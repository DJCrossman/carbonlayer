import { afterEach, assert, describe, expect, it, vi } from 'vitest';
import { changedFileList, expandedDiffLines, fileDiffs, patchOf, type DiffEntry } from './files';

afterEach(() => vi.unstubAllGlobals());

describe('patchOf', () => {
  it("rebuilds a unified patch from GitHub's diff lines, which already carry their prefixes", () => {
    const entry: DiffEntry = {
      path: 'a.txt',
      diffLines: [
        { type: 'HUNK', text: '@@ -1,3 +1,3 @@' },
        { type: 'CONTEXT', text: ' # Basic REST request' },
        { type: 'DELETION', text: "-stdout 'login'", displayNoNewLineWarning: true },
        { type: 'ADDITION', text: 'exec gh api /rate_limit' },
        { type: 'INJECTED_CONTEXT', text: 'ignored' },
      ],
    };
    expect(patchOf(entry)).toBe("@@ -1,3 +1,3 @@\n # Basic REST request\n-stdout 'login'\n\\ No newline at end of file\n+exec gh api /rate_limit");
  });

  it('has no patch for binary, too-large or empty diffs', () => {
    expect(patchOf({ path: 'a.png', isBinary: true, diffLines: [{ type: 'HUNK', text: '@@' }] })).toBeNull();
    expect(patchOf({ path: 'big.go', isTooBig: true, diffLines: [] })).toBeNull();
  });
});

describe('changedFileList', () => {
  it('lists every file in GitHub’s order, with the diffs GitHub sent along', () => {
    const { files, diffs } = changedFileList(
      { owner: 'o', name: 'r' },
      {
        diffSummaries: [
          { path: 'src/file 1.ts', changeType: 'ADDED', linesAdded: 1, linesDeleted: 0 },
          { path: 'old.ts', changeType: 'DELETED', markedAsViewed: true },
        ],
        diffContents: [{ path: 'src/file 1.ts', diffLines: [{ type: 'HUNK', text: '@@ -0,0 +1 @@' }, { type: 'ADDITION', text: '+x' }] }],
        comparison: { fullDiff: { baseOid: 'base', headOid: 'head' } },
      },
    );
    expect(files).toEqual([
      { path: 'src/file 1.ts', status: 'added', additions: 1, deletions: 0, viewerViewedState: 'UNVIEWED', blobUrl: 'https://github.com/o/r/blob/head/src/file%201.ts' },
      { path: 'old.ts', status: 'removed', additions: 0, deletions: 0, viewerViewedState: 'VIEWED', blobUrl: 'https://github.com/o/r/blob/base/old.ts' },
    ]);
    expect(diffs).toEqual({ 'src/file 1.ts': { patch: '@@ -0,0 +1 @@\n+x', previousPath: null, withheld: null, generated: false } });
  });

  it('tells a binary file from one whose lines GitHub held back: generated, too big or deleted', () => {
    const { diffs } = changedFileList(
      { owner: 'o', name: 'r' },
      {
        diffSummaries: [],
        diffContents: [
          // offstreetparking/core#9188, 2026-10-19: a lockfile and a linguist-generated file, small, without their lines.
          { path: 'pnpm-lock.yaml', isBinary: false, isTooBig: false, linesAdded: 10, linesDeleted: 0, diffLines: [], newTreeEntry: { isGenerated: true } },
          { path: 'shard-timings.json', isBinary: false, isTooBig: false, linesAdded: 5370, linesDeleted: 0, diffLines: [] },
          // offstreetparking/core#9190, 2026-10-19: a deleted file of 437 lines, which GitHub marks too big.
          { path: 'envelope-rollup.test.ts', isTooBig: true, linesAdded: 0, linesDeleted: 437, diffLines: [] },
          { path: 'logo.png', isBinary: true, linesAdded: 0, linesDeleted: 0, diffLines: [] },
          { path: 'empty.txt', linesAdded: 0, linesDeleted: 0, diffLines: [] },
          { path: 'a.ts', linesAdded: 1, linesDeleted: 0, diffLines: [{ type: 'HUNK', text: '@@ -0,0 +1 @@' }, { type: 'ADDITION', text: '+x' }] },
        ],
      },
    );
    expect(Object.fromEntries(Object.entries(diffs).map(([path, { patch, withheld, generated }]) => [path, [patch !== null, withheld, generated]]))).toEqual({
      'pnpm-lock.yaml': [false, 'held-back', true],
      'shard-timings.json': [false, 'held-back', false],
      'envelope-rollup.test.ts': [false, 'held-back', false],
      'logo.png': [false, 'binary', false],
      'empty.txt': [false, null, false],
      'a.ts': [true, null, false],
    });
  });
});

describe('fileDiffs', () => {
  it('asks for the paths in one request, like GitHub’s UI, and names a renamed file’s old path', async () => {
    const requested: URL[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        const parsed = new URL(url, 'https://github.com');
        requested.push(parsed);
        const asked = parsed.searchParams.get('paths')?.split(',').map(decodeURIComponent) ?? [];
        return Response.json(asked.map((path) => ({ path, oldTreeEntry: { path: path === 'new.ts' ? 'old.ts' : path }, diffLines: [{ type: 'HUNK', text: '@@ -1 +1 @@' }] })));
      }),
    );
    const headOid = vi.fn(async () => 'head');
    const diffs = await fileDiffs('/o/r/pull/1', ['src/a b.ts', 'new.ts'], headOid);

    expect(requested).toHaveLength(1);
    const [request] = requested;
    assert.isDefined(request);
    expect(request.pathname).toBe('/o/r/pull/1/page_data/diff_entries');
    expect(request.searchParams.get('paths')?.split(',')).toEqual(['src%2Fa%20b.ts', 'new.ts']);
    expect(request.searchParams.get('ctx')).toBe(':');
    expect(request.searchParams.has('range')).toBe(false);
    expect(diffs).toEqual({
      'src/a b.ts': { patch: '@@ -1 +1 @@', previousPath: null, withheld: null, generated: false },
      'new.ts': { patch: '@@ -1 +1 @@', previousPath: 'old.ts', withheld: null, generated: false },
    });
    expect(headOid).not.toHaveBeenCalled();
  });

  it('reads the entries keyed by their place, as GitHub answered its own page on 2026-10-19', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json({ 0: { path: 'pnpm-lock.yaml', isBinary: false, isTooBig: false, linesAdded: 10, linesDeleted: 0, diffLines: [] } })),
    );
    expect(await fileDiffs('/o/r/pull/1', ['pnpm-lock.yaml'], async () => 'head')).toEqual({
      'pnpm-lock.yaml': { patch: null, previousPath: null, withheld: 'held-back', generated: false },
    });
  });
});

describe('expandedDiffLines', () => {
  it("asks the way GitHub's Expand does: the path, each range as JSON, whitespace shown and the head commit as the range", async () => {
    const requested: URL[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        requested.push(new URL(url, 'https://github.com'));
        return Response.json({
          diffEntryLines: [
            { type: 'HUNK', blobLineNumber: 0, position: 0, displayNoNewLineWarning: false, text: '@@ -1,2 +1,2 @@', html: '', left: 0, right: 0, problems: [] },
            { type: 'CONTEXT', blobLineNumber: 1, position: 1, displayNoNewLineWarning: false, text: ' a', html: 'a', left: 1, right: 1, problems: [] },
            { type: 'DELETION', blobLineNumber: 2, position: 2, text: '-b', html: 'b', left: 2, right: null, problems: [] },
            { type: 'ADDITION', blobLineNumber: 2, position: 3, displayNoNewLineWarning: true, text: '+c', html: 'c', left: null, right: 2, problems: [] },
          ],
        });
      }),
    );
    const lines = await expandedDiffLines('/o/r/pull/1', 'src/a b.ts', 'f'.repeat(40), [
      { start: 7, end: 10 },
      { start: 30, end: 10_029 },
    ]);

    expect(requested).toHaveLength(1);
    const [request] = requested;
    assert.isDefined(request);
    expect(request.pathname).toBe('/o/r/pull/1/page_data/diff_entry_lines');
    expect([...request.searchParams]).toEqual([
      ['path', 'src/a b.ts'],
      ['context_line_ranges[]', '{"start":7,"end":10}'],
      ['context_line_ranges[]', '{"start":30,"end":10029}'],
      ['w', '0'],
      ['range', 'f'.repeat(40)],
    ]);
    expect(lines).toEqual([
      { type: 'HUNK', left: 0, right: 0, text: '@@ -1,2 +1,2 @@', displayNoNewLineWarning: false },
      { type: 'CONTEXT', left: 1, right: 1, text: ' a', displayNoNewLineWarning: false },
      { type: 'DELETION', left: 2, right: 0, text: '-b', displayNoNewLineWarning: false },
      { type: 'ADDITION', left: 0, right: 2, text: '+c', displayNoNewLineWarning: true },
    ]);
  });

  it("asks the way GitHub's Load Diff does for a file whose lines it held back: no ranges, whitespace shown, the head commit", async () => {
    const requested: URL[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        requested.push(new URL(url, 'https://github.com'));
        return Response.json({ diffEntryLines: [] });
      }),
    );
    await expandedDiffLines('/o/r/pull/1', 'pnpm-lock.yaml', 'f'.repeat(40), []);
    expect(requested.map((request) => [request.pathname, [...request.searchParams]])).toEqual([
      [
        '/o/r/pull/1/page_data/diff_entry_lines',
        [
          ['path', 'pnpm-lock.yaml'],
          ['w', '0'],
          ['range', 'f'.repeat(40)],
        ],
      ],
    ]);
  });

  it('refuses an answer of another shape, naming the endpoint', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ diffLines: [] })));
    await expect(expandedDiffLines('/o/r/pull/1', 'a.ts', 'head', [{ start: 1, end: 2 }])).rejects.toThrow('/o/r/pull/1/page_data/diff_entry_lines did not match');
  });
});
