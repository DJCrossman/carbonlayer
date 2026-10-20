// The Files section: a sticky toolbar, the file tree, and every changed file's diff in one continuous
// scroll. Review threads, comments batched for the pending review and the inline composer render as
// line annotations inside the diffs. `useFileReview` holds the reviewer's position in the files (current
// file and thread, collapsed files, the open composer) so page-level keybindings can drive it.
// Until the file list arrives the section shows the header's file count over skeleton cards; then each file
// shows a skeleton until its diff arrives, and a file whose lines GitHub held back (generated, too big) until they load,
// once the reader comes near it.
import { Virtualizer } from '@pierre/diffs';
import { FileDiff, VirtualizerContext, type FileDiffOptions, type SelectedLineRange } from '@pierre/diffs/react';
import { useQueries, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type MouseEvent } from 'react';
import type { DataSource, ReviewThreadDraft } from '../app/data-source';
import { fileAnchor } from '../app/routes';
import type { ChangedFile, PrDetail, PrStages, ReviewThread } from '../lib/model';
import { Button } from '../ui/Button';
import { Icon } from '../ui/Icon';
import { Skeleton } from '../ui/Skeleton';
import { showToast } from '../ui/Toast';
import { composerAnchorFor, currentLinesOf, fileNotes, filesInTreeOrder, fileTree, hiddenLines, renderableDiff, takesComments, type ComposerAnchor, type DiffNote, type FileTreeNode } from './diff';
import { prFileContentsQuery, prHeldBackDiffQuery, type StageState } from './page-data';
import { StageError } from './primitives';
import { DiffNoteView, type NoteActions } from './Threads';
import './files.css';

export function FilesSection({
  source,
  pr,
  listed,
  threads,
  onRetry,
  review,
  batch,
  diffStyle,
  onDiffStyleChange,
  onToggleViewed,
  noteActions,
}: {
  /** Where the lines a diff leaves out are asked for, when the reader expands them. */
  source: DataSource;
  pr: PrDetail;
  /** The file list and the diffs that have arrived so far. */
  listed: StageState<PrStages['files']>;
  threads: StageState<PrStages['threads']>;
  onRetry: (stage: 'files' | 'threads') => void;
  review: FileReview;
  batch: ReviewThreadDraft[];
  diffStyle: 'unified' | 'split';
  onDiffStyleChange: (style: 'unified' | 'split') => void;
  onToggleViewed: (path: string) => void;
  noteActions: NoteActions;
}) {
  const themeType = useDocumentTheme();
  // A long diff draws only the lines near the viewport, which @pierre/diffs' Virtualizer follows on this page's own scroll.
  const [virtualizer] = useState(() => new Virtualizer());
  useEffect(() => {
    virtualizer.setup(document);
    return () => virtualizer.cleanUp();
  }, [virtualizer]);
  const viewedCount = pr.files.filter((file) => file.viewerViewedState === 'VIEWED').length;
  const allCollapsed = review.order.every((file) => review.isCollapsed(file));
  // Before the list arrives, the header's count; a failed batch of diffs leaves its files without one.
  const fileCount = listed.value ? pr.files.length : pr.changedFiles;
  const diffs = listed.value?.diffs;
  const missingDiff = listed.status === 'error' ? 'failed' : 'loading';

  return (
    <section className="pr-files" id="pr-files" aria-label="Files changed">
      <div className="files-toolbar">
        <Button
          variant="ghost"
          size="sm"
          className={`files-tree-toggle ${review.treeOpen ? 'is-active' : ''}`}
          onClick={review.toggleTree}
          title="Toggle file tree (f)"
          aria-pressed={review.treeOpen}
        >
          <Icon name="sidebar" size={14} />
        </Button>
        <strong>
          {fileCount} {fileCount === 1 ? 'file' : 'files'} changed
        </strong>
        <span className="files-progress" title={`${viewedCount} of ${pr.files.length} files viewed`}>
          <span className="files-progress-bar">
            <span style={{ width: `${pr.files.length ? (viewedCount / pr.files.length) * 100 : 0}%` }} />
          </span>
          {viewedCount}/{pr.files.length} viewed
        </span>
        <span className="files-toolbar-spacer" />
        <div className="files-segmented" role="group" aria-label="Diff layout">
          {(['unified', 'split'] as const).map((style) => (
            <button key={style} className={diffStyle === style ? 'is-active' : ''} aria-pressed={diffStyle === style} onClick={() => onDiffStyleChange(style)}>
              {style === 'unified' ? 'Unified' : 'Split'}
            </button>
          ))}
        </div>
        <Button size="sm" onClick={() => review.setAllCollapsed(!allCollapsed)}>
          {allCollapsed ? 'Expand all' : 'Collapse all'}
        </Button>
      </div>
      {listed.status === 'error' && (
        <StageError what={listed.value ? 'some of the diffs' : 'the changed files'} error={listed.error} onRetry={() => onRetry('files')} />
      )}
      {threads.status === 'error' && <StageError what="the review threads" error={threads.error} onRetry={() => onRetry('threads')} />}
      <div className={`files-body ${review.treeOpen ? 'has-tree' : ''}`}>
        {review.treeOpen && <FileTree pr={pr} review={review} />}
        <div className="files-diffs">
          {!listed.value && listed.status === 'loading' && <FilesSkeleton count={Math.min(Math.max(pr.changedFiles, 1), 6)} />}
          {review.order.map((file) => (
            <FileCard
              key={file.path}
              source={source}
              virtualizer={virtualizer}
              file={file}
              missingDiff={diffs && !(file.path in diffs) ? missingDiff : null}
              pr={pr}
              batch={batch}
              review={review}
              diffStyle={diffStyle}
              themeType={themeType}
              onToggleViewed={onToggleViewed}
              noteActions={noteActions}
            />
          ))}
        </div>
      </div>
    </section>
  );
}

interface FileReview {
  tree: FileTreeNode[];
  /** Files in tree order, which is also the order the diffs render in. */
  order: ChangedFile[];
  currentPath: string | null;
  currentThreadId: string | null;
  treeOpen: boolean;
  composer: ComposerAnchor | null;
  isCollapsed(file: ChangedFile): boolean;
  /** Collapses or expands a file, its header kept where the reader sees it (`keepHeaderInPlace`). */
  setCollapsed(path: string, collapsed: boolean): void;
  /** Collapses or expands every file, the header of the file the page has scrolled to kept where the reader sees it. */
  setAllCollapsed(collapsed: boolean): void;
  /** The reader is done with a file (marked it viewed): when it is the current file, the next one becomes current. */
  moveOnFrom(path: string): void;
  goToFile(path: string): void;
  stepFile(delta: 1 | -1): void;
  revealThread(threadId: string): void;
  stepThread(delta: 1 | -1): void;
  toggleTree(): void;
  openComposer(anchor: ComposerAnchor): void;
  closeComposer(): void;
}

/** The reviewer's position in the files. Viewed files start collapsed; anything explicit wins. */
export function useFileReview(pr: PrDetail): FileReview {
  const tree = useMemo(() => fileTree(pr.files), [pr.files]);
  const order = useMemo(() => filesInTreeOrder(tree), [tree]);
  const [currentPath, setCurrentPath] = useState<string | null>(null);
  const [currentThreadId, setCurrentThreadId] = useState<string | null>(null);
  const [collapsed, setCollapsedState] = useState<Record<string, boolean>>({});
  const [treeOpen, setTreeOpen] = useState(true);
  const [composer, setComposer] = useState<ComposerAnchor | null>(null);
  // Scrolling updates the current file, except right after j/k or v moved it (the page may not be able to
  // scroll the last files to the top, which would otherwise hand "current" back to an earlier file), and except back to a
  // file marked viewed and moved on from, its header still at the top, until the reader scrolls into another one.
  const navigatedAt = useRef(0);
  const movedOnFrom = useRef<string | null>(null);
  // A file collapsed or expanded keeps its header where the reader saw it (keepHeaderInPlace), put back as the change is
  // drawn: the diffs' own layout effects have drawn it by then, and the page is not yet painted.
  const keepHeader = useRef<(() => void) | null>(null);
  useLayoutEffect(() => {
    keepHeader.current?.();
    keepHeader.current = null;
  }, [collapsed]);

  useEffect(() => {
    let frame = 0;
    const onScroll = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (performance.now() - navigatedAt.current < 600) return;
        const above = fileScrolledTo(order);
        if (above === movedOnFrom.current) return;
        movedOnFrom.current = null;
        if (above) setCurrentPath(above);
      });
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('scroll', onScroll);
    };
  }, [order]);

  const goToFile = useCallback((path: string) => {
    navigatedAt.current = performance.now();
    movedOnFrom.current = null;
    setCurrentPath(path);
    document.getElementById(`gg-file:${path}`)?.scrollIntoView({ block: 'start' });
  }, []);

  const revealThread = useCallback(
    (threadId: string) => {
      const thread = pr.threads.find((candidate) => candidate.id === threadId);
      if (!thread) return;
      navigatedAt.current = performance.now();
      setCollapsedState((current) => ({ ...current, [thread.path]: false }));
      setCurrentPath(thread.path);
      setCurrentThreadId(threadId);
      // The thread only has a box once its file is expanded and its line rendered (highlighting is async); a long diff
      // draws only the lines near the viewport, so the page moves toward the line meanwhile.
      let frames = 0;
      const tryScroll = () => {
        const element = document.querySelector(`[data-thread-id="${CSS.escape(threadId)}"]`);
        if (element && element.getClientRects().length > 0) {
          navigatedAt.current = performance.now();
          element.scrollIntoView({ block: 'center' });
        } else if (frames++ < 120) {
          navigatedAt.current = performance.now();
          scrollTowardLine(thread);
          requestAnimationFrame(tryScroll);
        }
      };
      requestAnimationFrame(tryScroll);
    },
    [pr.threads],
  );

  return {
    tree,
    order,
    currentPath,
    currentThreadId,
    treeOpen,
    composer,
    isCollapsed: (file) => collapsed[file.path] ?? file.viewerViewedState === 'VIEWED',
    setCollapsed: useCallback((path: string, value: boolean) => {
      keepHeader.current = keepHeaderInPlace(path, value);
      setCollapsedState((current) => ({ ...current, [path]: value }));
    }, []),
    setAllCollapsed: (value) => {
      // The files above the one the reader is in collapse or expand too: that one keeps its header where they see it.
      const reading = fileScrolledTo(order);
      keepHeader.current = reading === null ? null : keepHeaderInPlace(reading, value);
      setCollapsedState(Object.fromEntries(order.map((file) => [file.path, value])));
    },
    moveOnFrom: (path) => {
      if (path !== currentPath) return;
      // The page scrolling to keep the file's header in place is not the reader scrolling.
      navigatedAt.current = performance.now();
      movedOnFrom.current = path;
      const next = order[order.findIndex((file) => file.path === path) + 1];
      if (next) setCurrentPath(next.path);
    },
    goToFile,
    stepFile: (delta) => {
      const index = order.findIndex((file) => file.path === currentPath);
      const next = order[index === -1 ? (delta === 1 ? 0 : order.length - 1) : Math.min(order.length - 1, Math.max(0, index + delta))];
      if (next) goToFile(next.path);
    },
    revealThread,
    stepThread: (delta) => {
      const unresolved = pr.threads
        .filter((thread) => !thread.isResolved)
        .sort(
          (a, b) =>
            order.findIndex((file) => file.path === a.path) - order.findIndex((file) => file.path === b.path) ||
            (a.line ?? 0) - (b.line ?? 0),
        );
      if (unresolved.length === 0) return;
      const index = unresolved.findIndex((thread) => thread.id === currentThreadId);
      const next = index === -1 ? (delta === 1 ? unresolved[0] : unresolved.at(-1)) : unresolved[(index + delta + unresolved.length) % unresolved.length];
      if (next) revealThread(next.id);
    },
    toggleTree: useCallback(() => setTreeOpen((open) => !open), []),
    openComposer: useCallback((anchor: ComposerAnchor) => setComposer(anchor), []),
    closeComposer: useCallback(() => setComposer(null), []),
  };
}

function FileTree({ pr, review }: { pr: PrDetail; review: FileReview }) {
  const [closedDirs, setClosedDirs] = useState<ReadonlySet<string>>(new Set());
  const threadCounts = new Map<string, number>();
  for (const thread of pr.threads) if (!thread.isResolved) threadCounts.set(thread.path, (threadCounts.get(thread.path) ?? 0) + 1);

  const renderNodes = (nodes: FileTreeNode[], depth: number) =>
    nodes.map((node) => {
      const indent = { paddingLeft: 8 + depth * 12 };
      if (node.kind === 'dir') {
        const open = !closedDirs.has(node.path);
        return (
          <li key={`d:${node.path}`}>
            <button
              className="file-tree-row is-dir"
              style={indent}
              aria-expanded={open}
              onClick={() =>
                setClosedDirs((current) => {
                  const next = new Set(current);
                  if (open) next.add(node.path);
                  else next.delete(node.path);
                  return next;
                })
              }
            >
              <Icon name={open ? 'chevron-down' : 'chevron-right'} size={12} />
              <Icon name="file-directory" size={14} className="pr-fg-muted" />
              <span className="file-tree-name">{node.name}</span>
            </button>
            {open && <ul>{renderNodes(node.children, depth + 1)}</ul>}
          </li>
        );
      }
      const { file } = node;
      const unresolved = threadCounts.get(file.path) ?? 0;
      return (
        <li key={`f:${file.path}`}>
          <button
            className={`file-tree-row ${review.currentPath === file.path ? 'is-current' : ''}`}
            style={indent}
            onClick={() => review.goToFile(file.path)}
            title={file.previousPath ? `${file.previousPath} → ${file.path}` : file.path}
          >
            <span className={`file-status is-${file.status}`}>{STATUS_LETTERS[file.status]}</span>
            <span className="file-tree-name">{node.name}</span>
            {unresolved > 0 && (
              <span className="file-tree-threads" title={`${unresolved} unresolved`}>
                <Icon name="comment" size={12} />
                {unresolved}
              </span>
            )}
            <span className="file-tree-stat">
              {file.additions > 0 && <span className="pr-fg-success">+{file.additions}</span>}
              {file.deletions > 0 && <span className="pr-fg-danger">−{file.deletions}</span>}
            </span>
            <span className={`file-tree-viewed ${file.viewerViewedState === 'VIEWED' ? 'is-viewed' : ''}`} aria-label={file.viewerViewedState === 'VIEWED' ? 'Viewed' : undefined}>
              <Icon name="check" size={12} />
            </span>
          </button>
        </li>
      );
    });

  return (
    <nav className="file-tree" aria-label="Changed files">
      <ul>{renderNodes(review.tree, 0)}</ul>
    </nav>
  );
}

function FileCard({
  source,
  virtualizer,
  file,
  missingDiff,
  pr,
  batch,
  review,
  diffStyle,
  themeType,
  onToggleViewed,
  noteActions,
}: {
  source: DataSource;
  /** What draws a long diff's lines only near the viewport. */
  virtualizer: Virtualizer;
  file: ChangedFile;
  /** Why the file has no diff yet: it is on its way, or its batch failed. */
  missingDiff: 'loading' | 'failed' | null;
  pr: PrDetail;
  batch: ReviewThreadDraft[];
  review: FileReview;
  diffStyle: 'unified' | 'split';
  themeType: 'light' | 'dark' | 'system';
  onToggleViewed: (path: string) => void;
  noteActions: NoteActions;
}) {
  const collapsed = review.isCollapsed(file);
  const queryClient = useQueryClient();
  const { owner, name } = pr.repo;
  const { number, headOid, baseRefName } = pr;
  // GitHub's own page shows neither a deleted file's lines nor a moved one's, until its "Load diff" for the first.
  const removed = file.status === 'removed';
  const movedOnly = file.status === 'renamed' && file.additions === 0 && file.deletions === 0;
  const [deletedShown, setDeletedShown] = useState(false);
  // The lines GitHub held back (a generated file, one too big, a deleted one) load by themselves once the card comes within
  // a screen of the viewport, a deleted file's once asked for, and a collapsed file's only once it is expanded.
  const card = useRef<HTMLDivElement | null>(null);
  const heldBack = file.withheld === 'held-back' && file.patch === null && !movedOnly;
  const [near, setNear] = useState(false);
  useEffect(() => {
    const element = card.current;
    if (!heldBack || removed || near || !element) return;
    // `root: document` is this page's own scrolling viewport (in the extension, the iframe's), where the margin applies.
    const observer = new IntersectionObserver((entries) => entries.some((entry) => entry.isIntersecting) && setNear(true), { root: document, rootMargin: '100% 0px' });
    observer.observe(element);
    return () => observer.disconnect();
  }, [heldBack, removed, near]);
  // Only a file whose lines GitHub held back has a query for them; until its own header arrives, a PR opened from the inbox
  // or a stack names no head commit to ask them of.
  const heldBackQueries = heldBack
    ? [{ ...prHeldBackDiffQuery(source, { owner, name }, number, { headOid, baseRefName }, file.path), enabled: !collapsed && headOid !== '' && (removed ? deletedShown : near) }]
    : [];
  const [heldBackDiff] = useQueries({ queries: heldBackQueries });
  const patch = file.patch ?? heldBackDiff?.data ?? null;
  // Keyed on the patch, not the object: a refetch returns new objects, and a new diff identity re-renders it.
  const fileDiff = useMemo(() => renderableDiff({ ...file, patch }), [file.path, file.previousPath, file.status, patch]);
  const composer = review.composer?.path === file.path ? review.composer : null;
  // The diff keys each note by its place in the list, so a note keeps the place it was first shown in and new ones go
  // after it: a thread that arrives with a refresh leaves an open composer or reply, and what is typed in it, as it was.
  const shownNotes = useRef<Array<string | ReviewThreadDraft>>([]);
  const notes = useMemo(() => {
    // A thread is known by its id, a pending comment by its draft, the composer as itself.
    const found = fileNotes(file.path, pr.threads, batch, composer).map((note) => {
      const { metadata } = note;
      return { note, id: metadata.kind === 'thread' ? metadata.thread.id : metadata.kind === 'pending' ? metadata.draft : metadata.kind };
    });
    const ids = found.map(({ id }) => id);
    shownNotes.current = [...shownNotes.current.filter((id) => ids.includes(id)), ...ids.filter((id) => !shownNotes.current.includes(id))];
    return found.toSorted((a, b) => shownNotes.current.indexOf(a.id) - shownNotes.current.indexOf(b.id)).map(({ note }) => note);
  }, [file.path, pr.threads, batch, composer]);
  // GitHub offers "Add a suggestion" on the new file's lines only.
  const suggestion =
    composer && patch !== null && composer.side === 'additions' && (composer.startSide ?? 'additions') === 'additions'
      ? currentLinesOf(patch, composer.startLine ?? composer.line, composer.line)
      : null;
  // Lines being selected, until the pointer is released and the composer opens for them.
  const [selecting, setSelecting] = useState<SelectedLineRange | null>(null);
  // The commented lines stay highlighted while the composer is open, and only then; a selection shows as it grows.
  const selectedLines = useMemo(
    () =>
      selecting ??
      (composer ? { start: composer.startLine ?? composer.line, side: composer.startSide ?? composer.side, end: composer.line, endSide: composer.side } : null),
    [selecting, composer],
  );
  const viewed = file.viewerViewedState === 'VIEWED';
  const threadCount = pr.threads.filter((thread) => thread.path === file.path).length;
  const current = review.currentPath === file.path;
  const openComposer = useRef(review.openComposer);
  openComposer.current = review.openComposer;
  const setCollapsed = review.setCollapsed;

  // Stable identity unless a value the library renders from changes: it re-renders on every new options object.
  const options = useMemo(
    (): FileDiffOptions<DiffNote, undefined> => ({
      diffStyle,
      overflow: 'wrap',
      theme: { light: 'github-light', dark: 'github-dark-default' },
      themeType,
      stickyHeader: true,
      diffIndicators: 'bars',
      hunkSeparators: 'line-info',
      lineDiffType: 'word-alt',
      collapsed,
      enableGutterUtility: true,
      // A line number pressed and dragged across others, or clicked and then shift-clicked, selects those lines, as
      // does the "+" pressed and dragged; the composer opens for them when the pointer is released.
      // Only lines of the diff take a comment: a selection that reaches an unchanged line expanded around them shows none.
      enableLineSelection: true,
      onLineSelectionStart: (range) => setSelecting(range && fileDiff && takesComments(fileDiff, range) ? range : null),
      onLineSelectionChange: (range) => setSelecting(range && fileDiff && takesComments(fileDiff, range) ? range : null),
      onLineSelectionEnd: (range) => {
        setSelecting(null);
        // Null when the one line already selected was clicked again: the composer stays, with whatever it holds.
        if (range && fileDiff && takesComments(fileDiff, range)) openComposer.current(composerAnchorFor(file.path, fileDiff, range));
      },
      // The "+" selects only while this is set; its selection ends above like any other.
      onGutterUtilityClick: () => undefined,
      // The unchanged lines the diff leaves out show 20 at a time, as GitHub's "Expand up" and "Expand down" do, and 20 or
      // fewer all at once. The library shows them once it has the whole file, which the first expand asks GitHub for (every
      // hidden line in one request, kept with the diff), and keeps them shown, the file collapsed and opened again or not.
      expansionLineCount: 20,
      loadDiffFiles: async (partial) => {
        try {
          // Until its own header arrives, a PR opened from the inbox or a stack names no head commit.
          if (!headOid) throw new Error('the pull request is still loading');
          const contents = await queryClient.fetchQuery(prFileContentsQuery(source, { owner, name }, number, { headOid, baseRefName }, file.path, hiddenLines(partial)));
          return { oldFile: { name: partial.prevName ?? partial.name, contents: contents.old }, newFile: { name: partial.name, contents: contents.new } };
        } catch (reason) {
          showToast(`Could not load the unchanged lines: ${reason instanceof Error ? reason.message : String(reason)}`, 'danger');
          throw reason;
        }
      },
      // Sticky file headers stop under the Files toolbar instead of at the very top. The path copies itself when clicked
      // (onClick below), so it shows it on hover, as Graphite's does, without moving. An expanded unchanged line has no "+".
      unsafeCSS: `[data-sticky] { top: ${STICKY_TOP}px; } [data-title] { margin: -2px -4px; padding: 2px 4px; border-radius: 4px; cursor: pointer; } [data-title]:hover { background: var(--gg-bg-hover); } [data-line-type='context-expanded'] [data-gutter-utility-slot] { display: none; }`,
    }),
    [diffStyle, themeType, collapsed, file.path, fileDiff, queryClient, source, owner, name, number, headOid, baseRefName],
  );

  const viewedToggle = (
    <label className={`file-viewed ${viewed ? 'is-checked' : ''}`} title="Mark as viewed (v)">
      <input type="checkbox" checked={viewed} onChange={() => onToggleViewed(file.path)} />
      Viewed
    </label>
  );

  // The path, the library's in a diff's header (in its shadow root) or a stub's own, copies itself when clicked, as
  // Graphite's does.
  const onClick = (event: MouseEvent<HTMLDivElement>) => {
    if (event.nativeEvent.composedPath().some((target) => target instanceof Element && target.matches('[data-title], .file-stub-name'))) copyFileName(file.path);
  };

  const collapseToggle = (
    <button className="file-collapse" onClick={() => setCollapsed(file.path, !collapsed)} aria-expanded={!collapsed} title={collapsed ? 'Expand file (e)' : 'Collapse file (e)'}>
      <Icon name={collapsed ? 'chevron-right' : 'chevron-down'} size={14} />
    </button>
  );
  const generatedTag = file.generated && <span className="file-generated">Generated</span>;

  if (missingDiff) {
    return (
      <div className={`file-card is-stub ${current ? 'is-current' : ''}`} id={`gg-file:${file.path}`} ref={card} aria-busy={missingDiff === 'loading'} onClick={onClick}>
        <div className="file-stub-header">
          <span className={`file-status is-${file.status}`}>{STATUS_LETTERS[file.status]}</span>
          <span className="file-stub-name">{file.path}</span>
          <span className="files-toolbar-spacer" />
          {viewedToggle}
          <FileMenu path={file.path} prUrl={pr.url} />
        </div>
        {/* A collapsed file (one already viewed) shows its header alone, as it will once its diff is in. */}
        {collapsed ? null : missingDiff === 'failed' ? (
          <div className="file-stub-body">The diff did not load; retry above.</div>
        ) : (
          <div className="file-diff-skeleton" aria-hidden="true">
            {['40%', '65%', '55%', '30%'].map((width, index) => (
              <Skeleton key={index} width={width} height={10} />
            ))}
          </div>
        )}
      </div>
    );
  }

  // A file whose lines do not show (yet): its header as the diff's would be, and in place of the lines why there are none.
  if (!fileDiff || movedOnly || (removed && !deletedShown)) {
    const body = collapsed
      ? null
      : movedOnly
        ? 'moved'
        : file.withheld === 'binary'
          ? 'binary'
          : removed && !deletedShown
            ? 'deleted'
            : heldBackDiff?.isError
              ? 'failed'
              : heldBackDiff && heldBackDiff.data === undefined
                ? 'loading'
                : 'empty';
    return (
      <div
        className={`file-card is-stub ${current ? 'is-current' : ''}`}
        id={`gg-file:${file.path}`}
        ref={card}
        aria-busy={heldBackDiff?.isFetching}
        onClick={onClick}
        // Lines on their way hold the room they will take (a line's height each, at least), so that the files below are
        // where they will be, and a held-back file below is near only once the reader is.
        style={body === 'loading' ? { minHeight: (file.additions + file.deletions) * DIFF_LINE_HEIGHT } : undefined}
      >
        <div className="file-stub-header">
          {collapseToggle}
          <span className={`file-status is-${file.status}`}>{STATUS_LETTERS[file.status]}</span>
          {file.previousPath && <span className="file-stub-prev-name">{file.previousPath} →</span>}
          <span className="file-stub-name">{file.path}</span>
          {generatedTag}
          <span className="files-toolbar-spacer" />
          {/* As the diff's header counts them: removed lines when there are any or nothing was added, and the other way round. */}
          <span className="file-stub-counts">
            {(file.deletions > 0 || file.additions === 0) && <span className="pr-fg-danger">-{file.deletions}</span>}
            {(file.additions > 0 || file.deletions === 0) && <span className="pr-fg-success">+{file.additions}</span>}
          </span>
          {viewedToggle}
          <FileMenu path={file.path} prUrl={pr.url} />
        </div>
        {body === 'moved' && <div className="file-stub-body">File renamed without changes.</div>}
        {body === 'binary' && <div className="file-stub-body">Binary file not shown</div>}
        {body === 'deleted' && (
          <div className="file-stub-body">
            This file was deleted.{' '}
            <button className="file-stub-load" onClick={() => setDeletedShown(true)}>
              Load diff
            </button>
          </div>
        )}
        {body === 'failed' && heldBackDiff && <StageError what="this file's diff" error={heldBackDiff.error?.message ?? ''} onRetry={() => void heldBackDiff.refetch()} />}
        {body === 'loading' && (
          <div className="file-diff-skeleton" aria-hidden="true">
            {['40%', '65%', '55%', '30%'].map((width, index) => (
              <Skeleton key={index} width={width} height={10} />
            ))}
          </div>
        )}
        {body === 'empty' && <div className="file-stub-body">No lines changed</div>}
      </div>
    );
  }

  // A long diff draws only the lines near the viewport (the library's own virtualization), a shorter one all of its lines,
  // by its hunks' rows in the unified layout, whichever layout shows, so that a switch keeps it as it is (lines expanded
  // around the hunks count none). The library settles which when the diff mounts; a new patch that crosses the line mounts
  // it again, in the other.
  const virtualized = fileDiff.hunks.reduce((rows, hunk) => rows + hunk.unifiedLineCount, 0) > VIRTUALIZED_FROM_ROWS;
  const diff = (
    <FileDiff<DiffNote>
      fileDiff={fileDiff}
      options={options}
      lineAnnotations={notes}
      selectedLines={selectedLines}
      renderAnnotation={(annotation) => (
        <DiffNoteView
          note={annotation.metadata}
          anchor={composer}
          suggestion={suggestion}
          current={annotation.metadata.kind === 'thread' && annotation.metadata.thread.id === review.currentThreadId}
          actions={noteActions}
        />
      )}
      renderHeaderPrefix={() => collapseToggle}
      renderHeaderFilenameSuffix={file.generated ? () => generatedTag : undefined}
      renderHeaderMetadata={() => (
        <div className="file-header-meta">
          {threadCount > 0 && (
            <span className="file-comments" title={`${threadCount} review ${threadCount === 1 ? 'thread' : 'threads'}`}>
              <Icon name="comment" size={14} />
              {threadCount}
            </span>
          )}
          {viewedToggle}
          <FileMenu path={file.path} prUrl={pr.url} />
        </div>
      )}
    />
  );

  return (
    <div
      className={`file-card ${current ? 'is-current' : ''}`}
      id={`gg-file:${file.path}`}
      ref={card}
      onClick={onClick}
      data-virtualized={virtualized || undefined}
      // The diff draws its lines only once they are highlighted: until then the card holds the room its hunks' rows will take
      // (a line's height each, at least; the unchanged lines between hunks show only once expanded), so that the files below
      // are where they will be, and a held-back file below is near only once the reader is.
      style={collapsed ? undefined : { minHeight: fileDiff.hunks.reduce((rows, hunk) => rows + (diffStyle === 'split' ? hunk.splitLineCount : hunk.unifiedLineCount), 0) * DIFF_LINE_HEIGHT }}
    >
      {virtualized ? <VirtualizerContext value={virtualizer}>{diff}</VirtualizerContext> : diff}
    </div>
  );
}

/** Puts a file's path on the clipboard, as a click on Graphite's path or its "Copy file name" does, and says so. */
function copyFileName(path: string) {
  void navigator.clipboard.writeText(path).then(
    () => showToast('Copied file name'),
    (reason: unknown) => showToast(`Could not copy file name: ${reason instanceof Error ? reason.message : String(reason)}`, 'danger'),
  );
}

/**
 * The ⋯ at the end of a file's header, with the items of Graphite's that copy: the file's path, and the link to it in
 * the PR's files on GitHub, the one GitHub's own files view gives it (`fileAnchor`), which opens this page at the file.
 */
function FileMenu({ path, prUrl }: { path: string; prUrl: string }) {
  const [open, setOpen] = useState(false);
  const menu = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!(event.target instanceof Node) || !menu.current?.contains(event.target)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => event.key === 'Escape' && setOpen(false);
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  return (
    <div className="pr-menu" ref={menu}>
      <Button
        variant="ghost"
        size="sm"
        icon="kebab-horizontal"
        aria-label="More file actions"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      />
      {open && (
        <div className="pr-menu-list" role="menu">
          <button
            role="menuitem"
            onClick={() => {
              setOpen(false);
              copyFileName(path);
            }}
          >
            <Icon name="file-diff" size={14} />
            Copy file name
          </button>
          <button
            role="menuitem"
            onClick={() => {
              setOpen(false);
              void fileAnchor(path)
                .then((anchor) => navigator.clipboard.writeText(`${prUrl}/files#${anchor}`))
                .then(
                  () => showToast('Copied link to file'),
                  (reason: unknown) => showToast(`Could not copy link to file: ${reason instanceof Error ? reason.message : String(reason)}`, 'danger'),
                );
            }}
          >
            <Icon name="link" size={14} />
            Copy link
          </button>
        </div>
      )}
    </div>
  );
}

/** Cards the shape of a file's while the list of changed files is on its way. */
function FilesSkeleton({ count }: { count: number }) {
  return Array.from({ length: count }, (_, index) => (
    <div key={index} className="file-card is-stub" aria-busy="true" aria-label={index === 0 ? 'Loading the changed files' : undefined}>
      <div className="file-stub-header">
        <Skeleton width={16} height={16} />
        <Skeleton width={`${30 + ((index * 17) % 30)}%`} height={12} />
      </div>
      <div className="file-diff-skeleton" aria-hidden="true">
        <Skeleton width="45%" height={10} />
        <Skeleton width="60%" height={10} />
      </div>
    </div>
  ));
}

/**
 * Moves the page toward a thread's line in a long diff, which draws only the lines near the viewport
 * (`data-virtualized`): to the file while it draws none, then by the line numbers it has drawn on the thread's side, a
 * line's height for each line between. The page stays where it is once the line is among those drawn, and for any other diff.
 */
function scrollTowardLine(thread: ReviewThread) {
  const fileCard = document.getElementById(`gg-file:${thread.path}`);
  if (!(fileCard instanceof HTMLElement) || fileCard.dataset.virtualized === undefined) return;
  const side = thread.side === 'LEFT' ? 'deletions' : 'additions';
  // The unified layout numbers an added or unchanged line by its new number, a removed one by its old.
  const drawn = [...(fileCard.querySelector('diffs-container')?.shadowRoot?.querySelectorAll(`[data-unified] [data-gutter] [data-column-number], [data-${side}] [data-gutter] [data-column-number]`) ?? [])]
    .filter((cell) => cell.getAttribute('data-line-type') !== (side === 'additions' ? 'change-deletion' : 'change-addition'))
    .map((cell) => ({ line: Number(cell.getAttribute('data-column-number')), top: cell.getBoundingClientRect().top }));
  const first = drawn[0];
  const last = drawn.at(-1);
  // An outdated thread sits above the file's first line.
  const line = thread.line ?? 0;
  if (!first || !last) fileCard.scrollIntoView({ block: 'start' });
  else if (line < first.line) window.scrollBy({ top: first.top - (first.line - line) * DIFF_LINE_HEIGHT - innerHeight / 2, behavior: 'instant' });
  else if (line > last.line) window.scrollBy({ top: last.top + (line - last.line) * DIFF_LINE_HEIGHT - innerHeight / 2, behavior: 'instant' });
}

/** The app's theme (set on <html> by the parent page or the harness), for the diff highlighter. */
function useDocumentTheme(): 'light' | 'dark' | 'system' {
  const theme = useSyncExternalStore(subscribeToThemeChanges, () => document.documentElement.dataset.theme);
  return theme === 'light' || theme === 'dark' ? theme : 'system';
}

function subscribeToThemeChanges(onChange: () => void): () => void {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  return () => observer.disconnect();
}

/**
 * The file the page has scrolled to, the one the reader is in: the last whose card has reached the toolbar (j/k bring a
 * card's top 10 px under it). Null above the files.
 */
function fileScrolledTo(order: ChangedFile[]): string | null {
  let above: string | null = null;
  for (const file of order) {
    const element = document.getElementById(`gg-file:${file.path}`);
    if (!element || element.getBoundingClientRect().top > STICKY_TOP + 12) break;
    above = file.path;
  }
  return above;
}

/**
 * Measures where a file's header shows before the file collapses or expands, and returns what puts it back there once the
 * change is drawn, as GitHub's and Graphite's pages do. A collapsing file's header stays where the reader sees it: stuck
 * under the toolbar while they were inside the file (its top above the header's place), where it lands with the next file
 * right below it instead of both above the viewport; else where it was. An expanding file's header stays where it is.
 * Nothing for a file out of sight: the browser's scroll anchoring keeps what the reader sees where it is.
 */
function keepHeaderInPlace(path: string, collapse: boolean): (() => void) | null {
  const card = document.getElementById(`gg-file:${path}`);
  const before = card?.getBoundingClientRect();
  if (!card || !before || before.bottom <= STICKY_TOP || before.top >= innerHeight) return null;
  // A diff's header sticks at STICKY_TOP inside the card's border, so a card collapsed to its header shows it there with
  // its top a border higher.
  const top = collapse ? Math.max(before.top, STICKY_TOP - card.clientTop) : before.top;
  return () => {
    const after = document.getElementById(`gg-file:${path}`)?.getBoundingClientRect().top;
    // Instant whatever the page's scroll-behavior, so that the header does not travel there; near the end of the page the
    // browser stops it at the furthest the page scrolls.
    if (after !== undefined && after !== top) window.scrollBy({ top: after - top, behavior: 'instant' });
  };
}

/** Height of the sticky Files toolbar; file headers and the tree stick below it. Mirrors files.css. */
const STICKY_TOP = 40;

/** Height of a line of a diff. Mirrors files.css (`--diffs-line-height`). */
const DIFF_LINE_HEIGHT = 20;

/**
 * The rows past which a diff draws only those near the viewport. The library draws 150 to 200 rows around it (the
 * viewport and 1,000 px either side, in blocks of 50), so a diff not much longer gains little, and loses the browser's
 * find for the lines not drawn; drawing a whole diff freezes the page about a quarter of a millisecond a row, at every
 * draw (its first, a switch of layout or theme): a quarter of a second for 1,000 rows (measured on 4,002: over a second).
 */
const VIRTUALIZED_FROM_ROWS = 1_000;

/** Git's one-letter status codes. */
const STATUS_LETTERS: Record<ChangedFile['status'], string> = {
  added: 'A',
  removed: 'D',
  modified: 'M',
  renamed: 'R',
  copied: 'C',
  changed: 'M',
};
