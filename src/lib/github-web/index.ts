// Answers the app's RPC requests with the user's github.com session: same-origin requests from the content
// script to the endpoints GitHub's own React UI uses (docs/research/github-web-*.md). No token, no api.github.com.
// Reads are cached briefly in the content script's memory; any successful write clears that cache, and forgets the
// stages of the PR page it changes (pr-stages.ts keeps those).

import { STAGES_A_WRITE_CHANGES, type RpcMethod, type RpcMethods, type RpcRequest, type RpcResponse } from '../rpc';
import { getSettings } from '../settings';
import { enrichPull, fetchInbox, fetchViewPage } from './inbox';
import { mutations, pullRequestFor, rememberPullRequest } from './mutations';
import { fetchFileDiffs, fetchPrStage, forgetPrStages } from './pr-stages';
import { fetchPullRequestPage } from './pull-request';
import { listOrganizations } from './organizations';
import { pickableRepositories } from './repositories';
import { reviewerCandidatesFrom } from './reviews';
import { getJson, getPage, noteShape, politely } from './session';

export async function handleRpc(request: RpcRequest): Promise<RpcResponse> {
  try {
    if (!Object.hasOwn(handlers, request.method)) throw new Error(`Unknown request: ${String(request.method)}`);
    // The table is typed per method; this one call site cannot express the method/args correlation.
    const handler = handlers[request.method] as (args: unknown) => Promise<RpcMethods[RpcMethod]['result']>;
    const result = await handler(request.args);
    if (Object.hasOwn(mutations, request.method)) {
      cache.clear();
      forgetPrStages(STAGES_A_WRITE_CHANGES[request.method as keyof typeof mutations]);
    }
    return { kind: 'gg-rpc-result', id: request.id, ok: true, result };
  } catch (error) {
    return { kind: 'gg-rpc-result', id: request.id, ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

const handlers: { [M in RpcMethod]: (args: RpcMethods[M]['args']) => Promise<RpcMethods[M]['result']> } = {
  'inbox.fetch': async ({ views, force }) => {
    const { inboxScope } = await getSettings();
    // Keyed by the queries as saved: resolved, their relative times change every second.
    const key = `inbox:${JSON.stringify([inboxScope, views.map((view) => [view.query, view.limit])])}`;
    const results = await cached(key, 60_000, force, () => fetchInbox(views, inboxScope));
    // Results are index-aligned with `views`; the views themselves are not cached so renames show at once.
    return results.map((result, i) => ({ ...result, view: views[i]! }));
  },
  'inbox.fetchMore': async ({ view, page }) => {
    const { inboxScope } = await getSettings();
    const key = `inbox-page:${JSON.stringify([inboxScope, view.query, page])}`;
    return { ...(await cached(key, 60_000, false, () => fetchViewPage(view, inboxScope, page))), view };
  },
  'inbox.enrich': async ({ prs }) => {
    const { mergeMethod } = await getSettings();
    // The viewer's own review is found by the login of the github.com page this script runs in.
    const viewerLogin = document.querySelector('meta[name="user-login"]')?.getAttribute('content') || null;
    // Three pull requests at a time (each up to four page_data requests), each answer kept for 2 minutes.
    return politely(prs, 3, (pr) =>
      cached(`enrich:${pr.repo.owner}/${pr.repo.name}#${pr.number}:${pr.state}:${pr.isDraft}:${pr.ci.state}:${mergeMethod}`.toLowerCase(), 120_000, false, () =>
        enrichPull(pr, mergeMethod, viewerLogin),
      ),
    );
  },
  'repos.search': async ({ query, owner }) =>
    // The picker asks again after every pause in typing; what it asked in the last minute is answered from memory.
    pickableRepositories(query.trim(), owner ?? null, async (path) => {
      const data = await cached(`repos:${path}`, 60_000, false, () => getJson<unknown>(path));
      noteShape('repositories/picker/search', data);
      return data;
    }),
  'orgs.list': () =>
    // Who is signed in is the github.com page's own business; the list is asked for once in 10 minutes.
    cached('orgs', 600_000, false, () =>
      listOrganizations({ json: getJson, page: getPage }, document.querySelector('meta[name="user-login"]')?.getAttribute('content') || null),
    ),
  'pr.fetch': async ({ repo, number, force }) => {
    const { mergeMethod } = await getSettings();
    const key = `pr:${repo.owner}/${repo.name}#${number}:${mergeMethod}`.toLowerCase();
    const detail = await cached(key, 30_000, force, () => fetchPullRequestPage(repo, number));
    rememberPullRequest(detail);
    return detail;
  },
  // The PR page, a stage at a time; pr-stages.ts keeps GitHub's answers, shared between the stages.
  'pr.fetchHeader': (args) => fetchPrStage('header', args),
  'pr.fetchActivity': (args) => fetchPrStage('activity', args),
  'pr.fetchFiles': (args) => fetchPrStage('files', args),
  'pr.fetchFileDiffs': (args) => fetchFileDiffs(args),
  'pr.fetchThreads': (args) => fetchPrStage('threads', args),
  'pr.fetchMergeBox': (args) => fetchPrStage('mergeBox', args),
  'pr.fetchChecks': (args) => fetchPrStage('checks', args),
  'pr.fetchStack': (args) => fetchPrStage('stack', args),
  'pr.fetchMeta': (args) => fetchPrStage('meta', args),
  'pr.reviewerCandidates': async ({ prId, query }) => {
    const { path } = pullRequestFor(prId);
    const q = query.trim();
    // The picker asks again after every pause in typing; what it asked in the last minute is answered from memory.
    const [available, suggested] = await Promise.all([
      cached(`reviewers:${path}?q=${q}`, 60_000, false, () => getJson<unknown>(`${path}/page_data/reviewers${q ? `?q=${encodeURIComponent(q)}` : ''}`)),
      cached(`suggested-reviewers:${path}`, 60_000, false, () => getJson<unknown>(`${path}/page_data/suggested_reviewers`)),
    ]);
    return reviewerCandidatesFrom(available, suggested, q);
  },
  ...mutations,
};


/** Shares one in-flight or fresh load per key for `ttlMs`; `force` reloads; failures are not kept. */
function cached<T>(key: string, ttlMs: number, force: boolean | undefined, load: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (!force && hit && hit.expiresAt > Date.now()) return hit.value as Promise<T>;
  const value = load();
  cache.set(key, { expiresAt: Date.now() + ttlMs, value });
  value.catch(() => {
    if (cache.get(key)?.value === value) cache.delete(key);
  });
  return value;
}

const cache = new Map<string, { expiresAt: number; value: Promise<unknown> }>();
