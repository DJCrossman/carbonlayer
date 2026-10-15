// Leaving the PR page. Inside github.com the app is an iframe, so links must move the top window (the
// content script then re-renders the new page) rather than the iframe. Opened directly (the harness,
// `window.parent === window`) there is no parent: other PRs open in the harness, everything else in a tab.

import { postToParent } from '../app/bridge';
import { toAppHash } from '../app/routes';
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

/** Follows a link from rendered Markdown or a check: github.com links replace the top page, others open a new tab. */
export function followLink(url: string): void {
  if (window.parent === window) window.open(url, '_blank', 'noopener');
  else postToParent({ type: 'gg:navigate', url, newTab: !url.startsWith('https://github.com/') });
}
