import { describe, expect, it } from 'vitest';
import { newIssueReferencing, quoteReply } from './comment-menu';

describe('quoteReply', () => {
  it('puts each line after `> `, then an empty line, from Markdown with CRLF line ends or a selection with spaces around it', () => {
    expect(quoteReply('Ship it?\r\n\r\n```ts\r\nx()\r\n```')).toBe('> Ship it?\n> \n> ```ts\n> x()\n> ```\n\n');
    expect(quoteReply('  the overnight zones\n')).toBe('> the overnight zones\n\n');
  });
});

describe('newIssueReferencing', () => {
  it("is the comment's repository's new issue, its body the comment quoted and where it was posted, as GitHub's dialog writes it", () => {
    const url = newIssueReferencing({ markdown: 'Should this throw?\n> an earlier quote\nYes.', login: 'jlord', url: 'https://github.com/acme/widgets/pull/42#discussion_r1' });
    expect(url?.startsWith('https://github.com/acme/widgets/issues/new?body=')).toBe(true);
    expect(new URL(url ?? '').searchParams.get('body')).toBe(
      '> Should this throw?\n> an earlier quote\n> Yes. \n\n _Originally posted by @jlord in [#42](https://github.com/acme/widgets/pull/42#discussion_r1)_',
    );
  });

  it('is none for a permalink that names no pull request', () => {
    expect(newIssueReferencing({ markdown: 'x', login: 'ana', url: 'https://example.com/elsewhere' })).toBeNull();
  });
});
