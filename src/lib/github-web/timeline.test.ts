import { describe, expect, it } from 'vitest';
import { descriptionPermalink, reactionsIn, timelineFrom } from './timeline';

// A conversation the way GitHub renders it, cut down to the elements the parser reads (shapes from cli/cli#14320).
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
    expect(timeline[0]).toMatchObject({
      id: 'issuecomment-7',
      author: { login: 'bo' },
      bodyHtml: '<p>Looks good</p>',
      createdAt: '2026-09-02T11:00:00.000Z',
      url: 'https://github.com/o/r/pull/1#issuecomment-7',
    });
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

  it("reads a review's own body, reactions and menu inside the frame GitHub wraps the whole page in, still not its threads'", () => {
    // GitHub's full conversation page (nodejs/node#62105, 2026-10-28) puts everything in `repo-content-turbo-frame`.
    const review = `<turbo-frame id="repo-content-turbo-frame" target="_top"><div id="pullrequestreview-97" class="js-comment">
      <div class="TimelineItem"><div class="TimelineItem-body"><a class="author">cy</a> approved these changes <relative-time datetime="2026-09-03T09:00:00Z"></relative-time></div></div>
      <div class="TimelineItem"><div class="TimelineItem-body"><div id="pullrequestreview-97" class="timeline-comment-group">
        <div class="timeline-comment-actions"><details><details-menu>
          <clipboard-copy role="menuitem" value="Ship it">Copy Markdown</clipboard-copy>
          <button type="button" class="dropdown-item btn-link js-comment-edit-button" aria-label="Edit comment">Edit</button>
        </details-menu></details></div>
        <div class="comment-body"><p>Ship it</p></div>
        <form class="js-pick-reaction"><input type="hidden" name="input[subjectId]" value="PRR_97">
          <button name="input[content]" value="HOORAY react" class="social-reaction-summary-item js-reaction-group-button"><g-emoji alias="tada">🎉</g-emoji> 1</button>
        </form></div></div></div>
      <div class="TimelineItem"><turbo-frame id="review-thread-or-comment-id-7"><div class="comment-body"><p>nit</p></div>
        <form class="js-pick-reaction"><input type="hidden" name="input[subjectId]" value="PRRC_7"></form></turbo-frame></div>
    </div></turbo-frame>`;
    const [item] = timelineFrom(new DOMParser().parseFromString(review, 'text/html'), { pageUrl: '', threadIdsByReview: new Map(), commits: new Map() });
    expect(item).toMatchObject({
      kind: 'review',
      bodyHtml: '<p>Ship it</p>',
      subjectId: 'PRR_97',
      reactions: [{ content: 'HOORAY', count: 1, viewerHasReacted: false }],
      editableMarkdown: 'Ship it',
    });
  });

  it("marks a comment or a review's summary edited where its header shows GitHub's edit history, not a review whose thread comment was edited", () => {
    // The shape of GitHub's conversation page (nodejs/node#67062 and #62239, 2026-10-29, cut down): an edited comment's
    // header holds its edit history, "• edited" or "edited by …", and an unedited one's holds none.
    const history = (by: string) => `<span class="js-comment-edit-history"><span class="d-inline-block color-fg-muted">&#8226;</span>
      <details class="details-overlay details-reset d-inline-block dropdown"><summary class="btn-link no-underline color-fg-muted js-notice"><span>${by}</span></summary>
        <details-menu class="dropdown-menu js-comment-edit-history-menu" src="/user_content_edits/show_edit_history_log/IC_1" preload></details-menu></details></span>`;
    const comment = (id: number, edited: string) => `<div class="TimelineItem js-comment-container">
      <div class="timeline-comment-group TimelineItem-body" id="issuecomment-${id}"><div class="timeline-comment js-comment">
        <div class="timeline-comment-header"><h3><strong><a class="author">ana</a></strong> commented
          <a href="#issuecomment-${id}" class="Link--secondary js-timestamp"><relative-time datetime="2026-10-27T15:02:03Z"></relative-time></a>${edited}</h3></div>
        <div class="comment-body"><p>Comment ${id}</p></div></div></div>
    </div>`;
    const review = (id: number, edited: string, threadEdited: string) => `<div id="pullrequestreview-${id}" class="js-comment">
      <div class="TimelineItem"><div class="TimelineItem-body"><a class="author">bo</a> reviewed <relative-time datetime="2026-10-28T09:00:00Z"></relative-time></div></div>
      <div class="TimelineItem"><div class="TimelineItem-body"><div id="pullrequestreview-${id}" class="timeline-comment-group">
        <div class="timeline-comment-header"><h3><a class="author">bo</a> left a comment${edited}</h3></div>
        <div class="comment-body"><p>Review ${id}</p></div></div></div></div>
      <div class="TimelineItem"><turbo-frame id="review-thread-or-comment-id-${id}"><div id="discussion_r${id}">
        <h3><a class="author">ana</a>${threadEdited}</h3><div class="comment-body"><p>nit</p></div></div></turbo-frame></div>
    </div>`;
    const page = new DOMParser().parseFromString(
      `<turbo-frame id="repo-content-turbo-frame" target="_top">${comment(1, history('edited by joyeecheung'))}${comment(2, '')}${review(3, history('edited'), '')}${review(4, '', history('edited'))}</turbo-frame>`,
      'text/html',
    );
    const timeline = timelineFrom(page, { pageUrl: '', threadIdsByReview: new Map(), commits: new Map() });
    expect(timeline[0]).toMatchObject({ kind: 'comment', id: 'issuecomment-1', edited: true });
    expect(timeline[1]).toMatchObject({ kind: 'comment', id: 'issuecomment-2' });
    expect(timeline[1]).not.toHaveProperty('edited');
    expect(timeline[2]).toMatchObject({ kind: 'review', id: 'pullrequestreview-3', edited: true });
    expect(timeline[3]).toMatchObject({ kind: 'review', id: 'pullrequestreview-4' });
    expect(timeline[3]).not.toHaveProperty('edited');
  });
});

describe('timelineFrom, on comments the viewer may edit', () => {
  // The shape of GitHub's conversation page (a public PR's, 2026-10-27, cut down): a comment's options menu holds its
  // Copy link and Copy Markdown, and its Edit where the viewer may edit it; its `.js-comment` element holds its version.
  const menu = (markdown: string, editable: boolean) => `<div class="timeline-comment-actions"><details><details-menu>
      <clipboard-copy aria-label="Copy link" role="menuitem">Copy link</clipboard-copy>
      <clipboard-copy role="menuitem" value="${markdown}">Copy Markdown</clipboard-copy>
      ${editable ? '<button type="button" class="dropdown-item btn-link js-comment-edit-button" aria-label="Edit comment">Edit</button>' : ''}
    </details-menu></details></div>`;
  const page = new DOMParser().parseFromString(
    `<div class="TimelineItem js-comment-container">
      <div class="timeline-comment-group TimelineItem-body" id="issuecomment-11"><div class="timeline-comment js-comment" data-body-version="v-11">
        <a class="author">ana</a> commented <relative-time datetime="2026-10-20T10:00:00Z"></relative-time>${menu('Ship it?\n\n```ts\nx()\n```', true)}
        <div class="comment-body"><p>Ship it?</p><div class="zeroclipboard-container"><clipboard-copy aria-label="Copy" value="x()"></clipboard-copy></div></div></div></div>
    </div>
    <div class="TimelineItem js-comment-container">
      <div class="timeline-comment-group TimelineItem-body" id="issuecomment-12"><div class="timeline-comment js-comment" data-body-version="v-12">
        <a class="author">bo</a> commented <relative-time datetime="2026-10-20T11:00:00Z"></relative-time>${menu('Not yours', false)}
        <div class="comment-body"><p>Not yours</p></div></div></div>
    </div>
    <div id="pullrequestreview-21" class="js-comment">
      <div class="TimelineItem"><div class="TimelineItem-body"><a class="author">ana</a> left a comment <relative-time datetime="2026-10-21T09:00:00Z"></relative-time></div></div>
      <div class="TimelineItem"><div class="TimelineItem-body"><div id="pullrequestreview-21" class="timeline-comment-group">${menu('Looks good', true)}
        <div class="comment-body"><p>Looks good</p></div></div></div></div>
    </div>
    <div id="pullrequestreview-22" class="js-comment">
      <div class="TimelineItem"><div class="TimelineItem-body"><a class="author">bo</a> left a comment <relative-time datetime="2026-10-21T10:00:00Z"></relative-time></div></div>
      <div class="TimelineItem"><div class="TimelineItem-body"><div id="pullrequestreview-22" class="timeline-comment-group">${menu('By bo', false)}
        <div class="comment-body"><p>By bo</p></div></div></div></div>
      <div class="TimelineItem"><turbo-frame id="review-thread-or-comment-id-23">${menu('A diff comment', true)}<div class="comment-body"><p>A diff comment</p></div></turbo-frame></div>
    </div>`,
    'text/html',
  );
  const timeline = timelineFrom(page, { pageUrl: 'https://github.com/o/r/pull/1', threadIdsByReview: new Map(), commits: new Map() });

  it("offers a comment's Markdown, from its menu's Copy Markdown, only where its menu offers Edit, with the comment's version", () => {
    expect(timeline[0]).toMatchObject({ id: 'issuecomment-11', editableMarkdown: 'Ship it?\n\n```ts\nx()\n```', bodyVersion: 'v-11' });
    expect(timeline[1]).toMatchObject({ id: 'issuecomment-12', bodyHtml: '<p>Not yours</p>' });
    expect(timeline[1]).not.toHaveProperty('editableMarkdown');
    expect(timeline[1]).not.toHaveProperty('bodyVersion');
  });

  it("offers a review's own Markdown where its own menu offers Edit, not that of a thread it opened, and no version where the page gives none", () => {
    expect(timeline[2]).toMatchObject({ kind: 'review', id: 'pullrequestreview-21', editableMarkdown: 'Looks good' });
    expect(timeline[2]).not.toHaveProperty('bodyVersion');
    expect(timeline[3]).toMatchObject({ kind: 'review', id: 'pullrequestreview-22' });
    expect(timeline[3]).not.toHaveProperty('editableMarkdown');
  });

  it("reads every comment's and review's own Markdown from its Copy Markdown, which the menu copies and quotes, whoever may edit it", () => {
    expect(timeline.map((item) => ('markdown' in item ? item.markdown : undefined))).toEqual(['Ship it?\n\n```ts\nx()\n```', 'Not yours', 'Looks good', 'By bo']);
  });
});

describe('timelineFrom, on comments the viewer may delete', () => {
  // GitHub's Delete, a form in a comment's menu wherever the viewer may delete the comment: their own, and anyone's where
  // they are the repository's admin.
  const menu = (deletable: boolean) => `<div class="timeline-comment-actions"><details><details-menu>
      <clipboard-copy aria-label="Copy link" role="menuitem">Copy link</clipboard-copy>
      ${deletable ? '<form class="js-comment-delete" action="/o/r/issue_comments/0" method="post"><input type="hidden" name="_method" value="delete"><button type="submit" class="dropdown-item btn-link menu-item-danger" aria-label="Delete comment" data-confirm="Are you sure you want to delete this?">Delete</button></form>' : ''}
    </details-menu></details></div>`;
  const comment = (id: number, author: string, deletable: boolean) => `<div class="TimelineItem js-comment-container">
      <div class="timeline-comment-group TimelineItem-body" id="issuecomment-${id}"><div class="timeline-comment js-comment">
        <a class="author">${author}</a> commented <relative-time datetime="2026-10-20T10:00:00Z"></relative-time>${menu(deletable)}
        <div class="comment-body"><p>By ${author}</p></div></div></div>
    </div>`;
  const page = new DOMParser().parseFromString(
    `<html><head><meta name="user-login" content="octocat"></head><body>
    ${comment(11, 'octocat', true)}${comment(12, 'ana', true)}${comment(13, 'octocat', false)}
    <div id="pullrequestreview-21" class="js-comment">
      <div class="TimelineItem"><div class="TimelineItem-body"><a class="author">octocat</a> left a comment <relative-time datetime="2026-10-21T09:00:00Z"></relative-time></div></div>
      <div class="TimelineItem"><div class="TimelineItem-body"><div id="pullrequestreview-21" class="timeline-comment-group">${menu(true)}
        <div class="comment-body"><p>Looks good</p></div></div></div></div>
    </div></body></html>`,
    'text/html',
  );
  const timeline = timelineFrom(page, { pageUrl: 'https://github.com/o/r/pull/1', threadIdsByReview: new Map(), commits: new Map() });

  it("offers to delete only the viewer's own comments whose menus offer GitHub's Delete, not another's, nor a review", () => {
    expect(timeline.map((item) => ({ id: item.id, deletable: 'deletable' in item ? item.deletable : undefined }))).toEqual([
      { id: 'issuecomment-11', deletable: true },
      { id: 'issuecomment-12', deletable: undefined },
      { id: 'issuecomment-13', deletable: undefined },
      { id: 'pullrequestreview-21', deletable: undefined },
    ]);
  });
});

describe('timelineFrom, on hidden comments and those the viewer may hide', () => {
  // GitHub's classic page signed in, as its classic JS handles it (2026-11-16): the menu's Hide (`.js-comment-hide-button`)
  // where the viewer may hide the comment; a hidden one's `.minimized-comment` shown in place of its `.unminimized-comment`,
  // with the reason on its bar and its Unhide form (`form.js-comment-unminimize`) where the viewer may unhide it.
  const menu = (hideable: boolean) => `<div class="timeline-comment-actions"><details><details-menu>
      <clipboard-copy role="menuitem" value="The Markdown">Copy Markdown</clipboard-copy>
      ${hideable ? '<button type="button" class="dropdown-item btn-link js-comment-hide-button" role="menuitem">Hide</button>' : ''}
    </details-menu></details></div>`;
  const minimized = (reason: string, unhideable: boolean, shown: boolean) => `<div class="minimized-comment js-comment ${shown ? '' : 'd-none'}">
      <details><summary><h3 class="timeline-comment-header-text">
        ${reason}
      </h3></summary></details>
      ${unhideable ? '<form class="js-comment-unminimize" action="/o/r/comments/unminimize" method="post"><button type="submit">Unhide</button></form>' : ''}</div>`;
  const comment = (id: number, author: string, inside: string) => `<div class="TimelineItem js-comment-container">
      <div class="timeline-comment-group js-minimizable-comment-group TimelineItem-body" id="issuecomment-${id}">${inside}</div>
    </div>`;
  const unminimized = (author: string, hideable: boolean, shown: boolean) => `<div class="timeline-comment unminimized-comment js-comment ${shown ? '' : 'd-none'}">
      <a class="author">${author}</a> commented <relative-time datetime="2026-10-20T10:00:00Z"></relative-time>${menu(hideable)}
      <div class="comment-body"><p>By ${author}</p></div></div>`;
  const page = new DOMParser().parseFromString(
    `<html><head><meta name="user-login" content="octocat"></head><body>
    ${comment(31, 'ana', `${unminimized('ana', true, true)}${minimized('This comment was marked as off-topic.', true, false)}`)}
    ${comment(32, 'bo', `${unminimized('bo', true, false)}${minimized('This comment was marked as off-topic.', true, true)}`)}
    ${comment(33, 'cy', `${unminimized('cy', false, false)}${minimized('This comment was marked as low quality.', false, true)}`)}
    ${comment(34, 'dee', `${unminimized('dee', false, false)}${minimized('This comment has been minimized.', false, true)}`)}
    ${comment(35, 'octocat', unminimized('octocat', false, true))}
    <div id="pullrequestreview-41" class="js-comment">
      <div class="TimelineItem"><div class="TimelineItem-body"><a class="author">ana</a> left a comment <relative-time datetime="2026-10-21T09:00:00Z"></relative-time></div></div>
      <div class="TimelineItem"><div class="TimelineItem-body"><div id="pullrequestreview-41" class="timeline-comment-group">${menu(true)}
        <div class="comment-body"><p>Looks good</p></div></div></div></div>
      <div class="TimelineItem"><turbo-frame id="review-thread-or-comment-id-42">${minimized('This comment was marked as spam.', true, true)}<div class="comment-body"><p>A diff comment</p></div></turbo-frame></div>
    </div></body></html>`,
    'text/html',
  );
  const timeline = timelineFrom(page, { pageUrl: 'https://github.com/o/r/pull/1', threadIdsByReview: new Map(), commits: new Map() });
  const read = timeline.map((item) => ({
    id: item.id,
    hidden: 'hidden' in item ? item.hidden : undefined,
    hideable: 'hideable' in item ? item.hideable : undefined,
    unhideable: 'unhideable' in item ? item.unhideable : undefined,
  }));

  it('reads a hidden comment, with its body and the reason its bar says, and who may hide and unhide which', () => {
    expect(read.slice(0, 5)).toEqual([
      { id: 'issuecomment-31', hidden: undefined, hideable: true, unhideable: true },
      { id: 'issuecomment-32', hidden: { reason: 'OFF_TOPIC' }, hideable: true, unhideable: true },
      { id: 'issuecomment-33', hidden: { reason: 'LOW_QUALITY' }, hideable: undefined, unhideable: undefined },
      { id: 'issuecomment-34', hidden: { reason: null }, hideable: undefined, unhideable: undefined },
      { id: 'issuecomment-35', hidden: undefined, hideable: undefined, unhideable: undefined },
    ]);
    expect(timeline[1]).toMatchObject({ author: { login: 'bo' }, bodyHtml: '<p>By bo</p>' });
  });

  it("reads a review's own Hide, not a hidden comment of a thread it opened", () => {
    expect(read[5]).toEqual({ id: 'pullrequestreview-41', hidden: undefined, hideable: true, unhideable: undefined });
  });

  it("offers to report someone else's comment or review, not the viewer's own", () => {
    expect(timeline.map((item) => ('reportable' in item ? item.reportable : undefined))).toEqual([true, true, true, true, undefined, true]);
  });
});

describe('reactionsIn', () => {
  it("names who gave each reaction from its tooltip, neither the viewer, by login or as You, nor the ones GitHub only counts", () => {
    const page = new DOMParser().parseFromString(
      `<html><head><meta name="user-login" content="octocat"></head><body><form class="js-pick-reaction">
        <input type="hidden" name="input[subjectId]" value="IC_9">
        <button id="reactions--reaction_button_component-1" name="input[content]" value="THUMBS_UP unreact" class="social-reaction-summary-item"><g-emoji alias="+1">👍</g-emoji>
          <span class="js-discussion-reaction-group-count">14</span></button>
        <tool-tip for="reactions--reaction_button_component-1" popover="manual">ana, octocat, bo, and 11 more reacted with thumbs up emoji</tool-tip>
        <button id="reactions--reaction_button_component-2" name="input[content]" value="HEART react" class="social-reaction-summary-item"><g-emoji alias="heart">❤️</g-emoji> 2</button>
        <tool-tip for="reactions--reaction_button_component-2" popover="manual">cy and dee reacted with heart emoji</tool-tip>
        <button id="reactions--reaction_button_component-3" name="input[content]" value="ROCKET unreact" class="social-reaction-summary-item"><g-emoji alias="rocket">🚀</g-emoji> 2</button>
        <tool-tip for="reactions--reaction_button_component-3" popover="manual">You and ana reacted with rocket emoji</tool-tip>
        <button id="reactions--reaction_button_component-4" name="input[content]" value="EYES react" class="social-reaction-summary-item"><g-emoji alias="eyes">👀</g-emoji> 1</button>
      </form></body></html>`,
      'text/html',
    );
    expect(reactionsIn(page.querySelector('form')).reactions).toEqual([
      { content: 'THUMBS_UP', count: 14, viewerHasReacted: true, reactors: ['ana', 'bo'] },
      { content: 'HEART', count: 2, viewerHasReacted: false, reactors: ['cy', 'dee'] },
      { content: 'ROCKET', count: 2, viewerHasReacted: true, reactors: ['ana'] },
      { content: 'EYES', count: 1, viewerHasReacted: false, reactors: [] },
    ]);
  });
});

describe('descriptionPermalink', () => {
  it("is what GitHub's Copy link copies: the description header's link to #issue-<id>, not a link in its text", () => {
    // The shape of a public PR's description on github.com (2026-10-13), cut down.
    const page = new DOMParser().parseFromString(
      `<div class="TimelineItem js-comment-container">
        <div class="timeline-comment-group js-targetable-element TimelineItem-body" id="issue-555">
          <div id="pullrequest-444" class="timeline-comment-group js-targetable-element timeline-comment">
            <div class="timeline-comment-header"><h3><strong><a class="author" href="/ana">ana</a></strong> commented
              <a href="#issue-555" id="issue-555-permalink" class="Link--secondary js-timestamp"><relative-time datetime="2026-10-12T06:46:34Z"></relative-time></a></h3>
              <clipboard-copy aria-label="Copy link" for="issue-555-permalink" role="menuitem">Copy link</clipboard-copy></div>
            <div class="comment-body"><p>See <a href="#issue-1">the other one</a></p></div>
          </div>
        </div>
      </div>`,
      'text/html',
    );
    expect(descriptionPermalink(page, 'https://github.com/o/r/pull/1')).toBe('https://github.com/o/r/pull/1#issue-555');
  });

  it('is none when the conversation names none', () => {
    const page = new DOMParser().parseFromString(`<html><body>${conversation}</body></html>`, 'text/html');
    expect(descriptionPermalink(page, 'https://github.com/o/r/pull/1')).toBeNull();
  });
});
