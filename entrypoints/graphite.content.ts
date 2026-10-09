// Content script on app.graphite.com, for "Copy my sections from Graphite" (src/inbox/GraphiteImport.tsx). In the tab
// the background opened for that (entrypoints/background.ts knows which; every other Graphite tab is left alone), it
// asks entrypoints/graphite-sections.content.ts, which runs in the page's own JavaScript world where React's state is
// visible, for the sections Graphite's inbox holds, and hands them to the background, which stores them for the import
// dialog and closes the tab. A banner on the page says how it went.
import { browser } from 'wxt/browser';
import { defineContentScript } from 'wxt/utils/define-content-script';

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
      const { source, kind, sections, defaultRepos, error } = (event.data ?? {}) as {
        source?: unknown;
        kind?: unknown;
        sections?: unknown;
        defaultRepos?: unknown;
        error?: unknown;
      };
      if (source !== 'carbonlayer') return;
      if (
        kind === 'graphite-sections' &&
        Array.isArray(sections) &&
        sections.every((section: unknown) => typeof (section as { name?: unknown } | null)?.name === 'string') &&
        Array.isArray(defaultRepos)
      ) {
        banner.textContent = `CarbonLayer: copied ${sections.length} ${sections.length === 1 ? 'section' : 'sections'}, you can close this tab.`;
        void browser.runtime.sendMessage({ kind: 'carbonlayer-graphite-sections', sections, defaultRepos });
      } else if (kind === 'graphite-sections-error' && typeof error === 'string') {
        banner.textContent = `CarbonLayer: ${error}`;
        void browser.runtime.sendMessage({ kind: 'carbonlayer-graphite-sections-error', error });
      }
    });
    // The page-world script is listening by now: both load at document_idle, and the background has answered since.
    window.postMessage({ source: 'carbonlayer', kind: 'graphite-sections-request' }, location.origin);
  },
});
