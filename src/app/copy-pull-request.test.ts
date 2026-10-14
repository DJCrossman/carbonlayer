import { describe, expect, it } from 'vitest';
import { pullRequestCopy } from './copy-pull-request';

const pr = { number: 9003, title: 'Fix the parcs adapter', url: 'https://github.com/acme/widgets/pull/9003' };

describe('pullRequestCopy', () => {
  it('copies the number as GitHub links it within the repository', () => {
    expect(pullRequestCopy(pr, 'copy-number')).toEqual({ data: { 'text/plain': '#9003' }, subject: '#9003' });
  });

  it('copies the title as a link: an anchor for rich text, Markdown for plain text', () => {
    expect(pullRequestCopy(pr, 'copy-title-link')).toEqual({
      data: {
        'text/html': '<a href="https://github.com/acme/widgets/pull/9003">Fix the parcs adapter</a>',
        'text/plain': '[Fix the parcs adapter](https://github.com/acme/widgets/pull/9003)',
      },
      subject: 'link to “Fix the parcs adapter”',
    });
  });

  it('escapes the title in the anchor', () => {
    const { data } = pullRequestCopy({ ...pr, title: 'Render <Diff> & "quotes"' }, 'copy-title-link');
    expect(data['text/html']).toBe('<a href="https://github.com/acme/widgets/pull/9003">Render &lt;Diff&gt; &amp; "quotes"</a>');
    expect(data['text/plain']).toBe('[Render <Diff> & "quotes"](https://github.com/acme/widgets/pull/9003)');
  });

  it('shortens a long title in the toast to its whole words, never on the clipboard', () => {
    const title = 'Migrate session storage from Redis to DynamoDB with dual writes and a kill switch';
    const { data, subject } = pullRequestCopy({ ...pr, title }, 'copy-title-link');
    expect(subject).toBe('link to “Migrate session storage from Redis to DynamoDB with dual…”');
    expect(data['text/plain']).toBe(`[${title}](${pr.url})`);
  });

  it('copies the URL', () => {
    expect(pullRequestCopy(pr, 'copy-url')).toEqual({ data: { 'text/plain': 'https://github.com/acme/widgets/pull/9003' }, subject: 'URL' });
  });
});
