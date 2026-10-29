// GitHub's reactions under a comment or the description: a pill for each reaction given (its emoji and count, the
// viewer's own in the accent tone, and pointed at, GitHub's card of who gave it), which gives or takes back the
// viewer's, and a smiley opening GitHub's eight as its picker offers them. The PR page (PrReactions) sends each change and has every row show it at once.
import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { githubUser } from '../lib/github-web/session';
import { REACTION_CONTENTS, type Reaction, type ReactionContent } from '../lib/model';
import { Avatar } from '../ui/Avatar';
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
  const anchor = useRef<HTMLDivElement | null>(null);
  const smiley = useRef<HTMLButtonElement | null>(null);

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
      {reactions.map((reaction) => (
        <ReactionPill
          key={reaction.content}
          reaction={reaction}
          viewerLogin={page?.viewerLogin}
          onClick={react && (() => react(reaction.content, !reaction.viewerHasReacted))}
        />
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
 * said until GitHub says so too, how to send a change, and who the viewer is, whom a card of who reacted names first.
 * Without it the pills are only to read.
 */
export const PrReactions = createContext<{
  changed: ChangedReactions;
  react: (subjectId: string, content: ReactionContent, add: boolean) => void;
  viewerLogin: string;
} | null>(null);

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
 * The reactions the way GitHub last gave them, with the viewer's own as this page last set them: one GitHub already
 * shows changes nothing, any other moves its count by one. GitHub's order; a reaction nobody gives any more goes.
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
    return count > 0 ? [{ content, count, viewerHasReacted: !!changed[content], reactors: reaction?.reactors ?? [] }] : [];
  });
}

/**
 * A reaction's pill and, while it is pointed at, GitHub's card of the people who gave it over it: each by avatar and
 * login, the viewer first, then how many more GitHub leaves unnamed. Where GitHub names nobody, its tooltip's sentence
 * instead, which screen readers hear in either case.
 */
function ReactionPill({ reaction: { content, count, viewerHasReacted, reactors }, viewerLogin, onClick }: { reaction: Reaction; viewerLogin: string | undefined; onClick: (() => void) | null }) {
  const [open, setOpen] = useState(false);
  const pill = useRef<HTMLButtonElement | null>(null);
  const card = useRef<HTMLDivElement | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => () => clearTimeout(timer.current), []);
  useEffect(() => {
    if (!open) return;
    // Placed against the pill as it opened; a scroll takes the pill away from it, so it closes.
    const close = () => setOpen(false);
    document.addEventListener('scroll', close, true);
    return () => document.removeEventListener('scroll', close, true);
  }, [open]);
  useLayoutEffect(() => {
    const anchor = pill.current?.getBoundingClientRect();
    if (!anchor || !card.current) return;
    const { width, height } = card.current.getBoundingClientRect();
    // Above the pill, the left edges lined up, as GitHub's; below it where there is no room above, and inside the window.
    card.current.style.left = `${Math.max(8, Math.min(anchor.left, window.innerWidth - width - 8))}px`;
    card.current.style.top = `${anchor.top >= height + 12 ? anchor.top - height - 4 : anchor.bottom + 4}px`;
  });

  // GitHub's tooltip, "You, ana, and 3 more reacted with thumbs up emoji": the viewer first, then everyone GitHub names,
  // then how many it leaves unnamed.
  const named = [...(viewerHasReacted ? ['You'] : []), ...reactors];
  const unnamed = count - named.length;
  const sentence = `${new Intl.ListFormat('en').format(unnamed > 0 ? [...named, `${unnamed} ${named.length > 0 ? 'more' : unnamed === 1 ? 'person' : 'people'}`] : named)} reacted with ${REACTIONS[content].name} emoji`;
  // The card names the viewer by login, as GitHub's does.
  const people = [...(viewerHasReacted && viewerLogin ? [viewerLogin] : []), ...reactors];
  const more = count - people.length;
  // Opens a moment after the pointer arrives and closes a moment after it leaves the pill and the card both, so that it
  // can cross from one to the other.
  const hover = (next: boolean) => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setOpen(next), next ? 300 : 150);
  };
  return (
    <>
      <button
        ref={pill}
        type="button"
        className={`reaction-pill ${viewerHasReacted ? 'is-mine' : ''}`}
        aria-pressed={viewerHasReacted}
        aria-label={`${REACTIONS[content].name}: ${count}`}
        aria-description={sentence}
        title={people.length === 0 ? sentence : undefined}
        disabled={!onClick}
        onClick={onClick ?? undefined}
        onPointerEnter={() => people.length > 0 && hover(true)}
        onPointerLeave={() => hover(false)}
      >
        <span className="reaction-emoji">{REACTIONS[content].emoji}</span>
        {count}
      </button>
      {open &&
        people.length > 0 &&
        // In the body, past the clipping of the diff and the drawer.
        createPortal(
          <div
            ref={card}
            className="reaction-reactors"
            role="group"
            aria-label={`People who reacted with ${REACTIONS[content].name}`}
            onPointerEnter={() => hover(true)}
            onPointerLeave={() => hover(false)}
          >
            <ul>
              {people.map((login) => (
                <li key={login}>
                  <Avatar user={githubUser(login)} size={20} />
                  {login}
                </li>
              ))}
            </ul>
            {more > 0 && <div className="reaction-reactors-more">{`+${more} more ${more === 1 ? 'person' : 'people'}`}</div>}
          </div>,
          document.body,
        )}
    </>
  );
}
