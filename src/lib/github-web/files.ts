// Changed files and their patches. page_data/base_comparison_info lists every file (`diffSummaries`) and
// carries the first diffs (`diffContents`); the rest come from page_data/diff_entries, up to 20 paths per request. The
// lines a diff leaves out come from page_data/diff_entry_lines.

import { z } from 'zod/mini';
import type { ChangedFileDiff, ChangedFileSummary, RepoRef } from '../model';
import type { DiffEntryLine, LineRange } from '../rpc';
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
 * the way GitHub's own UI sends it, which `headOid` is only asked for then.
 */
export async function fileDiffs(pullPath: string, paths: string[], headOid: () => Promise<string | null>): Promise<Record<string, ChangedFileDiff>> {
  // As GitHub's UI does: each path encoded, joined with commas, the whole encoded again as one value;
  // `ctx` carries one (empty) context-range slot per path.
  const params = new URLSearchParams({ paths: paths.map(encodeURIComponent).join(','), ctx: paths.map(() => '').join(':'), w: '0' });
  let entries: DiffEntry[];
  try {
    entries = await getJson(`${pullPath}/page_data/diff_entries?${params}`, z.array(diffEntrySchema));
  } catch (error) {
    const range = await headOid();
    if (!range) throw error;
    params.set('range', range);
    entries = await getJson(`${pullPath}/page_data/diff_entries?${params}`, z.array(diffEntrySchema));
    console.debug('[gg] diff_entries needed range=<head OID>');
  }
  return Object.fromEntries(entries.map((entry) => [entry.path, diffOf(entry)]));
}

/**
 * One changed file's diff lines with the lines it leaves out in `ranges` (by their numbers in the new file) put in, the
 * way GitHub's "Expand up" / "Expand down" asks for them (page_data/diff_entry_lines, docs/research/github-web-endpoints.md):
 * the path, each range as JSON, whitespace shown, and the head commit as `range`. GitHub answers with every line of the
 * diff again, the ones asked for among them as CONTEXT lines; a line with no number on a side has none there.
 */
export async function expandedDiffLines(pullPath: string, path: string, headOid: string, ranges: LineRange[]): Promise<DiffEntryLine[]> {
  const params = new URLSearchParams({ path });
  for (const range of ranges) params.append('context_line_ranges[]', JSON.stringify({ start: range.start, end: range.end }));
  params.set('w', '0');
  params.set('range', headOid);
  const answer = await getJson(
    `${pullPath}/page_data/diff_entry_lines?${params}`,
    z.object({
      diffEntryLines: z.array(
        z.object({ type: z.string(), left: z.nullish(z.number()), right: z.nullish(z.number()), text: z.string(), displayNoNewLineWarning: z.nullish(z.boolean()) }),
      ),
    }),
  );
  return answer.diffEntryLines.map((line) => ({
    type: line.type,
    left: line.left ?? 0,
    right: line.right ?? 0,
    text: line.text,
    displayNoNewLineWarning: line.displayNoNewLineWarning ?? false,
  }));
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

/** One file's diff in page_data/diff_entries and base_comparison_info's `diffContents` (the fields read here). */
const diffEntrySchema = z.object({
  path: z.string(),
  isBinary: z.nullish(z.boolean()),
  isTooBig: z.nullish(z.boolean()),
  oldTreeEntry: z.nullish(z.object({ path: z.string() })),
  diffLines: z.nullish(z.array(z.object({ type: z.string(), text: z.string(), displayNoNewLineWarning: z.nullish(z.boolean()) }))),
});

export type DiffEntry = z.infer<typeof diffEntrySchema>;

/** page_data/base_comparison_info (the fields read here); a comparison without files lists none. */
export const baseComparisonAnswer = z.object({
  diffSummaries: z.pipe(
    z.nullish(
      z.array(
        z.object({
          path: z.string(),
          changeType: z.nullish(z.string()),
          linesAdded: z.nullish(z.number()),
          linesDeleted: z.nullish(z.number()),
          markedAsViewed: z.nullish(z.boolean()),
          /** Review thread anchors on the current diff: `{ R69: { threads: [{ id: 2694976171, start: 'R55' }] } }`. */
          markersMap: z.nullish(
            z.record(z.string(), z.object({ threads: z.nullish(z.array(z.object({ id: z.union([z.number(), z.string()]), start: z.nullish(z.string()) }))) })),
          ),
        }),
      ),
    ),
    z.transform((summaries) => summaries ?? []),
  ),
  diffContents: z.nullish(z.array(diffEntrySchema)),
  comparison: z.nullish(z.object({ fullDiff: z.nullish(z.object({ baseOid: z.string(), headOid: z.string() })) })),
});

export type BaseComparison = z.infer<typeof baseComparisonAnswer>;
