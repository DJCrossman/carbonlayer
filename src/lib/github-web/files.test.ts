import { afterEach, assert, describe, expect, it, vi } from 'vitest';
import { changedFileList, fileDiffs, patchOf, type DiffEntry } from './files';

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
    expect(diffs).toEqual({ 'src/file 1.ts': { patch: '@@ -0,0 +1 @@\n+x', previousPath: null } });
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
    expect(diffs).toEqual({ 'src/a b.ts': { patch: '@@ -1 +1 @@', previousPath: null }, 'new.ts': { patch: '@@ -1 +1 @@', previousPath: 'old.ts' } });
    expect(headOid).not.toHaveBeenCalled();
  });
});
