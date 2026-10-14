// The pull request page: header, stack, description, activity and every diff in one scroll, with status in
// a sticky sidebar and Graphite's keybindings. Everything comes through `source`, in stages (page-data.ts): the
// header first, then each part as its stage arrives, each with its own skeleton. Each mutation is shown optimistically
// where that matters (viewed, resolved, draft, auto-merge, reactions) and then reloads the stages it changed.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { postToParent } from '../app/bridge';
import { copyPullRequest } from '../app/copy-pull-request';
import type { DataSource, ReviewThreadDraft } from '../app/data-source';
import { useRefreshOnReturn } from '../app/refresh-on-return';
import type { AppRoute } from '../app/routes';
import { SIGNED_OUT } from '../lib/github-web/session';
import type { PrDetail, PrStage, PrStages, ReactionContent } from '../lib/model';
import { STAGES_A_WRITE_CHANGES, type MergeMethod } from '../lib/rpc';
import type { Settings } from '../lib/settings';
import { Avatar } from '../ui/Avatar';
import { Button } from '../ui/Button';
import { Icon } from '../ui/Icon';
import { RelativeTime } from '../ui/RelativeTime';
import { Skeleton } from '../ui/Skeleton';
import { showToast, ToastHost } from '../ui/Toast';
import { Activity } from './Activity';
import { useCheckReruns } from './check-reruns';
import { Markdown } from './Comment';
import { CommentsDrawer } from './CommentsDrawer';
import { FilesSection, useFileReview } from './Files';
import { usePrKeybindings } from './keybindings';
import { followLink, goToPr, openOnGitHub } from './navigation';
import { prDetailFrom, usePrPageData, type PrPageData } from './page-data';
import { MarkdownPreview, StageError, Staged, StatePill } from './primitives';
import { PrReactions, Reactions, type ChangedReactions } from './Reactions';
import { QuickApproveDialog, ReviewComposer, type ReviewEvent } from './ReviewComposer';
import { ReviewersCard } from './Reviewers';
import { ShortcutHelp, ShortcutLegend } from './ShortcutHelp';
import { Sidebar } from './Sidebar';
import { StackCard, StackSkeleton } from './StackCard';
import type { NoteActions } from './Threads';
import './page.css';

export function PrPage({ source, route }: { source: DataSource; route: Extract<AppRoute, { page: 'pr' }> }) {
  const { owner, name } = route.repo;
  const [error, setError] = useState<string | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);

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

  if (error) return <PrError message={error} />;
  // Another PR starts its stages over.
  return <PrStagesView key={`${owner}/${name}#${route.number}`} source={source} route={route} settings={settings} />;
}

/** The PR's stages as they arrive: a page skeleton until the header does, which only signing in can stop. */
function PrStagesView({ source, route, settings }: { source: DataSource; route: Extract<AppRoute, { page: 'pr' }>; settings: Settings | null }) {
  const { data, reload, refresh } = usePrPageData(source, route.repo, route.number);
  const header = data.header;
  const prId = header.value?.id;
  // Every comment box on the page previews its Markdown as GitHub renders it on this PR.
  const previewMarkdown = useCallback((text: string) => source.previewMarkdown(text, prId ?? ''), [source, prId]);
  // Not while a part of the page is loading already: the first load, a retry, or what a write changed.
  useRefreshOnReturn(refresh, { busy: Object.values(data).some((stage) => stage.status === 'loading') });
  if (header.status === 'error' && header.error === SIGNED_OUT) return <PrError message={header.error} />;
  if (!header.value || !settings) {
    const retry = () => void reload(['header'], true).catch(() => {});
    return <PrSkeleton headerError={header.status === 'error' ? <StageError what="this pull request" error={header.error} onRetry={retry} /> : null} />;
  }
  return (
    <MarkdownPreview value={previewMarkdown}>
      <PrView header={header.value} data={data} reload={reload} settings={settings} source={source} section={route.section} />
    </MarkdownPreview>
  );
}

function PrView({
  header,
  data,
  reload,
  settings,
  source,
  section,
}: {
  header: PrStages['header'];
  data: PrPageData;
  reload: (stages: readonly PrStage[], force?: boolean) => Promise<void>;
  settings: Settings;
  source: DataSource;
  section: Extract<AppRoute, { page: 'pr' }>['section'];
}) {
  const [edits, setEdits] = useState<PendingEdits>({ viewed: {}, resolved: {}, isDraft: null, autoMerge: null, reactions: {} });
  const pr = useMemo(() => optimisticPr(prDetailFrom(header, data), edits), [header, data, edits]);
  const files = useFileReview(pr);
  const checkReruns = useCheckReruns(pr, source, () => reload(STAGES_A_WRITE_CHANGES['pr.rerunFailedJobs']));
  /** A section's retry: its stages again, asked of GitHub rather than the content script's memory. */
  const retry = (stages: PrStage[]) => void reload(stages, true).catch(() => {});
  const [batch, setBatch] = useState<ReviewThreadDraft[]>([]);
  const [review, setReview] = useState<{ open: boolean; event: ReviewEvent; body: string }>({ open: false, event: 'COMMENT', body: '' });
  // Once the header's actions scroll out of sight, they appear again under the reviewers (PrActions, twice).
  const [headerActionsInView, setHeaderActionsInView] = useState(true);
  useEffect(() => {
    const button = document.querySelector('.pr-header .pr-review-anchor');
    if (!button) return;
    const observer = new IntersectionObserver(([entry]) => setHeaderActionsInView(entry?.isIntersecting ?? true), { root: document });
    observer.observe(button);
    return () => observer.disconnect();
  }, []);
  // More actions' menu, open beside whichever of the two shows, as the review popover is.
  const [menuOpen, setMenuOpen] = useState(false);
  const [quickApprove, setQuickApprove] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [reviewerPickerOpen, setReviewerPickerOpen] = useState(false);
  const [stackCollapsed, setStackCollapsed] = useState(false);
  const [commentsOpen, setCommentsOpen] = useState(false);
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

  /**
   * Runs a change against GitHub, then reloads the stages it changed (STAGES_A_WRITE_CHANGES), which the content script
   * has already forgotten. A failure is reported and its optimistic edit undone.
   */
  async function mutate(
    changed: readonly PrStage[],
    work: () => Promise<void>,
    failure: string,
    { success, undo }: { success?: string; undo?: () => void } = {},
  ): Promise<boolean> {
    try {
      await work();
    } catch (reason) {
      undo?.();
      showToast(`${failure}: ${reason instanceof Error ? reason.message : String(reason)}`, 'danger');
      return false;
    }
    if (success) showToast(success);
    try {
      await reload(changed);
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
    // The file shows its new state already; reloading every file and diff for it would only be slow.
    void mutate([], () => source.markFileViewed(pr.id, path, viewed), 'Could not update the viewed state', { undo: () => apply(!viewed) });
  }

  function setDraft(draft: boolean) {
    setEdits((current) => ({ ...current, isDraft: draft }));
    return mutate(STAGES_A_WRITE_CHANGES['pr.setDraft'], () => source.setDraft(pr.id, draft), draft ? 'Could not convert to draft' : 'Could not mark ready for review', {
      success: draft ? 'Converted to draft' : 'Marked ready for review',
      undo: () => setEdits((current) => ({ ...current, isDraft: null })),
    });
  }

  function react(subjectId: string, content: ReactionContent, add: boolean) {
    const mark = (given: boolean) =>
      setEdits((current) => ({ ...current, reactions: { ...current.reactions, [subjectId]: { ...current.reactions[subjectId], [content]: given } } }));
    mark(add);
    void mutate(STAGES_A_WRITE_CHANGES['pr.react'], () => source.react(pr.id, subjectId, content, add), add ? 'Could not react' : 'Could not take back the reaction', {
      undo: () => mark(!add),
    });
  }

  function openReview(event: ReviewEvent) {
    setReview((current) => ({ ...current, open: true, event: pr.viewerDidAuthor ? 'COMMENT' : event }));
  }

  const closeReview = useCallback(() => setReview((current) => ({ ...current, open: false })), []);

  const noteActions: NoteActions = {
    reply: (threadId, body) => mutate(STAGES_A_WRITE_CHANGES['pr.replyThread'], () => source.replyThread(threadId, body), 'Could not reply'),
    resolve: (threadId, resolved) => {
      setEdits((current) => ({ ...current, resolved: { ...current.resolved, [threadId]: resolved } }));
      return mutate(STAGES_A_WRITE_CHANGES['pr.resolveThread'], () => source.resolveThread(threadId, resolved), resolved ? 'Could not resolve the thread' : 'Could not unresolve the thread', {
        undo: () => setEdits((current) => ({ ...current, resolved: { ...current.resolved, [threadId]: !resolved } })),
      });
    },
    addToReview: (draft) => setBatch((current) => [...current, draft]),
    commentNow: (draft) =>
      mutate(STAGES_A_WRITE_CHANGES['pr.addThread'], () => source.addThread(pr.id, draft), 'Could not post the comment', {
        success: 'Comment posted',
      }),
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
      case 'toggle-comments':
        return setCommentsOpen((open) => !open);
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
      case 'edit-reviewers':
        return setReviewerPickerOpen(true);
      case 'rerun-failed-checks':
        return void checkReruns.rerun('failed');
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
      case 'copy-number':
      case 'copy-title-link':
      case 'copy-url':
        return void copyPullRequest(pr, action);
      case 'help':
        return setHelpOpen((open) => !open);
      case 'close':
        if (quickApprove) return setQuickApprove(false);
        if (helpOpen) return setHelpOpen(false);
        if (review.open) return closeReview();
        return files.closeComposer();
    }
  });

  const reviewPopover = (
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
            const ok = await mutate(STAGES_A_WRITE_CHANGES['pr.review'], () => source.review(pr.id, review.event, review.body, batch), 'Could not submit the review', {
              success: verdict,
            });
            if (ok) {
              setBatch([]);
              setReview({ open: false, event: 'COMMENT', body: '' });
            }
            return ok;
          }}
        />
      )
  );
  const actions = {
    pr,
    batchCount: batch.length,
    commentsOpen,
    onToggleComments: () => setCommentsOpen((open) => !open),
    onFinishReview: () => (review.open ? closeReview() : openReview(review.event)),
    onMenuOpenChange: setMenuOpen,
    onSetDraft: setDraft,
    onCopied: () => showToast('Link copied'),
  };

  return (
    <PrReactions value={{ changed: edits.reactions, react }}>
      <div className={`pr-page ${legendHidden ? '' : 'has-legend'} ${commentsOpen ? 'has-comments-drawer' : ''}`}>
        <div className="pr-conversation">
          <PrHeader
            pr={pr}
            actions={<PrActions {...actions} reviewPopover={headerActionsInView ? reviewPopover : null} menuOpen={menuOpen && headerActionsInView} />}
          />
          {data.header.status === 'error' && <StageError what="the header again" error={data.header.error} onRetry={() => retry(['header'])} />}
          {/* No stack card, not even its skeleton, when the page shows no stack. */}
          {(header.stackSource !== 'none' || pr.stack.source !== 'none') && (
            <Staged state={data.stack} what="the stack" onRetry={() => retry(['stack'])} skeleton={<StackSkeleton />}>
              {() => pr.stack.source !== 'none' && <StackCard stack={pr.stack} collapsed={stackCollapsed} onToggle={() => setStackCollapsed((collapsed) => !collapsed)} />}
            </Staged>
          )}
          <section className="pr-description" id="pr-description" aria-label="Description">
            {pr.bodyHtml.trim() ? <Markdown html={pr.bodyHtml} /> : <p className="pr-muted pr-description-empty">No description provided.</p>}
            <Reactions subjectId={pr.id} reactions={pr.descriptionReactions} />
          </section>
          <Activity
            pr={pr}
            stage={data.activity}
            onRetry={() => retry(['activity'])}
            onRevealThread={files.revealThread}
            onComment={(body) => mutate(STAGES_A_WRITE_CHANGES['pr.comment'], () => source.comment(pr.id, body), 'Could not post the comment', { success: 'Comment posted' })}
          />
        </div>
        <Sidebar
          pr={pr}
          data={data}
          onRetry={retry}
          actions={
            !headerActionsInView && (
              <div className="side-pr-actions">
                <PrActions {...actions} reviewPopover={reviewPopover} menuOpen={menuOpen} inSidebar />
              </div>
            )
          }
          mergeMethod={mergeMethod}
          onAutoMerge={(enabled, method) => {
            // Another method for an auto-merge already on: turned off, then on again with it.
            const switching = enabled && pr.autoMerge !== null && pr.autoMerge.method !== method;
            setEdits((current) => ({ ...current, autoMerge: enabled ? method : false }));
            return mutate(
              STAGES_A_WRITE_CHANGES['pr.setAutoMerge'],
              async () => {
                if (switching) await source.setAutoMerge(pr.id, false, method);
                await source.setAutoMerge(pr.id, enabled, method);
              },
              'Could not change Merge when ready',
              { undo: () => setEdits((current) => ({ ...current, autoMerge: null })) },
            );
          }}
          onRevert={async () => {
            try {
              const { url } = await source.revert(pr.id);
              // GitHub's prefilled page for the revert pull request, where it is created.
              if (url) followLink(url);
              else showToast('GitHub made the revert branch; open its pull request from GitHub');
              return true;
            } catch (reason) {
              showToast(`Could not revert: ${reason instanceof Error ? reason.message : String(reason)}`, 'danger');
              return false;
            }
          }}
          onMarkReady={() => setDraft(false)}
          onMerge={(method) => mutate(STAGES_A_WRITE_CHANGES['pr.merge'], () => source.merge(pr.id, method, pr.headOid), 'Could not merge', { success: `Merged #${pr.number}` })}
          onViewThreads={() => files.stepThread(1)}
          checkReruns={checkReruns}
          reviewersCard={
            <ReviewersCard
              pr={pr}
              pickerOpen={reviewerPickerOpen}
              onPickerOpenChange={setReviewerPickerOpen}
              searchReviewers={(query) => source.reviewerCandidates(pr.id, query)}
              onModify={(add, remove) =>
                mutate(STAGES_A_WRITE_CHANGES['pr.modifyReviewers'], () => source.modifyReviewers(pr.id, add, remove), 'Could not change the reviewers', { success: 'Reviewers updated' })
              }
              onReRequest={(reviewer) =>
                mutate(STAGES_A_WRITE_CHANGES['pr.reRequestReview'], () => source.reRequestReview(pr.id, reviewer.id), 'Could not re-request the review', {
                  success: `Asked ${reviewer.user.login} to review again`,
                })
              }
            />
          }
        />
        <FilesSection
          pr={pr}
          listed={data.files}
          threads={data.threads}
          onRetry={(stage) => retry([stage])}
          review={files}
          batch={batch}
          diffStyle={settings.diffLayout}
          onDiffStyleChange={(diffLayout) =>
            source.setSettings({ diffLayout }).catch((reason: unknown) => showToast(`Could not save: ${reason instanceof Error ? reason.message : String(reason)}`, 'danger'))
          }
          onToggleViewed={toggleViewed}
          noteActions={noteActions}
        />
        {commentsOpen && (
          <CommentsDrawer
            threads={pr.threads}
            stage={data.threads}
            batch={batch}
            files={files.order}
            viewerLogin={header.viewerLogin}
            currentThreadId={files.currentThreadId}
            actions={noteActions}
            onRevealThread={files.revealThread}
            onGoToFile={files.goToFile}
            onRetry={() => retry(['threads'])}
            onClose={() => setCommentsOpen(false)}
          />
        )}
        {legendHidden ? null : <ShortcutLegend onHide={() => setLegendHidden(true)} onShowAll={() => setHelpOpen(true)} />}
        {helpOpen && <ShortcutHelp legendHidden={legendHidden} onShowLegend={() => setLegendHidden(false)} onClose={() => setHelpOpen(false)} />}
        {quickApprove && (
          <QuickApproveDialog
            pr={pr}
            onClose={() => setQuickApprove(false)}
            onConfirm={() => mutate(STAGES_A_WRITE_CHANGES['pr.review'], () => source.review(pr.id, 'APPROVE', ''), 'Could not approve', { success: `Approved #${pr.number}` })}
          />
        )}
        <ToastHost />
      </div>
    </PrReactions>
  );
}

function PrHeader({ pr, actions }: { pr: PrDetail; /** The comments button, Finish review and More actions (PrActions). */ actions: ReactNode }) {
  return (
    <header className="pr-header">
      <div className="pr-header-top">
        <span className="pr-muted">
          {pr.repo.owner}/{pr.repo.name} <span className="pr-header-number">#{pr.number}</span>
        </span>
        <span className="pr-header-spacer" />
        {actions}
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

/** The page until its header arrives (one round trip); a header that failed says so in its place, with a retry. */
function PrSkeleton({ headerError }: { headerError: ReactNode }) {
  return (
    <div className="pr-page pr-skeleton" aria-busy="true" aria-label="Loading pull request">
      <div className="pr-conversation">
        {headerError ?? (
          <>
            <Skeleton width={160} height={12} />
            <Skeleton width="60%" height={26} />
            <Skeleton width="45%" height={14} />
          </>
        )}
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
  /** Shown by each reactions row (PrReactions) rather than applied over the PR, so the diffs keep their notes. */
  reactions: ChangedReactions;
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

/**
 * The PR's actions: the comments drawer's button, Finish review and More actions. In the header, and again under the
 * reviewers while the header's are scrolled out of sight; the review popover and the menu open beside the ones in view.
 */
function PrActions({
  pr,
  batchCount,
  commentsOpen,
  onToggleComments,
  onFinishReview,
  reviewPopover,
  menuOpen,
  onMenuOpenChange,
  onSetDraft,
  onCopied,
  inSidebar = false,
}: {
  pr: PrDetail;
  batchCount: number;
  commentsOpen: boolean;
  onToggleComments: () => void;
  onFinishReview: () => void;
  /** The review popover, when it is open and opens here. */
  reviewPopover: ReactNode;
  menuOpen: boolean;
  onMenuOpenChange: (open: boolean) => void;
  onSetDraft: (draft: boolean) => Promise<boolean>;
  onCopied: () => void;
  inSidebar?: boolean;
}) {
  const menu = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!(event.target instanceof Node) || !menu.current?.contains(event.target)) onMenuOpenChange(false);
    };
    const onKeyDown = (event: KeyboardEvent) => event.key === 'Escape' && onMenuOpenChange(false);
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [menuOpen, onMenuOpenChange]);

  return (
    <>
      {/* Opens the comments drawer; counts the open conversations once the threads have arrived. */}
      <Button
        className="pr-comments-toggle"
        icon="comment-discussion"
        onClick={onToggleComments}
        aria-pressed={commentsOpen}
        aria-label={pr.conversations ? `Comments: ${pr.unresolvedThreadCount} open` : 'Comments'}
        title="Comments (C)"
      >
        {pr.conversations ? pr.unresolvedThreadCount : null}
      </Button>
      <FinishReview batchCount={batchCount} onToggle={onFinishReview} popover={reviewPopover} floating={inSidebar} />
      <div className="pr-menu" ref={menu}>
        <Button onClick={() => onMenuOpenChange(!menuOpen)} aria-haspopup="menu" aria-expanded={menuOpen} aria-label="More actions">
          <Icon name="kebab-horizontal" size={14} />
        </Button>
        {menuOpen && (
          <div className="pr-menu-list" role="menu">
            {pr.state === 'OPEN' && pr.viewerCanUpdate && (
              <button
                role="menuitem"
                onClick={() => {
                  onMenuOpenChange(false);
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
                onMenuOpenChange(false);
                navigator.clipboard.writeText(pr.url).then(onCopied, () => showToast('Could not copy the link', 'danger'));
              }}
            >
              <Icon name="link-external" size={14} />
              Copy link
            </button>
          </div>
        )}
      </div>
    </>
  );
}

/**
 * Finish review, its popover under it; in the sidebar the popover floats beside it instead, rendered into the body since
 * the sidebar would clip it.
 */
function FinishReview({ batchCount, onToggle, popover, floating }: { batchCount: number; onToggle: () => void; popover: ReactNode; floating: boolean }) {
  const anchor = useRef<HTMLDivElement>(null);
  const [at, setAt] = useState<{ top: number; right: number; above: boolean } | null>(null);
  useLayoutEffect(() => {
    if (!popover || !floating) return;
    // Below the button when the popover fits there, else above it (the button often sits low in the sidebar).
    const place = () => {
      const rect = anchor.current?.getBoundingClientRect();
      const height = anchor.current?.querySelector('.review-popover')?.getBoundingClientRect().height ?? 320;
      if (!rect) return;
      const above = window.innerHeight - rect.bottom < height + 12 && rect.top > window.innerHeight - rect.bottom;
      setAt({ top: above ? rect.top : rect.bottom, right: window.innerWidth - rect.right, above });
    };
    place();
    window.addEventListener('resize', place);
    document.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      document.removeEventListener('scroll', place, true);
    };
  }, [popover, floating]);
  return (
    <div className="pr-review-anchor" ref={anchor}>
      <Button variant="primary" onClick={onToggle} aria-expanded={Boolean(popover)} title="Finish review (r c)">
        Finish review
        {batchCount > 0 && <span className="pr-badge pr-review-badge">{batchCount}</span>}
      </Button>
      {!floating
        ? popover
        : popover &&
          at &&
          // In the body, past the sidebar's clipping; still a `.pr-review-anchor`, so clicks inside it keep it open.
          createPortal(
            <div className={`pr-review-anchor review-popover-float ${at.above ? 'is-above' : ''}`} style={{ top: at.top, right: at.right }}>
              {popover}
            </div>,
            document.body,
          )}
    </div>
  );
}
