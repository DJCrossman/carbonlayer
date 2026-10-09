import { defineConfig } from 'wxt';

// See https://wxt.dev/api/config.html. The popup (entrypoints/popup) and options page
// (entrypoints/options, opened in a tab via its `manifest.open_in_tab` meta tag) are wired by WXT.
export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  manifest: {
    name: 'CarbonLayer – Graphite UI for GitHub',
    short_name: 'CarbonLayer',
    description: 'We have Graphite at home: a Graphite-style inbox and pull request page on top of your GitHub session.',
    permissions: ['storage'],
    host_permissions: ['https://github.com/*'],
    action: { default_title: 'CarbonLayer' },
    // The content script embeds app.html in an iframe on github.com.
    web_accessible_resources: [{ resources: ['app.html'], matches: ['https://github.com/*'] }],
  },
  // ES-module workers, in case the diff library's worker pool is used.
  vite: () => ({ worker: { format: 'es' } }),
});
