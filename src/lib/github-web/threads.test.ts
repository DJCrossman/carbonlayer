import { describe, expect, it } from 'vitest';
import { conversationsIn, reviewThreads, threadsAnswer } from './threads';

describe('reviewThreads', () => {
  // Thread 1 is anchored on the current diff; thread 2 is outdated and only the conversation says where it was.
  const page = new DOMParser().parseFromString(
    `<html><body>
      <turbo-frame id="review-thread-or-comment-id-2">
        <a class="text-mono">src/old.ts</a><span class="Label">Outdated</span>
        <table class="diff-table"><tbody>
          <tr><td class="blob-num" data-line-number="1"></td><td class="blob-num" data-line-number="1"></td><td class="blob-code blob-code-context"><span class="blob-code-inner">keep</span></td></tr>
          <tr><td class="blob-num" data-line-number="2"></td><td class="blob-num empty-cell"></td><td class="blob-code blob-code-deletion"><span class="blob-code-inner">drop</span></td></tr>
        </tbody></table>
      </turbo-frame>
    </body></html>`,
    'text/html',
  );
  const { threads, threadIdsByReview } = reviewThreads(
    threadsAnswer.parse({
      threads: [
        {
          id: '1',
          isResolved: false,
          pullRequestReviewId: 77,
          commentsData: {
            comments: [
              {
                id: 'PRRC_501',
                databaseId: 501,
                author: { login: 'ana', avatarUrl: 'https://a/ana' },
                body: 'nit',
                bodyHTML: '<p>nit</p>',
                publishedAt: '2026-10-01T00:00:00Z',
                url: 'https://github.com/o/r/pull/1#discussion_r501',
                // GitHub lists all eight reactions; most with nobody.
                reactionGroups: ['THUMBS_UP', 'THUMBS_DOWN', 'LAUGH', 'HOORAY', 'CONFUSED', 'HEART', 'ROCKET', 'EYES'].map((content) => ({
                  reaction: { content, viewerHasReacted: content === 'THUMBS_UP' },
                  reactors: [],
                  totalCount: content === 'THUMBS_UP' ? 2 : content === 'EYES' ? 1 : 0,
                })),
              },
            ],
          },
        },
        { id: '2', isResolved: true, pullRequestReviewId: 77, commentsData: { comments: [{ databaseId: 502, author: { login: 'bo' }, body: 'old', bodyHTML: '<p>old</p>', createdAt: '2026-09-01T00:00:00Z', currentDiffResourcePath: '/o/r/pull/1/files#r502' }] } },
      ],
    }),
    { diffSummaries: [{ path: 'src/new.ts', markersMap: { R69: { threads: [{ id: 1, start: 'R55' }] } } }] },
    page,
  );

  it('places threads by their diff anchors, falling back to the conversation for outdated ones', () => {
    expect(threads[0]).toMatchObject({ id: '1', path: 'src/new.ts', line: 69, startLine: 55, side: 'RIGHT', isOutdated: false, isResolved: false });
    expect(threads[1]).toMatchObject({ id: '2', path: 'src/old.ts', line: null, isOutdated: true, diffHunk: '@@ -1,2 +1,1 @@\n keep\n-drop' });
  });

  it('identifies comments by database id (replies need it), with the node id reactions name, and links threads to their review', () => {
    expect(threads[0]?.comments[0]).toEqual({
      id: '501',
      author: { login: 'ana', avatarUrl: 'https://a/ana', url: 'https://github.com/ana' },
      bodyHtml: '<p>nit</p>',
      createdAt: '2026-10-01T00:00:00Z',
      url: 'https://github.com/o/r/pull/1#discussion_r501',
      subjectId: 'PRRC_501',
      reactions: [
        { content: 'THUMBS_UP', count: 2, viewerHasReacted: true, reactors: [] },
        { content: 'EYES', count: 1, viewerHasReacted: false, reactors: [] },
      ],
      markdown: 'nit',
    });
    expect(threads[1]?.comments[0]?.url).toBe('https://github.com/o/r/pull/1/files#r502');
    expect(threadIdsByReview.get('77')).toEqual(['1', '2']);
  });
});

describe('reviewThreads, on a comment on the whole file', () => {
  it('places a thread under the `FILE` marker on its file, with no line, and not outdated', () => {
    // The conversation names the file but shows no diff excerpt for it.
    const page = new DOMParser().parseFromString(
      '<html><body><turbo-frame id="review-thread-or-comment-id-2967545223"><a class="text-mono">docs/zones.png</a></turbo-frame></body></html>',
      'text/html',
    );
    const { threads } = reviewThreads(
      threadsAnswer.parse({ threads: [{ id: 2967545223, isResolved: false, commentsData: { comments: [{ databaseId: 701, author: { login: 'ana' }, bodyHTML: '<p>Compress this</p>' }] } }] }),
      { diffSummaries: [{ path: 'docs/zones.png', markersMap: { FILE: { threads: [{ id: 2967545223 }] } } }] },
      page,
    );
    expect(threads[0]).toMatchObject({ id: '2967545223', path: 'docs/zones.png', line: null, startLine: null, isOutdated: false, diffHunk: '' });
  });
});

describe('reviewThreads, on who reacted', () => {
  it("names who gave each reaction by login in GitHub's order, never the viewer, nor anyone GitHub's own button leaves unnamed", () => {
    const { threads } = reviewThreads(
      threadsAnswer.parse({
        threads: [
          {
            id: '4',
            commentsData: {
              comments: [
                {
                  databaseId: 801,
                  author: { login: 'bo' },
                  bodyHTML: '<p>Ship it</p>',
                  reactionGroups: [
                    {
                      reaction: { content: 'THUMBS_UP', viewerHasReacted: true },
                      reactors: [
                        { login: 'ana', typeName: 'User' },
                        { login: 'octocat', typeName: 'User' },
                        { login: 'someone', typeName: 'Other' },
                        { login: 'dependabot', typeName: 'Bot' },
                      ],
                      totalCount: 4,
                    },
                  ],
                },
              ],
            },
          },
        ],
      }),
      { diffSummaries: [] },
      new DOMParser().parseFromString('<html><head><meta name="user-login" content="octocat"></head><body></body></html>', 'text/html'),
    );
    expect(threads[0]?.comments[0]?.reactions).toEqual([{ content: 'THUMBS_UP', count: 4, viewerHasReacted: true, reactors: ['ana', 'dependabot'] }]);
  });
});

describe('reviewThreads, on diff comments the viewer may edit', () => {
  it('offers the Markdown and version of each comment GitHub lets the viewer edit, and nothing of the others', () => {
    const { threads } = reviewThreads(
      threadsAnswer.parse({
        threads: [
          {
            id: '3',
            commentsData: {
              comments: [
                { databaseId: 601, author: { login: 'ana' }, body: 'Mine\r\nto fix', bodyHTML: '<p>Mine<br>to fix</p>', bodyVersion: 'v-601', viewerCanUpdate: true },
                { databaseId: 602, author: { login: 'bo' }, body: 'Theirs', bodyHTML: '<p>Theirs</p>', bodyVersion: 'v-602', viewerCanUpdate: false },
                { databaseId: 603, author: { login: 'ana' }, bodyHTML: '<p>No Markdown sent</p>', viewerCanUpdate: true },
              ],
            },
          },
        ],
      }),
      { diffSummaries: [] },
      new DOMParser().parseFromString('<html><body></body></html>', 'text/html'),
    );
    const comments = threads[0]?.comments ?? [];
    expect(comments[0]).toMatchObject({ id: '601', editableMarkdown: 'Mine\r\nto fix', bodyVersion: 'v-601' });
    for (const comment of comments.slice(1)) {
      expect(comment).not.toHaveProperty('editableMarkdown');
      expect(comment).not.toHaveProperty('bodyVersion');
    }
    // The Markdown the menu copies and quotes, though, whoever may edit the comment; none where GitHub sent none.
    expect(comments.map((comment) => comment.markdown)).toEqual(['Mine\r\nto fix', 'Theirs', undefined]);
  });
});

describe('reviewThreads, on diff comments the viewer may hide or report', () => {
  it("reads a hidden comment's reason in either of GitHub's spellings, who may hide and unhide, and whom GitHub offers to report", () => {
    const { threads } = reviewThreads(
      threadsAnswer.parse({
        threads: [
          {
            id: '6',
            commentsData: {
              comments: [
                { databaseId: 701, author: { login: 'ana' }, bodyHTML: '<p>Spam</p>', isHidden: true, minimizedReason: 'spam', viewerCanMinimize: true, viewerCanUnminimize: true, viewerCanReport: true },
                { databaseId: 702, author: { login: 'bo' }, bodyHTML: '<p>Old</p>', isHidden: true, minimizedReason: 'OFF_TOPIC', viewerCanReportToMaintainer: true },
                { databaseId: 703, author: { login: 'cy' }, bodyHTML: '<p>Hidden, no reason</p>', isHidden: true, minimizedReason: null },
                { databaseId: 704, author: { login: 'octocat' }, bodyHTML: '<p>Mine</p>', isHidden: false, minimizedReason: null, viewerCanMinimize: true, viewerCanReport: true },
              ],
            },
          },
        ],
      }),
      { diffSummaries: [] },
      new DOMParser().parseFromString('<html><head><meta name="user-login" content="octocat"></head><body></body></html>', 'text/html'),
    );
    expect(threads[0]?.comments.map(({ id, hidden, hideable, unhideable, reportable }) => ({ id, hidden, hideable, unhideable, reportable }))).toEqual([
      { id: '701', hidden: { reason: 'SPAM' }, hideable: true, unhideable: true, reportable: true },
      { id: '702', hidden: { reason: 'OFF_TOPIC' }, hideable: undefined, unhideable: undefined, reportable: true },
      { id: '703', hidden: { reason: null }, hideable: undefined, unhideable: undefined, reportable: undefined },
      { id: '704', hidden: undefined, hideable: true, unhideable: undefined, reportable: undefined },
    ]);
  });
});

describe('reviewThreads, on diff comments the viewer may delete', () => {
  it("offers to delete only the viewer's own comments GitHub lets them delete, not another's GitHub would let them delete", () => {
    const { threads } = reviewThreads(
      threadsAnswer.parse({
        threads: [
          {
            id: '5',
            commentsData: {
              comments: [
                { databaseId: 901, author: { login: 'octocat' }, bodyHTML: '<p>Mine</p>', viewerCanDelete: true },
                { databaseId: 902, author: { login: 'ana' }, bodyHTML: '<p>Theirs, the viewer an admin</p>', viewerCanDelete: true },
                { databaseId: 903, author: { login: 'octocat' }, bodyHTML: '<p>Mine, GitHub says no</p>', viewerCanDelete: false },
              ],
            },
          },
        ],
      }),
      { diffSummaries: [] },
      new DOMParser().parseFromString('<html><head><meta name="user-login" content="octocat"></head><body></body></html>', 'text/html'),
    );
    expect(threads[0]?.comments.map(({ id, deletable }) => ({ id, deletable }))).toEqual([
      { id: '901', deletable: true },
      { id: '902', deletable: undefined },
      { id: '903', deletable: undefined },
    ]);
  });
});

describe('conversationsIn', () => {
  it('counts the resolved threads of all', () => {
    expect(conversationsIn({ threads: [{ id: '1', isResolved: true }, { id: '2', isResolved: false }, { id: 3, isResolved: true }] })).toEqual({ resolved: 2, total: 3 });
  });

  it('counts none in an answer without threads', () => {
    expect(conversationsIn({})).toEqual({ resolved: 0, total: 0 });
  });
});
