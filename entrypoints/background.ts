// The background service worker, for "Copy my sections from Graphite" (src/inbox/GraphiteImport.tsx): it opens
// Graphite's inbox in a tab beside the one that asked, lets that tab's content script (entrypoints/graphite.content.ts)
// copy the sections, stores them where the import dialog looks (`graphiteImport` in storage.local), then closes the
// Graphite tab and returns to the one that asked. Which tab is copying lives in storage.session: the worker may stop
// while Graphite loads, and a browser restart should forget it.
import { browser } from 'wxt/browser';
import { defineBackground } from 'wxt/utils/define-background';

export default defineBackground(() => {
  browser.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
    const { kind, sections, defaultRepos, error } = (message ?? {}) as { kind?: unknown; sections?: unknown; defaultRepos?: unknown; error?: unknown };
    // The inbox's iframe and the options page are frames of a tab too.
    const tabId = sender.tab?.id;
    switch (kind) {
      case 'carbonlayer-open-graphite-import':
        void browser.tabs
          .create({ url: 'https://app.graphite.com/', openerTabId: tabId, windowId: sender.tab?.windowId })
          .then((tab) => browser.storage.session.set({ graphiteImportTab: { tabId: tab.id, openerTabId: tabId } }));
        return;
      case 'carbonlayer-graphite-import-wanted':
        // Every Graphite page asks as it loads; only the tab opened above copies, and only until it has.
        void copyingTab().then((copying) => sendResponse(tabId !== undefined && copying?.tabId === tabId));
        return true;
      case 'carbonlayer-graphite-sections':
        void copyingTab().then(async (copying) => {
          if (tabId === undefined || copying?.tabId !== tabId || !Array.isArray(sections) || !Array.isArray(defaultRepos)) return;
          await browser.storage.local.set({ graphiteImport: { at: new Date().toISOString(), sections, defaultRepos } });
          await browser.storage.session.remove('graphiteImportTab');
          // The tab that asked may have been closed meanwhile.
          if (copying.openerTabId !== undefined) await browser.tabs.update(copying.openerTabId, { active: true }).catch(() => {});
          await browser.tabs.remove(tabId);
        });
        return;
      case 'carbonlayer-graphite-sections-error':
        // The tab stays open and stays the one copying: once the user signs in there, Graphite loads again and so does
        // the copy.
        void copyingTab().then(async (copying) => {
          if (tabId === undefined || copying?.tabId !== tabId || typeof error !== 'string') return;
          await browser.storage.local.set({ graphiteImport: { at: new Date().toISOString(), error } });
        });
        return;
    }
  });
});

/** The Graphite tab copying sections for an import, and the tab that asked for them; none when no copy is under way. */
async function copyingTab(): Promise<{ tabId: number; openerTabId?: number } | undefined> {
  const { graphiteImportTab } = await browser.storage.session.get('graphiteImportTab');
  return graphiteImportTab as { tabId: number; openerTabId?: number } | undefined;
}
