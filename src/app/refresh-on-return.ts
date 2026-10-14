// Coming back to a page refreshes it, as Graphite does (React Query's refetchOnWindowFocus): quietly, in the background,
// the page updating in place. The inbox and the PR page both use it.
import { useEffect, useEffectEvent, useRef } from 'react';
import { GITHUB_ORIGIN, isBridgeMessage, type ParentToAppMessage } from './bridge';

/**
 * Calls `refresh` when the viewer comes back to the page: the tab shown again, or the window focused again, this frame's
 * own or github.com's, which the parent page forwards (`gg:focus`) because a frame hears nothing of a focus that lands
 * outside it. Only once what the page shows is more than 30 s old (since `fetchedAt`, or the last refresh, or the page
 * opening), and never while `busy` (the page is loading something) or the last refresh is still under way, so switching
 * back and forth asks GitHub at most twice a minute. `refresh` asks GitHub itself, past the content script's memory.
 */
export function useRefreshOnReturn(refresh: () => Promise<void>, { busy, fetchedAt = null }: { busy: boolean; fetchedAt?: number | null }): void {
  // The page asks GitHub as it opens.
  const refreshedAt = useRef(Date.now());
  const refreshing = useRef(false);

  const onReturn = useEffectEvent(() => {
    if (document.visibilityState !== 'visible' || busy || refreshing.current) return;
    if (Date.now() - Math.max(refreshedAt.current, fetchedAt ?? 0) < STALE_AFTER_MS) return;
    refreshing.current = true;
    void refresh().finally(() => {
      refreshing.current = false;
      refreshedAt.current = Date.now();
    });
  });

  useEffect(() => {
    const listener = () => onReturn();
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== GITHUB_ORIGIN || event.source !== window.parent || !isBridgeMessage<ParentToAppMessage>(event.data)) return;
      if (event.data.type === 'gg:focus') onReturn();
    };
    window.addEventListener('focus', listener);
    document.addEventListener('visibilitychange', listener);
    window.addEventListener('message', onMessage);
    return () => {
      window.removeEventListener('focus', listener);
      document.removeEventListener('visibilitychange', listener);
      window.removeEventListener('message', onMessage);
    };
  }, []);
}

/**
 * How old what a page shows may be before coming back to it asks GitHub again: the 30 s the content script keeps a PR's
 * answers. A glance at another window comes back well within it and asks nothing; coming back from a review in another
 * tab, a chat or a CI run always refreshes.
 */
const STALE_AFTER_MS = 30_000;
