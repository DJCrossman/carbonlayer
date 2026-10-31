// A GitHub comment as the PR page shows it (timeline comments, review bodies, thread comments), and the
// Markdown HTML GitHub renders for it.
import { useEffect, useRef, useState, type MouseEvent, type ReactNode, type Ref } from 'react';
import type { UserRef } from '../lib/model';
import { Avatar } from '../ui/Avatar';
import { Button } from '../ui/Button';
import { Icon } from '../ui/Icon';
import { Kbd } from '../ui/Kbd';
import { RelativeTime } from '../ui/RelativeTime';
import { showToast } from '../ui/Toast';
import { focusComment, followLink } from './navigation';
import { CommentInput } from './primitives';
import './comment.css';
import './markdown.css';

/** What editing a comment needs: its Markdown, which the edit box starts from, and what saves an edit (true once saved). */
export interface Editable {
  markdown: string;
  save: (body: string) => Promise<boolean>;
}

export function Comment({ author, createdAt, bodyHtml, url, action, edited, aside, footer, compact, edit, onDelete }: {
  author: UserRef | null;
  createdAt: string;
  bodyHtml: string;
  url?: string;
  /** Shown after the author's login, e.g. "commented" or a review's verdict, "approved". */
  action?: ReactNode;
  /** Edited since it was posted, which a muted "(edited)" after its time says, as Graphite's does. */
  edited?: boolean;
  /** Shown after its time, e.g. the link to the inline comments a review without a body left. */
  aside?: ReactNode;
  /** Shown under the body, e.g. its reactions. */
  footer?: ReactNode;
  compact?: boolean;
  /** Where GitHub lets the viewer edit the comment: an Edit button in its header opens its edit box in place of its body. */
  edit?: Editable;
  /**
   * Where the comment is the viewer's own and GitHub lets them delete it: what deletes it (true once deleted), which the
   * ⋯ at the end of its header offers as GitHub's comment menu does.
   */
  onDelete?: () => Promise<boolean>;
}) {
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const editButton = useRef<HTMLButtonElement | null>(null);
  return (
    <div className={`pr-comment ${compact ? 'is-compact' : ''} ${deleting ? 'is-deleting' : ''}`} aria-busy={deleting || undefined}>
      <div className="pr-comment-header">
        {author && <Avatar user={author} size={compact ? 18 : 20} />}
        <strong>{author?.login ?? 'ghost'}</strong>
        {action}
        {url ? (
          // Its permalink, as GitHub's time is: a click focuses the comment in place, the address bar holding the link.
          <a
            className="pr-comment-time"
            href={url}
            onClick={(event) => {
              // A click with ⌘, Ctrl, Shift or Alt, or another button, is the browser's: a new tab or window, or a download.
              if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
              event.preventDefault();
              focusComment(url);
            }}
          >
            <RelativeTime date={createdAt} />
          </a>
        ) : (
          <RelativeTime date={createdAt} />
        )}
        {edited && <span className="pr-muted">(edited)</span>}
        {aside}
        {edit && !editing && <EditButton ref={editButton} onClick={() => setEditing(true)} />}
        {url && <CopyLink url={url} />}
        {onDelete && !editing && (
          <CommentMenu
            disabled={deleting}
            onDelete={async () => {
              // GitHub's own question before it deletes a comment.
              if (!window.confirm('Are you sure you want to delete this?')) return;
              // Faded while GitHub deletes it, until the page loads again without it; back as it was should GitHub refuse.
              setDeleting(true);
              if (!(await onDelete())) setDeleting(false);
            }}
          />
        )}
      </div>
      {edit && editing ? (
        <CommentEditor
          edit={edit}
          onClose={() => {
            setEditing(false);
            // Back on its Edit button, as GitHub's edit box gives the focus back.
            requestAnimationFrame(() => editButton.current?.focus());
          }}
        />
      ) : (
        <>
          {bodyHtml.trim() !== '' && <Markdown html={bodyHtml} />}
          {footer}
        </>
      )}
    </div>
  );
}

/**
 * Copies GitHub's permalink to a comment, as its "Copy link" does and Graphite's link icon: in the comment's header,
 * seen while the pointer is on the comment or the button has the keyboard's focus (comment.css).
 */
export function CopyLink({ url, subject = 'comment' }: { url: string; subject?: 'comment' | 'description' }) {
  return (
    <button
      type="button"
      className="pr-comment-link"
      aria-label={`Copy link to ${subject}`}
      title="Copy link"
      onClick={() =>
        navigator.clipboard.writeText(url).then(
          () => showToast(`Copied link to ${subject}`),
          (reason: unknown) => showToast(`Could not copy link to ${subject}: ${reason instanceof Error ? reason.message : String(reason)}`, 'danger'),
        )
      }
    >
      <Icon name="link" size={14} />
    </button>
  );
}

/** Opens a comment's edit box, as GitHub's Edit does: a pencil beside its Copy link, seen as the Copy link is (comment.css). */
export function EditButton({ subject = 'comment', onClick, ref }: { subject?: 'comment' | 'description'; onClick: () => void; ref?: Ref<HTMLButtonElement> }) {
  return (
    <button ref={ref} type="button" className="pr-comment-edit" aria-label={`Edit ${subject}`} title="Edit" onClick={onClick}>
      <Icon name="pencil" size={14} />
    </button>
  );
}

/**
 * The ⋯ at the end of a comment's header, as GitHub's comment menu, seen as the Copy link is (comment.css): Delete, in
 * red, as GitHub's menu ends. Esc closes it and gives the focus back to the ⋯.
 */
function CommentMenu({ disabled, onDelete }: { disabled: boolean; onDelete: () => void }) {
  const [open, setOpen] = useState(false);
  const menu = useRef<HTMLDivElement | null>(null);
  const button = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!(event.target instanceof Node) || !menu.current?.contains(event.target)) setOpen(false);
    };
    // Ahead of the page's own Esc (keybindings.ts), which would close other things too, such as the comments drawer.
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      setOpen(false);
      button.current?.focus();
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown, true);
    };
  }, [open]);

  return (
    <div className="pr-menu pr-comment-menu" ref={menu}>
      <button
        ref={button}
        type="button"
        className="pr-comment-more"
        aria-label="More comment actions"
        title="More actions"
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setOpen((current) => !current)}
      >
        <Icon name="kebab-horizontal" size={14} />
      </button>
      {open && (
        <div className="pr-menu-list" role="menu">
          <button
            type="button"
            role="menuitem"
            className="is-danger"
            autoFocus
            onClick={() => {
              setOpen(false);
              onDelete();
            }}
          >
            <Icon name="trash" size={14} />
            Delete
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * A comment's edit box, as GitHub's: the comment box holding its Markdown, then Cancel and "Update comment". ⌘↵ saves, Esc
 * cancels. It edits the comment as it was when the edit started, should the comment load again meanwhile. While GitHub
 * saves the edit the box takes no input; once saved it closes, and a refused edit leaves its text in the box.
 */
export function CommentEditor({ edit, onClose }: { edit: Editable; onClose: () => void }) {
  const [started] = useState(edit);
  const [body, setBody] = useState(edit.markdown);
  const [saving, setSaving] = useState(false);
  const save = async () => {
    setSaving(true);
    const saved = await started.save(body);
    setSaving(false);
    if (saved) onClose();
  };
  return (
    <div className="pr-comment-editor">
      <CommentInput value={body} onChange={setBody} onSubmit={save} onCancel={onClose} placeholder="Leave a comment" autoFocus disabled={saving} />
      <div className="pr-comment-editor-actions">
        <Button variant="ghost" size="sm" onClick={onClose} disabled={saving}>
          Cancel
        </Button>
        <Button variant="primary" size="sm" onClick={save} disabled={saving}>
          Update comment <Kbd>⌘↵</Kbd>
        </Button>
      </div>
    </div>
  );
}

/** GitHub's own rendering of a Markdown body (already sanitised by GitHub). Links leave the iframe properly. */
export function Markdown({ html, className }: { html: string; className?: string }) {
  const onClick = (event: MouseEvent<HTMLDivElement>) => {
    const anchor = event.target instanceof Element ? event.target.closest('a[href]') : null;
    if (!(anchor instanceof HTMLAnchorElement) || anchor.getAttribute('href')?.startsWith('#')) return;
    // A click with ⌘, Ctrl, Shift or Alt is the browser's: a new tab or window, or a download.
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    followLink(anchor.href);
  };
  return <div className={`markdown-body ${className ?? ''}`} onClick={onClick} dangerouslySetInnerHTML={{ __html: html }} />;
}
