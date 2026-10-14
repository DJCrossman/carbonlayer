// Answers the app's RPC requests with the user's github.com session: same-origin requests from the content
// script to the endpoints GitHub's own React UI uses (docs/research/github-web-*.md). No token, no api.github.com.
// Reads are cached briefly in the content script's memory, except the PR page's stages, which the page's own cache
// keeps (pr-stages.ts only shares a request while it is on its way); any successful write clears that cache, and stops
// sharing the requests made before it.

import type { RpcMethod, RpcMethods, RpcRequest, RpcResponse } from '../rpc';
import { getSettings } from '../settings';
import { branchesIn, enrichPull, fetchInbox, fetchViewPage } from './inbox';
import { mutations, pullRequestFor, rememberPullRequest } from './mutations';
import { fetchFileDiffs, fetchPrStage, forgetPrAnswers } from './pr-stages';
import { fetchPullRequestPage } from './pull-request';
import { listOrganizations } from './organizations';
import { organizationPeople } from './people';
import { pickableRepositories, topRepositories } from './repositories';
import { reviewerCandidatesFrom } from './reviews';
import { getJson, getPage, noteShape, politely, render } from './session';

export async function handleRpc(request: RpcRequest): Promise<RpcResponse> {
  try {
    if (!Object.hasOwn(handlers, request.method)) throw new Error(`Unknown request: ${String(request.method)}`);
    // The table is typed per method; this one call site cannot express the method/args correlation.
    const handler = handlers[request.method] as (args: unknown) => Promise<RpcMethods[RpcMethod]['result']>;
    const result = await handler(request.args);
    if (Object.hasOwn(mutations, request.method)) {
      cache.clear();
      forgetPrAnswers();
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
  'inbox.branches': ({ prs }) =>
    // Six pull requests at a time, each header asked once in 10 minutes; one GitHub does not answer has no branches.
    politely(prs, 6, ({ repo, number }) =>
      cached(`branches:${repo.owner}/${repo.name}#${number}`.toLowerCase(), 600_000, false, async () =>
        branchesIn(await getJson<unknown>(`/${repo.owner}/${repo.name}/pull/${number}/page_data/header`), repo),
      ).catch((error: unknown) => {
        console.debug('[gg]', `page_data/header for ${repo.owner}/${repo.name}#${number} failed; the row waits for its merge box to name its branches:`, error instanceof Error ? error.message : error);
        return null;
      }),
    ),
  'repos.search': async ({ query, owner }) =>
    // The picker asks again after every pause in typing; what it asked in the last minute is answered from memory.
    pickableRepositories(query.trim(), owner ?? null, async (path) => {
      const data = await cached(`repos:${path}`, 60_000, false, () => getJson<unknown>(path));
      noteShape('repositories/picker/search', data);
      return data;
    }),
  'repos.top': ({ cursor }) =>
    // The homepage's list changes slowly: its first page is asked for once in 10 minutes, every "Show more" afresh.
    cursor === undefined || cursor === null ? cached('repos.top', 600_000, false, () => topRepositories()) : topRepositories(cursor),
  'orgs.list': () =>
    // Who is signed in is the github.com page's own business; the list is asked for once in 10 minutes.
    cached('orgs', 600_000, false, () =>
      listOrganizations({ json: getJson, page: getPage }, document.querySelector('meta[name="user-login"]')?.getAttribute('content') || null),
    ),
  'orgs.people': ({ org }) =>
    // An organization's people change slowly: each one's are asked for once in 10 minutes.
    cached(`people:${org.login}`.toLowerCase(), 600_000, false, () => organizationPeople(org, getPage)),
  'pr.fetch': async ({ repo, number, force }) => {
    const { mergeMethod } = await getSettings();
    const key = `pr:${repo.owner}/${repo.name}#${number}:${mergeMethod}`.toLowerCase();
    const detail = await cached(key, 30_000, force, () => fetchPullRequestPage(repo, number));
    rememberPullRequest(detail);
    return detail;
  },
  // The PR page, a stage at a time; pr-stages.ts shares GitHub's answers between the stages that ask at once.
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
  'markdown.preview': async ({ text, prId }) => {
    // The fields GitHub's own comment box sends for a comment on a pull request (docs/research/github-web-mutations.md).
    const pull = pullRequestFor(prId);
    return {
      html: await render('/preview', {
        text,
        issue: pull.databaseId,
        repository: pull.repositoryDatabaseId,
        project: pull.databaseId,
        subject: String(pull.number),
        subject_type: 'PullRequest',
      }),
    };
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
