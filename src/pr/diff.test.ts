import { afterEach, describe, expect, it, vi } from 'vitest';
import { prFixtures } from '../fixtures/pr';
import type { ChangedFile, ReviewThread } from '../lib/model';
import { composerAnchorFor, fileNotes, filesInTreeOrder, fileTree, renderableDiff } from './diff';

const pr42 = prFixtures.find((pr) => pr.number === 42)!;
const fileAt = (path: string) => pr42.files.find((file) => file.path === path)!;

describe('renderableDiff', () => {
  afterEach(() => vi.restoreAllMocks());

  it('keeps every hunk of every fixture file and never reports a malformed hunk', () => {
    const errors = vi.spyOn(console, 'error');
    for (const pr of prFixtures) {
      for (const file of pr.files) {
        if (file.patch === null) continue;
        const diff = renderableDiff(file);
        expect(diff?.hunks).toHaveLength(file.patch.split('\n').filter((line) => line.startsWith('@@ ')).length);
        const added = diff!.hunks.reduce((sum, hunk) => sum + hunk.additionLines, 0);
        const removed = diff!.hunks.reduce((sum, hunk) => sum + hunk.deletionLines, 0);
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
  const adapter = renderableDiff(fileAt('src/parcs/adapter.ts'))!;

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
