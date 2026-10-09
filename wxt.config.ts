import { defineConfig } from 'wxt';

// See https://wxt.dev/api/config.html. The popup (entrypoints/popup) and options page
// (entrypoints/options, opened in a tab via its `manifest.open_in_tab` meta tag) are wired by WXT.
export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  manifest: {
    name: 'Graphite-style GitHub',
    description: 'Makes GitHub pull requests look and work like Graphite: a configurable inbox and a tidy, stack-aware PR page.',
    permissions: ['storage'],
    host_permissions: ['https://api.github.com/*'],
    action: { default_title: 'Graphite-style GitHub' },
    // The content script embeds app.html in an iframe on github.com.
    web_accessible_resources: [{ resources: ['app.html'], matches: ['https://github.com/*'] }],
  },
  // ES-module workers, in case the diff library's worker pool is used.
  vite: () => ({ worker: { format: 'es' } }),
});
