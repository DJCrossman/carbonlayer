// The pull request page: header, stack, description, activity and every diff in one scroll, with status in
// a sticky sidebar and Graphite's keybindings. Everything comes through `source`; each mutation is shown
// optimistically where that matters (viewed, resolved, draft, auto-merge) and then refetched.
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { postToParent } from '../app/bridge';
import type { DataSource, ReviewThreadDraft } from '../app/data-source';
import type { AppRoute } from '../app/routes';
import type { PrDetail } from '../lib/model';
import type { MergeMethod } from '../lib/rpc';
import type { Settings } from '../lib/settings';
import { Avatar } from '../ui/Avatar';
import { Button } from '../ui/Button';
import { Icon } from '../ui/Icon';
import { RelativeTime } from '../ui/RelativeTime';
import { Skeleton } from '../ui/Skeleton';
import { showToast, ToastHost } from '../ui/Toast';
import { Activity } from './Activity';
import { Markdown } from './Comment';
import { FilesSection, useFileReview } from './Files';
import { usePrKeybindings } from './keybindings';
import { goToPr, openOnGitHub } from './navigation';
import { StatePill } from './primitives';
import { QuickApproveDialog, ReviewComposer, type ReviewEvent } from './ReviewComposer';
import { ShortcutHelp, ShortcutLegend } from './ShortcutHelp';
import { Sidebar } from './Sidebar';
import { StackCard } from './StackCard';
import type { NoteActions } from './Threads';
import './page.css';

export function PrPage({ source, route }: { source: DataSource; route: Extract<AppRoute, { page: 'pr' }> }) {
  const { owner, name } = route.repo;
  const { number } = route;
  const key = `${owner}/${name}#${number}`;
  const [loaded, setLoaded] = useState<{ key: string; pr: PrDetail } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  // A refetch that lands after the route moved on must not replace the new PR.
  const currentKey = useRef(key);
  currentKey.current = key;

  useEffect(() => {
    let cancelled = false;
    const fail = (reason: unknown) => !cancelled && setError(reason instanceof Error ? reason.message : String(reason));
    source.getSettings().then((value) => !cancelled && setSettings(value), fail);
    let unwatch = () => {};
    try {
      unwatch = source.watchSettings(setSettings);
    } catch (reason) {
      fail(reason);
    }
    return () => {
      cancelled = true;
      unwatch();
    };
  }, [source]);

  useEffect(() => {
    setError(null);
    source.fetchPr({ owner, name }, number).then(
      (pr) => {
        if (currentKey.current === key) setLoaded({ key, pr });
      },
      (reason: unknown) => {
        if (currentKey.current === key) setError(reason instanceof Error ? reason.message : String(reason));
      },
    );
  }, [source, owner, name, number, key]);

  const refetch = useCallback(async () => {
    const pr = await source.fetchPr({ owner, name }, number, true);
    if (currentKey.current === key) setLoaded({ key, pr });
  }, [source, owner, name, number, key]);

  if (error) return <PrError message={error} />;
  if (!settings || loaded?.key !== key) return <PrSkeleton />;
  return <PrView key={key} fetched={loaded.pr} settings={settings} source={source} section={route.section} refetch={refetch} />;
}

function PrView({
  fetched,
  settings,
  source,
  section,
  refetch,
}: {
  fetched: PrDetail;
  settings: Settings;
  source: DataSource;
  section: Extract<AppRoute, { page: 'pr' }>['section'];
  refetch: () => Promise<void>;
}) {
  const [edits, setEdits] = useState<PendingEdits>({ viewed: {}, resolved: {}, isDraft: null, autoMerge: null });
  const pr = useMemo(() => optimisticPr(fetched, edits), [fetched, edits]);
  const files = useFileReview(pr);
  const [batch, setBatch] = useState<ReviewThreadDraft[]>([]);
  const [review, setReview] = useState<{ open: boolean; event: ReviewEvent; body: string }>({ open: false, event: 'COMMENT', body: '' });
  const [quickApprove, setQuickApprove] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [stackCollapsed, setStackCollapsed] = useState(false);
  const [legendHidden, setLegendHidden] = useState(() => {
    try {
      return localStorage.getItem('gg:pr-legend-hidden') === '1';
    } catch {
      return false;
    }
  });
  const mergeMethod: MergeMethod = pr.allowedMergeMethods.includes(settings.mergeMethod) ? settings.mergeMethod : pr.defaultMergeMethod;

  useEffect(() => {
    const title = `${pr.title} · #${pr.number}`;
    postToParent({ type: 'gg:title', title });
    if (window.parent === window) document.title = title;
  }, [pr.title, pr.number]);

  useEffect(() => {
    const files = document.getElementById('pr-files');
    if (section !== 'files' || !files) return;
    // The page may be too short to bring the files to the top until the diffs have rendered, so keep them
    // pinned there while the page grows, until the reader takes over or it has settled.
    const pin = () => files.scrollIntoView({ block: 'start' });
    const observer = new ResizeObserver(pin);
    const stop = () => observer.disconnect();
    pin();
    observer.observe(document.body);
    const timer = setTimeout(stop, 3000);
    const events = ['wheel', 'keydown', 'pointerdown'] as const;
    for (const type of events) window.addEventListener(type, stop, { once: true, passive: true });
    return () => {
      stop();
      clearTimeout(timer);
      for (const type of events) window.removeEventListener(type, stop);
    };
  }, [section]);

  useEffect(() => {
    try {
      localStorage.setItem('gg:pr-legend-hidden', legendHidden ? '1' : '0');
    } catch {
      // Storage can be unavailable (blocked site data); the legend then simply shows again next time.
    }
  }, [legendHidden]);

  /** Runs a change against GitHub, then refetches. A failure is reported and its optimistic edit undone. */
  async function mutate(work: () => Promise<void>, failure: string, { success, undo }: { success?: string; undo?: () => void } = {}): Promise<boolean> {
    try {
      await work();
    } catch (reason) {
      undo?.();
      showToast(`${failure}: ${reason instanceof Error ? reason.message : String(reason)}`, 'danger');
      return false;
    }
    if (success) showToast(success);
    try {
      await refetch();
    } catch (reason) {
      showToast(`Saved, but reloading the PR failed: ${reason instanceof Error ? reason.message : String(reason)}`, 'danger');
    }
    return true;
  }

  function toggleViewed(path: string) {
    const viewed = pr.files.find((file) => file.path === path)?.viewerViewedState !== 'VIEWED';
    const apply = (value: boolean) => {
      setEdits((current) => ({ ...current, viewed: { ...current.viewed, [path]: value } }));
      files.setCollapsed(path, value);
    };
    apply(viewed);
    void mutate(() => source.markFileViewed(pr.id, path, viewed), 'Could not update the viewed state', { undo: () => apply(!viewed) });
  }

  function setDraft(draft: boolean) {
    setEdits((current) => ({ ...current, isDraft: draft }));
    return mutate(() => source.setDraft(pr.id, draft), draft ? 'Could not convert to draft' : 'Could not mark ready for review', {
      success: draft ? 'Converted to draft' : 'Marked ready for review',
      undo: () => setEdits((current) => ({ ...current, isDraft: null })),
    });
  }

  function openReview(event: ReviewEvent) {
    setReview((current) => ({ ...current, open: true, event: pr.viewerDidAuthor ? 'COMMENT' : event }));
  }

  const closeReview = useCallback(() => setReview((current) => ({ ...current, open: false })), []);

  const noteActions: NoteActions = {
    reply: (threadId, body) => mutate(() => source.replyThread(threadId, body), 'Could not reply'),
    resolve: (threadId, resolved) => {
      setEdits((current) => ({ ...current, resolved: { ...current.resolved, [threadId]: resolved } }));
      return mutate(() => source.resolveThread(threadId, resolved), resolved ? 'Could not resolve the thread' : 'Could not unresolve the thread', {
        undo: () => setEdits((current) => ({ ...current, resolved: { ...current.resolved, [threadId]: !resolved } })),
      });
    },
    addToReview: (draft) => setBatch((current) => [...current, draft]),
    commentNow: (draft) =>
      mutate(() => source.addThread(pr.id, draft.path, draft.line, draft.side, draft.body), 'Could not post the comment', { success: 'Comment posted' }),
    removePending: (index) => setBatch((current) => current.filter((_, at) => at !== index)),
    closeComposer: files.closeComposer,
  };

  usePrKeybindings((action) => {
    const { entries, currentIndex } = pr.stack;
    const currentFile = pr.files.find((file) => file.path === files.currentPath);
    switch (action) {
      case 'next-file':
        return files.stepFile(1);
      case 'prev-file':
        return files.stepFile(-1);
      case 'next-thread':
        return files.stepThread(1);
      case 'prev-thread':
        return files.stepThread(-1);
      case 'toggle-tree':
        return files.toggleTree();
      case 'toggle-stack':
        return setStackCollapsed((collapsed) => !collapsed);
      case 'stack-down': {
        const below = entries[currentIndex - 1];
        return below && goToPr(below);
      }
      case 'stack-up': {
        const above = entries[currentIndex + 1];
        return above && goToPr(above);
      }
      case 'review-comment':
        return openReview('COMMENT');
      case 'review-request-changes':
        return openReview('REQUEST_CHANGES');
      case 'review-approve':
        return openReview('APPROVE');
      case 'quick-approve':
        return setQuickApprove(true);
      case 'toggle-viewed':
        return currentFile && toggleViewed(currentFile.path);
      case 'toggle-file':
        return currentFile && files.setCollapsed(currentFile.path, !files.isCollapsed(currentFile));
      case 'open-github':
        return openOnGitHub(pr.url);
      case 'go-description':
        return document.getElementById('pr-description')?.scrollIntoView({ block: 'start' });
      case 'go-files':
        return document.getElementById('pr-files')?.scrollIntoView({ block: 'start' });
      case 'help':
        return setHelpOpen((open) => !open);
      case 'close':
        if (quickApprove) return setQuickApprove(false);
        if (helpOpen) return setHelpOpen(false);
        if (review.open) return closeReview();
        return files.closeComposer();
    }
  });

  return (
    <div className={`pr-page ${legendHidden ? '' : 'has-legend'}`}>
      <div className="pr-conversation">
        <PrHeader
          pr={pr}
          batchCount={batch.length}
          onFinishReview={() => (review.open ? closeReview() : openReview(review.event))}
          onSetDraft={setDraft}
          onCopied={() => showToast('Link copied')}
          reviewPopover={
            review.open && (
              <ReviewComposer
                pr={pr}
                batch={batch}
                event={review.event}
                body={review.body}
                onEventChange={(event) => setReview((current) => ({ ...current, event }))}
                onBodyChange={(body) => setReview((current) => ({ ...current, body }))}
                onRemove={noteActions.removePending}
                onClose={closeReview}
                onSubmit={async () => {
                  const verdict = { COMMENT: 'Review submitted', REQUEST_CHANGES: 'Changes requested', APPROVE: 'Approved' }[review.event];
                  const ok = await mutate(() => source.review(pr.id, review.event, review.body, batch), 'Could not submit the review', { success: verdict });
                  if (ok) {
                    setBatch([]);
                    setReview({ open: false, event: 'COMMENT', body: '' });
                  }
                  return ok;
                }}
              />
            )
          }
        />
        {pr.stack.source !== 'none' && (
          <StackCard stack={pr.stack} collapsed={stackCollapsed} onToggle={() => setStackCollapsed((collapsed) => !collapsed)} />
        )}
        <section className="pr-description" id="pr-description" aria-label="Description">
          {pr.bodyHtml.trim() ? <Markdown html={pr.bodyHtml} /> : <p className="pr-muted pr-description-empty">No description provided.</p>}
        </section>
        <Activity
          pr={pr}
          onRevealThread={files.revealThread}
          onComment={(body) => mutate(() => source.comment(pr.id, body), 'Could not post the comment', { success: 'Comment posted' })}
        />
      </div>
      <Sidebar
        pr={pr}
        mergeMethod={mergeMethod}
        onAutoMerge={(enabled) => {
          setEdits((current) => ({ ...current, autoMerge: enabled ? mergeMethod : false }));
          return mutate(() => source.setAutoMerge(pr.id, enabled, mergeMethod), 'Could not change Merge when ready', {
            undo: () => setEdits((current) => ({ ...current, autoMerge: null })),
          });
        }}
        onMarkReady={() => setDraft(false)}
        onMerge={(method) => mutate(() => source.merge(pr.id, method, pr.headOid), 'Could not merge', { success: `Merged #${pr.number}` })}
        onViewThreads={() => files.stepThread(1)}
      />
      <FilesSection
        pr={pr}
        review={files}
        batch={batch}
        diffStyle={settings.diffLayout}
        onDiffStyleChange={(diffLayout) => void source.setSettings({ diffLayout })}
        onToggleViewed={toggleViewed}
        noteActions={noteActions}
      />
      {legendHidden ? null : <ShortcutLegend onHide={() => setLegendHidden(true)} onShowAll={() => setHelpOpen(true)} />}
      {helpOpen && <ShortcutHelp legendHidden={legendHidden} onShowLegend={() => setLegendHidden(false)} onClose={() => setHelpOpen(false)} />}
      {quickApprove && (
        <QuickApproveDialog
          pr={pr}
          onClose={() => setQuickApprove(false)}
          onConfirm={() => mutate(() => source.review(pr.id, 'APPROVE', ''), 'Could not approve', { success: `Approved #${pr.number}` })}
        />
      )}
      <ToastHost />
    </div>
  );
}

function PrHeader({
  pr,
  batchCount,
  onFinishReview,
  onSetDraft,
  onCopied,
  reviewPopover,
}: {
  pr: PrDetail;
  batchCount: number;
  onFinishReview: () => void;
  onSetDraft: (draft: boolean) => Promise<boolean>;
  onCopied: () => void;
  reviewPopover: ReactNode;
}) {
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    if (!menuOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!(event.target instanceof Element) || !event.target.closest('.pr-menu')) setMenuOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => event.key === 'Escape' && setMenuOpen(false);
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [menuOpen]);

  return (
    <header className="pr-header">
      <div className="pr-header-top">
        <span className="pr-muted">
          {pr.repo.owner}/{pr.repo.name} <span className="pr-header-number">#{pr.number}</span>
        </span>
        <span className="pr-header-spacer" />
        <Button variant="ghost" onClick={() => openOnGitHub(pr.url)} title="Open on GitHub (g h)">
          <Icon name="link-external" size={14} />
          Open on GitHub
        </Button>
        <div className="pr-review-anchor">
          <Button variant="primary" onClick={onFinishReview} aria-expanded={Boolean(reviewPopover)} title="Finish review (r c)">
            Finish review
            {batchCount > 0 && <span className="pr-badge pr-review-badge">{batchCount}</span>}
          </Button>
          {reviewPopover}
        </div>
        <div className="pr-menu">
          <Button onClick={() => setMenuOpen((open) => !open)} aria-haspopup="menu" aria-expanded={menuOpen} aria-label="More actions">
            <Icon name="kebab-horizontal" size={14} />
          </Button>
          {menuOpen && (
            <div className="pr-menu-list" role="menu">
              {pr.state === 'OPEN' && pr.viewerCanUpdate && (
                <button
                  role="menuitem"
                  onClick={() => {
                    setMenuOpen(false);
                    void onSetDraft(!pr.isDraft);
                  }}
                >
                  <Icon name={pr.isDraft ? 'eye' : 'git-pull-request-draft'} size={14} />
                  {pr.isDraft ? 'Ready for review' : 'Convert to draft'}
                </button>
              )}
              <button
                role="menuitem"
                onClick={() => {
                  setMenuOpen(false);
                  void navigator.clipboard.writeText(pr.url).then(onCopied);
                }}
              >
                <Icon name="link-external" size={14} />
                Copy link
              </button>
            </div>
          )}
        </div>
      </div>
      <h1 className="pr-title">{pr.title}</h1>
      <div className="pr-meta">
        <StatePill pr={pr} />
        <span className="pr-meta-author">
          <Avatar user={pr.author} size={18} />
          <strong>{pr.author.login}</strong>
        </span>
        <span className="pr-branches pr-mono" title={`${pr.headRefName} into ${pr.baseRefName}`}>
          <span>{pr.headRefName}</span>
          <span className="pr-muted">→</span>
          <span>{pr.baseRefName}</span>
        </span>
        <span className="pr-muted">
          {pr.changedFiles} {pr.changedFiles === 1 ? 'file' : 'files'}
        </span>
        <span className="pr-diffstat">
          <span className="pr-fg-success">+{pr.additions}</span> <span className="pr-fg-danger">−{pr.deletions}</span>
        </span>
        <span className="pr-muted">
          Updated <RelativeTime date={pr.updatedAt} ago />
        </span>
      </div>
    </header>
  );
}

function PrSkeleton() {
  return (
    <div className="pr-page pr-skeleton" aria-busy="true" aria-label="Loading pull request">
      <div className="pr-conversation">
        <Skeleton width={160} height={12} />
        <Skeleton width="60%" height={26} />
        <Skeleton width="45%" height={14} />
        <Skeleton width="100%" height={110} />
        <Skeleton width="100%" height={220} />
      </div>
      <div className="pr-sidebar">
        <Skeleton width="100%" height={70} />
        <Skeleton width="100%" height={90} />
        <Skeleton width="100%" height={180} />
      </div>
    </div>
  );
}

function PrError({ message }: { message: string }) {
  return (
    <div className="pr-error" role="alert">
      <Icon name="x-circle-fill" size={20} className="pr-fg-danger" />
      <div>
        <strong>Could not load this pull request</strong>
        <p>{message}</p>
        {/sign in|session/i.test(message) || /\b404\b.*\/page_data\//.test(message) ? (
          <p className="pr-muted">Sign in to github.com in this tab, then reload.</p>
        ) : null}
      </div>
    </div>
  );
}

/** Changes made on this page that the next fetch will confirm, applied over the fetched PR meanwhile. */
interface PendingEdits {
  viewed: Record<string, boolean>;
  resolved: Record<string, boolean>;
  isDraft: boolean | null;
  autoMerge: MergeMethod | false | null;
}

/** The fetched PR with this page's not-yet-confirmed changes applied. */
function optimisticPr(pr: PrDetail, edits: PendingEdits): PrDetail {
  // Untouched lists keep their identity, so diffs whose notes did not change are not re-rendered.
  let unresolvedDelta = 0;
  const threads =
    Object.keys(edits.resolved).length === 0
      ? pr.threads
      : pr.threads.map((thread) => {
          const resolved = edits.resolved[thread.id];
          if (resolved === undefined || resolved === thread.isResolved) return thread;
          unresolvedDelta += resolved ? -1 : 1;
          return { ...thread, isResolved: resolved };
        });
  const files =
    Object.keys(edits.viewed).length === 0
      ? pr.files
      : pr.files.map((file) => {
          const viewed = edits.viewed[file.path];
          return viewed === undefined ? file : { ...file, viewerViewedState: viewed ? ('VIEWED' as const) : ('UNVIEWED' as const) };
        });
  const isDraft = edits.isDraft ?? pr.isDraft;
  return {
    ...pr,
    isDraft,
    mergeStatus: isDraft ? 'DRAFT' : pr.mergeStatus === 'DRAFT' ? 'UNKNOWN' : pr.mergeStatus,
    autoMerge: edits.autoMerge === null ? pr.autoMerge : edits.autoMerge === false ? null : { method: edits.autoMerge },
    threads,
    unresolvedThreadCount: Math.max(0, pr.unresolvedThreadCount + unresolvedDelta),
    files,
  };
}
