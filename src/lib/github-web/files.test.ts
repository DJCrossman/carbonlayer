import { afterEach, describe, expect, it, vi } from 'vitest';
import { changedFiles, patchOf, type DiffEntry } from './files';

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

describe('changedFiles', () => {
  it('keeps the embedded diffs and fetches the rest 20 paths at a time, in GitHub’s file order', async () => {
    const paths = Array.from({ length: 22 }, (_, i) => `src/file ${i}.ts`);
    const requested: URL[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        const parsed = new URL(url, 'https://github.com');
        requested.push(parsed);
        const asked = parsed.searchParams.get('paths')!.split(',').map(decodeURIComponent);
        return Response.json(asked.map((path) => ({ path, diffLines: [{ type: 'HUNK', text: '@@ -0,0 +1 @@' }, { type: 'ADDITION', text: '+x' }] })));
      }),
    );
    const files = await changedFiles(
      '/o/r/pull/1',
      { owner: 'o', name: 'r' },
      {
        diffSummaries: [
          ...paths.map((path) => ({ path, changeType: 'ADDED', linesAdded: 1, linesDeleted: 0 })),
          { path: 'old.ts', changeType: 'DELETED', markedAsViewed: true },
        ],
        diffContents: [{ path: 'src/file 0.ts', diffLines: [{ type: 'HUNK', text: '@@ -0,0 +1 @@' }] }],
        comparison: { fullDiff: { baseOid: 'base', headOid: 'head' } },
      },
    );

    expect(requested).toHaveLength(2);
    expect(requested[0]!.pathname).toBe('/o/r/pull/1/page_data/diff_entries');
    expect(requested[0]!.searchParams.get('paths')!.split(',')).toHaveLength(20);
    expect(requested[0]!.searchParams.get('ctx')).toBe(':'.repeat(19));
    expect(requested[0]!.searchParams.has('range')).toBe(false);
    expect(files.map((file) => file.path)).toEqual([...paths, 'old.ts']);
    expect(files[1]).toMatchObject({ status: 'added', patch: '@@ -0,0 +1 @@\n+x', viewerViewedState: 'UNVIEWED', blobUrl: 'https://github.com/o/r/blob/head/src/file%201.ts' });
    expect(files.at(-1)).toMatchObject({ status: 'removed', viewerViewedState: 'VIEWED', blobUrl: 'https://github.com/o/r/blob/base/old.ts' });
  });
});
