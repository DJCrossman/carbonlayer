// Answers the app's RPC requests with the user's github.com session: same-origin requests from the content
// script to the endpoints GitHub's own React UI uses (docs/research/github-web-*.md). No token, no api.github.com.
// Reads are cached briefly in the content script's memory; any successful write clears that cache.

import type { RpcMethod, RpcMethods, RpcRequest, RpcResponse } from '../rpc';
import { getSettings } from '../settings';
import { enrichPull, fetchInbox, fetchViewPage } from './inbox';
import { mutations, pullRequestFor, rememberPullRequest } from './mutations';
import { fetchPullRequestPage } from './pull-request';
import { repositoryCandidatesFrom, repositoryPickerPath } from './repositories';
import { reviewerCandidatesFrom } from './reviews';
import { getJson, noteShape, politely } from './session';

export async function handleRpc(request: RpcRequest): Promise<RpcResponse> {
  try {
    if (!Object.hasOwn(handlers, request.method)) throw new Error(`Unknown request: ${String(request.method)}`);
    // The table is typed per method; this one call site cannot express the method/args correlation.
    const handler = handlers[request.method] as (args: unknown) => Promise<RpcMethods[RpcMethod]['result']>;
    const result = await handler(request.args);
    if (Object.hasOwn(mutations, request.method)) cache.clear();
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
    // Three pull requests at a time (each a merge box and a diffstat request), each answer kept for 2 minutes.
    return politely(prs, 3, (pr) =>
      cached(`enrich:${pr.repo.owner}/${pr.repo.name}#${pr.number}:${pr.state}:${pr.isDraft}:${mergeMethod}`.toLowerCase(), 120_000, false, () => enrichPull(pr, mergeMethod)),
    );
  },
  'repos.search': async ({ query }) => {
    // The picker asks again after every pause in typing; what it asked in the last minute is answered from memory.
    const path = repositoryPickerPath(query.trim());
    const data = await cached(`repos:${path}`, 60_000, false, () => getJson<unknown>(path));
    noteShape('repositories/picker/search', data);
    return repositoryCandidatesFrom(data);
  },
  'pr.fetch': async ({ repo, number, force }) => {
    const { mergeMethod } = await getSettings();
    const key = `pr:${repo.owner}/${repo.name}#${number}:${mergeMethod}`.toLowerCase();
    const detail = await cached(key, 30_000, force, () => fetchPullRequestPage(repo, number, mergeMethod));
    rememberPullRequest(detail);
    return detail;
  },
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
