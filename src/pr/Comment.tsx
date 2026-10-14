// A GitHub comment as the PR page shows it (timeline comments, review bodies, thread comments), and the
// Markdown HTML GitHub renders for it.
import type { MouseEvent, ReactNode } from 'react';
import type { UserRef } from '../lib/model';
import { Avatar } from '../ui/Avatar';
import { RelativeTime } from '../ui/RelativeTime';
import { followLink } from './navigation';
import './comment.css';
import './markdown.css';

export function Comment({ author, createdAt, bodyHtml, url, action, footer, compact }: {
  author: UserRef | null;
  createdAt: string;
  bodyHtml: string;
  url?: string;
  /** Shown after the author's login, e.g. "commented" or a review badge. */
  action?: ReactNode;
  /** Shown under the body, e.g. its reactions. */
  footer?: ReactNode;
  compact?: boolean;
}) {
  return (
    <div className={`pr-comment ${compact ? 'is-compact' : ''}`}>
      <div className="pr-comment-header">
        {author && <Avatar user={author} size={compact ? 18 : 20} />}
        <strong>{author?.login ?? 'ghost'}</strong>
        {action}
        {url ? (
          <a className="pr-comment-time" href={url} target="_blank" rel="noopener">
            <RelativeTime date={createdAt} />
          </a>
        ) : (
          <RelativeTime date={createdAt} />
        )}
      </div>
      {bodyHtml.trim() !== '' && <Markdown html={bodyHtml} />}
      {footer}
    </div>
  );
}

/** GitHub's own rendering of a Markdown body (already sanitised by GitHub). Links leave the iframe properly. */
export function Markdown({ html, className }: { html: string; className?: string }) {
  const onClick = (event: MouseEvent<HTMLDivElement>) => {
    const anchor = (event.target as Element).closest('a[href]');
    if (!(anchor instanceof HTMLAnchorElement) || anchor.getAttribute('href')?.startsWith('#')) return;
    event.preventDefault();
    followLink(anchor.href);
  };
  return <div className={`markdown-body ${className ?? ''}`} onClick={onClick} dangerouslySetInnerHTML={{ __html: html }} />;
}
