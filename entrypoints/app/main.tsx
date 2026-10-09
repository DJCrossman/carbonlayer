// The app page. Lives in an iframe on github.com (see ARCHITECTURE.md) or standalone in the harness.
import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { GITHUB_ORIGIN, isBridgeMessage, postToParent, type ParentToAppMessage } from '../../src/app/bridge';
import { createFixtureDataSource, createRpcDataSource, type DataSource } from '../../src/app/data-source';
import { parseAppHash, type AppRoute } from '../../src/app/routes';
import { InboxPage } from '../../src/inbox/InboxPage';
import { PrPage } from '../../src/pr/PrPage';
import '../../src/ui/tokens.css';

function App({ source }: { source: DataSource }) {
  const [route, setRoute] = useState<AppRoute>(() => parseAppHash(location.hash));

  useEffect(() => {
    const onHashChange = () => setRoute(parseAppHash(location.hash));
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== GITHUB_ORIGIN || event.source !== window.parent || !isBridgeMessage<ParentToAppMessage>(event.data)) return;
      const message = event.data;
      if (message.type === 'gg:route') {
        history.replaceState(null, '', message.hash);
        setRoute(parseAppHash(message.hash));
      } else if (message.type === 'gg:theme') {
        document.documentElement.dataset.theme = message.theme;
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
    // Standalone (harness) only: follow the OS theme. Inside github.com the parent sends gg:theme.
    if (window.parent !== window) return;
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => (document.documentElement.dataset.theme = media.matches ? 'dark' : 'light');
    apply();
    media.addEventListener('change', apply);
    return () => media.removeEventListener('change', apply);
  }, []);

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
