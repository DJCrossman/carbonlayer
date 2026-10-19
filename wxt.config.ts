import { defineConfig } from 'wxt';

// See https://wxt.dev/api/config.html. The popup (entrypoints/popup) and options page
// (entrypoints/options, opened in a tab via its `manifest.open_in_tab` meta tag) are wired by WXT.
export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  manifest: {
    name: 'CarbonLayer – Graphite UI for GitHub',
    short_name: 'CarbonLayer',
    description: 'We have Graphite at home: a Graphite-style inbox and pull request page on top of your GitHub session.',
    // Alarms move a stack merge on in the background every 30 s (entrypoints/background.ts).
    permissions: ['storage', 'alarms'],
    host_permissions: ['https://github.com/*'],
    action: { default_title: 'CarbonLayer' },
    // The content script embeds app.html in an iframe on github.com.
    web_accessible_resources: [{ resources: ['app.html'], matches: ['https://github.com/*'] }],
  },
  // ES-module workers, in case the diff library's worker pool is used. Every build has an id of its own, under which the
  // app keeps its cache on the device (src/app/query-cache.tsx): no build restores what another one kept.
  vite: () => ({ worker: { format: 'es' }, define: { 'import.meta.env.BUILD_ID': JSON.stringify(BUILD_ID) } }),
});

/** This build: the time it was made. */
const BUILD_ID = new Date().toISOString();
