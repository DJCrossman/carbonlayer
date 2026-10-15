// Content script on app.graphite.com, for "Copy my sections from Graphite" (src/inbox/GraphiteImport.tsx). In the tab
// the background opened for that (entrypoints/background.ts knows which; every other Graphite tab is left alone), it
// asks entrypoints/graphite-sections.content.ts, which runs in the page's own JavaScript world where React's state is
// visible, for the sections Graphite's inbox holds, and hands them to the background, which stores them for the import
// dialog and closes the tab. A banner on the page says how it went.
// First: zod's messages (src/lib/zod-messages.ts).
import '../src/lib/zod-messages';
import { browser } from 'wxt/browser';
import { defineContentScript } from 'wxt/utils/define-content-script';
import { z } from 'zod/mini';
import { graphiteInboxSnapshot } from '../src/lib/graphite';

export default defineContentScript({
  matches: ['https://app.graphite.com/*'],
  runAt: 'document_idle',
  // WXT's start-up postMessage would reach Graphite's own message listeners.
  noScriptStartedPostMessage: true,
  async main(ctx) {
    const wanted: unknown = await browser.runtime.sendMessage({ kind: 'carbonlayer-graphite-import-wanted' }).catch(() => false);
    if (wanted !== true) return;

    const banner = document.createElement('div');
    banner.setAttribute('role', 'status');
    banner.style.cssText =
      'all: initial; position: fixed; z-index: 2147483647; top: 12px; right: 12px; max-width: 380px; padding: 8px 12px; border-radius: 6px; background: #1f2328; color: #ffffff; font: 500 13px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans", Helvetica, Arial, sans-serif; box-shadow: 0 4px 12px rgba(0, 0, 0, 0.25);';
    banner.textContent = 'CarbonLayer: copying your sections…';
    document.body.append(banner);
    ctx.onInvalidated(() => banner.remove());

    ctx.addEventListener(window, 'message', (event) => {
      if (event.source !== window || event.origin !== location.origin) return;
      // Graphite's own messages are posted here too; ours say they are.
      const data: unknown = event.data;
      if (!postedByCarbonLayer.safeParse(data).success) return;
      const message = fromPageWorld.parse(data);
      if (message.kind === 'graphite-sections') {
        const { sections, defaultRepos, viewerLogin } = message;
        banner.textContent = `CarbonLayer: copied ${sections.length} ${sections.length === 1 ? 'section' : 'sections'}, you can close this tab.`;
        void browser.runtime.sendMessage({ kind: 'carbonlayer-graphite-sections', sections, defaultRepos, viewerLogin });
      } else if (message.kind === 'graphite-sections-error') {
        banner.textContent = `CarbonLayer: ${message.error}`;
        void browser.runtime.sendMessage({ kind: 'carbonlayer-graphite-sections-error', error: message.error });
      }
    });
    // The page-world script is listening by now: both load at document_idle, and the background has answered since.
    window.postMessage({ source: 'carbonlayer', kind: 'graphite-sections-request' }, location.origin);
  },
});

/** A message the extension's scripts posted on the page. */
const postedByCarbonLayer = z.object({ source: z.literal('carbonlayer') });

/**
 * What the page-world script (entrypoints/graphite-sections.content.ts) posts, and this script's own request, which it
 * hears too.
 */
const fromPageWorld = z.discriminatedUnion('kind', [
  z.extend(graphiteInboxSnapshot, { source: z.literal('carbonlayer'), kind: z.literal('graphite-sections') }),
  z.object({ source: z.literal('carbonlayer'), kind: z.literal('graphite-sections-error'), error: z.string() }),
  z.object({ source: z.literal('carbonlayer'), kind: z.literal('graphite-sections-request') }),
]);
