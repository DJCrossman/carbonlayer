// The PR page's data as its stages arrive (PrStages in src/lib/model.ts), each a query of the page's cache
// (src/app/query-cache.tsx). Every stage loads at once and on its own; each part of the page renders from the stages it
// needs, with a skeleton until they arrive and an inline error, with a retry, for one that failed. What the viewer saw
// last shows at once from the cache while the page asks GitHub again. A write reloads only the stages it changed.
import { useQueries, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef } from 'react';
import { askedTogether } from '../app/asked-together';
import type { DataSource } from '../app/data-source';
import { SIGNED_OUT } from '../lib/github-web/session';
import type { ChangedFile, ChangedFileDiff, PrDetail, PrStage, PrStages, PrSummary, RepoRef, ReviewThread, TimelineItem } from '../lib/model';
import { filesInTreeOrder, fileTree } from './diff';

/**
 * Loads every stage of a PR's page and keeps each as it arrives. The diffs GitHub does not send with the file list follow
 * it 20 files a request, four requests at a time, in the order the files show, so the first files fill in first.
 * `reload` loads stages again (keeping what they showed meanwhile) and rejects with the first failure. Coming back to the
 * page once a stage is 30 s old asks GitHub for it again in the background; the diffs follow the head commit, loading
 * again only once it moved. A stage GitHub does not answer then keeps what it showed.
 */
export function usePrPageData(source: DataSource, repo: RepoRef, number: number): { data: PrPageData; reload: (stages: readonly PrStage[]) => Promise<void> } {
  const { owner, name } = repo;
  const queryClient = useQueryClient();
  const stages = useQueries({
    queries: PR_STAGES.map((stage) => ({
      queryKey: ['pr', owner, name, number, stage],
      queryFn: () => source.fetchPrStage(stage, { owner, name }, number),
      // Opening the page asks GitHub, whatever the cache had.
      refetchOnMount: 'always' as const,
      // The files follow the head commit (below).
      staleTime: stage === 'files' ? Infinity : 30_000,
    })),
    combine: (results) => Object.fromEntries(PR_STAGES.map((stage, index) => [stage, results[index]!])) as { [S in PrStage]: UseQueryResult<PrStages[S]> },
  });
  const signedOut = stages.header.error?.message === SIGNED_OUT;

  // The diffs GitHub did not send with the file list, in the order the files show. They follow the head commit, so they
  // wait for a header GitHub sent this page rather than the one the cache had.
  const listed = stages.files.data;
  const head = stages.header.isFetchedAfterMount ? stages.header.data : undefined;
  const missing = useMemo(
    () =>
      listed
        ? filesInTreeOrder(fileTree(listed.files.map((file): ChangedFile => ({ ...file, patch: null, previousPath: null }))))
            .map((file) => file.path)
            .filter((path) => !(path in listed.diffs))
        : [],
    [listed],
  );
  // 20 paths a request and four requests at a time; a path GitHub sent no diff for has none.
  const askForDiff = useMemo(
    () =>
      askedTogether(
        async (paths: string[]) => {
          const diffs = await source.fetchPrFileDiffs({ owner, name }, number, paths);
          return paths.map((path) => diffs[path] ?? null);
        },
        { perRequest: 20, atOnce: 4 },
      ),
    [source, owner, name, number],
  );
  const diffs = useQueries({
    queries: head
      ? missing.map((path) => ({
          queryKey: ['pr-diff', owner, name, number, head.headOid, head.baseRefName, path],
          queryFn: () => askForDiff(path),
          // The same commit on the same base has the same diff.
          staleTime: Infinity,
          // Signed out, the page says so and nothing else; while the file list loads again, which files changed may too.
          enabled: !signedOut && !stages.files.isFetching,
        }))
      : [],
    combine: (results) => ({
      arrived: Object.fromEntries(results.flatMap((result, index) => (result.data ? [[missing[index]!, result.data]] : []))),
      failure: results.find((result) => result.isError && !result.isFetching)?.error?.message ?? null,
      waiting: results.some((result) => result.data === undefined),
    }),
  });

  // A file shows the diff it had until its new one arrives.
  const shownDiffs = useRef<Record<string, ChangedFileDiff>>({});
  const files = useMemo((): StageState<PrStages['files']> => {
    if (!listed) return stageShown(stages.files);
    shownDiffs.current = { ...shownDiffs.current, ...listed.diffs, ...diffs.arrived };
    const value = { ...listed, diffs: shownDiffs.current };
    if (diffs.failure) return { status: 'error', value, error: diffs.failure };
    const loading = stages.files.isFetching || diffs.waiting || (!head && missing.length > 0);
    return { status: loading ? 'loading' : 'ready', value };
  }, [listed, stages.files, diffs, head, missing]);

  const data = useMemo(
    () => ({ ...(Object.fromEntries(PR_STAGES.map((stage) => [stage, stageShown(stages[stage] as UseQueryResult<unknown>)])) as PrPageData), files }),
    [stages, files],
  );

  const reload = useCallback(
    (changed: readonly PrStage[]) =>
      queryClient.invalidateQueries({ queryKey: ['pr', owner, name, number], predicate: ({ queryKey }) => changed.includes(queryKey[4] as PrStage) }, { throwOnError: true }),
    [queryClient, owner, name, number],
  );

  // The diffs follow the head commit: the same commit on the same base has the same diffs, so the file list loads again
  // only once a header finds the branch moved on or the pull request retargeted.
  const headAt = head ? `${head.baseRefName} ${head.headOid}` : null;
  const filesHead = useRef(headAt);
  useEffect(() => {
    if (headAt === null || headAt === filesHead.current) return;
    const first = filesHead.current === null;
    filesHead.current = headAt;
    // The first header's files are loading alongside it.
    if (!first) void queryClient.invalidateQueries({ queryKey: ['pr', owner, name, number, 'files'] });
  }, [headAt, queryClient, owner, name, number]);

  return { data, reload };
}

/**
 * The PR as far as the page has it: the header and every stage that has arrived, and for each stage still loading (or
 * failed) what the page shows without it. Its own entry in the stack is this PR as the page has it.
 */
export function prDetailFrom(header: PrStages['header'], data: PrPageData): PrDetail {
  const mergeBox: PrStages['mergeBox'] = data.mergeBox.value ?? {
    mergeStatus: header.isDraft ? 'DRAFT' : 'UNKNOWN',
    reviewers: [],
    reviewDecision: 'NONE',
    viewerCanMerge: false,
    viewerCanEnableAutoMerge: false,
    allowedMergeMethods: ['MERGE', 'SQUASH', 'REBASE'],
    defaultMergeMethod: 'MERGE',
    autoMerge: null,
    isInMergeQueue: false,
  };
  const checks: PrStages['checks'] = data.checks.value ?? { ci: { state: 'NONE', checks: [], counts: { success: 0, failure: 0, pending: 0, other: 0 } }, requiredCheckNames: [], emptyReason: null };
  const meta: PrStages['meta'] = data.meta.value ?? { labels: [], assignees: [] };
  const listed = data.files.value;
  const stack = data.stack.value?.stack;
  // Counted from the threads the page shows, so the PR's own entry in the stack follows a resolve once they reload.
  const threads = data.threads.value?.threads;
  const conversations = threads ? { resolved: threads.filter((thread) => thread.isResolved).length, total: threads.length } : null;
  const summary: PrSummary = { ...header, ...mergeBox, ...checks, labels: meta.labels, unread: null, conversations };
  return {
    ...header,
    ...mergeBox,
    ...checks,
    ...meta,
    unread: null,
    conversations,
    // Lists that have not arrived stay the same empty list, so the diffs they feed are not rendered again for nothing.
    timeline: data.activity.value?.timeline ?? NO_TIMELINE,
    threads: data.threads.value?.threads ?? NO_THREADS,
    unresolvedThreadCount: data.threads.value?.unresolvedThreadCount ?? 0,
    baseOid: listed?.baseOid ?? '',
    files: listed ? listed.files.map((file) => ({ ...file, ...(listed.diffs[file.path] ?? { patch: null, previousPath: null }) })) : NO_FILES,
    stack: stack
      ? { ...stack, entries: stack.entries.map((entry, index) => (index === stack.currentIndex ? summary : entry)) }
      : { entries: [summary], currentIndex: 0, trunk: header.baseRefName, source: 'none' },
  };
}

/** A stage of the PR page: loading (still showing what it had, if anything), arrived, or failed. */
export type StageState<T> = { status: 'loading'; value: T | null } | { status: 'ready'; value: T } | { status: 'error'; value: T | null; error: string };

export type PrPageData = { [S in PrStage]: StageState<PrStages[S]> };

/** Every stage, the header first: the page's first request. */
const PR_STAGES: PrStage[] = ['header', 'stack', 'activity', 'files', 'threads', 'mergeBox', 'checks', 'meta'];

/**
 * What the page shows of a stage: once it has arrived, what it has, through a reload or a return to the page that GitHub
 * does not answer; before that, its first failure, with a retry.
 */
function stageShown<T>(query: UseQueryResult<T>): StageState<T> {
  if (query.data !== undefined) return { status: query.isFetching ? 'loading' : 'ready', value: query.data };
  if (query.isError && !query.isFetching) return { status: 'error', value: null, error: query.error.message };
  return { status: 'loading', value: null };
}

const NO_TIMELINE: TimelineItem[] = [];
const NO_THREADS: ReviewThread[] = [];
const NO_FILES: ChangedFile[] = [];
