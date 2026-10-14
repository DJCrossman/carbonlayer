import { describe, expect, it } from 'vitest';
import { timelineFrom } from './timeline';

// A conversation as GitHub renders it, cut down to the elements the parser reads (shapes from cli/cli#14320).
const conversation = `
<div class="TimelineItem">
  <div id="pullrequest-42" class="timeline-comment"><a class="author">ana</a> commented
    <relative-time datetime="2026-09-02T10:00:00Z"></relative-time><div class="comment-body"><p>The description</p></div></div>
</div>
<div class="TimelineItem js-comment-container">
  <div class="timeline-comment-group TimelineItem-body" id="issuecomment-7"><a class="author">bo</a> commented
    <relative-time datetime="2026-09-02T11:00:00Z"></relative-time><div class="comment-body"><p>Looks good</p></div>
    <div class="comment-reactions js-reactions-container"><form class="js-pick-reaction" action="/o/r/reactions" method="post">
      <input type="hidden" name="_method" value="put"><input type="hidden" name="authenticity_token" value="tok">
      <input type="hidden" name="input[subjectId]" value="IC_7">
      <button name="input[content]" value="THUMBS_UP react" class="social-reaction-summary-item js-reaction-group-button" aria-pressed="false"><g-emoji alias="+1">👍</g-emoji> 1</button>
      <button name="input[content]" value="HEART unreact" class="social-reaction-summary-item js-reaction-group-button" aria-pressed="true"><g-emoji alias="heart">❤️</g-emoji> 2</button>
    </form></div></div>
</div>
<div class="TimelineItem js-comment-container">
  <div class="timeline-comment-group TimelineItem-body" id="issuecomment-8"><div class="minimized-comment"></div></div>
</div>
<div id="event-1" class="TimelineItem">
  <div class="TimelineItem-badge"><svg class="octicon octicon-eye"></svg></div>
  <div class="TimelineItem-body"><a class="author text-bold">ana</a> requested a review from <a href="/cy"><span class="text-bold">cy</span></a>
    <relative-time datetime="2026-09-02T12:00:00Z"></relative-time></div>
</div>
<div id="pullrequestreview-99" class="js-comment">
  <div class="TimelineItem">
    <div class="TimelineItem-badge"><svg class="octicon octicon-check"></svg></div>
    <div class="TimelineItem-body"><strong><a class="author">cy</a></strong> approved these changes <relative-time datetime="2026-09-03T09:00:00Z"></relative-time></div>
  </div>
  <div class="TimelineItem"><div class="TimelineItem-body"><div id="pullrequestreview-99" class="timeline-comment"><a class="author">cy</a> left a comment
    <div class="comment-body"><p>Ship it</p></div>
    <form class="js-pick-reaction"><input type="hidden" name="input[subjectId]" value="PRR_99"></form></div></div></div>
  <div class="TimelineItem"><div class="TimelineItem-body"><turbo-frame id="review-thread-or-comment-id-5"><div class="comment-body"><p>nit</p></div></turbo-frame></div></div>
</div>
<div id="commits-pushed-abc1234" class="TimelineItem">
  <div class="TimelineItem-badge"><svg class="octicon octicon-repo-push"></svg></div>
  <div class="TimelineItem-body"><a class="author">ana</a> added 1 commit <relative-time datetime="2026-09-03T10:00:00+02:00"></relative-time></div>
</div>
<div class="TimelineItem">
  <div class="TimelineItem-badge"><svg class="octicon octicon-git-commit"></svg></div>
  <div class="TimelineItem-body"><code><a class="markdown-title" href="/o/r/pull/1/commits/abc1234abc1234abc1234abc1234abc1234abc12">Fix the widget</a></code></div>
</div>
<div id="event-2" class="TimelineItem">
  <div class="TimelineItem-badge"><svg class="octicon octicon-repo-push"></svg></div>
  <div class="TimelineItem-body"><a class="author">ana</a> <a href="/o/r/compare/1111111..2222222">force-pushed</a> the branch
    <relative-time datetime="2026-09-04T10:00:00Z"></relative-time></div>
</div>
<div id="event-3" class="TimelineItem">
  <div class="TimelineItem-badge"><svg class="octicon octicon-git-pull-request-draft"></svg></div>
  <div class="TimelineItem-body"><a class="author">ana</a> marked this pull request as draft <relative-time datetime="2026-09-05T10:00:00Z"></relative-time></div>
</div>
<div id="event-4" class="TimelineItem">
  <div class="TimelineItem-badge"><svg class="octicon octicon-eye"></svg></div>
  <div class="TimelineItem-body"><a class="author">ana</a> marked this pull request as ready for review <relative-time datetime="2026-09-06T10:00:00Z"></relative-time></div>
</div>
<div id="event-5" class="TimelineItem">
  <div class="TimelineItem-badge"><svg class="octicon octicon-cross-reference"></svg></div>
  <div class="TimelineItem-body"><a class="author">dee</a> mentioned this pull request <relative-time datetime="2026-09-07T10:00:00Z"></relative-time></div>
</div>
<div id="event-6" class="TimelineItem">
  <div class="TimelineItem-badge"><svg class="octicon octicon-git-merge"></svg></div>
  <div class="TimelineItem-body"><a class="author">cy</a> merged commit <code>9b6585b</code> into main <relative-time datetime="2026-09-08T10:00:00Z"></relative-time></div>
</div>`;

describe('timelineFrom', () => {
  const page = new DOMParser().parseFromString(`<html><body>${conversation}</body></html>`, 'text/html');
  const timeline = timelineFrom(page, {
    pageUrl: 'https://github.com/o/r/pull/1',
    threadIdsByReview: new Map([['99', ['5']]]),
    commits: new Map([['abc1234abc1234abc1234abc1234abc1234abc12', { createdAt: '2026-09-03T08:00:00.000Z', actorLogin: 'ana' }]]),
  });

  it('reads comments, reviews, commits and events in page order, skipping the description, hidden comments and unknown events', () => {
    expect(timeline.map((item) => item.kind)).toEqual(['comment', 'review-requested', 'review', 'commit', 'force-push', 'converted-to-draft', 'ready-for-review', 'merged']);
  });

  it('keeps who, when and what for each item', () => {
    expect(timeline[0]).toMatchObject({ id: 'issuecomment-7', author: { login: 'bo' }, bodyHtml: '<p>Looks good</p>', createdAt: '2026-09-02T11:00:00.000Z' });
    expect(timeline[1]).toMatchObject({ kind: 'review-requested', actor: { login: 'ana' }, requested: 'cy' });
    expect(timeline[2]).toMatchObject({
      kind: 'review',
      id: 'pullrequestreview-99',
      author: { login: 'cy' },
      state: 'APPROVED',
      bodyHtml: '<p>Ship it</p>',
      url: 'https://github.com/o/r/pull/1#pullrequestreview-99',
      threadIds: ['5'],
    });
    expect(timeline[3]).toMatchObject({ kind: 'commit', abbreviatedOid: 'abc1234', messageHeadline: 'Fix the widget', author: { login: 'ana' }, committedAt: '2026-09-03T08:00:00.000Z' });
    expect(timeline[4]).toMatchObject({ kind: 'force-push', beforeOid: '1111111', afterOid: '2222222' });
  });

  it("reads each comment's and review's reactions from its own reaction form, the viewer's by its unreact button", () => {
    expect(timeline[0]).toMatchObject({
      subjectId: 'IC_7',
      reactions: [
        { content: 'THUMBS_UP', count: 1, viewerHasReacted: false },
        { content: 'HEART', count: 2, viewerHasReacted: true },
      ],
    });
    expect(timeline[2]).toMatchObject({ subjectId: 'PRR_99', reactions: [] });
  });

  it('offers nothing to react to for a review without a body, though the threads it opened have reaction forms', () => {
    const review = `<div id="pullrequestreview-98">
      <div class="TimelineItem"><div class="TimelineItem-body"><a class="author">cy</a> reviewed <relative-time datetime="2026-09-03T09:00:00Z"></relative-time></div></div>
      <div class="TimelineItem"><turbo-frame id="review-thread-or-comment-id-6"><div class="comment-body"><p>nit</p></div>
        <form class="js-pick-reaction"><input type="hidden" name="input[subjectId]" value="PRRC_6">
          <button name="input[content]" value="EYES react" class="social-reaction-summary-item js-reaction-group-button"><g-emoji alias="eyes">👀</g-emoji> 4</button>
        </form></turbo-frame></div>
    </div>`;
    const [item] = timelineFrom(new DOMParser().parseFromString(review, 'text/html'), { pageUrl: '', threadIdsByReview: new Map(), commits: new Map() });
    expect(item).toMatchObject({ kind: 'review', subjectId: null, reactions: [] });
  });
});
