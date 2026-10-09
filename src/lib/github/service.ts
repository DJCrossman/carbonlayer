// The operations the background's RPC handlers call, each with the user's token. Reads are cached for a
// short while in the service worker's memory so moving around a stack or back to the inbox is instant.

import type { PrDetail, RepoRef, View, ViewResult } from '../model';
import { graphql } from './client';
import { searchInbox, viewSearches } from './inbox';
import { fetchPullRequest } from './pull-request';
import { VIEWER } from './queries';

export async function authStatus(token: string): Promise<{ ok: boolean; login: string | null; error: string | null }> {
  if (!token) return { ok: false, login: null, error: 'Add a GitHub token in the extension options' };
  try {
    const data = await graphql<{ viewer: { login: string } }>(token, VIEWER, {});
    return { ok: true, login: data.viewer.login, error: null };
  } catch (error) {
    return { ok: false, login: null, error: error instanceof Error ? error.message : String(error) };
  }
}

/** Every view's PRs, cached for 60 s by the queries GitHub actually sees. */
export async function fetchInbox(token: string, views: View[], scope: string, force = false): Promise<ViewResult[]> {
  const searches = viewSearches(views, scope);
  const results = await cached(token, `inbox:${JSON.stringify(searches)}`, 60_000, force, () => searchInbox(token, searches));
  // Results are index-aligned with `views`; the views themselves are not cached so renames show at once.
  return results.map((result, i) => ({ view: views[i]!, ...result }));
}

/** One PR page, cached for 30 s. */
export async function fetchPr(token: string, repo: RepoRef, number: number, force = false): Promise<PrDetail> {
  const key = `pr:${repo.owner}/${repo.name}#${number}`.toLowerCase();
  const detail = await cached(token, key, 30_000, force, () => fetchPullRequest(token, repo, number));
  // Mutations name a PR or a review thread; remember which cached page each belongs to.
  pageKeyBySubjectId.set(detail.id, key);
  for (const thread of detail.threads) pageKeyBySubjectId.set(thread.id, key);
  return detail;
}

/** Runs a mutation on `subjectId` (a PR or review thread), then forgets that PR's page and every inbox. */
export async function mutate(token: string, subjectId: string, mutation: string, variables: Record<string, unknown>): Promise<undefined> {
  try {
    await graphql(token, mutation, variables);
  } finally {
    const pageKey = pageKeyBySubjectId.get(subjectId);
    if (pageKey) cache.delete(pageKey);
    for (const key of cache.keys()) if (key.startsWith('inbox:')) cache.delete(key);
  }
  return undefined;
}

/** Shares one in-flight or fresh load per key; failures are not kept. Switching tokens starts afresh. */
function cached<T>(token: string, key: string, ttlMs: number, force: boolean, load: () => Promise<T>): Promise<T> {
  if (token !== cacheToken) {
    cache.clear();
    pageKeyBySubjectId.clear();
    cacheToken = token;
  }
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
const pageKeyBySubjectId = new Map<string, string>();
let cacheToken = '';
