// The Files section: a sticky toolbar, the file tree, and every changed file's diff in one continuous
// scroll. Review threads, comments batched for the pending review and the inline composer render as
// line annotations inside the diffs. `useFileReview` holds the reviewer's position in the files (current
// file and thread, collapsed files, the open composer) so page-level keybindings can drive it.
import { FileDiff, type FileDiffOptions } from '@pierre/diffs/react';
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { ReviewThreadDraft } from '../app/data-source';
import type { ChangedFile, PrDetail } from '../lib/model';
import { Button } from '../ui/Button';
import { fileNotes, filesInTreeOrder, fileTree, renderableDiff, type ComposerAnchor, type DiffNote, type FileTreeNode } from './diff';
import { Icon } from './primitives';
import { DiffNoteView, type NoteActions } from './Threads';
import './files.css';

export function FilesSection({
  pr,
  review,
  batch,
  diffStyle,
  onDiffStyleChange,
  onToggleViewed,
  noteActions,
}: {
  pr: PrDetail;
  review: FileReview;
  batch: ReviewThreadDraft[];
  diffStyle: 'unified' | 'split';
  onDiffStyleChange: (style: 'unified' | 'split') => void;
  onToggleViewed: (path: string) => void;
  noteActions: NoteActions;
}) {
  const themeType = useDocumentTheme();
  const viewedCount = pr.files.filter((file) => file.viewerViewedState === 'VIEWED').length;
  const allCollapsed = review.order.every((file) => review.isCollapsed(file));

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
          {pr.files.length} {pr.files.length === 1 ? 'file' : 'files'} changed
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
      <div className={`files-body ${review.treeOpen ? 'has-tree' : ''}`}>
        {review.treeOpen && <FileTree pr={pr} review={review} />}
        <div className="files-diffs">
          {review.order.map((file) => (
            <FileCard
              key={file.path}
              file={file}
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

export interface FileReview {
  tree: FileTreeNode[];
  /** Files in tree order, which is also the order the diffs render in. */
  order: ChangedFile[];
  currentPath: string | null;
  currentThreadId: string | null;
  treeOpen: boolean;
  composer: ComposerAnchor | null;
  isCollapsed(file: ChangedFile): boolean;
  setCollapsed(path: string, collapsed: boolean): void;
  setAllCollapsed(collapsed: boolean): void;
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
  // Scrolling updates the current file, except right after j/k moved it (the page may not be able to
  // scroll the last files to the top, which would otherwise hand "current" back to an earlier file).
  const navigatedAt = useRef(0);

  useEffect(() => {
    let frame = 0;
    const onScroll = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (performance.now() - navigatedAt.current < 600) return;
        let above: string | null = null;
        for (const file of order) {
          const element = document.getElementById(`gg-file:${file.path}`);
          if (!element || element.getBoundingClientRect().top > STICKY_TOP + 12) break;
          above = file.path;
        }
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
      // The thread only has a box once its file is expanded and its line rendered (highlighting is async).
      let frames = 0;
      const tryScroll = () => {
        const element = document.querySelector(`[data-thread-id="${CSS.escape(threadId)}"]`);
        if (element && element.getClientRects().length > 0) {
          navigatedAt.current = performance.now();
          element.scrollIntoView({ block: 'center' });
        } else if (frames++ < 120) {
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
    setCollapsed: useCallback((path: string, value: boolean) => setCollapsedState((current) => ({ ...current, [path]: value })), []),
    setAllCollapsed: (value) => setCollapsedState(Object.fromEntries(order.map((file) => [file.path, value]))),
    goToFile,
    stepFile: (delta) => {
      const index = order.findIndex((file) => file.path === currentPath);
      const next = order[index === -1 ? (delta === 1 ? 0 : order.length - 1) : Math.min(order.length - 1, Math.max(0, index + delta))];
      if (next) goToFile(next.path);
    },
    revealThread,
    stepThread: (delta) => {
      const position = (path: string) => order.findIndex((file) => file.path === path);
      const unresolved = pr.threads
        .filter((thread) => !thread.isResolved)
        .sort((a, b) => position(a.path) - position(b.path) || (a.line ?? 0) - (b.line ?? 0));
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
  file,
  pr,
  batch,
  review,
  diffStyle,
  themeType,
  onToggleViewed,
  noteActions,
}: {
  file: ChangedFile;
  pr: PrDetail;
  batch: ReviewThreadDraft[];
  review: FileReview;
  diffStyle: 'unified' | 'split';
  themeType: 'light' | 'dark' | 'system';
  onToggleViewed: (path: string) => void;
  noteActions: NoteActions;
}) {
  // Keyed on the patch, not the object: a refetch returns new objects, and a new diff identity re-renders it.
  const fileDiff = useMemo(() => renderableDiff(file), [file.path, file.previousPath, file.status, file.patch]);
  const composer = review.composer?.path === file.path ? review.composer : null;
  const notes = useMemo(() => fileNotes(file.path, pr.threads, batch, composer), [file.path, pr.threads, batch, composer]);
  // The commented line stays highlighted while the composer is open, and only then.
  const selectedLines = useMemo(() => (composer ? { start: composer.line, end: composer.line, side: composer.side } : null), [composer]);
  const collapsed = review.isCollapsed(file);
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
      theme: { light: 'github-light', dark: 'github-dark' },
      themeType,
      stickyHeader: true,
      diffIndicators: 'bars',
      hunkSeparators: 'line-info',
      lineDiffType: 'word-alt',
      collapsed,
      enableGutterUtility: true,
      onGutterUtilityClick: (range) =>
        openComposer.current({ path: file.path, line: range.end, side: range.endSide ?? range.side ?? 'additions' }),
      // Sticky file headers stop under the Files toolbar instead of at the very top.
      unsafeCSS: `[data-sticky] { top: ${STICKY_TOP}px; }`,
    }),
    [diffStyle, themeType, collapsed, file.path],
  );

  const viewedToggle = (
    <label className={`file-viewed ${viewed ? 'is-checked' : ''}`} title="Mark as viewed (v)">
      <input type="checkbox" checked={viewed} onChange={() => onToggleViewed(file.path)} />
      Viewed
    </label>
  );

  if (!fileDiff) {
    return (
      <div className={`file-card is-stub ${current ? 'is-current' : ''}`} id={`gg-file:${file.path}`}>
        <div className="file-stub-header">
          <span className={`file-status is-${file.status}`}>{STATUS_LETTERS[file.status]}</span>
          <span className="file-stub-name">{file.path}</span>
          <span className="files-toolbar-spacer" />
          {viewedToggle}
        </div>
        <div className="file-stub-body">
          Binary or too large to display ·{' '}
          <a href={file.blobUrl} target="_blank" rel="noopener">
            open on GitHub
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className={`file-card ${current ? 'is-current' : ''}`} id={`gg-file:${file.path}`}>
      <FileDiff<DiffNote>
        fileDiff={fileDiff}
        options={options}
        lineAnnotations={notes}
        selectedLines={selectedLines}
        renderAnnotation={(annotation) => (
          <DiffNoteView
            note={annotation.metadata}
            anchor={composer}
            current={annotation.metadata.kind === 'thread' && annotation.metadata.thread.id === review.currentThreadId}
            actions={noteActions}
          />
        )}
        renderHeaderPrefix={() => (
          <button
            className="file-collapse"
            onClick={() => setCollapsed(file.path, !collapsed)}
            aria-expanded={!collapsed}
            title={collapsed ? 'Expand file (e)' : 'Collapse file (e)'}
          >
            <Icon name={collapsed ? 'chevron-right' : 'chevron-down'} size={14} />
          </button>
        )}
        renderHeaderMetadata={() => (
          <div className="file-header-meta">
            {threadCount > 0 && (
              <span className="file-comments" title={`${threadCount} review ${threadCount === 1 ? 'thread' : 'threads'}`}>
                <Icon name="comment" size={14} />
                {threadCount}
              </span>
            )}
            {viewedToggle}
          </div>
        )}
      />
    </div>
  );
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

/** Height of the sticky Files toolbar; file headers and the tree stick below it. Mirrors files.css. */
const STICKY_TOP = 40;

/** Git's one-letter status codes. */
const STATUS_LETTERS: Record<ChangedFile['status'], string> = {
  added: 'A',
  removed: 'D',
  modified: 'M',
  renamed: 'R',
  copied: 'C',
  changed: 'M',
  unchanged: '·',
};
