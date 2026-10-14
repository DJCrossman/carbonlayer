// The app page. Lives in an iframe on github.com (see ARCHITECTURE.md) or standalone in the harness.
import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { browser } from 'wxt/browser';
import { GITHUB_ORIGIN, isBridgeMessage, postToParent, themeOpenedIn, type ParentToAppMessage } from '../../src/app/bridge';
import { createFixtureDataSource, createRpcDataSource, type DataSource } from '../../src/app/data-source';
import { PageQueries, type CacheOwner } from '../../src/app/query-cache';
import { parseAppHash, type AppRoute } from '../../src/app/routes';
import { InboxPage } from '../../src/inbox/InboxPage';
import type { Settings } from '../../src/lib/settings';
import { PrPage } from '../../src/pr/PrPage';
import '../../src/ui/tokens.css';

function App({ source }: { source: DataSource }) {
  const [route, setRoute] = useState<AppRoute>(() => parseAppHash(location.hash));
  // GitHub's own theme, sent by the parent page; null standalone (harness). Until the parent has said, and until the
  // options' theme is read, both are the theme the parent opened this frame in, which app-theme.ts has shown since the
  // first paint, so the first render keeps it rather than flashing the system's.
  const [githubTheme, setGithubTheme] = useState<'light' | 'dark' | null>(themeOpenedIn);
  const [themeSetting, setThemeSetting] = useState<Settings['theme']>(() => themeOpenedIn() ?? 'auto');
  // Whose cache the page restores: whoever the parent page says is signed in (gg:viewer), undefined until it has said.
  // Opened directly (the harness) nobody is and the cache stays in memory, unless a test asks for it to be kept on the
  // device (`&keep=<label>`), as the fixtures' viewer, under that label for a version.
  const [cacheOwner, setCacheOwner] = useState<CacheOwner | null | undefined>(() => {
    if (window.parent !== window) return undefined;
    const label = new URLSearchParams(location.search).get('keep');
    return label ? { version: label, login: 'octocat' } : null;
  });

  useEffect(() => {
    const onHashChange = () => setRoute(parseAppHash(location.hash));
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== GITHUB_ORIGIN || event.source !== window.parent || !isBridgeMessage<ParentToAppMessage>(event.data)) return;
      const message = event.data;
      if (message.type === 'gg:route') {
        history.replaceState(null, '', message.hash);
        setRoute(parseAppHash(message.hash));
      } else if (message.type === 'gg:theme') {
        setGithubTheme(message.theme);
      } else if (message.type === 'gg:viewer') {
        setCacheOwner(message.login ? { version: browser.runtime.getManifest().version, login: message.login } : null);
      } else if (message.type === 'gg:keydown') {
        // A key typed on GitHub's page while this document did not have focus, so its own listeners never saw it:
        // replay it once, on the document, where the page-level shortcut hooks listen.
        const { key, code, altKey, ctrlKey, metaKey, shiftKey } = message;
        document.dispatchEvent(new KeyboardEvent('keydown', { key, code, altKey, ctrlKey, metaKey, shiftKey, bubbles: true }));
      }
    };
    window.addEventListener('hashchange', onHashChange);
    window.addEventListener('message', onMessage);
    postToParent({ type: 'gg:ready' });
    return () => {
      window.removeEventListener('hashchange', onHashChange);
      window.removeEventListener('message', onMessage);
    };
  }, []);

  useEffect(() => {
    void source.getSettings().then((settings) => setThemeSetting(settings.theme), () => {});
    return source.watchSettings((settings) => setThemeSetting(settings.theme));
  }, [source]);

  useEffect(() => {
    // The options' Light or Dark wins; "Match GitHub" follows GitHub's theme, or the OS theme until it is known.
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => (document.documentElement.dataset.theme = themeSetting !== 'auto' ? themeSetting : (githubTheme ?? (media.matches ? 'dark' : 'light')));
    apply();
    media.addEventListener('change', apply);
    return () => media.removeEventListener('change', apply);
  }, [themeSetting, githubTheme]);

  if (cacheOwner === undefined) return null;
  return (
    <PageQueries owner={cacheOwner}>
      {route.page === 'inbox' ? (
        <InboxPage source={source} route={route} />
      ) : route.page === 'pr' ? (
        <PrPage source={source} route={route} />
      ) : (
        <p style={{ padding: 16 }}>Open github.com or a pull request.</p>
      )}
    </PageQueries>
  );
}

async function start() {
  const useFixtures = new URLSearchParams(location.search).get('fixtures') === '1';
  const source = useFixtures ? createFixtureDataSource((await import('../../src/fixtures')).fixtures) : createRpcDataSource();
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App source={source} />
    </StrictMode>,
  );
}

void start();
