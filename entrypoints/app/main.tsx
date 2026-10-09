// The app page. Lives in an iframe on github.com (see ARCHITECTURE.md) or standalone in the harness.
import { StrictMode, useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { GITHUB_ORIGIN, isParentToAppMessage, postToParent, type ParentToAppMessage } from '../../src/app/bridge';
import { createFixtureDataSource, createRpcDataSource, type DataSource } from '../../src/app/data-source';
import { parseAppHash, type AppRoute } from '../../src/app/routes';
import { InboxPage } from '../../src/inbox/InboxPage';
import { PrPage } from '../../src/pr/PrPage';
import '../../src/ui/tokens.css';

function App({ source }: { source: DataSource }) {
  const [route, setRoute] = useState<AppRoute>(() => parseAppHash(location.hash));
  const [keydown, setKeydown] = useState<Extract<ParentToAppMessage, { type: 'gg:keydown' }> | null>(null);

  useEffect(() => {
    const onHashChange = () => setRoute(parseAppHash(location.hash));
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== GITHUB_ORIGIN || !isParentToAppMessage(event.data)) return;
      const message = event.data;
      if (message.type === 'gg:route') {
        history.replaceState(null, '', message.hash);
        setRoute(parseAppHash(message.hash));
      } else if (message.type === 'gg:theme') {
        document.documentElement.dataset.theme = message.theme;
      } else if (message.type === 'gg:keydown') {
        // Replay the parent's keystroke as a synthetic event so page-level shortcut hooks see it.
        setKeydown(message);
        document.dispatchEvent(new KeyboardEvent('keydown', { ...message, bubbles: true }));
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

  void keydown;
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
