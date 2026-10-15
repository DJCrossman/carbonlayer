// Runs in app.graphite.com's own JavaScript world, where React's state is visible (a content script's isolated world
// sees only the DOM). When entrypoints/graphite.content.ts asks, in the tab opened to copy the sections, it waits up to
// 30 s for the inbox to render (the app is slow), copies the sections out of React's state (inboxSnapshotOf in
// src/lib/graphite.ts) and posts them back; on every other Graphite page it only listens.
// First: zod is told not to compile parsers before graphite.ts makes its schemas (src/lib/zod-in-page.ts says why).
import '../src/lib/zod-in-page';
import { defineContentScript } from 'wxt/utils/define-content-script';
import { z } from 'zod';
import { inboxSnapshotOf, type GraphiteInboxSnapshot } from '../src/lib/graphite';

export default defineContentScript({
  matches: ['https://app.graphite.com/*'],
  runAt: 'document_idle',
  world: 'MAIN',
  main() {
    window.addEventListener('message', (event) => {
      // Graphite's own messages, and this script's own answers, are posted here too.
      if (event.source !== window || !sectionsRequest.safeParse(event.data).success) return;
      const giveUpAt = Date.now() + 30_000;
      let emptyInbox = false;
      const look = () => {
        // Every element of the inbox leads up to its state; its sidebar's sections are list items.
        for (const item of document.querySelectorAll('li')) {
          let snapshot: GraphiteInboxSnapshot | null;
          try {
            snapshot = inboxSnapshotOf(item);
          } catch (error) {
            // The inbox holds its sections in a shape the copy cannot read: the tab and the import say so.
            window.postMessage({ source: 'carbonlayer', kind: 'graphite-sections-error', error: error instanceof Error ? error.message : String(error) }, location.origin);
            return;
          }
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

/** What entrypoints/graphite.content.ts posts to ask for the sections. */
const sectionsRequest = z.object({ source: z.literal('carbonlayer'), kind: z.literal('graphite-sections-request') });
