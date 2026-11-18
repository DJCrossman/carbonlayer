// Leaving the PR page. Inside github.com the app is an iframe, so links must move the top window (the
// content script then re-renders the new page) rather than the iframe. Opened directly (the harness,
// `window.parent === window`) there is no parent: other PRs and this PR's comments open in the harness, everything else in
// a tab.

import { postToParent } from '../app/bridge';
import { parseAppHash, parseGitHubLocation, toAppHash, toGitHubUrl } from '../app/routes';
import type { PrSummary } from '../lib/model';

/** Shows another PR (stack navigation): the top window navigates, or the harness changes its route. */
export function goToPr(pr: Pick<PrSummary, 'repo' | 'number' | 'url'>): void {
  if (window.parent === window) location.hash = toAppHash({ page: 'pr', repo: pr.repo, number: pr.number, section: 'conversation' });
  else postToParent({ type: 'gg:navigate', url: pr.url });
}

/** Hands this page back to GitHub's own UI. */
export function openOnGitHub(prUrl: string): void {
  if (window.parent === window) window.open(prUrl, '_blank', 'noopener');
  else postToParent({ type: 'gg:open-native' });
}

/** Follows a link from rendered Markdown, a check or a commit: github.com links replace the top page, others open a new tab. */
export function followLink(url: string): void {
  if (window.parent === window) window.open(url, '_blank', 'noopener');
  else postToParent({ type: 'gg:navigate', url, newTab: !url.startsWith('https://github.com/') });
}

/** Opens a page in a new tab, leaving this one as it is, so a comment being written keeps its text (GitHub's settings). */
export function openInNewTab(url: string): void {
  if (window.parent === window) window.open(url, '_blank', 'noopener');
  else postToParent({ type: 'gg:navigate', url, newTab: true });
}

/**
 * Focuses a comment on this page, as a click on its time does on GitHub: the top window moves to its permalink without
 * loading (a history entry, so Back leaves it again, or with `replace` the current entry, for a comment chosen by a click
 * on it) and the page marks it; the harness changes its route. The reader stays in the section they are in: a diff
 * comment's permalink is the conversation's, which the files view names as GitHub's does (`toGitHubUrl`).
 */
export function focusComment(url: string, { replace = false }: { replace?: boolean } = {}): void {
  const linked = parseGitHubLocation(new URL(url));
  // The app's hash is always its current route (main.tsx sets it on every move).
  const current = parseAppHash(location.hash);
  const route =
    linked.page === 'pr' && current.page === 'pr' && current.repo.owner === linked.repo.owner && current.repo.name === linked.repo.name && current.number === linked.number
      ? { ...linked, section: current.section }
      : linked;
  if (window.parent !== window) postToParent({ type: 'gg:navigate', url: toGitHubUrl(route), replace });
  // A fragment move that replaces the entry still fires hashchange, which the app's route follows.
  else if (replace) location.replace(toAppHash(route));
  else location.hash = toAppHash(route);
}
