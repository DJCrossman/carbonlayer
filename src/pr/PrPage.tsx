// The pull request page: header, stack, description, activity and every diff in one scroll, with status in
// a sticky sidebar and Graphite's keybindings. Everything comes through `source`, in stages (page-data.ts): the
// header first, then each part as its stage arrives, each with its own skeleton. Each mutation is shown optimistically
// where that matters (viewed, resolved, draft, auto-merge, reactions) and then reloads the stages it changed.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { postToParent } from '../app/bridge';
import { copyPullRequest } from '../app/copy-pull-request';
import type { DataSource, ReviewThreadDraft } from '../app/data-source';
import { fileAnchor, type AppRoute } from '../app/routes';
import { useSettings } from '../app/use-settings';
import { SIGNED_OUT } from '../lib/github-web/session';
import type { ChangedFile, PrDetail, PrStage, PrStages, ReactionContent } from '../lib/model';
import { STAGES_A_WRITE_CHANGES, type MergeCommit, type MergeMethod } from '../lib/rpc';
import type { Settings } from '../lib/settings';
import { isUnderWay, mergeStackWhenReady, type StackMerge, type StackMergeRequest } from '../lib/stack-merges';
import { Avatar } from '../ui/Avatar';
import { Button } from '../ui/Button';
import { Icon } from '../ui/Icon';
import { RelativeTime } from '../ui/RelativeTime';
import { Skeleton } from '../ui/Skeleton';
import { showToast, ToastHost } from '../ui/Toast';
import { Activity } from './Activity';
import { AssigneesCard } from './Assignees';
import { useCheckReruns } from './check-reruns';
import { CopyLink, Markdown } from './Comment';
import { CommentsDrawer } from './CommentsDrawer';
import { FilesSection, useFileReview } from './Files';
import { usePrKeybindings } from './keybindings';
import { LabelsCard } from './Labels';
import { MergeStackDialog } from './MergeStackDialog';
import { nextActionFor, stackToMerge } from './next-action';
import { followLink, goToPr, openOnGitHub } from './navigation';
import { prDetailFrom, usePrPageData, type PrPageData } from './page-data';
import { MarkdownPreview, MentionList, StageError, Staged, StatePill } from './primitives';
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
  const { settings, error } = useSettings(source);
  if (error) return <PrError message={error} />;
  // Another PR starts its stages over, and everything the page was doing on the last one.
  return <PrStagesView key={`${owner}/${name}#${route.number}`} source={source} route={route} settings={settings} />;
}

/**
 * The PR's stages as they arrive: a page skeleton until the header does, which only signing in can stop. The window's
 * title names the PR, by its number until its header comes.
 */
function PrStagesView({ source, route, settings }: { source: DataSource; route: Extract<AppRoute, { page: 'pr' }>; settings: Settings | null }) {
  const { data, reload } = usePrPageData(source, route.repo, route.number);
  const header = data.header;
  const prId = header.value?.id;
  // Every comment box on the page previews its Markdown the way GitHub renders it on this PR, and suggests its people and
  // teams after an `@`.
  const previewMarkdown = useCallback((text: string) => source.previewMarkdown(text, prId ?? ''), [source, prId]);
  const mentionList = useMemo(() => ({ prId: prId ?? '', load: () => source.listMentions(prId ?? '') }), [source, prId]);
  const title = header.value ? `${header.value.title} · #${header.value.number}` : `#${route.number}`;
  useEffect(() => {
    postToParent({ type: 'gg:title', title });
    if (window.parent === window) document.title = title;
  }, [title]);
  if (header.status === 'error' && header.error === SIGNED_OUT) return <PrError message={header.error} />;
  if (!header.value) {
    const retry = () => void reload(['header']).catch(() => {});
    return <PrSkeleton headerError={header.status === 'error' ? <StageError what="this pull request" error={header.error} onRetry={retry} /> : null} />;
  }
  // The settings are read in a moment, once a tab: a header the cache had waits for them rather than show the skeleton.
  if (!settings) return null;
  return (
    <MarkdownPreview value={previewMarkdown}>
      <MentionList value={mentionList}>
        <PrView header={header.value} data={data} reload={reload} settings={settings} source={source} section={route.section} comment={route.comment} file={route.file} />
      </MentionList>
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
  comment,
  file,
}: {
  header: PrStages['header'];
  data: PrPageData;
  reload: (stages: readonly PrStage[]) => Promise<void>;
  settings: Settings;
  source: DataSource;
  section: Extract<AppRoute, { page: 'pr' }>['section'];
  comment: Extract<AppRoute, { page: 'pr' }>['comment'];
  file: Extract<AppRoute, { page: 'pr' }>['file'];
}) {
  const [edits, setEdits] = useState((): PendingEdits => ({ viewed: {}, resolved: {}, isDraft: null, autoMerge: null, reactions: {} }));
  const pr = useMemo(() => optimisticPr(prDetailFrom(header, data), edits), [header, data, edits]);
  const files = useFileReview(pr);
  const checkReruns = useCheckReruns(pr, source, () => reload(STAGES_A_WRITE_CHANGES['pr.rerunFailedJobs']));
  /** A section's retry: its stages again. */
  const retry = (stages: PrStage[]) => void reload(stages).catch(() => {});
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
  // The method the stack's merge dialog opened with; null while it is closed.
  const [mergingStack, setMergingStack] = useState<MergeMethod | null>(null);
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
  // The sidebar's next step, as its action card finds it: while it is to merge the stack and the viewer may, the top bar's
  // "Merge N PRs" and m open the dialog that does.
  const nextAction = nextActionFor(pr, (['mergeBox', 'stack', 'threads', 'checks'] as const).filter((stage) => data[stage].value === null || data[stage].status === 'placeholder'));
  const stackMerge = nextAction.kind === 'ready-as-stack' && pr.viewerCanMerge ? nextAction.prs : null;
  // The merges CarbonLayer runs in the background in this repository, under way or stopped; the sidebar shows the one that
  // merges this PR where the merge controls are.
  const backgroundMerges = useBackgroundMerges(source, pr, reload);
  const backgroundMerge = backgroundMerges.find((merge) => merge.prs.some(({ number }) => number === pr.number)) ?? null;
  // CarbonLayer's own "Merge when ready", armed where GitHub refused its stack auto-merge: it marks the rows of the open PRs
  // it will merge, as GitHub's merge box marks those its stack auto-merge covers.
  const mergingWhenReady = backgroundMerge?.whenReady && isUnderWay(backgroundMerge) ? backgroundMerge : null;
  const stack = useMemo(
    () =>
      mergingWhenReady
        ? {
            ...pr.stack,
            entries: pr.stack.entries.map((entry) =>
              entry.state === 'OPEN' && mergingWhenReady.prs.some(({ number }) => number === entry.number) ? { ...entry, willMergeWhenReady: true } : entry,
            ),
          }
        : pr.stack,
    [pr.stack, mergingWhenReady],
  );
  useLinkedComment(comment, pr, data, files.revealThread);
  const linkedFile = useLinkedFile(file, pr.files);

  useEffect(() => {
    const files = document.getElementById('pr-files');
    // A link to a comment opens the page at that comment instead.
    if (section !== 'files' || comment || !files) return;
    // A link to a file opens the page at the file, once the file list has it.
    const target = (linkedFile && document.getElementById(`gg-file:${linkedFile}`)) || files;
    // The page may be too short to bring the files to the top until the diffs have rendered, so keep them
    // pinned there while the page grows, until the reader takes over or it has settled.
    const pin = () => target.scrollIntoView({ block: 'start' });
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
  }, [section, comment, linkedFile]);

  useEffect(() => {
    try {
      localStorage.setItem('gg:pr-legend-hidden', legendHidden ? '1' : '0');
    } catch {
      // Storage can be unavailable (blocked site data); the legend then simply shows again next time.
    }
  }, [legendHidden]);

  /**
   * Runs a change against GitHub, then reloads the stages it changed (STAGES_A_WRITE_CHANGES). A failure is reported and
   * its optimistic edit undone.
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
    // The next file, which now shows right below the viewed one's header, is the one v marks next.
    if (viewed) files.moveOnFrom(path);
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

  function closePullRequest() {
    return mutate(
      STAGES_A_WRITE_CHANGES['pr.close'],
      async () => {
        const { branch } = await source.close(pr.id);
        // Closed: what became of its branch says the rest.
        if (branch.kind === 'deleted') showToast(`Closed #${pr.number} and deleted ${pr.headRefName}`);
        else if (branch.kind === 'based-on') {
          const based = branch.numbers.map((number) => `#${number}`).join(', ');
          showToast(`Closed #${pr.number}; kept ${pr.headRefName}, which ${based} ${branch.numbers.length === 1 ? 'is' : 'are'} based on`);
        } else if (branch.kind === 'failed') showToast(`Closed #${pr.number}, but could not delete ${pr.headRefName}: ${branch.reason}`, 'danger');
        else showToast(`Closed #${pr.number}`);
      },
      'Could not close the pull request',
    );
  }

  function merge(method: MergeMethod) {
    return mutate(STAGES_A_WRITE_CHANGES['pr.merge'], () => source.merge(pr.id, method, pr.headOid), 'Could not merge', { success: `Merged #${pr.number}` });
  }

  /**
   * Starts merging the stack up to this PR in the background, once it can (src/lib/stack-merges.ts): the page shows how
   * it goes, and says when it has merged.
   */
  async function mergeStack(method: MergeMethod, commit: MergeCommit | undefined, options: Pick<StackMergeRequest, 'ignoreOptionalChecks' | 'rebaseFirst'>): Promise<boolean> {
    const merging = stackToMerge(pr.stack);
    if (!merging) return false;
    try {
      await source.startStackMerge({
        repo: pr.repo,
        number: pr.number,
        prs: merging.map(({ number, title }) => ({ number, title })),
        trunk: pr.stack.trunk,
        method,
        ...(commit && { commit }),
        expectedHeadOid: pr.headOid,
        ...options,
        whenReady: false,
      });
    } catch (reason) {
      showToast(`Could not start the merge: ${reason instanceof Error ? reason.message : String(reason)}`, 'danger');
      return false;
    }
    showToast(`Merging ${merging.length} PRs. CarbonLayer carries on if this tab closes.`);
    return true;
  }

  /**
   * "Merge when ready" turned on or off, or its method changed: GitHub's auto-merge, as GitHub's merge box sets it. For a
   * PR of a GitHub-native stack whose repository GitHub refuses its stack auto-merge, CarbonLayer merges the stack when it
   * is ready instead (mergeStackWhenReady); turning that off cancels it, with nothing on GitHub to undo, and another
   * method merges the same PRs with it.
   */
  async function setMergeWhenReady(enabled: boolean, method: MergeMethod): Promise<boolean> {
    if (mergingWhenReady) {
      const { repo, number, prs, trunk, expectedHeadOid, ignoreOptionalChecks, rebaseFirst } = mergingWhenReady;
      try {
        if (enabled) await source.startStackMerge({ repo, number, prs, trunk, method, expectedHeadOid, ignoreOptionalChecks, rebaseFirst, whenReady: true });
        else await source.dropStackMerge(mergingWhenReady.id);
        return true;
      } catch (reason) {
        showToast(`Could not change Merge when ready: ${reason instanceof Error ? reason.message : String(reason)}`, 'danger');
        return false;
      }
    }
    // Another method for an auto-merge already on: turned off, then on again with it.
    const switching = enabled && pr.autoMerge !== null && pr.autoMerge.method !== method;
    setEdits((current) => ({ ...current, autoMerge: enabled ? method : false }));
    return mutate(
      STAGES_A_WRITE_CHANGES['pr.setAutoMerge'],
      async () => {
        if (switching) await source.setAutoMerge(pr.id, false, method);
        if (!enabled || pr.stack.source !== 'native') return source.setAutoMerge(pr.id, enabled, method);
        // The open PRs from the bottom of the stack through this one, which GitHub's stack auto-merge would cover.
        const merging = pr.stack.entries.slice(0, pr.stack.currentIndex + 1).filter((entry) => entry.state === 'OPEN');
        const by = await mergeStackWhenReady(
          pr.id,
          { repo: pr.repo, number: pr.number, prs: merging.map(({ number, title }) => ({ number, title })), trunk: pr.stack.trunk, method, expectedHeadOid: pr.headOid },
          source,
        );
        // CarbonLayer's own shows from the merge the background keeps, not as GitHub's auto-merge.
        if (by === 'carbonlayer') setEdits((current) => ({ ...current, autoMerge: null }));
      },
      'Could not change Merge when ready',
      { undo: () => setEdits((current) => ({ ...current, autoMerge: null })) },
    );
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
      case 'merge':
        return stackMerge && setMergingStack((open) => open ?? mergeMethod);
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
        if (mergingStack) return setMergingStack(null);
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
    onClosePullRequest: closePullRequest,
    onCopied: () => showToast('Link copied'),
  };

  return (
    <PrReactions value={{ changed: edits.reactions, react }}>
      <div className={`pr-page ${legendHidden ? '' : 'has-legend'} ${commentsOpen ? 'has-comments-drawer' : ''}`}>
        <div className="pr-conversation">
          <PrHeader
            pr={pr}
            actions={
              <PrActions
                {...actions}
                reviewPopover={headerActionsInView ? reviewPopover : null}
                menuOpen={menuOpen && headerActionsInView}
                mergeStack={stackMerge && { count: stackMerge.length, onOpen: () => setMergingStack(mergeMethod) }}
              />
            }
          />
          {/* No stack card, not even its skeleton, when the page shows no stack. */}
          {(header.stackSource !== 'none' || pr.stack.source !== 'none') && (
            <Staged state={data.stack} what="the stack" onRetry={() => retry(['stack'])} skeleton={<StackSkeleton />}>
              {() =>
                pr.stack.source !== 'none' && (
                  <StackCard
                    stack={stack}
                    collapsed={stackCollapsed}
                    onToggle={() => setStackCollapsed((collapsed) => !collapsed)}
                    source={source}
                    mergeMethod={settings.mergeMethod}
                  />
                )
              }
            </Staged>
          )}
          <section className="pr-description" id="pr-description" aria-label="Description">
            {pr.descriptionUrl && <CopyLink url={pr.descriptionUrl} subject="description" />}
            {/* The inbox's row has no description; the page's own header brings it. */}
            {data.header.status === 'placeholder' ? (
              <Skeleton width="100%" height={110} />
            ) : pr.bodyHtml.trim() ? (
              <Markdown html={pr.bodyHtml} />
            ) : (
              <p className="pr-muted pr-description-empty">No description provided.</p>
            )}
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
          onAutoMerge={setMergeWhenReady}
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
          onMerge={merge}
          onMergeStack={setMergingStack}
          backgroundMerge={backgroundMerge}
          onDropBackgroundMerge={async (id) => {
            try {
              await source.dropStackMerge(id);
              return true;
            } catch (reason) {
              showToast(`Could not stop the merge: ${reason instanceof Error ? reason.message : String(reason)}`, 'danger');
              return false;
            }
          }}
          onRebaseStack={async () => {
            let complete = false;
            const rebased = await mutate(
              STAGES_A_WRITE_CHANGES['pr.rebaseStack'],
              async () => {
                ({ complete } = await source.rebaseStack(pr.id));
              },
              'Could not rebase the stack',
            );
            // GitHub's own words for the rebase, done or still going (it carries on after the answer is due).
            if (rebased) showToast(complete ? 'Rebasing complete' : 'Rebasing stack…');
            return rebased;
          }}
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
          labelsCard={
            <LabelsCard
              pr={pr}
              listLabels={() => source.labelCandidates(pr.id)}
              onModify={(add, remove) =>
                mutate(STAGES_A_WRITE_CHANGES['pr.modifyLabels'], () => source.modifyLabels(pr.id, add, remove), 'Could not change the labels', { success: 'Labels updated' })
              }
            />
          }
          assigneesCard={
            <AssigneesCard
              pr={pr}
              viewerLogin={header.viewerLogin}
              listAssignees={() => source.assigneeCandidates(pr.id)}
              onModify={(add, remove) =>
                mutate(STAGES_A_WRITE_CHANGES['pr.modifyAssignees'], () => source.modifyAssignees(pr.id, add, remove), 'Could not change the assignees', { success: 'Assignees updated' })
              }
            />
          }
        />
        <FilesSection
          source={source}
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
        {mergingStack && stackMerge && (
          <MergeStackDialog
            pr={pr}
            prs={stackMerge}
            method={mergingStack}
            underWay={backgroundMerges.some((merge) => isUnderWay(merge) && merge.prs.some(({ number }) => stackMerge.some((entry) => entry.number === number)))}
            proposeCommit={(method) => source.proposedMergeCommit(pr.id, method)}
            onStart={mergeStack}
            onClose={() => setMergingStack(null)}
          />
        )}
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
          {/* The repository's page on GitHub, in this tab as GitHub's own link to it opens. */}
          <a
            className="pr-header-repo"
            href={`https://github.com/${pr.repo.owner}/${pr.repo.name}`}
            onClick={(event) => {
              // A click with ⌘, Ctrl, Shift or Alt, or another button, is the browser's: a new tab or window, or a download.
              if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
              event.preventDefault();
              followLink(event.currentTarget.href);
            }}
          >
            {pr.repo.owner}/{pr.repo.name}
          </a>{' '}
          <span className="pr-header-number">#{pr.number}</span>
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
 * The PR's actions: the comments drawer's button, Finish review, the header's "Merge N PRs" while the stack can merge, and
 * More actions. In the header, and again under the reviewers while the header's are scrolled out of sight, where the
 * sidebar's own next step offers the merge; the review popover and the menu open beside the ones in view.
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
  onClosePullRequest,
  onCopied,
  inSidebar = false,
  mergeStack = null,
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
  onClosePullRequest: () => Promise<boolean>;
  onCopied: () => void;
  inSidebar?: boolean;
  /** The header's "Merge N PRs", while the sidebar's next step is to merge the stack and the viewer may; it opens its dialog. */
  mergeStack?: { count: number; onOpen: () => void } | null;
}) {
  const menu = useRef<HTMLDivElement | null>(null);

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
      {mergeStack && (
        <Button variant="primary" className="pr-merge-button" title="Merge the stack (m)" onClick={mergeStack.onOpen}>
          Merge {mergeStack.count} PRs
        </Button>
      )}
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
            {/* As GitHub's "Close pull request": closed at once, without merging; last, apart from the rest. */}
            {pr.state === 'OPEN' && pr.viewerCanUpdate && (
              <>
                <div role="separator" className="pr-menu-separator" />
                <button
                  role="menuitem"
                  onClick={() => {
                    onMenuOpenChange(false);
                    void onClosePullRequest();
                  }}
                >
                  <Icon name="git-pull-request-closed" size={14} />
                  Close pull request
                </button>
              </>
            )}
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
  const anchor = useRef<HTMLDivElement | null>(null);
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

/**
 * Opens the page at the comment a GitHub link to the PR names (`route.comment`) and marks it, like GitHub's own page:
 * the description, a comment or review in the activity, or a comment in a diff thread, once the stage that has it has
 * arrived. A link to a comment the page does not show (hidden, or gone) leaves the page as it is.
 */
function useLinkedComment(anchor: string | undefined, pr: PrDetail, data: PrPageData, revealThread: (threadId: string, readerMoved?: () => boolean) => void) {
  // Where the linked comment shows, for the anchor that names it. Each link is looked up once, so a later reload of the
  // stage leaves the reader be; a route that names no comment forgets it, so that naming it again looks it up again.
  const [linked, setLinked] = useState<{ anchor: string; find: () => Element | null | undefined; block: ScrollLogicalPosition } | null>(null);
  const lookedUp = useRef<string | null>(null);
  // As a browser does with a link's anchor, the link gives up once the reader has scrolled, typed or clicked.
  const readerMoved = useRef(false);

  useEffect(() => {
    if (!anchor) return;
    readerMoved.current = false;
    const moved = () => (readerMoved.current = true);
    const events = ['wheel', 'keydown', 'pointerdown'] as const;
    for (const type of events) window.addEventListener(type, moved, { passive: true });
    return () => {
      for (const type of events) window.removeEventListener(type, moved);
    };
  }, [anchor]);

  useEffect(() => {
    if (!anchor) lookedUp.current = null;
    if (!anchor || lookedUp.current === anchor) return;
    const isLinked = (url: string | null | undefined) => url?.endsWith(`#${anchor}`) ?? false;
    // A comment's timestamp links to its permalink (Comment.tsx), so the permalink finds it on the page.
    const commentIn = (scope: string, url: string) =>
      [...document.querySelectorAll(`${scope} a.pr-comment-time`)].find((link) => link.getAttribute('href') === url)?.closest('.pr-comment');
    if (anchor.startsWith('issue-')) {
      lookedUp.current = anchor;
      if (isLinked(pr.descriptionUrl)) setLinked({ anchor, find: () => document.getElementById('pr-description'), block: 'start' });
    } else if (anchor.startsWith('discussion_r')) {
      if (data.threads.status === 'loading') return;
      lookedUp.current = anchor;
      const thread = pr.threads.find((candidate) => candidate.comments.some((comment) => isLinked(comment.url)));
      const url = thread?.comments.map((comment) => comment.url).find(isLinked);
      // A reader who scrolled, typed or clicked while the threads loaded keeps their place, as with any other link.
      if (!thread || !url || readerMoved.current) return;
      // In the diff's thread, not its copy in the comments drawer.
      const find = () => commentIn(`[data-thread-id="${CSS.escape(thread.id)}"]`, url);
      // Its file expanded and the thread opened, resolved or not; its diff may still be on its way. A comment the reader
      // already sees stays where it is.
      revealThread(thread.id, () => readerMoved.current || readerSees(find()));
      setLinked({ anchor, find, block: 'center' });
    } else {
      if (data.activity.status === 'loading') return;
      lookedUp.current = anchor;
      const url = pr.timeline.map((entry) => (entry.kind === 'comment' || entry.kind === 'review' ? entry.url : null)).find(isLinked);
      if (url) setLinked({ anchor, find: () => commentIn('.timeline', url)?.closest('.timeline-card'), block: 'start' });
    }
  }, [anchor, pr, data.threads.status, data.activity.status, revealThread]);

  // As GitHub's `:target`, the mark follows the route: it stays while the route names the comment, and a route that names
  // another, or none, takes it off.
  const shown = linked?.anchor === anchor ? linked : null;
  // Once it has a box, into view unless the reader already sees it whole, and marked; it is looked for ten seconds at most.
  useEffect(() => {
    if (!shown) return;
    let marked: Element | null = null;
    let frame = 0;
    const started = performance.now();
    const land = () => {
      if (readerMoved.current) return;
      const element = shown.find();
      if (element && element.getClientRects().length > 0) {
        if (!readerSees(element)) element.scrollIntoView({ block: shown.block });
        element.classList.add('is-linked');
        marked = element;
      } else if (performance.now() - started < 10_000) {
        frame = requestAnimationFrame(land);
      }
    };
    frame = requestAnimationFrame(land);
    return () => {
      cancelAnimationFrame(frame);
      marked?.classList.remove('is-linked');
    };
  }, [shown]);
}

/**
 * The changed file a GitHub link to the PR's files names (`route.file`, `fileAnchor`), once the file list has it: its
 * path; null before that, for a file the PR does not change, and when the reader scrolled, typed or clicked before it was
 * found.
 */
function useLinkedFile(anchor: string | undefined, files: ChangedFile[]): string | null {
  const [linked, setLinked] = useState<{ anchor: string; path: string } | null>(null);
  // As a browser does with a link's anchor, the link gives up once the reader has scrolled, typed or clicked.
  const readerMoved = useRef(false);

  useEffect(() => {
    if (!anchor) return;
    readerMoved.current = false;
    const moved = () => (readerMoved.current = true);
    const events = ['wheel', 'keydown', 'pointerdown'] as const;
    for (const type of events) window.addEventListener(type, moved, { passive: true });
    return () => {
      for (const type of events) window.removeEventListener(type, moved);
    };
  }, [anchor]);

  useEffect(() => {
    if (!anchor) return;
    let current = true;
    // The anchor is a hash of the path, so each file's is worked out to find the one it names.
    void Promise.all(files.map(async (file) => ((await fileAnchor(file.path)) === anchor ? file.path : null))).then((paths) => {
      const path = paths.find((candidate) => candidate !== null);
      if (current && path && !readerMoved.current) setLinked({ anchor, path });
    });
    return () => {
      current = false;
    };
  }, [anchor, files]);

  return linked && linked.anchor === anchor ? linked.path : null;
}

/**
 * The stack merges CarbonLayer runs in the background in the PR's repository (src/lib/stack-merges.ts), under way or
 * stopped. Once the one that merges this PR has rebased the stack, the page loads again what that changed; once it has
 * merged it, what the merge changed, and a toast says so.
 */
function useBackgroundMerges(source: DataSource, pr: PrDetail, reload: (stages: readonly PrStage[]) => Promise<void>): StackMerge[] {
  const [merges, setMerges] = useState<StackMerge[]>([]);
  const latestReload = useRef(reload);
  latestReload.current = reload;
  const { owner, name } = pr.repo;
  const { number } = pr;
  useEffect(() => {
    // What the page showed before each change, to tell what the change did; undefined before the first.
    let shown: StackMerge | null | undefined;
    return source.watchStackMerges((all) => {
      const inRepository = all.filter((candidate) => candidate.repo.owner === owner && candidate.repo.name === name);
      const before = shown;
      const next = inRepository.find((candidate) => candidate.prs.some((entry) => entry.number === number)) ?? null;
      shown = next;
      setMerges(inRepository);
      if (!before || !next || before.id !== next.id || before.step.kind === next.step.kind) return;
      if (next.step.kind === 'merged') {
        showToast(`Merged ${next.prs.length} PRs`);
        latestReload.current(STAGES_A_WRITE_CHANGES['pr.merge']).catch((reason: unknown) =>
          showToast(`Merged, but reloading the PR failed: ${reason instanceof Error ? reason.message : String(reason)}`, 'danger'),
        );
      } else if (before.step.kind === 'rebasing' && next.step.kind !== 'stopped') {
        latestReload.current(STAGES_A_WRITE_CHANGES['pr.rebaseStack']).catch(() => {});
      }
    });
  }, [source, owner, name, number]);
  return merges;
}

/**
 * Whether the reader already sees all of an element: inside the viewport, and neither its top nor its bottom under what
 * sticks to the top of the page (the files' toolbar, a diff's file header) or floats over it (the shortcut legend).
 */
function readerSees(element: Element | null | undefined): boolean {
  if (!element) return false;
  const box = element.getBoundingClientRect();
  if (box.height === 0 || box.top < 0 || box.bottom > innerHeight) return false;
  // Just inside its top and bottom edges, clear of a rounded corner.
  const x = box.left + Math.min(box.width / 2, 16);
  return [box.top + 2, box.bottom - 2].every((y) => {
    const onTop = document.elementFromPoint(x, y);
    return onTop !== null && element.contains(onTop);
  });
}
