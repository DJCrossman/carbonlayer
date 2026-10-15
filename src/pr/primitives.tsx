// PR-page pieces the shared primitives in src/ui/ do not cover: the Open / Draft / Merged / Closed state
// pill, the comment box, and a part of the page fed by one stage of its data.
import { skipToken, useQuery } from '@tanstack/react-query';
import { createContext, Fragment, useContext, useEffect, useId, useLayoutEffect, useRef, useState, type ClipboardEvent, type KeyboardEvent, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import type { Emoji, PrSummary } from '../lib/model';
import { Button } from '../ui/Button';
import { Icon, type IconName } from '../ui/Icon';
import { StatusPill } from '../ui/StatusPill';
import { Markdown } from './Comment';
import {
  continueList,
  emojiQueryAt,
  emojiSuggestionsFor,
  insertEmoji,
  insertHeading,
  insertLink,
  insertSuggestion,
  linkPastedUrl,
  toggleBold,
  toggleCode,
  toggleItalic,
  toggleNumberedList,
  toggleQuote,
  toggleTaskList,
  toggleUnorderedList,
  type Draft,
} from './markdown-editing';
import type { StageState } from './page-data';
import './primitives.css';

/** Open / Draft / Merged / Closed. */
export function StatePill({ pr }: { pr: Pick<PrSummary, 'state' | 'isDraft'> }) {
  if (pr.state === 'MERGED') return <StatusPill tone="done" icon="git-merge">Merged</StatusPill>;
  if (pr.state === 'CLOSED') return <StatusPill tone="danger" icon="git-pull-request-closed">Closed</StatusPill>;
  if (pr.isDraft) return <StatusPill tone="neutral" icon="git-pull-request-draft">Draft</StatusPill>;
  return <StatusPill tone="success" icon="git-pull-request">Open</StatusPill>;
}

/**
 * The comment box every composer on the page uses, like GitHub's: Write and Preview tabs, GitHub's formatting toolbar and
 * the shortcuts GitHub documents for comments, lists that carry on with Enter, a URL pasted over text linking it, and
 * GitHub's emoji suggested after a `:` (markdown-editing.ts says what each does to the text). ⌘↵ / Ctrl+↵ submits, Esc
 * cancels, and it grows with its content. While the emoji list shows, ↑ / ↓ move through it, Enter or Tab (or a click)
 * puts the one reached in, and Esc closes only the list.
 */
export function CommentInput({
  value,
  onChange,
  onSubmit,
  onCancel,
  placeholder,
  autoFocus,
  disabled,
  minRows = 2,
  suggestion,
}: {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  onCancel?: () => void;
  placeholder: string;
  autoFocus?: boolean;
  disabled?: boolean;
  minRows?: number;
  /** The commented lines' current text: adds GitHub's "Add a suggestion", which puts them in a suggestion block. */
  suggestion?: () => string;
}) {
  const ref = useRef<HTMLTextAreaElement | null>(null);
  const previewTab = useRef<HTMLButtonElement | null>(null);
  const preview = useContext(MarkdownPreview);
  // While Preview shows: the height Write had, which the preview keeps so the box does not jump.
  const [previewing, setPreviewing] = useState<{ height: number } | null>(null);
  // ⌘⇧V / Ctrl+Shift+V pastes a URL as it is, over a selection too.
  const pasteAsIs = useRef(false);
  // Where a command's selection goes once React shows its text, when the browser could not type the text in itself.
  const selectionAfter = useRef<Draft | null>(null);
  // What a `:` before the caret asks for (emojiQueryAt), read from the text it was typed in, and which suggestion ↑ / ↓
  // reached; null once Esc closed the list or the text lost focus. GitHub's emoji are asked for the first time a box
  // asks for one, then kept by the page's cache: they rarely change.
  const [emojiAsk, setEmojiAsk] = useState<{ value: string; at: number; query: string; active: number } | null>(null);
  const asked = emojiAsk && emojiAsk.value === value && !previewing && !disabled ? emojiAsk : null;
  const loadEmojis = useContext(EmojiList);
  const emojis = useQuery({ queryKey: ['emojis'], queryFn: asked && loadEmojis ? loadEmojis : skipToken, staleTime: Infinity });
  const suggestions = asked && emojis.data ? emojiSuggestionsFor(asked.query, emojis.data) : [];
  const emojiListShown = suggestions.length > 0 || (asked !== null && emojis.isLoading);
  const emojiListId = useId();
  const isMac = navigator.userAgent.includes('Mac');
  const tools: Array<[Tool, ...Tool[]]> = suggestion
    ? [[{ label: 'Add a suggestion', icon: 'file-diff', keys: 'G', stroke: 'g', command: (draft) => insertSuggestion(draft, suggestion()) }], ...TOOLBAR]
    : TOOLBAR;

  // `autoFocus` alone is not enough inside a diff: the annotation is mounted before the library slots it
  // into a rendered line, and an unrendered element cannot take focus. Retry for a few frames.
  useEffect(() => {
    if (!autoFocus) return;
    let frames = 0;
    let frame = requestAnimationFrame(function focus() {
      ref.current?.focus();
      if (document.activeElement !== ref.current && frames++ < 30) frame = requestAnimationFrame(focus);
    });
    return () => cancelAnimationFrame(frame);
  }, [autoFocus]);

  // A comment sent from Preview clears the text; the next one starts on Write.
  useEffect(() => {
    if (value === '') setPreviewing(null);
  }, [value]);

  useLayoutEffect(() => {
    const textarea = ref.current;
    const after = selectionAfter.current;
    if (!textarea || !after || textarea.value !== after.value) return;
    textarea.setSelectionRange(after.selectionStart, after.selectionEnd);
    selectionAfter.current = null;
  });

  /**
   * Carries out a command on the text; false when it had nothing to do. Only the stretch it changes is typed in, by the
   * browser, so ⌘Z undoes it as it would typing.
   */
  const carryOut = (command: (draft: Draft) => Draft | null): boolean => {
    const textarea = ref.current;
    const after = textarea && !disabled ? command(textarea) : null;
    if (!textarea || !after) return false;
    const before = textarea.value;
    let from = 0;
    while (from < before.length && from < after.value.length && before[from] === after.value[from]) from++;
    let to = before.length;
    let end = after.value.length;
    while (to > from && end > from && before[to - 1] === after.value[end - 1]) {
      to--;
      end--;
    }
    textarea.focus();
    textarea.setSelectionRange(from, to);
    if (before === after.value || document.execCommand(end > from ? 'insertText' : 'delete', false, after.value.slice(from, end))) {
      textarea.setSelectionRange(after.selectionStart, after.selectionEnd);
    } else {
      selectionAfter.current = after;
      onChange(after.value);
    }
    return true;
  };

  const showPreview = (show: boolean) => {
    if (show === !!previewing) return;
    if (!show) {
      setPreviewing(null);
      requestAnimationFrame(() => ref.current?.focus());
      return;
    }
    // Keyboard focus moves from the text, about to hide, to the Preview tab, where ⌘⇧P still reaches the box.
    if (document.activeElement === ref.current) previewTab.current?.focus();
    setPreviewing({ height: ref.current?.offsetHeight ?? 0 });
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    pasteAsIs.current = false;
    // While the emoji list shows, it has its keys first: Esc, and ↑ / ↓, Enter and Tab pressed alone (with Shift, ⌘, Ctrl
    // or ⌥ held, as in GitHub's list, they do what they always do).
    if (asked && emojiListShown && event.target === ref.current && !event.nativeEvent.isComposing) {
      const plain = !event.shiftKey && !event.metaKey && !event.ctrlKey && !event.altKey;
      const reached = suggestions[asked.active];
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        setEmojiAsk(null);
        return;
      }
      if (plain && (event.key === 'ArrowDown' || event.key === 'ArrowUp') && suggestions.length > 0) {
        event.preventDefault();
        setEmojiAsk({ ...asked, active: (asked.active + (event.key === 'ArrowDown' ? 1 : -1) + suggestions.length) % suggestions.length });
        return;
      }
      if (plain && (event.key === 'Enter' || event.key === 'Tab') && reached) {
        event.preventDefault();
        carryOut((draft) => insertEmoji(draft, reached));
        return;
      }
    }
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      if (value.trim() && !disabled) onSubmit();
      return;
    }
    if (event.key === 'Escape' && onCancel) {
      event.preventDefault();
      onCancel();
      return;
    }
    if ((isMac ? event.metaKey : event.ctrlKey) && !event.altKey) {
      // Letters by the character they type; digits and punctuation by their key, whose character shift changes.
      const stroke = `${event.shiftKey ? 'shift+' : ''}${/^[a-z]$/i.test(event.key) ? event.key.toLowerCase() : event.code}`;
      const tool = previewing ? undefined : tools.flat().find((candidate) => candidate.stroke === stroke);
      if (stroke === 'shift+p') {
        event.preventDefault();
        showPreview(!previewing);
      } else if (stroke === 'shift+v') {
        pasteAsIs.current = true;
      } else if (tool) {
        event.preventDefault();
        carryOut(tool.command);
      }
      return;
    }
    if (event.key === 'Enter' && !event.shiftKey && !event.altKey && !event.nativeEvent.isComposing && event.target === ref.current && carryOut(continueList)) {
      event.preventDefault();
    }
  };

  const onPaste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    const pasted = event.clipboardData.getData('text/plain');
    if (!pasteAsIs.current && carryOut((draft) => linkPastedUrl(draft, pasted))) event.preventDefault();
  };

  return (
    <div className={`pr-comment-box ${disabled ? 'is-disabled' : ''}`} onKeyDown={onKeyDown}>
      <div className="pr-comment-box-header">
        <div className="pr-comment-box-tabs" role="tablist" aria-label="Comment">
          <button type="button" role="tab" aria-selected={!previewing} className="pr-comment-box-tab" disabled={disabled} onClick={() => showPreview(false)}>
            Write
          </button>
          <button
            ref={previewTab}
            type="button"
            role="tab"
            aria-selected={!!previewing}
            className="pr-comment-box-tab"
            disabled={disabled}
            title={`Preview (${isMac ? '⌘⇧P' : 'Ctrl+Shift+P'})`}
            onClick={() => showPreview(true)}
          >
            Preview
          </button>
        </div>
        {!previewing && (
          <div className="pr-comment-box-toolbar" role="toolbar" aria-label="Formatting">
            {tools.map((group, index) => (
              <Fragment key={group[0].label}>
                {index > 0 && <span className="pr-comment-box-divider" />}
                {group.map((tool) => (
                  <button
                    key={tool.label}
                    type="button"
                    className="pr-comment-box-tool"
                    aria-label={tool.label}
                    title={tool.keys ? `${tool.label} (${isMac ? `⌘${tool.keys.replace('Shift+', '⇧')}` : `Ctrl+${tool.keys}`})` : tool.label}
                    disabled={disabled}
                    // The text keeps its focus and selection, which the command acts on.
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => carryOut(tool.command)}
                  >
                    <Icon name={tool.icon} />
                  </button>
                ))}
              </Fragment>
            ))}
          </div>
        )}
      </div>
      <textarea
        ref={ref}
        className="pr-comment-box-input"
        hidden={!!previewing}
        value={value}
        placeholder={placeholder}
        rows={Math.max(minRows, Math.min(12, value.split('\n').length))}
        disabled={disabled}
        aria-autocomplete="list"
        aria-controls={suggestions.length > 0 ? emojiListId : undefined}
        aria-activedescendant={asked && suggestions.length > 0 ? `${emojiListId}-${asked.active}` : undefined}
        onChange={(event) => {
          onChange(event.target.value);
          const query = emojiQueryAt(event.target);
          setEmojiAsk(query && { ...query, value: event.target.value, active: 0 });
        }}
        // A move of the caret asks again: the list follows what is typed before it.
        onSelect={(event) => {
          const query = emojiQueryAt(event.currentTarget);
          setEmojiAsk(query && { ...query, value: event.currentTarget.value, active: 0 });
        }}
        onBlur={() => setEmojiAsk(null)}
        onPaste={onPaste}
      />
      {previewing && <CommentPreview text={value} render={preview} minHeight={previewing.height} />}
      {asked && emojiListShown && (
        <EmojiSuggestions
          textarea={ref}
          at={asked.at}
          id={emojiListId}
          suggestions={emojis.data ? suggestions : null}
          active={asked.active}
          onReach={(index) => setEmojiAsk({ ...asked, active: index })}
          onChoose={(emoji) => carryOut((draft) => insertEmoji(draft, emoji))}
        />
      )}
    </div>
  );
}

/** Renders a comment's Markdown the way GitHub will show it, for the Preview tab of every comment box inside it. */
export const MarkdownPreview = createContext<((text: string) => Promise<string>) | null>(null);

/** Loads GitHub's emoji, which every comment box inside it suggests after a `:`; none are suggested without it. */
export const EmojiList = createContext<(() => Promise<Emoji[]>) | null>(null);

/**
 * A part of the page fed by one stage of its data: its skeleton until the stage first arrives, then what `children`
 * renders from it. When the stage failed, a one-line error with a retry, below what it showed before if anything.
 */
export function Staged<T,>({
  state,
  what,
  skeleton,
  onRetry,
  children,
}: {
  state: StageState<T>;
  /** What failed to load, in a few words: "the checks". */
  what: string;
  skeleton: ReactNode;
  onRetry: () => void;
  children: (value: T) => ReactNode;
}) {
  const failure = state.status === 'error' && <StageError what={what} error={state.error} onRetry={onRetry} />;
  if (state.value === null) return failure || skeleton;
  return (
    <>
      {children(state.value)}
      {failure}
    </>
  );
}

/** One line saying what part of the page did not load and why, with a retry. */
export function StageError({ what, error, onRetry }: { what: string; error: string; onRetry: () => void }) {
  return (
    <div className="pr-stage-error" role="alert">
      <Icon name="alert" size={14} className="pr-fg-danger" />
      <span className="pr-stage-error-text" title={error}>
        Could not load {what} <span className="pr-muted">· {error}</span>
      </span>
      <Button variant="ghost" size="sm" icon="sync" onClick={onRetry}>
        Retry
      </Button>
    </div>
  );
}

/** A comment box's Preview tab: GitHub's rendering of the text, or the text as it is when GitHub cannot render it. */
function CommentPreview({ text, render, minHeight }: { text: string; render: ((text: string) => Promise<string>) | null; minHeight: number }) {
  const [rendered, setRendered] = useState<{ text: string; html: string } | { text: string; error: string } | null>(null);
  useEffect(() => {
    if (!render || text.trim() === '') return;
    let current = true;
    render(text).then(
      (html) => current && setRendered({ text, html }),
      (reason: unknown) => current && setRendered({ text, error: reason instanceof Error ? reason.message : String(reason) }),
    );
    return () => {
      current = false;
    };
  }, [render, text]);

  if (text.trim() === '') {
    return (
      <div className="pr-comment-box-preview pr-muted" style={{ minHeight }}>
        Nothing to preview
      </div>
    );
  }
  if (!render || (rendered?.text === text && 'error' in rendered)) {
    return (
      <div className="pr-comment-box-preview" style={{ minHeight }}>
        <div className="pr-muted" title={rendered && 'error' in rendered ? rendered.error : undefined}>
          Preview is not available
        </div>
        <pre className="pr-comment-box-raw">{text}</pre>
      </div>
    );
  }
  return (
    <div className="pr-comment-box-preview" style={{ minHeight }} aria-busy={rendered?.text !== text}>
      {rendered?.text === text && 'html' in rendered ? <Markdown html={rendered.html} /> : <span className="pr-muted">Loading preview…</span>}
    </div>
  );
}

/**
 * A toolbar button of the comment box. `keys` is its shortcut after ⌘ / Ctrl the way GitHub's docs write it; `stroke`
 * is how the box's keydown reads that shortcut.
 */
interface Tool {
  label: string;
  icon: IconName;
  command: (draft: Draft) => Draft;
  keys?: string;
  stroke?: string;
}

/**
 * GitHub's comment toolbar, in its order and groups, with the shortcuts GitHub documents for comments ("Keyboard
 * shortcuts", docs.github.com) and its task list's ⌘⇧L (GitHub's command list; the docs leave it out).
 */
const TOOLBAR: Array<[Tool, ...Tool[]]> = [
  [
    { label: 'Heading', icon: 'heading', command: insertHeading },
    { label: 'Bold', icon: 'bold', command: toggleBold, keys: 'B', stroke: 'b' },
    { label: 'Italic', icon: 'italic', command: toggleItalic, keys: 'I', stroke: 'i' },
    { label: 'Quote', icon: 'quote', command: toggleQuote, keys: 'Shift+.', stroke: 'shift+Period' },
    { label: 'Code', icon: 'code', command: toggleCode, keys: 'E', stroke: 'e' },
    { label: 'Link', icon: 'link', command: insertLink, keys: 'K', stroke: 'k' },
  ],
  [
    { label: 'Numbered list', icon: 'list-ordered', command: toggleNumberedList, keys: 'Shift+7', stroke: 'shift+Digit7' },
    { label: 'Unordered list', icon: 'list-unordered', command: toggleUnorderedList, keys: 'Shift+8', stroke: 'shift+Digit8' },
    { label: 'Task list', icon: 'tasklist', command: toggleTaskList, keys: 'Shift+L', stroke: 'shift+l' },
  ],
];

/**
 * The emoji a comment box suggests for what was typed after a `:`, as GitHub's list: under the text typed (above it when
 * there is no room below), in the page's body, so no part of the page that scrolls (a diff, the drawer) clips it. A click
 * leaves the focus in the text, and never reaches the page beneath, whose popovers would take it for one outside them.
 */
function EmojiSuggestions({
  textarea,
  at,
  id,
  suggestions,
  active,
  onReach,
  onChoose,
}: {
  textarea: RefObject<HTMLTextAreaElement | null>;
  /** Where the `:` is in the text: the list starts under what was typed after it. */
  at: number;
  id: string;
  /** Null while GitHub's emoji are on their way. */
  suggestions: Emoji[] | null;
  active: number;
  onReach: (index: number) => void;
  onChoose: (emoji: Emoji) => void;
}) {
  const box = useRef<HTMLDivElement | null>(null);
  const [place, setPlace] = useState<{ top: number; left: number } | null>(null);
  useLayoutEffect(() => {
    const placeList = () => {
      const field = textarea.current;
      if (!field || !box.current) return;
      const typed = characterOnScreen(field, at + 1);
      const { offsetHeight: height, offsetWidth: width } = box.current;
      const above = window.innerHeight - typed.bottom < height + 8 && typed.top > window.innerHeight - typed.bottom;
      setPlace({ top: above ? typed.top - height - 4 : typed.bottom + 4, left: Math.max(4, Math.min(typed.left, window.innerWidth - width - 4)) });
    };
    placeList();
    window.addEventListener('resize', placeList);
    document.addEventListener('scroll', placeList, true);
    return () => {
      window.removeEventListener('resize', placeList);
      document.removeEventListener('scroll', placeList, true);
    };
  }, [textarea, at, suggestions]);

  return createPortal(
    <div
      ref={box}
      className="pr-emoji-suggestions"
      // Measured where it is first drawn, unseen, then placed before the frame is painted.
      style={place ?? { visibility: 'hidden' }}
      onMouseDown={(event) => event.preventDefault()}
      onPointerDown={(event) => event.stopPropagation()}
    >
      {suggestions ? (
        <ul id={id} role="listbox" aria-label="Emoji" className="pr-emoji-suggestions-list">
          {suggestions.map((emoji, index) => (
            <li
              key={emoji.name}
              id={`${id}-${index}`}
              role="option"
              aria-selected={index === active}
              className="pr-emoji-suggestion"
              onMouseMove={() => onReach(index)}
              onClick={() => onChoose(emoji)}
            >
              {'character' in emoji ? (
                <span className="pr-emoji-suggestion-emoji">{emoji.character}</span>
              ) : (
                <img className="pr-emoji-suggestion-emoji" src={emoji.imageUrl} width={16} height={16} alt={`${emoji.name} emoji`} />
              )}
              {emoji.name}
            </li>
          ))}
        </ul>
      ) : (
        <div role="status" className="pr-emoji-suggestions-loading">
          Loading emoji…
        </div>
      )}
    </div>,
    document.body,
  );
}

/**
 * Where the character at `index` of the textarea's text shows on screen (its line's top and bottom, its left edge), found
 * the way Primer's InlineAutocomplete places its list: the text laid out again, off screen, in a box styled as the
 * textarea, with the part from `index` on in a marker whose place is read.
 */
function characterOnScreen(textarea: HTMLTextAreaElement, index: number): { top: number; bottom: number; left: number } {
  const style = getComputedStyle(textarea);
  const copy = document.createElement('div');
  for (const property of [
    'box-sizing', 'width', 'height', 'overflow-y', 'border-style', 'border-top-width', 'border-right-width', 'border-bottom-width', 'border-left-width',
    'padding-top', 'padding-right', 'padding-bottom', 'padding-left', 'font-family', 'font-size', 'font-style', 'font-variant', 'font-weight',
    'font-stretch', 'line-height', 'letter-spacing', 'word-spacing', 'tab-size', 'text-indent', 'text-transform', 'text-align', 'direction',
    'white-space', 'overflow-wrap', 'word-break',
  ]) {
    copy.style.setProperty(property, style.getPropertyValue(property));
  }
  copy.style.setProperty('position', 'absolute');
  copy.style.setProperty('top', '0');
  copy.style.setProperty('left', '-9999px');
  copy.style.setProperty('visibility', 'hidden');
  copy.textContent = textarea.value.slice(0, index);
  const marker = copy.appendChild(document.createElement('span'));
  marker.textContent = textarea.value.slice(index) || '.';
  document.body.append(copy);
  const field = textarea.getBoundingClientRect();
  const top = field.top + parseFloat(style.borderTopWidth) + marker.offsetTop - textarea.scrollTop;
  const left = field.left + parseFloat(style.borderLeftWidth) + marker.offsetLeft - textarea.scrollLeft;
  copy.remove();
  return { top, bottom: top + (parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.2), left };
}
