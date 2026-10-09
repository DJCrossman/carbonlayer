// Runs in app.graphite.com's own JavaScript world, where React's state is visible (a content script's isolated world
// sees only the DOM). When entrypoints/graphite.content.ts asks, in the tab opened to copy the sections, it waits up to
// 30 s for the inbox to render (the app is slow), copies the sections out of React's state (inboxSnapshotOf in
// src/lib/graphite.ts) and posts them back; on every other Graphite page it only listens.
import { defineContentScript } from 'wxt/utils/define-content-script';
import { inboxSnapshotOf } from '../src/lib/graphite';

export default defineContentScript({
  matches: ['https://app.graphite.com/*'],
  runAt: 'document_idle',
  world: 'MAIN',
  main() {
    window.addEventListener('message', (event) => {
      const { source, kind } = (event.data ?? {}) as { source?: unknown; kind?: unknown };
      if (event.source !== window || source !== 'carbonlayer' || kind !== 'graphite-sections-request') return;
      const giveUpAt = Date.now() + 30_000;
      let emptyInbox = false;
      const look = () => {
        // Every element of the inbox leads up to its state; its sidebar's sections are list items.
        for (const item of document.querySelectorAll('li')) {
          const snapshot = inboxSnapshotOf(item);
          if (!snapshot) continue;
          if (snapshot.sections.length > 0) {
            window.postMessage({ source: 'carbonlayer', kind: 'graphite-sections', ...snapshot }, location.origin);
            return;
          }
          // Still syncing, or truly empty.
          emptyInbox = true;
        }
        if (Date.now() < giveUpAt) {
          setTimeout(look, 500);
          return;
        }
        const error = emptyInbox
          ? "Graphite's inbox has no sections to copy."
          : "Graphite's inbox did not show up in its tab. Sign in to Graphite there; your sections are copied as soon as your inbox shows.";
        window.postMessage({ source: 'carbonlayer', kind: 'graphite-sections-error', error }, location.origin);
      };
      look();
    });
  },
});
