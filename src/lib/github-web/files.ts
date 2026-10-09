// Changed files and their patches. page_data/base_comparison_info lists every file (`diffSummaries`) and
// carries the first diffs (`diffContents`); the rest come from page_data/diff_entries, 20 paths per request.

import type { ChangedFile, RepoRef } from '../model';
import { getJson, politely } from './session';

/** Every changed file in GitHub's order, with a unified patch rebuilt from GitHub's diff lines. */
export async function changedFiles(pullPath: string, repo: RepoRef, comparison: BaseComparison): Promise<ChangedFile[]> {
  const entries = new Map((comparison.diffContents ?? []).map((entry) => [entry.path, entry]));
  const missing = comparison.diffSummaries.map((summary) => summary.path).filter((path) => !entries.has(path));
  const batches = Array.from({ length: Math.ceil(missing.length / 20) }, (_, i) => missing.slice(i * 20, i * 20 + 20));
  const fullDiff = comparison.comparison?.fullDiff ?? null;
  const fetched = await politely(batches, 4, (paths) => diffEntries(pullPath, paths, fullDiff));
  for (const entry of fetched.flat()) entries.set(entry.path, entry);

  return comparison.diffSummaries.map((summary): ChangedFile => {
    const entry = entries.get(summary.path);
    const changeType = (summary.changeType ?? entry?.status ?? 'MODIFIED').toUpperCase();
    const status: ChangedFile['status'] =
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
    const oldPath = entry?.oldTreeEntry?.path;
    // A deleted file only exists at the base commit.
    const blobOid = (status === 'removed' ? fullDiff?.baseOid : fullDiff?.headOid) ?? 'HEAD';
    return {
      path: summary.path,
      previousPath: (status === 'renamed' || status === 'copied') && oldPath && oldPath !== summary.path ? oldPath : null,
      status,
      additions: summary.linesAdded ?? entry?.linesAdded ?? 0,
      deletions: summary.linesDeleted ?? entry?.linesDeleted ?? 0,
      patch: entry ? patchOf(entry) : null,
      viewerViewedState: summary.markedAsViewed ? 'VIEWED' : 'UNVIEWED',
      blobUrl: `https://github.com/${repo.owner}/${repo.name}/blob/${blobOid}/${summary.path.split('/').map(encodeURIComponent).join('/')}`,
    };
  });
}

/**
 * Full-PR diff entries for up to 20 paths. Without `range` GitHub answers with the whole PR's diff (observed);
 * if it ever refuses, the request is retried with the head OID as `range`, as GitHub's own UI sends it.
 */
async function diffEntries(pullPath: string, paths: string[], fullDiff: { baseOid: string; headOid: string } | null): Promise<DiffEntry[]> {
  // As GitHub's UI does: each path encoded, joined with commas, the whole encoded again as one value;
  // `ctx` carries one (empty) context-range slot per path.
  const params = new URLSearchParams({ paths: paths.map(encodeURIComponent).join(','), ctx: paths.map(() => '').join(':'), w: '0' });
  try {
    return await getJson<DiffEntry[]>(`${pullPath}/page_data/diff_entries?${params}`);
  } catch (error) {
    if (!fullDiff) throw error;
    params.set('range', fullDiff.headOid);
    const entries = await getJson<DiffEntry[]>(`${pullPath}/page_data/diff_entries?${params}`);
    console.debug('[gg] diff_entries needed range=<head OID>');
    return entries;
  }
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
  commits?: Array<{ oid: string; createdAt: string; actorLogin?: string | null; messageHeadline?: string }>;
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
