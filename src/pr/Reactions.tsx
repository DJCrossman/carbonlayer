// GitHub's reactions under a comment or the description: a pill for each reaction given (its emoji and count, the
// viewer's own in the accent tone), which gives or takes back the viewer's, and a smiley opening GitHub's eight as its
// picker offers them. The PR page (PrReactions) sends each change and has every row show it at once.
import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { REACTION_CONTENTS, type Reaction, type ReactionContent } from '../lib/model';
import { Icon } from '../ui/Icon';
import './reactions.css';

export function Reactions({
  subjectId,
  reactions: fetched,
}: {
  /** What a reaction names; null where GitHub offers no way to react, which leaves the pills to read. */
  subjectId: string | null;
  reactions: Reaction[];
}) {
  const page = useContext(PrReactions);
  const [pickerOpen, setPickerOpen] = useState(false);
  const anchor = useRef<HTMLDivElement>(null);
  const smiley = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!pickerOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!(event.target instanceof Node) || !anchor.current?.contains(event.target)) setPickerOpen(false);
    };
    // Ahead of the page's own Esc (keybindings.ts), which would close other things too, such as an inline composer.
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      setPickerOpen(false);
      smiley.current?.focus();
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown, true);
    };
  }, [pickerOpen]);

  const react = page && subjectId !== null ? (content: ReactionContent, add: boolean) => page.react(subjectId, content, add) : null;
  const reactions = subjectId === null ? fetched : reactionsAfter(fetched, page?.changed[subjectId]);
  if (reactions.length === 0 && !react) return null;
  return (
    <div className={`reactions ${reactions.length === 0 ? 'is-empty' : ''}`}>
      {reactions.map(({ content, count, viewerHasReacted }) => (
        <button
          key={content}
          type="button"
          className={`reaction-pill ${viewerHasReacted ? 'is-mine' : ''}`}
          aria-pressed={viewerHasReacted}
          aria-label={`${REACTIONS[content].name}: ${count}`}
          title={`${count} ${REACTIONS[content].name}${viewerHasReacted ? ', yours among them' : ''}`}
          disabled={!react}
          onClick={() => react?.(content, !viewerHasReacted)}
        >
          <span className="reaction-emoji">{REACTIONS[content].emoji}</span>
          {count}
        </button>
      ))}
      {react && (
        <div className="reaction-picker-anchor" ref={anchor}>
          <button
            ref={smiley}
            type="button"
            className="reaction-add"
            aria-label="Add reaction"
            title="Add reaction"
            aria-haspopup="menu"
            aria-expanded={pickerOpen}
            onClick={() => setPickerOpen((open) => !open)}
          >
            <Icon name="smiley" size={14} />
          </button>
          {pickerOpen && (
            <div className="reaction-picker" role="menu" aria-label="Pick your reaction">
              {REACTION_CONTENTS.map((content, index) => {
                const mine = reactions.some((reaction) => reaction.content === content && reaction.viewerHasReacted);
                return (
                  <button
                    key={content}
                    type="button"
                    role="menuitemcheckbox"
                    aria-checked={mine}
                    className={`reaction-option ${mine ? 'is-mine' : ''}`}
                    title={REACTIONS[content].name}
                    autoFocus={index === 0}
                    onClick={() => {
                      setPickerOpen(false);
                      react(content, !mine);
                    }}
                  >
                    {REACTIONS[content].emoji}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** The reactions the viewer gave (true) or took back (false) on this page, by subject and reaction. */
export type ChangedReactions = Record<string, Partial<Record<ReactionContent, boolean>>>;

/**
 * The PR page's part in every reactions row: what the viewer changed there, which each row shows over what GitHub last
 * said until GitHub says so too, and how to send a change. Without it the pills are only to read.
 */
export const PrReactions = createContext<{ changed: ChangedReactions; react: (subjectId: string, content: ReactionContent, add: boolean) => void } | null>(null);

/** Each of GitHub's reactions as it shows them: the emoji, and the name its tooltips give it. */
const REACTIONS: Record<ReactionContent, { emoji: string; name: string }> = {
  THUMBS_UP: { emoji: '👍', name: 'thumbs up' },
  THUMBS_DOWN: { emoji: '👎', name: 'thumbs down' },
  LAUGH: { emoji: '😄', name: 'laugh' },
  HOORAY: { emoji: '🎉', name: 'hooray' },
  CONFUSED: { emoji: '😕', name: 'confused' },
  HEART: { emoji: '❤️', name: 'heart' },
  ROCKET: { emoji: '🚀', name: 'rocket' },
  EYES: { emoji: '👀', name: 'eyes' },
};

/**
 * The reactions as GitHub last gave them, with the viewer's own as this page last set them: one GitHub already shows
 * changes nothing, any other moves its count by one. GitHub's order; a reaction nobody gives any more goes.
 */
function reactionsAfter(reactions: Reaction[], changed: Partial<Record<ReactionContent, boolean>> = {}): Reaction[] {
  const pending = REACTION_CONTENTS.filter(
    (content) => changed[content] !== undefined && changed[content] !== reactions.some((reaction) => reaction.content === content && reaction.viewerHasReacted),
  );
  if (pending.length === 0) return reactions;
  return REACTION_CONTENTS.flatMap((content): Reaction[] => {
    const reaction = reactions.find((candidate) => candidate.content === content);
    if (!pending.includes(content)) return reaction ? [reaction] : [];
    const count = (reaction?.count ?? 0) + (changed[content] ? 1 : -1);
    return count > 0 ? [{ content, count, viewerHasReacted: !!changed[content] }] : [];
  });
}
