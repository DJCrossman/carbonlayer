import { describe, expect, it } from 'vitest';
import type { ReviewThreadDraft } from '../app/data-source';
import type { ChangedFile, ReviewThread } from '../lib/model';
import { drawerContents, type DrawerEntry, type DrawerFilters } from './comments-drawer';

const comment = (login: string, createdAt: string): ReviewThread['comments'][number] => ({
  id: `${login}@${createdAt}`,
  author: { login, avatarUrl: '', url: `https://github.com/${login}` },
  bodyHtml: '',
  createdAt,
  url: '',
  subjectId: null,
  reactions: [],
});

const thread = (id: string, overrides: Partial<ReviewThread>): ReviewThread => ({
  id,
  path: 'a.ts',
  line: 3,
  startLine: null,
  side: 'RIGHT',
  isResolved: false,
  isOutdated: false,
  diffHunk: '',
  comments: [comment('jlord', '2026-10-08T10:00:00Z')],
  ...overrides,
});

const file = (path: string, patch: string | null): ChangedFile => ({
  path,
  previousPath: null,
  status: 'modified',
  additions: 0,
  deletions: 0,
  patch,
  viewerViewedState: 'UNVIEWED',
  blobUrl: '',
});

// The diff shows a.ts before b.ts; b.ts's diff has not arrived.
const files = [file('a.ts', ['@@ -1,2 +1,3 @@', ' one', '+two', ' three'].join('\n')), file('b.ts', null)];
const threads = [
  thread('b-open', { path: 'b.ts', line: 3 }),
  thread('a-late', { line: 3, comments: [comment('mona', '2026-10-09T09:00:00Z')] }),
  thread('a-early', { line: 2, startLine: 1, comments: [comment('jlord', '2026-10-08T09:00:00Z'), comment('mona', '2026-10-08T12:00:00Z')] }),
  thread('a-resolved', { line: 1, isResolved: true, comments: [comment('hubot', '2026-10-07T10:00:00Z')] }),
  thread('a-stale', { line: null, isOutdated: true, isResolved: true, comments: [comment('Hubot', '2026-10-06T10:00:00Z')] }),
];
const batch: ReviewThreadDraft[] = [
  { path: 'b.ts', line: 1, side: 'RIGHT', body: 'first' },
  { path: 'a.ts', line: 2, side: 'RIGHT', startLine: 1, startSide: 'LEFT', body: 'second' },
];
const filters = (overrides: Partial<DrawerFilters>): DrawerFilters => ({ reviewer: null, status: 'open', order: 'file', ...overrides });
const ids = (entries: DrawerEntry[]) => entries.map((entry) => (entry.kind === 'thread' ? entry.thread.id : `pending ${entry.index}`));

describe('drawerContents', () => {
  it("shows the unresolved threads at first, in the diff's order of files and lines", () => {
    const contents = drawerContents(threads, batch, files, filters({}), 'octocat');
    expect(ids(contents.shown)).toEqual(['a-early', 'a-late', 'b-open']);
    expect(contents.hidden).toBe(4);
    expect(contents.counts).toEqual({ open: 3, resolved: 2, pending: 2 });
  });

  it("shows the resolved threads, the viewer's batched comments or everything by status, a thread it cannot place at its file's top", () => {
    expect(ids(drawerContents(threads, batch, files, filters({ status: 'resolved' }), 'octocat').shown)).toEqual(['a-stale', 'a-resolved']);
    expect(ids(drawerContents(threads, batch, files, filters({ status: 'pending' }), 'octocat').shown)).toEqual(['pending 1', 'pending 0']);
    const all = drawerContents(threads, batch, files, filters({ status: 'all' }), 'octocat');
    expect(ids(all.shown)).toEqual(['a-stale', 'a-early', 'a-resolved', 'pending 1', 'a-late', 'pending 0', 'b-open']);
    expect(all.hidden).toBe(0);
  });

  it('narrows to the threads a reviewer started or commented in, and to the batched comments only for the viewer', () => {
    const mona = drawerContents(threads, batch, files, filters({ reviewer: 'Mona' }), 'octocat');
    expect(ids(mona.shown)).toEqual(['a-early', 'a-late']);
    expect(mona.counts).toEqual({ open: 2, resolved: 0, pending: 0 });
    expect(mona.hidden).toBe(5);
    const viewer = drawerContents(threads, batch, files, filters({ reviewer: 'octocat', status: 'all' }), 'OctoCat');
    expect(ids(viewer.shown)).toEqual(['pending 1', 'pending 0']);
    expect(viewer.counts).toEqual({ open: 0, resolved: 0, pending: 2 });
  });

  it('puts the newest first: the comments not yet posted, the last added first, then each thread by its latest comment', () => {
    expect(ids(drawerContents(threads, batch, files, filters({ status: 'all', order: 'newest' }), 'octocat').shown)).toEqual([
      'pending 1',
      'pending 0',
      'a-late',
      'a-early',
      'b-open',
      'a-resolved',
      'a-stale',
    ]);
  });

  it('offers everyone who started or commented in a thread, once each, by login', () => {
    expect(drawerContents(threads, [], files, filters({}), 'octocat').reviewers.map((user) => user.login)).toEqual(['hubot', 'jlord', 'mona']);
  });

  it("carries each conversation's lines and the code they sit on, none where the patch does not reach them or has not arrived", () => {
    const shown = drawerContents(threads, batch, files, filters({ status: 'all' }), 'octocat').shown;
    const at = (id: string) => shown.find((entry) => ids([entry])[0] === id)!;
    expect(at('a-early')).toMatchObject({
      lines: { first: { side: 'RIGHT', line: 1 }, last: { side: 'RIGHT', line: 2 } },
      code: [
        { kind: 'context', line: 1, text: 'one' },
        { kind: 'added', line: 2, text: 'two' },
      ],
    });
    // From the old file's first line to the new file's second.
    expect(at('pending 1')).toMatchObject({ lines: { first: { side: 'LEFT', line: 1 }, last: { side: 'RIGHT', line: 2 } }, code: [{ text: 'one' }, { text: 'two' }] });
    expect(at('a-stale')).toMatchObject({ lines: null, code: null });
    expect(at('b-open')).toMatchObject({ lines: { last: { side: 'RIGHT', line: 3 } }, code: null });
  });

  it('shows and hides nothing when there is nothing to show', () => {
    expect(drawerContents([], [], files, filters({}), 'octocat')).toEqual({ shown: [], hidden: 0, counts: { open: 0, resolved: 0, pending: 0 }, reviewers: [] });
  });
});
