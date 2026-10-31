// The PR conversation, server-rendered by GitHub inside the React page: classic HTML with one
// `.TimelineItem` per comment, review header, commit or event (events carry an octicon badge).

import { REACTION_CONTENTS, type Reaction, type TimelineItem } from '../model';
import { githubUser } from './session';

/**
 * The conversation in page order. `threadIdsByReview` links a review (numeric id) to the threads it opened;
 * `commits` (from the changes page, by oid) supplies the commit times and authors that commit rows omit.
 */
export function timelineFrom(
  page: Document,
  context: {
    pageUrl: string;
    threadIdsByReview: Map<string, string[]>;
    commits: Map<string, { createdAt: string; actorLogin: string | null }>;
  },
): TimelineItem[] {
  const items: TimelineItem[] = [];
  const seenReviews: Set<Element> = new Set();
  const viewerLogin = page.querySelector('meta[name="user-login"]')?.getAttribute('content');
  // Commit rows have no time of their own; they follow the "added N commits" row that has one.
  let lastTime = '';

  for (const row of page.querySelectorAll('.TimelineItem')) {
    const datetime = Date.parse(row.querySelector('relative-time')?.getAttribute('datetime') ?? '');
    if (!Number.isNaN(datetime)) lastTime = new Date(datetime).toISOString();
    const createdAt = lastTime;
    const actorLogin = row.querySelector('a.author')?.textContent?.trim();
    const actor = actorLogin ? githubUser(actorLogin) : null;

    // A review is a wrapper holding its header row, its body comment and the threads it opened.
    const review = row.closest('[id^="pullrequestreview-"]');
    if (review) {
      if (seenReviews.has(review)) continue;
      seenReviews.add(review);
      const header = (row.querySelector('.TimelineItem-body')?.textContent ?? '').replace(/\s+/g, ' ');
      // The review's own body and reaction form, not those of the threads it opened: each thread is a turbo-frame inside
      // the review, while the frame GitHub wraps the whole page in (`repo-content-turbo-frame`) holds the review itself.
      const body = [...review.querySelectorAll('.comment-body')].find((element) => !review.contains(element.closest('turbo-frame')));
      const reactionForm = [...review.querySelectorAll('form.js-pick-reaction')].find((form) => !review.contains(form.closest('turbo-frame')));
      const actions = [...review.querySelectorAll('.timeline-comment-actions')].find((menu) => !review.contains(menu.closest('turbo-frame')));
      items.push({
        kind: 'review',
        id: review.id,
        author: actor ?? githubUser('ghost'),
        state: /dismissed/i.test(header)
          ? 'DISMISSED'
          : /approved these changes/.test(header)
            ? 'APPROVED'
            : /requested changes/.test(header)
              ? 'CHANGES_REQUESTED'
              : 'COMMENTED',
        bodyHtml: body?.innerHTML.trim() ?? '',
        createdAt,
        url: `${context.pageUrl}#${review.id}`,
        threadIds: context.threadIdsByReview.get(review.id.replace('pullrequestreview-', '')) ?? [],
        // Its summary edited, which its header marks as a comment's is, not a comment edited in a thread it opened.
        ...([...review.querySelectorAll('.js-comment-edit-history')].some((marker) => !review.contains(marker.closest('turbo-frame'))) && { edited: true }),
        ...reactionsIn(reactionForm),
        ...editingIn(actions, review),
      });
      continue;
    }

    // The PR description is rendered as the first comment; it is not part of the activity.
    if (row.querySelector('[id^="pullrequest-"]')) continue;

    const comment = row.querySelector('.timeline-comment-group[id^="issuecomment-"]');
    if (comment) {
      const body = comment.querySelector('.comment-body');
      // Minimized (hidden) comments render without a body.
      if (body) {
        items.push({
          kind: 'comment',
          id: comment.id,
          author: actor ?? githubUser('ghost'),
          bodyHtml: body.innerHTML.trim(),
          createdAt,
          url: `${context.pageUrl}#${comment.id}`,
          // GitHub's header marks an edited comment with its edit history, "• edited" (or "edited by mona") opening it.
          ...(comment.querySelector('.js-comment-edit-history') && { edited: true }),
          ...reactionsIn(comment.querySelector('form.js-pick-reaction')),
          ...editingIn(comment.querySelector('.timeline-comment-actions'), comment.querySelector('.js-comment')),
          // The viewer's own, where its menu offers GitHub's Delete (`form.js-comment-delete`); GitHub deletes no review.
          ...(viewerLogin && actorLogin === viewerLogin && comment.querySelector('.timeline-comment-actions .js-comment-delete') && { deletable: true }),
        });
      }
      continue;
    }

    const badge = row.querySelector('.TimelineItem-badge .octicon')?.getAttribute('class') ?? '';
    const text = (row.querySelector('.TimelineItem-body')?.textContent ?? '').replace(/\s+/g, ' ');
    const id = row.id || `${badge.replace(/.*octicon-/, '')}-${createdAt}`;

    if (badge.includes('octicon-git-commit')) {
      const link = row.querySelector('a[href*="/commit"]');
      const href = link?.getAttribute('href') ?? '';
      const oid = /\/commits?\/([0-9a-f]{40})/.exec(href)?.[1];
      if (!oid) continue;
      const known = context.commits.get(oid);
      const avatarLogin = row.querySelector('.AvatarStack img[alt^="@"]')?.getAttribute('alt')?.slice(1);
      const authorLogin = known?.actorLogin ?? avatarLogin;
      items.push({
        kind: 'commit',
        id: oid,
        oid,
        abbreviatedOid: oid.slice(0, 7),
        messageHeadline: (row.querySelector('a.markdown-title') ?? link)?.textContent?.trim() ?? '',
        author: authorLogin ? githubUser(authorLogin) : null,
        committedAt: known?.createdAt ?? createdAt,
        url: new URL(href, 'https://github.com').href,
      });
    } else if (/force-pushed/.test(text)) {
      const [, beforeOid = '', afterOid = ''] = /\/compare\/([0-9a-f]+)\.\.\.?([0-9a-f]+)/.exec(row.querySelector('a[href*="/compare/"]')?.getAttribute('href') ?? '') ?? [];
      items.push({ kind: 'force-push', id, actor, createdAt, beforeOid, afterOid });
    } else if (/requested (?:an? )?(?:\w+ )?reviews? from/.test(text)) {
      // The requested reviewer (user or team) is the bold name after the actor.
      const requested = row.querySelector('.TimelineItem-body .text-bold:not(.author)')?.textContent?.trim();
      if (requested) items.push({ kind: 'review-requested', id, actor, requested, createdAt });
    } else if (/review requested due to/.test(text) && actor) {
      // An automatic request ("Copilot AI balanced review requested due to automatic review settings") names the reviewer as the actor.
      items.push({ kind: 'review-requested', id, actor: null, requested: actor.login, createdAt });
    } else if (/marked this pull request as ready for review/.test(text)) {
      items.push({ kind: 'ready-for-review', id, actor, createdAt });
    } else if (/marked this pull request as draft/.test(text) || badge.includes('octicon-git-pull-request-draft')) {
      items.push({ kind: 'converted-to-draft', id, actor, createdAt });
    } else if (badge.includes('octicon-git-merge')) {
      items.push({ kind: 'merged', id, actor, createdAt });
    } else if (/\bclosed this\b/.test(text) || badge.includes('octicon-git-pull-request-closed')) {
      items.push({ kind: 'closed', id, actor, createdAt });
    } else if (/\breopened this\b/.test(text)) {
      items.push({ kind: 'reopened', id, actor, createdAt });
    }
  }
  return items;
}

/**
 * GitHub's permalink to the PR's description, as its "Copy link" copies it: the timestamp in the description's header
 * links to `#issue-<id>` (the issue's id, not the pull request's), from an anchor with the id `issue-<id>-permalink`.
 */
export function descriptionPermalink(page: Document, pageUrl: string): string | null {
  const anchor = page.querySelector('[id^="pullrequest-"] a[href^="#issue-"][id$="-permalink"]')?.getAttribute('href');
  return anchor ? `${pageUrl}${anchor}` : null;
}

/**
 * What a comment's reaction form (`form.js-pick-reaction`) says: the subject a reaction names, and a button for each
 * reaction given, valued `<CONTENT> react`, or `<CONTENT> unreact` once the viewer gave it, reading its emoji and count,
 * with the tooltip (`<tool-tip for>` the button) naming who gave it: "ana, bo, and 3 more reacted with thumbs up emoji".
 * Without a form there is nothing to react with.
 */
export function reactionsIn(form: Element | null | undefined): { subjectId: string | null; reactions: Reaction[] } {
  if (!form) return { subjectId: null, reactions: [] };
  const viewerLogin = form.ownerDocument.querySelector('meta[name="user-login"]')?.getAttribute('content');
  const tooltips = [...form.querySelectorAll('tool-tip')];
  const reactions = [...form.querySelectorAll('button.social-reaction-summary-item')].flatMap((button): Reaction[] => {
    const [, value = '', un] = /^([A-Z_]+) (un)?react$/.exec(button.getAttribute('value')?.trim() ?? '') ?? [];
    const content = REACTION_CONTENTS.find((known) => known === value);
    const count = Number(/(\d+)\s*$/.exec(button.textContent ?? '')?.[1] ?? 0);
    const viewerHasReacted = un === 'un';
    const tooltip = tooltips.find((candidate) => button.id && candidate.getAttribute('for') === button.id)?.textContent?.trim() ?? '';
    // The names before "reacted with", but the "N more" GitHub leaves unnamed, and the viewer, by login or as "You".
    const reactors = (/^(.+?) reacted with /.exec(tooltip)?.[1] ?? '')
      .split(/, and |, | and /)
      .filter((name) => name && !/^\d+ more$/.test(name) && name !== viewerLogin && !(viewerHasReacted && name === 'You'));
    return content && (count > 0 || viewerHasReacted) ? [{ content, count, viewerHasReacted, reactors }] : [];
  });
  return { subjectId: form.querySelector('input[name="input[subjectId]"]')?.getAttribute('value') || null, reactions };
}

/**
 * What editing a comment starts from, as its options menu (`.timeline-comment-actions`) and its `.js-comment` element have
 * it: GitHub offers the viewer Edit in the menu (`.js-comment-edit-button`) only on a comment they may edit, the menu's
 * Copy Markdown holds the comment's Markdown, and the element its version (`data-body-version`), which GitHub's page
 * sends with an edit. Nothing where the menu offers no Edit, or no Markdown to start from.
 */
function editingIn(actions: Element | null | undefined, comment: Element | null): { editableMarkdown?: string; bodyVersion?: string } {
  const markdown = actions?.querySelector('.js-comment-edit-button') ? actions.querySelector('clipboard-copy[role="menuitem"][value]')?.getAttribute('value') : null;
  if (markdown === null || markdown === undefined) return {};
  const version = comment?.getAttribute('data-body-version');
  return { editableMarkdown: markdown, ...(version && { bodyVersion: version }) };
}
