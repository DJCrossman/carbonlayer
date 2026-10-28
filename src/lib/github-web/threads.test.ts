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
        { content: 'THUMBS_UP', count: 2, viewerHasReacted: true },
        { content: 'EYES', count: 1, viewerHasReacted: false },
      ],
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
