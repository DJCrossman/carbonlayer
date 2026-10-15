// The activity timeline: comments, reviews, commits (consecutive ones grouped) and one-line events, with
// the PR-level comment composer at the bottom. A few skeleton rows stand in until the activity arrives.
import { useState } from 'react';
import type { PrDetail, PrStages, TimelineItem } from '../lib/model';
import { Avatar } from '../ui/Avatar';
import { Button } from '../ui/Button';
import { Icon } from '../ui/Icon';
import { Kbd } from '../ui/Kbd';
import { RelativeTime } from '../ui/RelativeTime';
import { Skeleton } from '../ui/Skeleton';
import { Comment } from './Comment';
import { followLink } from './navigation';
import type { StageState } from './page-data';
import { CommentInput, Staged } from './primitives';
import { Reactions } from './Reactions';
import './activity.css';

export function Activity({
  pr,
  stage,
  onRetry,
  onRevealThread,
  onComment,
}: {
  pr: PrDetail;
  stage: StageState<PrStages['activity']>;
  onRetry: () => void;
  onRevealThread: (threadId: string) => void;
  onComment: (body: string) => Promise<boolean>;
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
                        footer={<Reactions subjectId={entry.subjectId} reactions={entry.reactions} />}
                      />
                    </li>
                  );
                case 'review': {
                  const inline = entry.threadIds.length;
                  const firstThread = entry.threadIds[0];
                  return (
                    <li key={entry.id} className={`timeline-card is-review is-${entry.state.toLowerCase().replace('_', '-')}`}>
                      <Comment
                        author={entry.author}
                        createdAt={entry.createdAt}
                        bodyHtml={entry.bodyHtml}
                        url={entry.url}
                        action={<ReviewBadge state={entry.state} />}
                        footer={<Reactions subjectId={entry.subjectId} reactions={entry.reactions} />}
                      />
                      {firstThread && (
                        <button className="timeline-threads" onClick={() => onRevealThread(firstThread)}>
                          <Icon name="comment" size={12} />
                          {inline} inline {inline === 1 ? 'comment' : 'comments'}
                        </button>
                      )}
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
                          {/* A commit opens in this tab, as GitHub's own commit links do; ⌘, Ctrl, Shift or Alt leave it to the browser. */}
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
      <CommentComposer onComment={onComment} />
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

function ReviewBadge({ state }: { state: Extract<TimelineItem, { kind: 'review' }>['state'] }) {
  const [label, tone, icon] = (
    {
      APPROVED: ['Approved', 'success', 'check'],
      CHANGES_REQUESTED: ['Changes requested', 'danger', 'file-diff'],
      COMMENTED: ['Commented', 'neutral', 'comment'],
      DISMISSED: ['Dismissed', 'neutral', 'skip'],
      PENDING: ['Pending', 'attention', 'clock'],
    } as const
  )[state];
  return (
    <span className={`review-badge is-${tone}`}>
      <Icon name={icon} size={12} />
      {label}
    </span>
  );
}

function CommentComposer({ onComment }: { onComment: (body: string) => Promise<boolean> }) {
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    if (await onComment(body)) setBody('');
    setBusy(false);
  };
  return (
    <div className="timeline-composer">
      <CommentInput value={body} onChange={setBody} onSubmit={submit} placeholder="Leave a comment" disabled={busy} minRows={3} />
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
