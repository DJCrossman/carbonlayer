// The whole PR at once (`pr.fetch`): every stage of the PR page (pr-stages.ts) put together, with every file's diff.
// The PR page itself loads the stages one by one and renders each as it arrives.

import type { ChangedFileDiff, PrDetail, PrSummary, RepoRef } from '../model';
import { fetchFileDiffs, fetchPrStage } from './pr-stages';
import { politely } from './session';

export async function fetchPullRequestPage(repo: RepoRef, number: number): Promise<PrDetail> {
  const pull = { repo, number };
  const [header, activity, files, threads, mergeBox, checks, stack, meta] = await Promise.all([
    fetchPrStage('header', pull),
    fetchPrStage('activity', pull),
    fetchPrStage('files', pull),
    fetchPrStage('threads', pull),
    fetchPrStage('mergeBox', pull),
    fetchPrStage('checks', pull),
    fetchPrStage('stack', pull),
    fetchPrStage('meta', pull),
  ]);
  // The diffs GitHub did not send with the list, 20 paths a request, four requests at a time.
  const missing = files.files.map((file) => file.path).filter((path) => !(path in files.diffs));
  const batches = Array.from({ length: Math.ceil(missing.length / 20) }, (_, i) => missing.slice(i * 20, i * 20 + 20));
  const diffs: Record<string, ChangedFileDiff> = Object.assign({ ...files.diffs }, ...(await politely(batches, 4, (paths) => fetchFileDiffs({ ...pull, paths }))));
  const conversations = { resolved: threads.threads.filter((thread) => thread.isResolved).length, total: threads.threads.length };
  const summary: PrSummary = { ...header, ...mergeBox, ...checks, labels: meta.labels, unread: null, conversations };
  return {
    ...header,
    ...mergeBox,
    ...checks,
    unread: null,
    conversations,
    ...activity,
    ...threads,
    ...meta,
    baseOid: files.baseOid,
    files: files.files.map((file) => ({ ...file, ...(diffs[file.path] ?? { patch: null, previousPath: null }) })),
    // The stack's own entry for this PR knows only the header.
    stack: { ...stack.stack, entries: stack.stack.entries.map((entry, index) => (index === stack.stack.currentIndex ? summary : entry)) },
  };
}
