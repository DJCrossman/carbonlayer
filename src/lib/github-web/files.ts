// Changed files and their patches. page_data/base_comparison_info lists every file (`diffSummaries`) and
// carries the first diffs (`diffContents`); the rest come from page_data/diff_entries, up to 20 paths per request.

import type { ChangedFileDiff, ChangedFileSummary, RepoRef } from '../model';
import { getJson } from './session';

/** Every changed file in GitHub's order, and the diffs GitHub sent along with the list, by path. */
export function changedFileList(repo: RepoRef, comparison: BaseComparison): { files: ChangedFileSummary[]; diffs: Record<string, ChangedFileDiff> } {
  const fullDiff = comparison.comparison?.fullDiff ?? null;
  const files = comparison.diffSummaries.map((summary): ChangedFileSummary => {
    const changeType = (summary.changeType ?? 'MODIFIED').toUpperCase();
    const status: ChangedFileSummary['status'] =
      changeType === 'ADDED'
        ? 'added'
        : changeType === 'DELETED' || changeType === 'REMOVED'
          ? 'removed'
          : changeType === 'RENAMED'
            ? 'renamed'
            : changeType === 'COPIED'
              ? 'copied'
              : changeType === 'CHANGED'
                ? 'changed'
                : 'modified';
    // A deleted file only exists at the base commit.
    const blobOid = (status === 'removed' ? fullDiff?.baseOid : fullDiff?.headOid) ?? 'HEAD';
    return {
      path: summary.path,
      status,
      additions: summary.linesAdded ?? 0,
      deletions: summary.linesDeleted ?? 0,
      viewerViewedState: summary.markedAsViewed ? 'VIEWED' : 'UNVIEWED',
      blobUrl: `https://github.com/${repo.owner}/${repo.name}/blob/${blobOid}/${summary.path.split('/').map(encodeURIComponent).join('/')}`,
    };
  });
  return { files, diffs: Object.fromEntries((comparison.diffContents ?? []).map((entry) => [entry.path, diffOf(entry)])) };
}

/**
 * The diffs of up to 20 changed files, by path, from one of GitHub's diff_entries requests. Without `range` GitHub
 * answers with the whole PR's diff (observed); if it ever refuses, the request is retried with the head OID as `range`,
 * as GitHub's own UI sends it, which `headOid` is only asked for then.
 */
export async function fileDiffs(pullPath: string, paths: string[], headOid: () => Promise<string | null>): Promise<Record<string, ChangedFileDiff>> {
  // As GitHub's UI does: each path encoded, joined with commas, the whole encoded again as one value;
  // `ctx` carries one (empty) context-range slot per path.
  const params = new URLSearchParams({ paths: paths.map(encodeURIComponent).join(','), ctx: paths.map(() => '').join(':'), w: '0' });
  let entries: DiffEntry[];
  try {
    entries = await getJson<DiffEntry[]>(`${pullPath}/page_data/diff_entries?${params}`);
  } catch (error) {
    const range = await headOid();
    if (!range) throw error;
    params.set('range', range);
    entries = await getJson<DiffEntry[]>(`${pullPath}/page_data/diff_entries?${params}`);
    console.debug('[gg] diff_entries needed range=<head OID>');
  }
  return Object.fromEntries(entries.map((entry) => [entry.path, diffOf(entry)]));
}

/** The diff a GitHub diff entry carries: its patch and, for a renamed or copied file, the path it had before. */
function diffOf(entry: DiffEntry): ChangedFileDiff {
  const oldPath = entry.oldTreeEntry?.path;
  return { patch: patchOf(entry), previousPath: oldPath && oldPath !== entry.path ? oldPath : null };
}

/**
 * The unified patch for one file, or null for binary, too-large and empty diffs. GitHub's diff lines already
 * carry their `+` / `-` / space prefix (observed); a line without one gets it added.
 */
export function patchOf(entry: DiffEntry): string | null {
  if (entry.isBinary || entry.isTooBig || !entry.diffLines?.length) return null;
  const prefixes: Record<string, string> = { HUNK: '@@', ADDITION: '+', DELETION: '-', CONTEXT: ' ' };
  const lines = entry.diffLines.flatMap((line) => {
    const prefix = prefixes[line.type];
    if (prefix === undefined) return [];
    const text = line.text.startsWith(prefix) || prefix === '@@' ? line.text : prefix + line.text;
    return line.displayNoNewLineWarning ? [text, '\\ No newline at end of file'] : [text];
  });
  return lines.length > 0 ? lines.join('\n') : null;
}

/** page_data/base_comparison_info (the fields read here). */
export interface BaseComparison {
  diffSummaries: Array<{
    path: string;
    changeType?: string;
    linesAdded?: number;
    linesDeleted?: number;
    markedAsViewed?: boolean;
    /** Review thread anchors on the current diff: `{ R69: { threads: [{ id: 2694976171, start: 'R55' }] } }`. */
    markersMap?: Record<string, { threads?: Array<{ id: number | string; start?: string }> }>;
  }>;
  diffContents?: DiffEntry[];
  comparison?: { fullDiff?: { baseOid: string; headOid: string } };
}

export interface DiffEntry {
  path: string;
  status?: string;
  isBinary?: boolean;
  isTooBig?: boolean;
  linesAdded?: number;
  linesDeleted?: number;
  oldTreeEntry?: { path: string } | null;
  diffLines?: Array<{ type: string; text: string; displayNoNewLineWarning?: boolean }>;
}
