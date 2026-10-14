// Linear's copy shortcuts, which the PR page has for its pull request and the inbox for the row under the pointer: ⌘.
// copies the PR's number, ⌘C its title as a link and ⌘, its URL (Ctrl for ⌘ off macOS), and a toast says what was
// copied. Each page's keyboard handling leaves ⌘C to the browser while text is selected or a text field has focus.
import type { PrSummary } from '../lib/model';
import { showToast } from '../ui/Toast';

/** Puts the PR's number, its title linked to it, or its URL on the clipboard, and says so in a toast. */
export async function copyPullRequest(pr: Pick<PrSummary, 'number' | 'title' | 'url'>, action: CopyAction): Promise<void> {
  const { data, subject } = pullRequestCopy(pr, action);
  try {
    // Only the focused document may write: a key typed on GitHub's page moves the focus here first (github.content.ts).
    await navigator.clipboard.write([new ClipboardItem(data)]);
    showToast(`Copied ${subject}`);
  } catch (reason) {
    showToast(`Could not copy ${subject}: ${reason instanceof Error ? reason.message : String(reason)}`, 'danger');
  }
}

/** The copy shortcuts, in keybindings.ts's chord notation: `mod` is ⌘ on macOS and Ctrl elsewhere. */
export const COPY_KEYBINDINGS: ReadonlyArray<{ chord: string; action: CopyAction; label: string }> = [
  { chord: 'mod+.', action: 'copy-number', label: 'Copy PR number' },
  { chord: 'mod+c', action: 'copy-title-link', label: 'Copy title with link' },
  { chord: 'mod+,', action: 'copy-url', label: 'Copy URL' },
];

/**
 * What a copy puts on the clipboard, by type, and how its toast names it. GitHub links "#9003" to the PR within its
 * repository. The title goes as a link to the PR: an anchor for apps that paste rich text (Slack, Linear, Docs), and
 * Markdown for those that paste plain text.
 */
export function pullRequestCopy(pr: Pick<PrSummary, 'number' | 'title' | 'url'>, action: CopyAction): { data: Record<string, string>; subject: string } {
  switch (action) {
    case 'copy-number':
      return { data: { 'text/plain': `#${pr.number}` }, subject: `#${pr.number}` };
    case 'copy-title-link': {
      const anchor = Object.assign(document.createElement('a'), { href: pr.url, textContent: pr.title });
      // A long title is cut after its last whole word within 60 characters.
      const title = pr.title.length > 60 ? `${pr.title.slice(0, 61).replace(/\s+\S*$/, '')}…` : pr.title;
      return { data: { 'text/html': anchor.outerHTML, 'text/plain': `[${pr.title}](${pr.url})` }, subject: `link to “${title}”` };
    }
    case 'copy-url':
      return { data: { 'text/plain': pr.url }, subject: 'URL' };
  }
}

export type CopyAction = 'copy-number' | 'copy-title-link' | 'copy-url';
