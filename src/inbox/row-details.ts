// What GitHub's dashboard leaves out of a pull request's row (mergeability, reviewers and their verdict, line counts,
// failing checks, conversations), a query of the page's cache a PR: asked for by the inbox's rows as they come into
// view and by the PR page's stack card for its other entries, under one key, so what either found the other shows at
// once (src/app/query-cache.tsx keeps it on the device).
import { hashKey, useQueries, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { askedTogether } from '../app/asked-together';
import type { DataSource } from '../app/data-source';
import type { PrEnrichment, PrSummary, RepoRef, StackEntry, ViewResult } from '../lib/model';
import type { MergeMethod } from '../lib/rpc';

/**
 * What GitHub's dashboard leaves out of the rows (mergeability, reviewers, line counts, failing checks), by PR id, a query
 * a row, asked for once the row is wanted (an inbox row within 200px of view, a stack entry on show): up to 10 rows a
 * request and one request at a time, so with the content script asking GitHub about 3 PRs at once the page never has
 * more than that in flight. A row is asked again once it has been updated, or its checks or the merge method have
 * changed, and kept 2 minutes; until the new answer comes, and wherever it misses something, what was found before
 * stays, from the cache too. A request that fails leaves its rows as they were, and says so in the console.
 */
export function useRowEnrichment(source: DataSource, rows: StackEntry[], mergeMethod: MergeMethod) {
  const queryClient = useQueryClient();
  // The rows shown so far, as they were when shown (rowVersion).
  const [shown, setShown] = useState<ReadonlySet<string>>(new Set());
  // Rows that come into view together (the first paint, a section opening, a scroll) share a request. One that fails
  // leaves its rows as the dashboard showed them.
  const askForRow = useMemo(
    () =>
      askedTogether(
        async (prs: StackEntry[]) => {
          try {
            return await source.enrichInbox(prs.map(({ repo, number, state, isDraft, author, ci }) => ({ repo, number, state, isDraft, author, ci: { state: ci.state } })));
          } catch (error) {
            console.debug('[gg]', 'enriching inbox rows failed; they keep what the dashboard said:', error instanceof Error ? error.message : error);
            return prs.map((): PrEnrichment => ({}));
          }
        },
        { perRequest: 10, atOnce: 1, gatherMs: 50 },
      ),
    [source],
  );
  const found = useQueries({
    queries: rows.map((pr) => ({
      queryKey: ['inbox-row', ...rowVersion(pr), mergeMethod],
      queryFn: async () => ({ ...enrichmentFoundBefore(queryClient).get(pr.id), ...(await askForRow(pr)) }),
      staleTime: 2 * 60_000,
      enabled: shown.has(hashKey(rowVersion(pr))),
    })),
    combine: (results) => {
      const before = results.some((result) => result.data === undefined) ? enrichmentFoundBefore(queryClient) : null;
      return new Map(rows.flatMap((pr, index) => {
        const enrichment = results[index]?.data ?? before?.get(pr.id);
        return enrichment ? [[pr.id, { enrichment }] as const] : [];
      }));
    },
  });

  function want(pr: StackEntry) {
    const version = hashKey(rowVersion(pr));
    if (!shown.has(version)) setShown((current) => new Set(current).add(version));
  }

  return { found, want };
}

/**
 * The row the inbox last showed for a PR, in a section or a "Load more" page, the latest first; undefined when the inbox
 * has not shown it.
 */
export function inboxRowFor(queryClient: QueryClient, repo: RepoRef, number: number): PrSummary | undefined {
  return ['inbox', 'inbox-page']
    .flatMap((queryKey) =>
      queryClient
        .getQueryCache()
        .findAll({ queryKey: [queryKey], predicate: ({ state }) => state.data !== undefined })
        .sort((a, b) => b.state.dataUpdatedAt - a.state.dataUpdatedAt),
    )
    .flatMap((query) => (query.state.data as ViewResult).prs)
    .find((pr) => pr.number === number && pr.repo.owner.toLowerCase() === repo.owner.toLowerCase() && pr.repo.name.toLowerCase() === repo.name.toLowerCase());
}

/** The latest enrichment found for each row, by PR id, whatever the row looked like then. */
export function enrichmentFoundBefore(queryClient: QueryClient): Map<string, PrEnrichment> {
  const queries = queryClient.getQueryCache().findAll({ queryKey: ['inbox-row'] });
  const latest = new Map<string, { at: number; enrichment: PrEnrichment }>();
  for (const { queryKey, state } of queries) {
    const id = queryKey[1] as string;
    if (state.data !== undefined && state.dataUpdatedAt > (latest.get(id)?.at ?? -1)) latest.set(id, { at: state.dataUpdatedAt, enrichment: state.data as PrEnrichment });
  }
  return new Map([...latest].map(([id, { enrichment }]) => [id, enrichment]));
}

/** What a row's enrichment goes by: the PR, and what the dashboard says of it that would change the answer. */
function rowVersion(pr: StackEntry) {
  return [pr.id, pr.updatedAt, pr.state, pr.isDraft, pr.ci.state];
}
