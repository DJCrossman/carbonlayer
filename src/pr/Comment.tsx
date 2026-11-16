// A GitHub comment as the PR page shows it (timeline comments, review bodies, thread comments), and the
// Markdown HTML GitHub renders for it.
import { Fragment, useEffect, useRef, useState, type MouseEvent, type ReactNode, type Ref } from 'react';
import type { HideReason, UserRef } from '../lib/model';
import { Avatar } from '../ui/Avatar';
import { Button } from '../ui/Button';
import { Icon, type IconName } from '../ui/Icon';
import { Kbd } from '../ui/Kbd';
import { RelativeTime } from '../ui/RelativeTime';
import { showToast } from '../ui/Toast';
import { newIssueReferencing, quoteReply } from './comment-menu';
import { HideCommentDialog } from './HideCommentDialog';
import { focusComment, followLink, openInNewTab } from './navigation';
import { CommentInput } from './primitives';
import './comment.css';
import './markdown.css';

/** What editing a comment needs: its Markdown, which the edit box starts from, and what saves an edit (true once saved). */
export interface Editable {
  markdown: string;
  save: (body: string) => Promise<boolean>;
}

/** One item of a comment's ⋯ menu. */
interface MenuItem {
  label: string;
  icon: IconName;
  danger?: boolean;
  onSelect: () => void;
}

export function Comment({
  author,
  createdAt,
  bodyHtml,
  url,
  action,
  edited,
  aside,
  footer,
  compact,
  edit,
  onDelete,
  markdown,
  hidden,
  onQuote,
  onHide,
  onUnhide,
  reportable,
}: {
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
  /** The comment's Markdown as GitHub keeps it, which the menu copies and quotes; without it the menu offers neither. */
  markdown?: string;
  /** Hidden, with GitHub's reason: the comment collapses to a line saying why, which shows it on request, as GitHub's does. */
  hidden?: { reason: HideReason | null };
  /** Puts a quote of the comment in the comment box its reply goes in, which the menu's Quote reply offers. */
  onQuote?: (quote: string) => void;
  /** Where GitHub lets the viewer hide the comment, not hidden: what hides it for a reason (true once hidden), the menu's Hide. */
  onHide?: (reason: HideReason) => Promise<boolean>;
  /** Where GitHub lets the viewer unhide the hidden comment: what shows it again (true once shown), the menu's Unhide. */
  onUnhide?: () => Promise<boolean>;
  /** Someone else's, which the menu offers to report to GitHub. */
  reportable?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [hiding, setHiding] = useState(false);
  const [showingHidden, setShowingHidden] = useState(false);
  const editButton = useRef<HTMLButtonElement | null>(null);
  const root = useRef<HTMLDivElement | null>(null);
  // What the reader had selected in the comment's body as the menu opened, which Quote reply quotes in place of the Markdown.
  const selected = useRef<string | null>(null);
  const login = author?.login ?? 'ghost';
  const newIssue = url && markdown !== undefined ? newIssueReferencing({ markdown, login, url }) : null;
  // GitHub's menu, in its order: the comment's link and Markdown, quoting it here and in a new issue; then what the viewer
  // may do to it; then reporting someone else's.
  const menu: MenuItem[][] = [
    [
      ...(url ? [{ label: 'Copy link', icon: 'link', onSelect: () => copyForViewer(url, 'link to comment') } satisfies MenuItem] : []),
      ...(markdown !== undefined ? [{ label: 'Copy Markdown', icon: 'markdown', onSelect: () => copyForViewer(markdown, 'comment as Markdown') } satisfies MenuItem] : []),
      ...(onQuote && markdown !== undefined ? [{ label: 'Quote reply', icon: 'quote', onSelect: () => onQuote(quoteReply(selected.current ?? markdown)) } satisfies MenuItem] : []),
      ...(newIssue ? [{ label: 'Reference in new issue', icon: 'issue-opened', onSelect: () => openInNewTab(newIssue) } satisfies MenuItem] : []),
    ],
    [
      ...(edit ? [{ label: 'Edit', icon: 'pencil', onSelect: () => setEditing(true) } satisfies MenuItem] : []),
      ...(onHide && !hidden ? [{ label: 'Hide', icon: 'eye-closed', onSelect: () => setHiding(true) } satisfies MenuItem] : []),
      ...(onUnhide && hidden ? [{ label: 'Unhide', icon: 'eye', onSelect: () => void onUnhide() } satisfies MenuItem] : []),
      ...(onDelete
        ? [
            {
              label: 'Delete',
              icon: 'trash',
              danger: true,
              onSelect: async () => {
                // GitHub's own question before it deletes a comment.
                if (!window.confirm('Are you sure you want to delete this?')) return;
                // Faded while GitHub deletes it, until the page loads again without it; back as it was should GitHub refuse.
                setDeleting(true);
                if (!(await onDelete())) setDeleting(false);
              },
            } satisfies MenuItem,
          ]
        : []),
    ],
    // GitHub's report form, in a new tab, naming the comment and its author as GitHub's own item does.
    ...(reportable && url && author
      ? [[{ label: 'Report content', icon: 'report', onSelect: () => openInNewTab(`https://github.com/contact/report-content?content_url=${encodeURIComponent(url)}&report=${login}+(user)`) } satisfies MenuItem]]
      : []),
  ].filter((group) => group.length > 0);
  const collapsed = !!hidden && !showingHidden;
  return (
    <div ref={root} className={`pr-comment ${compact ? 'is-compact' : ''} ${deleting ? 'is-deleting' : ''}`} aria-busy={deleting || undefined}>
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
        {menu.length > 0 && !editing && (
          <CommentMenu
            disabled={deleting}
            groups={menu}
            onOpen={() => {
              // A selection inside the comment's own body, as GitHub's Quote reply quotes it.
              const selection = window.getSelection();
              const body = root.current?.querySelector(':scope > .markdown-body');
              const range = selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : null;
              selected.current =
                body && range && !range.collapsed && body.contains(range.startContainer) && body.contains(range.endContainer) && range.toString().trim() !== '' ? range.toString() : null;
            }}
          />
        )}
      </div>
      {hidden && !(edit && editing) && (
        // GitHub's words for a hidden comment, its reason as GitHub writes it (`off-topic`), and its toggle.
        <div className="pr-comment-hidden">
          <Icon name="eye-closed" size={14} />
          <span>{hidden.reason ? `This comment was marked as ${hidden.reason.replace(/_/g, '-').toLowerCase()}.` : 'This comment has been minimized.'}</span>
          {bodyHtml.trim() !== '' && (
            <button type="button" className="pr-comment-hidden-toggle" aria-expanded={!collapsed} onClick={() => setShowingHidden(collapsed)}>
              {collapsed ? 'Show comment' : 'Hide comment'}
            </button>
          )}
        </div>
      )}
      {hiding && onHide && <HideCommentDialog onHide={onHide} onClose={() => setHiding(false)} />}
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
        !collapsed && (
          <>
            {bodyHtml.trim() !== '' && <Markdown html={bodyHtml} />}
            {footer}
          </>
        )
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
      onClick={() => copyForViewer(url, `link to ${subject}`)}
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
 * The ⋯ at the end of a comment's header, as GitHub's comment menu, seen as the Copy link is (comment.css): its groups of
 * items, a separator between each two, Delete in red. `onOpen` runs as it opens, before the click moves anything. Esc closes
 * it and gives the focus back to the ⋯.
 */
function CommentMenu({ disabled, groups, onOpen }: { disabled: boolean; groups: MenuItem[][]; onOpen: () => void }) {
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
        onClick={() => {
          if (!open) onOpen();
          setOpen(!open);
        }}
      >
        <Icon name="kebab-horizontal" size={14} />
      </button>
      {open && (
        <div className="pr-menu-list" role="menu">
          {groups.map((items, group) => (
            <Fragment key={group}>
              {group > 0 && <div className="pr-menu-separator" role="separator" />}
              {items.map((item, index) => (
                <button
                  key={item.label}
                  type="button"
                  role="menuitem"
                  className={item.danger ? 'is-danger' : undefined}
                  autoFocus={group === 0 && index === 0}
                  onClick={() => {
                    setOpen(false);
                    item.onSelect();
                  }}
                >
                  <Icon name={item.icon} size={14} />
                  {item.label}
                </button>
              ))}
            </Fragment>
          ))}
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

/** Copies text for the viewer, saying so in a toast as GitHub's Copy link and Copy Markdown do, or why it could not. */
function copyForViewer(text: string, what: string) {
  navigator.clipboard.writeText(text).then(
    () => showToast(`Copied ${what}`),
    (reason: unknown) => showToast(`Could not copy ${what}: ${reason instanceof Error ? reason.message : String(reason)}`, 'danger'),
  );
}
