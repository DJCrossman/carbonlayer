// The PR page's data as its stages arrive (PrStages in src/lib/model.ts), each a query of the page's cache
// (src/app/query-cache.tsx). Every stage loads at once and on its own; each part of the page renders from the stages it
// needs, with a skeleton until they arrive and an inline error, with a retry, for one that failed. What the viewer saw
// last shows at once from the cache while the page asks GitHub again; a PR the viewer has not opened but the inbox or a
// stack card showed stands in with what its row or entry said. A write reloads only the stages it changed.
import { useQueries, useQueryClient, type QueryClient, type UseQueryResult } from '@tanstack/react-query';
import { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { z } from 'zod/mini';
import { askedTogether } from '../app/asked-together';
import type { DataSource } from '../app/data-source';
import { KEPT_STAGES, SaveCacheNow } from '../app/query-cache';
import { enrichmentFoundBefore, inboxRowFor } from '../inbox/row-details';
import { patchOf } from '../lib/github-web/files';
import { SIGNED_OUT } from '../lib/github-web/session';
import { prStagesSchema, stackBranchesSchema, type ChangedFile, type ChangedFileDiff, type PrDetail, type PrStage, type PrStages, type PrSummary, type RepoRef, type ReviewThread, type StackEntry, type TimelineItem } from '../lib/model';
import type { LineRange } from '../lib/rpc';
import { fileContentsFrom, filesInTreeOrder, fileTree } from './diff';

/**
 * Loads every stage of a PR's page and keeps each as it arrives. The diffs GitHub does not send with the file list follow
 * it 20 files a request, four requests at a time, in the order the files show, so the first files fill in first.
 * `reload` loads stages again (keeping what they showed meanwhile) and rejects with the first failure. Coming back to the
 * page once a stage is 30 s old asks GitHub for it again in the background; the diffs follow the head commit, loading
 * again only once it moved, and those the cache has for the head it had show while the page asks. A stage GitHub does not
 * answer then keeps what it showed. Until a stage first arrives, what the inbox or a stack showed of the PR stands in for
 * it, where it can (`placeholder`).
 */
export function usePrPageData(source: DataSource, repo: RepoRef, number: number): { data: PrPageData; reload: (stages: readonly PrStage[]) => Promise<void> } {
  const { owner, name } = repo;
  const queryClient = useQueryClient();
  const [standingIn] = useState(() => stagesStandingIn(queryClient, repo, number));
  const stageQuery = <S extends PrStage>(stage: S) => ({
    ...prStageQuery(source, { owner, name }, number, stage),
    // Opening the page asks GitHub, whatever the cache had.
    refetchOnMount: 'always' as const,
    // The files follow the head commit (below).
    staleTime: stage === 'files' ? Infinity : 30_000,
    placeholderData: standingIn[stage],
  });
  // In PR_STAGES' order, the header first.
  const stages = useQueries({
    queries: [stageQuery('header'), stageQuery('stack'), stageQuery('activity'), stageQuery('files'), stageQuery('threads'), stageQuery('mergeBox'), stageQuery('checks'), stageQuery('meta')],
    combine: ([header, stack, activity, files, threads, mergeBox, checks, meta]) => ({ header, stack, activity, files, threads, mergeBox, checks, meta }),
  });
  const signedOut = stages.header.error?.message === SIGNED_OUT;

  // The diffs GitHub did not send with the file list, in the order the files show. They follow the head commit: those the
  // cache has for the header it had show at once, and asking GitHub waits for a header GitHub sent this page.
  const listed = stages.files.data;
  const cachedHead = stages.header.isPlaceholderData ? undefined : stages.header.data;
  const head = stages.header.isFetchedAfterMount ? stages.header.data : undefined;
  const missing = useMemo(() => (listed ? diffsToAsk(listed) : []), [listed]);
  const askForDiff = useMemo(() => askForDiffs(source, { owner, name }, number), [source, owner, name, number]);
  const diffs = useQueries({
    queries: cachedHead
      ? missing.map((path) => ({
          ...prDiffQuery(askForDiff, { owner, name }, number, cachedHead, path),
          // Signed out, the page says so and nothing else; while the file list loads again, which files changed may too.
          enabled: head !== undefined && !signedOut && !stages.files.isFetching,
        }))
      : [],
    combine: (results) => ({
      arrived: Object.fromEntries(
        missing.flatMap((path, index) => {
          const diff = results[index]?.data;
          return diff ? [[path, diff] as const] : [];
        }),
      ),
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
    (): PrPageData => ({
      header: stageShown(stages.header),
      stack: stageShown(stages.stack),
      activity: stageShown(stages.activity),
      files,
      threads: stageShown(stages.threads),
      mergeBox: stageShown(stages.mergeBox),
      checks: stageShown(stages.checks),
      meta: stageShown(stages.meta),
    }),
    [stages, files],
  );

  const reload = useCallback(
    (changed: readonly PrStage[]) =>
      queryClient.invalidateQueries({ queryKey: ['pr', owner, name, number], predicate: ({ queryKey }) => changed.some((stage) => stage === queryKey[4]) }, { throwOnError: true }),
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
 * The query for one stage of a PR's page, as the page asks it and as it is loaded ahead of a click. A stage the device does
 * not keep stays in this tab's memory for a while once no page shows it (IN_MEMORY_FOR_MS).
 */
export function prStageQuery<S extends PrStage>(
  source: DataSource,
  repo: RepoRef,
  number: number,
  stage: S,
): { queryKey: ['pr', string, string, number, S]; queryFn: () => Promise<PrStages[S]>; gcTime?: number } {
  return {
    queryKey: ['pr', repo.owner, repo.name, number, stage],
    queryFn: () => source.fetchPrStage(stage, repo, number),
    ...(!KEPT_STAGES.includes(stage) && { gcTime: IN_MEMORY_FOR_MS }),
  };
}

/**
 * Loads the page of a PR the viewer may open next (an inbox row or a stack entry the pointer rests on, a row selected
 * with j / k) into the cache, like Graphite, so opening it shows it at once: every stage, asked together as the page
 * asks them, the ones kept on the device saved there as soon as they have loaded, and once the header and the file list
 * are in, the diffs GitHub did not send with it; the timeline, files, threads and diffs stay in this tab's memory. One PR
 * at a time, the latest intent first, the three latest at most waiting, and none whose stages are 30 s fresh; the next PR
 * waits only for the stages kept on the device.
 */
export function useLoadAhead(source: DataSource): (pr: PrToLoad) => void {
  const queryClient = useQueryClient();
  const saveCacheNow = useContext(SaveCacheNow);
  const waiting = useRef<PrToLoad[]>([]);
  const loading = useRef(false);

  async function loadInTurn() {
    for (let pr = waiting.current.pop(); pr; pr = waiting.current.pop()) {
      const { repo, number } = pr;
      const asked = new Map(PR_STAGES.map((stage) => [stage, queryClient.prefetchQuery({ ...prStageQuery(source, repo, number, stage), staleTime: 30_000 })]));
      void Promise.all([asked.get('header'), asked.get('files')]).then(() => {
        // What the cache holds for each, read by its stage's schema.
        const header = z.optional(prStagesSchema.shape.header).parse(queryClient.getQueryData(prStageQuery(source, repo, number, 'header').queryKey));
        const listed = z.optional(prStagesSchema.shape.files).parse(queryClient.getQueryData(prStageQuery(source, repo, number, 'files').queryKey));
        if (!header || !listed) return;
        const askForDiff = askForDiffs(source, repo, number);
        for (const path of diffsToAsk(listed)) void queryClient.prefetchQuery(prDiffQuery(askForDiff, repo, number, header, path));
      });
      await Promise.all(KEPT_STAGES.map((stage) => asked.get(stage)));
      // Saved at once rather than within the second, should the PR be opened some other way than here.
      await saveCacheNow();
    }
    loading.current = false;
  }

  return (pr: PrToLoad) => {
    waiting.current = [...waiting.current.filter((other) => other.id !== pr.id), pr].slice(-3);
    if (loading.current) return;
    loading.current = true;
    void loadInTurn();
  };
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
    stackSection: null,
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
    files: listed ? listed.files.map((file) => ({ ...file, ...(listed.diffs[file.path] ?? { patch: null, previousPath: null, withheld: null, generated: false }) })) : NO_FILES,
    // Its own entry keeps GitHub's verdict on merging it as a stack, which only the stack has.
    stack: stack
      ? { ...stack, entries: stack.entries.map((entry, index) => (index === stack.currentIndex ? { ...summary, readyToMergeAsStack: entry.readyToMergeAsStack } : entry)) }
      : { entries: [summary], currentIndex: 0, trunk: header.baseRefName, source: 'none' },
  };
}

/**
 * A stage of the PR page: loading (still showing what it had, if anything), arrived, failed, or, until it first arrives,
 * what the inbox or a stack showed of the PR in its place.
 */
export type StageState<T> =
  | { status: 'loading'; value: T | null }
  | { status: 'ready'; value: T }
  | { status: 'error'; value: T | null; error: string }
  | { status: 'placeholder'; value: T };

export type PrPageData = { [S in PrStage]: StageState<PrStages[S]> };

/** A PR the viewer may open next, as an inbox row or a stack entry names it. */
type PrToLoad = Pick<PrSummary, 'id' | 'repo' | 'number'>;

/** Every stage, the header first: the page's first request. */
const PR_STAGES: PrStage[] = ['header', 'stack', 'activity', 'files', 'threads', 'mergeBox', 'checks', 'meta'];

/**
 * How long this tab keeps a PR's timeline, files, threads and diffs once no page shows them, for a move back to it: the
 * device never keeps them, and a tab that moves between many PRs should not hold them all.
 */
const IN_MEMORY_FOR_MS = 30 * 60_000;

/**
 * What the inbox or a stack the page showed knows of this PR, in the place of the stages it can stand in for until theirs
 * arrive. The inbox's row (in a section or a "Load more" page) with its branches, else the PR's entry in the latest stack
 * that names it (a neighbour opened from its stack card), gives the header without its description; with the row details
 * found for it, the reviewers and merge status, and the checks. The row gives the labels; the stack, itself centred on
 * this PR. Nothing when neither has shown the PR. The stacks and branches the cache holds are read by their schemas.
 */
export function stagesStandingIn(queryClient: QueryClient, repo: RepoRef, number: number): Partial<PrStages> {
  const isThisPr = (pr: Pick<PrSummary, 'repo' | 'number'>) =>
    pr.number === number && pr.repo.owner.toLowerCase() === repo.owner.toLowerCase() && pr.repo.name.toLowerCase() === repo.name.toLowerCase();
  const row = inboxRowFor(queryClient, repo, number);
  const stack = queryClient
    .getQueryCache()
    .findAll({ queryKey: ['pr'], predicate: ({ queryKey, state }) => queryKey[4] === 'stack' && state.data !== undefined })
    .sort((a, b) => b.state.dataUpdatedAt - a.state.dataUpdatedAt)
    .map((query) => prStagesSchema.shape.stack.parse(query.state.data).stack)
    .find((candidate) => candidate.source !== 'none' && candidate.entries.some(isThisPr));
  const known = row ?? stack?.entries.find(isThisPr);
  if (!known) return {};
  const details = enrichmentFoundBefore(queryClient).get(known.id);
  const branches = z.optional(z.nullable(stackBranchesSchema)).parse(queryClient.getQueryData(['stack-branches', known.repo.owner, known.repo.name, known.number]));
  const pr: StackEntry = { ...known, ...details };
  const { id, title, url, author, state, isDraft, createdAt, updatedAt, mergedAt, additions, deletions, changedFiles, commentCount, nativeStack } = pr;
  return {
    // A stack entry whose page header GitHub did not answer names nobody; the page's own header will.
    ...(author && {
      header: {
        id,
        repo: pr.repo,
        number,
        title,
        url,
        author,
        state,
        isDraft,
        createdAt,
        updatedAt,
        mergedAt,
        additions,
        deletions,
        changedFiles,
        commentCount,
        nativeStack,
        headRefName: pr.headRefName || branches?.headRefName || '',
        baseRefName: pr.baseRefName || branches?.baseRefName || '',
        // Not on the row or the entry: the page's own header brings them.
        bodyHtml: '',
        descriptionUrl: null,
        descriptionReactions: [],
        headOid: '',
        viewerCanUpdate: false,
        viewerDidAuthor: false,
        viewerLogin: '',
        stackSource: stack?.source ?? (pr.nativeStack ? 'native' : 'none'),
      },
    }),
    ...(row && { meta: { labels: row.labels, assignees: [] } }),
    ...(stack && { stack: { stack: { ...stack, currentIndex: stack.entries.findIndex(isThisPr) } } }),
    ...(details?.reviewers && {
      mergeBox: {
        mergeStatus: pr.mergeStatus,
        reviewers: pr.reviewers,
        reviewDecision: pr.reviewDecision,
        viewerCanMerge: false,
        viewerCanEnableAutoMerge: false,
        allowedMergeMethods: ['MERGE', 'SQUASH', 'REBASE'],
        defaultMergeMethod: 'MERGE',
        autoMerge: pr.autoMerge,
        isInMergeQueue: pr.isInMergeQueue,
        stackSection: null,
      },
    }),
    ...(details?.ci && { checks: { ci: details.ci, requiredCheckNames: details.requiredCheckNames ?? [], emptyReason: null } }),
  };
}

/** The files whose diffs GitHub did not send with the list, in the order the files show: those asked for a batch at a time. */
function diffsToAsk(listed: PrStages['files']): string[] {
  return filesInTreeOrder(fileTree(listed.files.map((file): ChangedFile => ({ ...file, patch: null, previousPath: null, withheld: null, generated: false }))))
    .map((file) => file.path)
    .filter((path) => !(path in listed.diffs));
}

/** How a PR's diffs are asked of GitHub: 20 paths a request and four requests at a time; a path GitHub sent no diff for has none. */
function askForDiffs(source: DataSource, repo: RepoRef, number: number) {
  return askedTogether(
    async (paths: string[]) => {
      const diffs = await source.fetchPrFileDiffs(repo, number, paths);
      return paths.map((path) => diffs[path] ?? null);
    },
    { perRequest: 20, atOnce: 4 },
  );
}

/** The query for one file's diff on a head commit, as the page asks it and as it is loaded ahead of a click. */
function prDiffQuery(ask: (path: string) => Promise<ChangedFileDiff | null>, repo: RepoRef, number: number, head: Pick<PrStages['header'], 'headOid' | 'baseRefName'>, path: string) {
  return {
    queryKey: ['pr-diff', repo.owner, repo.name, number, head.headOid, head.baseRefName, path],
    queryFn: () => ask(path),
    // The same commit on the same base has the same diff.
    staleTime: Infinity,
    gcTime: IN_MEMORY_FOR_MS,
  };
}

/**
 * The query for a changed file's whole contents on both sides, on a head commit and base: what the first expand of the
 * unchanged lines its diff leaves out (`hidden`) asks GitHub for. Kept beside the file's diff in this tab's memory, never on
 * the device, for as long as the diff is: the same commit on the same base has the same file.
 */
export function prFileContentsQuery(source: DataSource, repo: RepoRef, number: number, head: Pick<PrStages['header'], 'headOid' | 'baseRefName'>, path: string, hidden: LineRange[]) {
  return {
    queryKey: ['pr-diff', repo.owner, repo.name, number, head.headOid, head.baseRefName, path, 'contents'],
    queryFn: async () => fileContentsFrom(await source.fetchPrDiffLines(repo, number, path, head.headOid, hidden)),
    staleTime: Infinity,
    gcTime: IN_MEMORY_FOR_MS,
  };
}

/**
 * The query for the diff GitHub held back from a changed file's entry (a generated file, one too big, or a deleted one),
 * on a head commit and base: its whole diff, asked the way GitHub's "Load Diff" asks for it (diff_entry_lines without
 * ranges), as a patch. Kept beside the file's diff in this tab's memory, never on the device, for as long as the diff is:
 * the same commit on the same base has the same diff.
 */
export function prHeldBackDiffQuery(source: DataSource, repo: RepoRef, number: number, head: Pick<PrStages['header'], 'headOid' | 'baseRefName'>, path: string) {
  return {
    queryKey: ['pr-diff', repo.owner, repo.name, number, head.headOid, head.baseRefName, path, 'held-back'],
    queryFn: async () => {
      const patch = patchOf({ path, diffLines: await source.fetchPrDiffLines(repo, number, path, head.headOid, []) });
      if (patch === null) throw new Error('GitHub sent no lines for this file');
      return patch;
    },
    staleTime: Infinity,
    gcTime: IN_MEMORY_FOR_MS,
  };
}

/**
 * What the page shows of a stage: once it has arrived, what it has, through a reload or a return to the page that GitHub
 * does not answer; before that, its first failure, with a retry.
 */
function stageShown<T,>(query: UseQueryResult<T>): StageState<T> {
  if (query.isPlaceholderData) return { status: 'placeholder', value: query.data };
  if (query.data !== undefined) return { status: query.isFetching ? 'loading' : 'ready', value: query.data };
  if (query.isError && !query.isFetching) return { status: 'error', value: null, error: query.error.message };
  return { status: 'loading', value: null };
}

const NO_TIMELINE: TimelineItem[] = [];
const NO_THREADS: ReviewThread[] = [];
const NO_FILES: ChangedFile[] = [];
