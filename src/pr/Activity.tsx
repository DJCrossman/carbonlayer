// The activity timeline: comments, reviews, commits (consecutive ones grouped) and one-line events, with
// the PR-level comment composer at the bottom. A few skeleton rows stand in until the activity arrives.
import { useState, type Ref, type RefObject } from 'react';
import type { HideReason, PrDetail, PrStages, TimelineItem } from '../lib/model';
import { Avatar } from '../ui/Avatar';
import { Button } from '../ui/Button';
import { Icon } from '../ui/Icon';
import { Kbd } from '../ui/Kbd';
import { RelativeTime } from '../ui/RelativeTime';
import { Skeleton } from '../ui/Skeleton';
import { Comment } from './Comment';
import { followLink } from './navigation';
import type { StageState } from './page-data';
import { CommentInput, Staged, type CommentBox } from './primitives';
import { Reactions } from './Reactions';
import './activity.css';

/** How a review's header says its verdict, as Graphite's does: a verb, coloured for an approval or changes requested. */
const REVIEW_VERDICTS: Record<Extract<TimelineItem, { kind: 'review' }>['state'], { verb: string; tone: 'success' | 'danger' | 'muted' | 'attention' }> = {
  APPROVED: { verb: 'approved', tone: 'success' },
  CHANGES_REQUESTED: { verb: 'requested changes', tone: 'danger' },
  COMMENTED: { verb: 'commented', tone: 'muted' },
  DISMISSED: { verb: 'dismissed their review', tone: 'muted' },
  PENDING: { verb: 'started a review', tone: 'attention' },
};

export function Activity({
  pr,
  stage,
  onRetry,
  onRevealThread,
  onComment,
  onEditComment,
  onDeleteComment,
  onHideComment,
  onUnhideComment,
  composer,
}: {
  pr: PrDetail;
  stage: StageState<PrStages['activity']>;
  onRetry: () => void;
  onRevealThread: (threadId: string) => void;
  onComment: (body: string) => Promise<boolean>;
  /** Saves an edit of a comment or a review's summary, by its id, started on its version; true once GitHub has it. */
  onEditComment: (commentId: string, version: string | undefined, body: string) => Promise<boolean>;
  /** Deletes a comment of the viewer's, by its id; true once GitHub has. */
  onDeleteComment: (commentId: string) => Promise<boolean>;
  /** Hides a comment or a review's summary, by its id, for GitHub's reason; true once GitHub has. */
  onHideComment: (commentId: string, reason: HideReason) => Promise<boolean>;
  /** Shows a hidden comment or review summary again, by its id; true once GitHub has. */
  onUnhideComment: (commentId: string) => Promise<boolean>;
  /** The new-comment box at the foot of the activity, where a comment's, a review's and the description's Quote reply goes. */
  composer: RefObject<CommentBox | null>;
}) {
  const entries: Array<Exclude<TimelineItem, CommitItem> | { kind: 'commits'; id: string; commits: CommitItem[] }> = [];
  for (const item of pr.timeline) {
    const last = entries.at(-1);
    if (item.kind === 'commit' && last?.kind === 'commits') last.commits.push(item);
    else entries.push(item.kind === 'commit' ? { kind: 'commits', id: item.id, commits: [item] } : item);
  }

  return (
    <section className="pr-activity" aria-label="Activity">
      <h2 className="pr-section-title">Activity</h2>
      <Staged state={stage} what="the activity" onRetry={onRetry} skeleton={<ActivitySkeleton />}>
        {() => (
          <ol className="timeline">
            {entries.map((entry) => {
              switch (entry.kind) {
                case 'comment':
                  return (
                    <li key={entry.id} className="timeline-card">
                      <Comment
                        author={entry.author}
                        createdAt={entry.createdAt}
                        bodyHtml={entry.bodyHtml}
                        url={entry.url}
                        action={<span className="pr-muted">commented</span>}
                        edited={entry.edited}
                        footer={<Reactions subjectId={entry.subjectId} reactions={entry.reactions} />}
                        edit={entry.editableMarkdown === undefined ? undefined : { markdown: entry.editableMarkdown, save: (body) => onEditComment(entry.id, entry.bodyVersion, body) }}
                        onDelete={entry.deletable ? () => onDeleteComment(entry.id) : undefined}
                        markdown={entry.markdown}
                        hidden={entry.hidden}
                        onQuote={(quote) => composer.current?.insertQuote(quote)}
                        onHide={entry.hideable ? (reason) => onHideComment(entry.id, reason) : undefined}
                        onUnhide={entry.unhideable ? () => onUnhideComment(entry.id) : undefined}
                        reportable={entry.reportable}
                      />
                    </li>
                  );
                case 'review': {
                  const inline = entry.threadIds.length;
                  const firstThread = entry.threadIds[0];
                  const { verb, tone } = REVIEW_VERDICTS[entry.state];
                  // A review without a body is one line on its verdict's tint, its inline comments after its time, as
                  // Graphite's approval is; one with a body keeps its card, the link under it.
                  const bar = entry.bodyHtml.trim() === '';
                  const threads = firstThread && (
                    <button className="timeline-threads" onClick={() => onRevealThread(firstThread)}>
                      <Icon name="comment" size={12} />
                      {inline} inline {inline === 1 ? 'comment' : 'comments'}
                    </button>
                  );
                  return (
                    <li key={entry.id} className={`timeline-card ${bar ? 'is-bar' : 'is-review'} is-${entry.state.toLowerCase().replace('_', '-')}`}>
                      <Comment
                        author={entry.author}
                        createdAt={entry.createdAt}
                        bodyHtml={entry.bodyHtml}
                        url={entry.url}
                        action={<span className={`review-verb is-${tone}`}>{verb}</span>}
                        edited={entry.edited}
                        aside={bar && threads}
                        footer={<Reactions subjectId={entry.subjectId} reactions={entry.reactions} />}
                        edit={entry.editableMarkdown === undefined ? undefined : { markdown: entry.editableMarkdown, save: (body) => onEditComment(entry.id, entry.bodyVersion, body) }}
                        markdown={entry.markdown}
                        hidden={entry.hidden}
                        onQuote={(quote) => composer.current?.insertQuote(quote)}
                        onHide={entry.hideable ? (reason) => onHideComment(entry.id, reason) : undefined}
                        onUnhide={entry.unhideable ? () => onUnhideComment(entry.id) : undefined}
                        reportable={entry.reportable}
                      />
                      {!bar && threads}
                    </li>
                  );
                }
                case 'commits':
                  return (
                    <li key={entry.id} className="timeline-commits">
                      {entry.commits.map((commit) => (
                        <div key={commit.id} className="timeline-commit">
                          <Icon name="git-commit" size={14} className="pr-fg-muted" />
                          {commit.author && <Avatar user={commit.author} size={16} />}
                          {/* A commit opens in this tab, like GitHub's own commit links; ⌘, Ctrl, Shift or Alt leave it to the browser. */}
                          <a
                            className="timeline-commit-message"
                            href={commit.url}
                            onClick={(event) => {
                              if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
                              event.preventDefault();
                              followLink(event.currentTarget.href);
                            }}
                          >
                            {commit.messageHeadline}
                          </a>
                          <a
                            className="pr-mono pr-muted"
                            href={commit.url}
                            onClick={(event) => {
                              if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
                              event.preventDefault();
                              followLink(event.currentTarget.href);
                            }}
                          >
                            {commit.abbreviatedOid}
                          </a>
                          <RelativeTime date={commit.committedAt} />
                        </div>
                      ))}
                    </li>
                  );
                case 'force-push':
                  return (
                    <li key={entry.id} className="timeline-event">
                      <Icon name="repo-push" size={14} />
                      <strong>{entry.actor?.login ?? 'Someone'}</strong> force-pushed{' '}
                      <span className="pr-mono">{entry.beforeOid.slice(0, 7)}</span> → <span className="pr-mono">{entry.afterOid.slice(0, 7)}</span>
                      <RelativeTime date={entry.createdAt} />
                    </li>
                  );
                case 'review-requested':
                  return (
                    <li key={entry.id} className="timeline-event">
                      <Icon name="eye" size={14} />
                      <strong>{entry.actor?.login ?? 'Someone'}</strong> requested review from <strong>{entry.requested}</strong>
                      <RelativeTime date={entry.createdAt} />
                    </li>
                  );
                default: {
                  const [icon, text] = (
                    {
                      'ready-for-review': ['eye', 'marked this ready for review'],
                      'converted-to-draft': ['git-pull-request-draft', 'converted this to a draft'],
                      merged: ['git-merge', 'merged this'],
                      closed: ['git-pull-request-closed', 'closed this'],
                      reopened: ['git-pull-request', 'reopened this'],
                    } as const
                  )[entry.kind];
                  return (
                    <li key={entry.id} className={`timeline-event is-${entry.kind}`}>
                      <Icon name={icon} size={14} />
                      <strong>{entry.actor?.login ?? 'Someone'}</strong> {text}
                      <RelativeTime date={entry.createdAt} />
                    </li>
                  );
                }
              }
            })}
          </ol>
        )}
      </Staged>
      <CommentComposer onComment={onComment} box={composer} />
    </section>
  );
}

/** A few rows the shape of the timeline's: commits and events, and a comment. */
function ActivitySkeleton() {
  return (
    <ol className="timeline" aria-busy="true" aria-label="Loading the activity">
      {[240, 300].map((width) => (
        <li key={width} className="timeline-event">
          <Skeleton width={16} height={16} />
          <Skeleton width={width} height={10} />
        </li>
      ))}
      <li className="timeline-card">
        <div className="timeline-skeleton-card">
          <Skeleton width={160} height={12} />
          <Skeleton width="70%" height={10} />
        </div>
      </li>
      <li className="timeline-event">
        <Skeleton width={16} height={16} />
        <Skeleton width={200} height={10} />
      </li>
    </ol>
  );
}

function CommentComposer({ onComment, box }: { onComment: (body: string) => Promise<boolean>; box: Ref<CommentBox> }) {
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    if (await onComment(body)) setBody('');
    setBusy(false);
  };
  return (
    <div className="timeline-composer">
      <CommentInput ref={box} value={body} onChange={setBody} onSubmit={submit} placeholder="Leave a comment" disabled={busy} minRows={3} />
      <div className="timeline-composer-actions">
        <span className="pr-muted">Markdown supported</span>
        <Button variant="primary" onClick={submit} disabled={busy || body.trim() === ''}>
          Comment <Kbd>⌘↵</Kbd>
        </Button>
      </div>
    </div>
  );
}

type CommitItem = Extract<TimelineItem, { kind: 'commit' }>;
