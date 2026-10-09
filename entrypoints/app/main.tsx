// The app page. Lives in an iframe on github.com (see ARCHITECTURE.md) or standalone in the harness.
import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { GITHUB_ORIGIN, isBridgeMessage, postToParent, type ParentToAppMessage } from '../../src/app/bridge';
import { createFixtureDataSource, createRpcDataSource, type DataSource } from '../../src/app/data-source';
import { parseAppHash, type AppRoute } from '../../src/app/routes';
import { InboxPage } from '../../src/inbox/InboxPage';
import type { Settings } from '../../src/lib/settings';
import { PrPage } from '../../src/pr/PrPage';
import '../../src/ui/tokens.css';

function App({ source }: { source: DataSource }) {
  const [route, setRoute] = useState<AppRoute>(() => parseAppHash(location.hash));
  // GitHub's own theme, sent by the parent page; null standalone (harness) and until the parent has said.
  const [githubTheme, setGithubTheme] = useState<'light' | 'dark' | null>(null);
  const [themeSetting, setThemeSetting] = useState<Settings['theme']>('auto');

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

  switch (route.page) {
    case 'inbox':
      return <InboxPage source={source} route={route} />;
    case 'pr':
      return <PrPage source={source} route={route} />;
    case 'none':
      return <p style={{ padding: 16 }}>Open github.com/pulls or a pull request.</p>;
  }
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
