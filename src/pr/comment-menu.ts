// What a comment's ⋯ menu makes of the comment, as GitHub's own menu does: the quote its Quote reply puts in a comment box,
// what of the comment it quotes, and the new issue its "Reference in new issue" starts.

/**
 * The text as GitHub's Quote reply puts it in a comment box: each of its lines after `> `, then an empty line, so that the
 * reply goes under the quote.
 */
export function quoteReply(text: string): string {
  return `${text
    .replace(/\r\n?/g, '\n')
    .trim()
    .split('\n')
    .map((line) => `> ${line}`)
    .join('\n')}\n\n`;
}

/**
 * What the reader has selected inside a comment's body (the description's included), which GitHub's Quote reply quotes in
 * place of the whole Markdown; null where nothing is selected there.
 */
export function quotableSelection(body: Element | null | undefined): string | null {
  const selection = window.getSelection();
  const range = selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : null;
  return body && range && !range.collapsed && body.contains(range.startContainer) && body.contains(range.endContainer) && range.toString().trim() !== '' ? range.toString() : null;
}

/**
 * GitHub's page for a new issue in the comment's repository, its body as GitHub's "Reference in a new issue" starts it (its
 * bundle, 2026-11-16): the comment's Markdown, each line not already a quote after `> `, then "_Originally posted by @login
 * in [#n](permalink)_", with GitHub's own spaces around the empty line. Null where the permalink names no pull request.
 */
export function newIssueReferencing(comment: { markdown: string; login: string; url: string }): string | null {
  const [, owner, name, number] = /^https:\/\/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/.exec(comment.url) ?? [];
  if (!owner || !name || !number) return null;
  const body = `${comment.markdown.replace(/^(?!>)/gm, '> ')} \n\n _Originally posted by @${comment.login} in [#${number}](${comment.url})_`;
  return `https://github.com/${owner}/${name}/issues/new?body=${encodeURIComponent(body)}`;
}
