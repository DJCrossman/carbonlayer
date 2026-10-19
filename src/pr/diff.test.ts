import { hydratePartialDiff } from '@pierre/diffs';
import { afterEach, assert, describe, expect, it, vi } from 'vitest';
import { createFixtureDataSource } from '../app/data-source';
import { fixtures } from '../fixtures';
import { prFixtures } from '../fixtures/pr';
import type { ChangedFile, ReviewThread } from '../lib/model';
import type { DiffEntryLine } from '../lib/rpc';
import { commentedRows, composerAnchorFor, currentLinesOf, fileContentsFrom, fileNotes, filesInTreeOrder, fileTree, hiddenLines, renderableDiff, takesComments } from './diff';

const pr42 = prFixtures.find((pr) => pr.number === 42);
assert.isDefined(pr42);
const fileAt = (path: string): ChangedFile => {
  const file = pr42.files.find((candidate) => candidate.path === path);
  assert.isDefined(file, path);
  return file;
};

describe('renderableDiff', () => {
  afterEach(() => vi.restoreAllMocks());

  it('keeps every hunk of every fixture file and never reports a malformed hunk', () => {
    const errors = vi.spyOn(console, 'error');
    for (const pr of prFixtures) {
      for (const file of pr.files) {
        if (file.patch === null) continue;
        const diff = renderableDiff(file);
        expect(diff?.hunks).toHaveLength(file.patch.split('\n').filter((line) => line.startsWith('@@ ')).length);
        assert.exists(diff, file.path);
        const added = diff.hunks.reduce((sum, hunk) => sum + hunk.additionLines, 0);
        const removed = diff.hunks.reduce((sum, hunk) => sum + hunk.deletionLines, 0);
        expect({ path: file.path, added, removed }).toEqual({ path: file.path, added: file.additions, removed: file.deletions });
      }
    }
    expect(errors).not.toHaveBeenCalled();
  });

  it('marks added, removed, renamed and modified files with their change type and names', () => {
    expect(renderableDiff(fileAt('src/parcs/zones.ts'))).toMatchObject({ name: 'src/parcs/zones.ts', type: 'new' });
    expect(renderableDiff(fileAt('src/parcs/legacy.ts'))).toMatchObject({ name: 'src/parcs/legacy.ts', type: 'deleted' });
    expect(renderableDiff(fileAt('src/parcs/new-name.ts'))).toMatchObject({
      name: 'src/parcs/new-name.ts',
      prevName: 'src/parcs/old-name.ts',
      type: 'rename-changed',
    });
    const modified = renderableDiff(fileAt('src/parcs/adapter.ts'));
    expect(modified).toMatchObject({ name: 'src/parcs/adapter.ts', type: 'change' });
    expect(modified?.prevName).toBeUndefined();
  });

  it('keeps the first hunk, which the parser drops when the patch has no file header', () => {
    const diff = renderableDiff(fileAt('src/parcs/adapter.ts'));
    expect(diff?.hunks.map((hunk) => [hunk.deletionStart, hunk.additionStart])).toEqual([
      [1, 1],
      [38, 39],
    ]);
  });

  it('treats a rename without changes as a pure rename and a missing patch as unrenderable', () => {
    const pureRename: ChangedFile = { ...fileAt('src/parcs/new-name.ts'), patch: '', additions: 0, deletions: 0 };
    expect(renderableDiff(pureRename)).toMatchObject({ type: 'rename-pure', prevName: 'src/parcs/old-name.ts', hunks: [] });
    expect(renderableDiff(fileAt('docs/zones.png'))).toBeNull();
  });
});

describe('fileNotes', () => {
  const thread = (overrides: Partial<ReviewThread>): ReviewThread => ({
    id: 't',
    path: 'a.ts',
    line: 3,
    startLine: null,
    side: 'RIGHT',
    isResolved: false,
    isOutdated: false,
    diffHunk: '',
    comments: [],
    ...overrides,
  });

  it("maps GitHub's RIGHT side to additions and LEFT to deletions, on the thread's line", () => {
    const right = thread({ id: 'r', side: 'RIGHT', line: 7 });
    const left = thread({ id: 'l', side: 'LEFT', line: 4 });
    expect(fileNotes('a.ts', [right, left], [], null)).toEqual([
      { side: 'additions', lineNumber: 7, metadata: { kind: 'thread', thread: right } },
      { side: 'deletions', lineNumber: 4, metadata: { kind: 'thread', thread: left } },
    ]);
  });

  it('puts an outdated thread GitHub can no longer place at file level', () => {
    const outdated = thread({ line: null, isOutdated: true });
    expect(fileNotes('a.ts', [outdated], [], null)).toEqual([{ side: 'additions', lineNumber: 0, metadata: { kind: 'thread', thread: outdated } }]);
  });

  it("only returns this file's threads, batched comments and composer", () => {
    const batch = [
      { path: 'b.ts', line: 1, side: 'RIGHT' as const, body: 'elsewhere' },
      { path: 'a.ts', line: 9, side: 'LEFT' as const, body: 'pending' },
    ];
    const notes = fileNotes('a.ts', [thread({ path: 'b.ts' })], batch, { path: 'a.ts', line: 2, side: 'additions' });
    expect(notes).toEqual([
      { side: 'deletions', lineNumber: 9, metadata: { kind: 'pending', draft: batch[1], index: 1 } },
      { side: 'additions', lineNumber: 2, metadata: { kind: 'composer' } },
    ]);
  });
});

describe('composerAnchorFor', () => {
  // The second hunk, -38,11 +39,20: five unchanged lines, L43–L44 deleted, R44–R54 added, then unchanged lines from L45/R55.
  const adapter = renderableDiff(fileAt('src/parcs/adapter.ts'));
  assert.exists(adapter);

  it('opens under the last line of a selection, with its first line in the unified diff as the start', () => {
    // Dragged upwards over added lines.
    expect(composerAnchorFor('a.ts', adapter, { start: 50, side: 'additions', end: 46 })).toEqual({
      path: 'a.ts',
      line: 50,
      side: 'additions',
      startLine: 46,
      startSide: 'additions',
    });
    // From the first added line up to the last deleted one, which the change block lists before it.
    expect(composerAnchorFor('a.ts', adapter, { start: 44, side: 'additions', end: 44, endSide: 'deletions' })).toEqual({
      path: 'a.ts',
      line: 44,
      side: 'additions',
      startLine: 44,
      startSide: 'deletions',
    });
    // Split: an unchanged line in the old file's column, numbered lower, dragged up to an added line above it.
    expect(composerAnchorFor('a.ts', adapter, { start: 45, side: 'deletions', end: 50, endSide: 'additions' })).toEqual({
      path: 'a.ts',
      line: 45,
      side: 'deletions',
      startLine: 50,
      startSide: 'additions',
    });
  });

  it('opens under one line with no start', () => {
    expect(composerAnchorFor('a.ts', adapter, { start: 46, side: 'additions', end: 46 })).toEqual({ path: 'a.ts', line: 46, side: 'additions' });
  });
});

describe('fileTree', () => {
  it('nests files under merged single-child directories, directories first', () => {
    const tree = fileTree(pr42.files);
    expect(tree.map((node) => node.name)).toEqual(['docs', 'src/parcs']);
    expect(filesInTreeOrder(tree).map((file) => file.path)).toEqual([
      'docs/zones.png',
      'src/parcs/adapter.css',
      'src/parcs/adapter.ts',
      'src/parcs/legacy.ts',
      'src/parcs/new-name.ts',
      'src/parcs/zones.ts',
    ]);
  });
});

describe('currentLinesOf', () => {
  const patch = ['@@ -10,4 +10,5 @@ class Adapter', ' const a = 1;', '-const b = 2;', '+const b = 3;', '+const c = 4;', ' return a;', '\\ No newline at end of file'].join('\n');

  it("reads the new file's lines, skipping removed ones, for a suggestion to start from", () => {
    expect(currentLinesOf(patch, 11, 12)).toBe('const b = 3;\nconst c = 4;');
    expect(currentLinesOf(patch, 13, 13)).toBe('return a;');
  });

  it('gives nothing for lines the patch does not reach', () => {
    expect(currentLinesOf(patch, 13, 15)).toBeNull();
  });
});

describe('commentedRows', () => {
  // L10/R10 unchanged, L11 removed, R11–R12 added, L12/R13 unchanged.
  const patch = ['@@ -10,3 +10,4 @@ class Adapter', ' const a = 1;', '-const b = 2;', '+const b = 3;', '+const c = 4;', ' return a;', '\\ No newline at end of file'].join('\n');

  it('reads one line on either side, numbered in its own file', () => {
    expect(commentedRows(patch, { side: 'RIGHT', line: 12 }, { side: 'RIGHT', line: 12 })).toEqual([{ kind: 'added', line: 12, text: 'const c = 4;' }]);
    expect(commentedRows(patch, { side: 'LEFT', line: 11 }, { side: 'LEFT', line: 11 })).toEqual([{ kind: 'removed', line: 11, text: 'const b = 2;' }]);
  });

  it('keeps the removed lines a range spans, its unchanged lines numbered on the side of its last line', () => {
    expect(commentedRows(patch, { side: 'RIGHT', line: 10 }, { side: 'RIGHT', line: 12 })).toEqual([
      { kind: 'context', line: 10, text: 'const a = 1;' },
      { kind: 'removed', line: 11, text: 'const b = 2;' },
      { kind: 'added', line: 11, text: 'const b = 3;' },
      { kind: 'added', line: 12, text: 'const c = 4;' },
    ]);
    expect(commentedRows(patch, { side: 'LEFT', line: 11 }, { side: 'LEFT', line: 12 })?.map((row) => [row.kind, row.line])).toEqual([
      ['removed', 11],
      ['added', 11],
      ['added', 12],
      ['context', 12],
    ]);
  });

  it('reads a range from a removed line to an added one', () => {
    expect(commentedRows(patch, { side: 'LEFT', line: 11 }, { side: 'RIGHT', line: 11 })?.map((row) => row.text)).toEqual(['const b = 2;', 'const b = 3;']);
  });

  it('gives nothing for lines the patch does not reach in one hunk', () => {
    expect(commentedRows(patch, { side: 'RIGHT', line: 14 }, { side: 'RIGHT', line: 14 })).toBeNull();
    const twoHunks = `${patch}\n@@ -30,2 +31,2 @@\n x\n y`;
    expect(commentedRows(twoHunks, { side: 'RIGHT', line: 13 }, { side: 'RIGHT', line: 31 })).toBeNull();
    expect(commentedRows(twoHunks, { side: 'RIGHT', line: 32 }, { side: 'RIGHT', line: 32 })).toEqual([{ kind: 'context', line: 32, text: 'y' }]);
  });
});

describe('hiddenLines', () => {
  it('names the lines above the first hunk, between the hunks and after the last, by their numbers in the new file', () => {
    const hidden = (path: string) => {
      const diff = renderableDiff(fileAt(path));
      assert.exists(diff, path);
      return hiddenLines(diff);
    };
    expect(hidden('src/parcs/adapter.ts')).toEqual([
      { start: 10, end: 38 },
      { start: 59, end: 10_058 },
    ]);
    expect(hidden('src/parcs/adapter.css')).toEqual([
      { start: 1, end: 11 },
      { start: 24, end: 10_023 },
    ]);
    expect(hidden('src/parcs/new-name.ts')).toEqual([{ start: 7, end: 10_006 }]);
  });

  it('goes on after the line a hunk without new lines names', () => {
    const diff = renderableDiff({ ...fileAt('src/parcs/adapter.ts'), patch: '@@ -3,2 +2,0 @@\n-a\n-b', additions: 0, deletions: 2 });
    assert.exists(diff);
    expect(hiddenLines(diff)).toEqual([
      { start: 1, end: 2 },
      { start: 3, end: 10_002 },
    ]);
  });
});

describe('fileContentsFrom', () => {
  const line = (type: string, left: number, right: number, text: string, displayNoNewLineWarning = false): DiffEntryLine => ({ type, left, right, text, displayNoNewLineWarning });

  it('puts each side together from its unchanged lines and its own, by their numbers there, without the diff markers', () => {
    // GitHub's order: an expanded line, the hunk, then its lines; one line came without its marker.
    const answer = [
      line('CONTEXT', 1, 1, ' first'),
      line('HUNK', 0, 0, '@@ -2,3 +2,3 @@'),
      line('CONTEXT', 2, 2, ' second'),
      line('DELETION', 3, 0, '-old third'),
      line('ADDITION', 0, 3, '+new third'),
      line('CONTEXT', 4, 4, 'fourth'),
      line('CONTEXT', 5, 5, ' '),
    ];
    expect(fileContentsFrom(answer)).toEqual({ old: 'first\nsecond\nold third\nfourth\n\n', new: 'first\nsecond\nnew third\nfourth\n\n' });
    expect(fileContentsFrom(answer.toReversed())).toEqual(fileContentsFrom(answer));
  });

  it('ends a side without a newline where GitHub warns of none on its last line', () => {
    const answer = [line('CONTEXT', 1, 1, ' a'), line('DELETION', 2, 0, '-b', true), line('ADDITION', 0, 2, '+b')];
    expect(fileContentsFrom(answer)).toEqual({ old: 'a\nb', new: 'a\nb\n' });
    expect(fileContentsFrom([line('CONTEXT', 1, 1, ' a'), line('CONTEXT', 2, 2, ' b', true)])).toEqual({ old: 'a\nb', new: 'a\nb' });
  });

  it('refuses an answer that misses a line of either side, naming it', () => {
    expect(() => fileContentsFrom([line('CONTEXT', 1, 1, ' a'), line('CONTEXT', 3, 3, ' c')])).toThrow("GitHub's answer has no line 2 of the old file");
    expect(() => fileContentsFrom([line('CONTEXT', 1, 1, ' a'), line('DELETION', 2, 0, '-b'), line('ADDITION', 0, 3, '+c')])).toThrow(
      "GitHub's answer has no line 2 of the new file",
    );
  });
});

describe("a fixture file's hidden lines, as the diff library shows them", () => {
  const source = createFixtureDataSource(fixtures);

  /** The file's diff with every line it hides loaded, the way the diff library takes them from `loadDiffFiles`. */
  const whole = async (path: string) => {
    const diff = renderableDiff(fileAt(path));
    assert.exists(diff, path);
    const contents = fileContentsFrom(await source.fetchPrDiffLines(pr42.repo, pr42.number, path, pr42.headOid, hiddenLines(diff)));
    return { contents, diff: hydratePartialDiff('clone', diff, { oldFile: { name: diff.prevName ?? diff.name, contents: contents.old }, newFile: { name: diff.name, contents: contents.new } }) };
  };

  it('agrees with the patch on the lines the patch shows, on both sides', async () => {
    for (const path of ['src/parcs/adapter.ts', 'src/parcs/adapter.css', 'src/parcs/new-name.ts']) {
      const { patch } = fileAt(path);
      assert.isNotNull(patch);
      const { diff } = await whole(path);
      for (const hunk of diff.hunks) {
        const shown = currentLinesOf(patch, hunk.additionStart, hunk.additionStart + hunk.additionCount - 1);
        expect(diff.additionLines.slice(hunk.additionStart - 1, hunk.additionStart - 1 + hunk.additionCount).join('').replace(/\n$/, '')).toBe(shown);
        const removedOrKept = patch.split('\n').filter((row, index, rows) => {
          const header = rows.slice(0, index + 1).findLast((candidate) => candidate.startsWith('@@ '));
          return header?.startsWith(`@@ -${hunk.deletionStart},`) && !row.startsWith('@@') && !row.startsWith('+');
        });
        expect(diff.deletionLines.slice(hunk.deletionStart - 1, hunk.deletionStart - 1 + hunk.deletionCount)).toEqual(removedOrKept.map((row) => `${row.slice(1)}\n`));
      }
    }
  });

  it('numbers the hidden lines on each side: the gap between two hunks, and what follows the last', async () => {
    const { diff } = await whole('src/parcs/adapter.ts');
    // 29 lines between the hunks (new 10 to 38, old 9 to 37), 22 after the last (new 59 to 80, old 49 to 70).
    expect(diff.hunks.map((hunk) => hunk.collapsedBefore)).toEqual([0, 29]);
    expect([diff.additionLines.length, diff.deletionLines.length]).toEqual([80, 70]);
    expect(diff.deletionLines[9 - 1]).toBe(diff.additionLines[10 - 1]);
    expect(diff.additionLines[12 - 1]).toBe('export class ParcsAdapter {\n');
    expect(diff.deletionLines[11 - 1]).toBe('export class ParcsAdapter {\n');
    expect(diff.additionLines[80 - 1]).toBe("export type { ZoneId } from './zones';\n");
    expect(diff.deletionLines[70 - 1]).toBe("export type { ZoneId } from './zones';\n");
  });

  it('asks for no line past the end of the file, and a file whose diff reaches its end hides nothing after it', async () => {
    const { diff, contents } = await whole('src/parcs/new-name.ts');
    expect(contents.new.split('\n')).toHaveLength(13);
    expect(diff.hunks.map((hunk) => [hunk.collapsedBefore, hunk.additionStart, hunk.additionCount])).toEqual([[0, 1, 6]]);
    expect(diff.additionLines).toHaveLength(12);
  });
});

describe('takesComments', () => {
  const diff = renderableDiff(fileAt('src/parcs/adapter.ts'));
  assert.exists(diff);

  it('takes lines of the hunks, on either side, one or a range', () => {
    expect(takesComments(diff, { start: 2, end: 2 })).toBe(true);
    expect(takesComments(diff, { start: 39, side: 'additions', end: 58, endSide: 'additions' })).toBe(true);
    expect(takesComments(diff, { start: 43, side: 'deletions', end: 45, endSide: 'additions' })).toBe(true);
  });

  it('takes none that starts or ends on an unchanged line expanded around the hunks', () => {
    expect(takesComments(diff, { start: 20, end: 20 })).toBe(false);
    expect(takesComments(diff, { start: 9, side: 'additions', end: 10, endSide: 'additions' })).toBe(false);
    expect(takesComments(diff, { start: 37, side: 'deletions', end: 39, endSide: 'additions' })).toBe(false);
    expect(takesComments(diff, { start: 59, end: 59 })).toBe(false);
  });
});
