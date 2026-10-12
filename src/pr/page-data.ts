// The PR page's data as its stages arrive (PrStages in src/lib/model.ts). Every stage loads at once and on its own;
// each part of the page renders from the stages it needs, with a skeleton until they arrive and an inline error, with a
// retry, for one that failed. A write reloads only the stages it changed.
import { useCallback, useEffect, useRef, useState } from 'react';
import type { DataSource } from '../app/data-source';
import { politely, SIGNED_OUT } from '../lib/github-web/session';
import type { ChangedFile, PrDetail, PrStage, PrStages, PrSummary, RepoRef, ReviewThread, TimelineItem } from '../lib/model';
import { filesInTreeOrder, fileTree } from './diff';

/**
 * Loads every stage of a PR's page and keeps each as it arrives. The diffs GitHub does not send with the file list follow
 * it 20 files a request, four requests at a time, in the order the files show, so the first files fill in first.
 * `reload` loads stages again (keeping what they showed meanwhile) and rejects with the first failure.
 */
export function usePrPageData(source: DataSource, repo: RepoRef, number: number): { data: PrPageData; reload: (stages: readonly PrStage[], force?: boolean) => Promise<void> } {
  const [data, setData] = useState<PrPageData>(() => Object.fromEntries(PR_STAGES.map((stage) => [stage, { status: 'loading', value: null }])) as PrPageData);
  // Only the latest load of a stage may change it: one a later load overtook (a reload after a write) is dropped.
  const latestLoad = useRef<Partial<Record<PrStage, number>>>({});
  const mounted = useRef(true);
  const signedOut = useRef(false);
  const { owner, name } = repo;

  const reload = useCallback(
    async (stages: readonly PrStage[], force = false) => {
      const pr = { owner, name };
      const update = <S extends PrStage>(stage: S, next: (state: StageState<PrStages[S]>) => StageState<PrStages[S]>) =>
        setData((current) => ({ ...current, [stage]: next(current[stage]) }));
      const fail = <S extends PrStage>(stage: S, reason: unknown) => {
        const error = reason instanceof Error ? reason.message : String(reason);
        if (stage === 'header' && error === SIGNED_OUT) signedOut.current = true;
        update(stage, (state) => ({ status: 'error', value: state.value, error }));
        return error;
      };

      const load = async <S extends PrStage>(stage: S): Promise<string | null> => {
        const run = (latestLoad.current[stage] ?? 0) + 1;
        latestLoad.current[stage] = run;
        const isLatest = () => mounted.current && latestLoad.current[stage] === run;
        update(stage, (state) => ({ status: 'loading', value: state.value }));
        let value: PrStages[S];
        try {
          value = await source.fetchPrStage(stage, pr, number, force);
        } catch (reason) {
          return isLatest() ? fail(stage, reason) : null;
        }
        if (!isLatest()) return null;
        if (stage !== 'files') {
          update(stage, () => ({ status: 'ready', value }));
          return null;
        }

        const listed = value as PrStages['files'];
        update('files', () => ({ status: 'loading', value: listed }));
        const order = filesInTreeOrder(fileTree(listed.files.map((file): ChangedFile => ({ ...file, patch: null, previousPath: null }))));
        const missing = order.map((file) => file.path).filter((path) => !(path in listed.diffs));
        const batches = Array.from({ length: Math.ceil(missing.length / 20) }, (_, i) => missing.slice(i * 20, i * 20 + 20));
        const failures = await politely(batches, 4, async (paths) => {
          // Signed out, the page says so and nothing else: no point asking for more diffs.
          if (!isLatest() || signedOut.current) return null;
          try {
            const diffs = await source.fetchPrFileDiffs(pr, number, paths, force);
            if (isLatest()) update('files', (state) => (state.value ? { ...state, value: { ...state.value, diffs: { ...state.value.diffs, ...diffs } } } : state));
            return null;
          } catch (reason) {
            return reason;
          }
        });
        if (!isLatest()) return null;
        const failure = failures.find((reason) => reason !== null);
        if (failure !== undefined) return fail('files', failure);
        update('files', (state) => (state.value ? { status: 'ready', value: state.value } : state));
        return null;
      };

      const failure = (await Promise.all(stages.map((stage) => load(stage)))).find((error) => error !== null);
      if (failure) throw new Error(failure);
    },
    [source, owner, name, number],
  );

  useEffect(() => {
    mounted.current = true;
    // Each stage shows its own failure where it would have rendered.
    reload(PR_STAGES).catch(() => {});
    return () => {
      mounted.current = false;
    };
  }, [reload]);

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
  const checks: PrStages['checks'] = data.checks.value ?? { ci: { state: 'NONE', checks: [], counts: { success: 0, failure: 0, pending: 0, other: 0 } }, requiredCheckNames: [] };
  const meta: PrStages['meta'] = data.meta.value ?? { labels: [], assignees: [] };
  const listed = data.files.value;
  const stack = data.stack.value?.stack;
  const summary: PrSummary = { ...header, ...mergeBox, ...checks, labels: meta.labels, unread: null };
  return {
    ...header,
    ...mergeBox,
    ...checks,
    ...meta,
    unread: null,
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

const NO_TIMELINE: TimelineItem[] = [];
const NO_THREADS: ReviewThread[] = [];
const NO_FILES: ChangedFile[] = [];
