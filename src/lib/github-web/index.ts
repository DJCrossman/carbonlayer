// Answers the app's RPC requests with the user's github.com session: same-origin requests from the content
// script to the endpoints GitHub's own React UI uses (docs/research/github-web-*.md). No token, no api.github.com.
// The page's own cache (src/app/query-cache.tsx) decides when to ask again, so reads go to GitHub; only the reviewer
// picker's and `pr.fetch`'s are kept briefly here, and pr-stages.ts shares a request between the PR page's stages while
// it is on its way. Any successful write clears what is kept, and stops sharing the requests made before it.

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
  'inbox.fetch': async ({ views }) => fetchInbox(views, (await getSettings()).inboxScope),
  'inbox.fetchMore': async ({ view, page }) => fetchViewPage(view, (await getSettings()).inboxScope, page),
  'inbox.enrich': async ({ prs }) => {
    const { mergeMethod } = await getSettings();
    // The viewer's own review is found by the login of the github.com page this script runs in.
    const viewerLogin = document.querySelector('meta[name="user-login"]')?.getAttribute('content') || null;
    // Three pull requests at a time, each up to four page_data requests.
    return politely(prs, 3, (pr) => enrichPull(pr, mergeMethod, viewerLogin));
  },
  'inbox.branches': ({ prs }) =>
    // Six pull requests at a time; one GitHub does not answer has no branches.
    politely(prs, 6, ({ repo, number }) =>
      getJson<unknown>(`/${repo.owner}/${repo.name}/pull/${number}/page_data/header`)
        .then((header) => branchesIn(header, repo))
        .catch((error: unknown) => {
          console.debug('[gg]', `page_data/header for ${repo.owner}/${repo.name}#${number} failed; the row waits for its merge box to name its branches:`, error instanceof Error ? error.message : error);
          return null;
        }),
    ),
  'repos.search': async ({ query, owner }) =>
    pickableRepositories(query.trim(), owner ?? null, async (path) => {
      const data = await getJson<unknown>(path);
      noteShape('repositories/picker/search', data);
      return data;
    }),
  'repos.top': ({ cursor }) => (cursor === undefined || cursor === null ? topRepositories() : topRepositories(cursor)),
  'orgs.list': () =>
    // Who is signed in is the github.com page's own business.
    listOrganizations({ json: getJson, page: getPage }, document.querySelector('meta[name="user-login"]')?.getAttribute('content') || null),
  'orgs.people': ({ org }) => organizationPeople(org, getPage),
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
