import { describe, expect, it } from 'vitest';
import type { Emoji } from '../lib/model';
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

// Drafts are written with the selection marked: 'a |b|' selects "b", 'a|b' is the caret alone.
const draft = (marked: string): Draft => {
  const selectionStart = marked.indexOf('|');
  const selectionEnd = marked.indexOf('|', selectionStart + 1) === -1 ? selectionStart : marked.indexOf('|', selectionStart + 1) - 1;
  return { value: marked.replaceAll('|', ''), selectionStart, selectionEnd };
};
const marked = (result: Draft | null): string => {
  if (!result) return 'unchanged';
  const { value, selectionStart, selectionEnd } = result;
  return selectionStart === selectionEnd
    ? `${value.slice(0, selectionStart)}|${value.slice(selectionStart)}`
    : `${value.slice(0, selectionStart)}|${value.slice(selectionStart, selectionEnd)}|${value.slice(selectionEnd)}`;
};

describe('toggleBold', () => {
  it('wraps the selection and keeps it selected, and unwraps it again', () => {
    expect(marked(toggleBold(draft('hello |world|')))).toBe('hello **|world|**');
    expect(marked(toggleBold(draft('hello **|world|**')))).toBe('hello |world|');
  });

  it('wraps the word around a bare caret, which stays where it was', () => {
    expect(marked(toggleBold(draft('hello wo|rld')))).toBe('hello **wo|rld**');
  });

  it('gives a caret at the very end of the text an empty pair to type into, like GitHub', () => {
    expect(marked(toggleBold(draft('|')))).toBe('**|**');
    expect(marked(toggleBold(draft('hello|')))).toBe('hello**|**');
  });

  it('keeps whitespace at the edges of the selection outside the markers', () => {
    expect(marked(toggleBold(draft('say| hi |now')))).toBe('say **|hi|** now');
  });
});

describe('toggleItalic', () => {
  it('wraps the selection in underscores', () => {
    expect(marked(toggleItalic(draft('hello |world|')))).toBe('hello _|world|_');
  });
});

describe('insertHeading', () => {
  it('puts a third-level heading marker before the word at the caret', () => {
    expect(marked(insertHeading(draft('Ti|tle')))).toBe('### Ti|tle');
  });

  it('takes the marker away from a selection that has it', () => {
    expect(marked(insertHeading(draft('### |Title|')))).toBe('|Title|');
  });
});

describe('toggleQuote', () => {
  it('quotes every selected line, set apart from the text before it by a blank line', () => {
    expect(marked(toggleQuote(draft('intro\n|a\nb|')))).toBe('intro\n\n|> a\n> b|');
  });

  it('quotes from the word at the caret to the end of its line', () => {
    expect(marked(toggleQuote(draft('wo|rd')))).toBe('> wo|rd');
  });

  it('unquotes lines that are all quoted', () => {
    expect(marked(toggleQuote(draft('|> a\n> b|')))).toBe('|a\nb|');
  });
});

describe('toggleCode', () => {
  it('wraps a selection on one line in backticks', () => {
    expect(marked(toggleCode(draft('call |run()| now')))).toBe('call `|run()|` now');
  });

  it('fences a selection of several lines', () => {
    expect(marked(toggleCode(draft('|a\nb|')))).toBe('```\n|a\nb|\n```');
  });
});

describe('insertLink', () => {
  it('links the selected text and selects the url placeholder to type over', () => {
    expect(marked(insertLink(draft('see |docs|')))).toBe('see [docs](|url|)');
  });

  it('inserts an empty link with the caret between the brackets when nothing is selected', () => {
    expect(marked(insertLink(draft('see |')))).toBe('see [|](url)');
  });

  it('makes a selected URL the target, the caret in the brackets for its text', () => {
    expect(marked(insertLink(draft('|https://example.com|')))).toBe('[|](https://example.com)');
  });
});

describe('toggleNumberedList', () => {
  it('numbers every selected line, and takes the numbers away again', () => {
    expect(marked(toggleNumberedList(draft('|one\ntwo|')))).toBe('|1. one\n2. two|');
    expect(marked(toggleNumberedList(draft('|1. one\n2. two|')))).toBe('|one\ntwo|');
  });

  it('turns a bulleted list into a numbered one', () => {
    expect(marked(toggleNumberedList(draft('|- one\n- two|')))).toBe('|1. one\n2. two|');
  });
});

describe('toggleUnorderedList', () => {
  it("bullets the caret's whole line, set apart from the paragraph before it", () => {
    expect(marked(toggleUnorderedList(draft('first\nsec|ond')))).toBe('first\n\n- sec|ond');
  });

  it("takes the bullet off the caret's line when it has one", () => {
    expect(marked(toggleUnorderedList(draft('- sec|ond')))).toBe('sec|ond');
  });

  it('starts a list in an empty comment', () => {
    expect(marked(toggleUnorderedList(draft('|')))).toBe('- |');
  });
});

describe('toggleTaskList', () => {
  it('makes every selected line an unchecked task', () => {
    expect(marked(toggleTaskList(draft('|a\nb|')))).toBe('|- [ ] a\n- [ ] b|');
  });

  it('starts a task in an empty comment', () => {
    expect(marked(toggleTaskList(draft('|')))).toBe('- [ ] |');
  });
});

describe('insertSuggestion', () => {
  it('appends a suggestion block with the lines, the caret at their end', () => {
    expect(marked(insertSuggestion(draft('Looks off|'), 'const a = 1;'))).toBe('Looks off\n```suggestion\nconst a = 1;|\n```');
  });

  it('is the whole comment when the comment is empty', () => {
    expect(marked(insertSuggestion(draft('|'), 'a\nb'))).toBe('```suggestion\na\nb|\n```');
  });
});

describe('continueList', () => {
  it('starts the next item with the same bullet and indentation', () => {
    expect(marked(continueList(draft('- one|')))).toBe('- one\n- |');
    expect(marked(continueList(draft('  * nested|')))).toBe('  * nested\n  * |');
  });

  it('numbers the next item one higher', () => {
    expect(marked(continueList(draft('1. one|')))).toBe('1. one\n2. |');
    expect(marked(continueList(draft('9. nine|')))).toBe('9. nine\n10. |');
  });

  it('follows a task, done or not, with an unchecked one', () => {
    expect(marked(continueList(draft('- [x] done|')))).toBe('- [x] done\n- [ ] |');
  });

  it('moves the rest of the line into the new item', () => {
    expect(marked(continueList(draft('- one|two')))).toBe('- one\n- |two');
  });

  it('ends the list on an empty item, taking its marker away', () => {
    expect(marked(continueList(draft('- one\n- |')))).toBe('- one\n|');
    expect(marked(continueList(draft('- [ ] |')))).toBe('|');
  });

  it('leaves Enter alone outside a list item, before its marker, and over a selection', () => {
    expect(continueList(draft('plain|'))).toBeNull();
    expect(continueList(draft('|- one'))).toBeNull();
    expect(continueList(draft('- |one|'))).toBeNull();
  });
});

describe('linkPastedUrl', () => {
  it('links the selected text to a pasted URL, the caret after the link', () => {
    expect(marked(linkPastedUrl(draft('read |the docs| first'), 'https://example.com/docs\n'))).toBe('read [the docs](https://example.com/docs)| first');
  });

  it('leaves a paste alone without a selection, without a URL, over a URL and inside a link target', () => {
    expect(linkPastedUrl(draft('read |'), 'https://example.com')).toBeNull();
    expect(linkPastedUrl(draft('read |this|'), 'not a url')).toBeNull();
    expect(linkPastedUrl(draft('read |https://old.example.com|'), 'https://example.com')).toBeNull();
    expect(linkPastedUrl(draft('[docs](|old|)'), 'https://example.com')).toBeNull();
  });
});

describe('emojiQueryAt', () => {
  it('reads what was typed after a `:` that starts the text or follows whitespace, up to the caret', () => {
    expect(emojiQueryAt(draft(':+1|'))).toEqual({ at: 0, query: '+1' });
    expect(emojiQueryAt(draft('Nice :smi|le'))).toEqual({ at: 5, query: 'smi' });
    expect(emojiQueryAt(draft('Done\n:ta|'))).toEqual({ at: 5, query: 'ta' });
    expect(emojiQueryAt(draft('Nice :|'))).toEqual({ at: 5, query: '' });
  });

  it('asks for nothing after a `:` inside a word, once a space is typed, or over a selection', () => {
    expect(emojiQueryAt(draft('a:b|'))).toBeNull();
    expect(emojiQueryAt(draft('see https://|'))).toBeNull();
    expect(emojiQueryAt(draft(':+1: |'))).toBeNull();
    expect(emojiQueryAt(draft('|:smile|'))).toBeNull();
  });
});

describe('emojiSuggestionsFor', () => {
  // As GitHub's list has them: its first entries, then by name.
  const emojis: Emoji[] = [
    { name: '100', character: '💯' },
    { name: '1234', character: '🔢' },
    { name: '+1', character: '👍' },
    { name: '-1', character: '👎' },
    { name: '1st_place_medal', character: '🥇' },
    { name: '2nd_place_medal', character: '🥈' },
    { name: 'blue_heart', character: '💙' },
    { name: 'cupid', character: '💘' },
    { name: 'hugs', character: '🤗' },
    { name: 'muscle', character: '💪' },
    { name: 'shipit', imageUrl: 'https://github.githubassets.com/images/icons/emoji/shipit.png?v8' },
    { name: 'smile', character: '😄' },
    { name: 'smile_cat', character: '😸' },
    { name: 'smiley', character: '😃' },
    { name: 'sunny', character: '☀️' },
    { name: 'sweat_smile', character: '😅' },
    { name: 'thumbsdown', character: '👎' },
    { name: 'thumbsup', character: '👍' },
  ];
  const names = (query: string) => emojiSuggestionsFor(query, emojis).map((emoji) => emoji.name);

  it("offers the list's first five for a bare `:`", () => {
    expect(names('')).toEqual(['100', '1234', '+1', '-1', '1st_place_medal']);
  });

  it('puts names that begin with the query before those that only have it, case aside, five at most', () => {
    expect(names('SMI')).toEqual(['smile', 'smile_cat', 'smiley', 'sweat_smile']);
    expect(names('s')).toEqual(['shipit', 'smile', 'smile_cat', 'smiley', 'sunny']);
    expect(names('+1')).toEqual(['+1']);
  });

  it('keeps +1, thumbsup and -1 ahead of their equals before the five are taken, and ahead of all five after', () => {
    expect(names('u')).toEqual(['thumbsup', 'blue_heart', 'cupid', 'hugs', 'muscle']);
    expect(names('thumbs')).toEqual(['thumbsup', 'thumbsdown']);
    expect(names('1')).toEqual(['+1', '-1', '100', '1234', '1st_place_medal']);
  });

  it('suggests nothing for a name typed out to its closing `:`, which stays as it is', () => {
    expect(names('+1:')).toEqual([]);
  });
});

describe('insertEmoji', () => {
  it("puts a Unicode emoji's character and a space in place of the `:` and what follows it, the caret after the space", () => {
    expect(marked(insertEmoji(draft(':+1|'), { name: '+1', character: '👍' }))).toBe('👍 |');
    expect(marked(insertEmoji(draft('Nice :smi|\nmore'), { name: 'smile', character: '😄' }))).toBe('Nice 😄 |\nmore');
  });

  it("puts one of GitHub's own emoji in as `:name:`", () => {
    expect(marked(insertEmoji(draft('Ship it :ship|'), { name: 'shipit', imageUrl: 'https://github.githubassets.com/images/icons/emoji/shipit.png?v8' }))).toBe('Ship it :shipit: |');
  });

  it('does nothing where the text asks for no emoji', () => {
    expect(insertEmoji(draft('a:b|'), { name: '+1', character: '👍' })).toBeNull();
  });
});
