// The app page. Lives in an iframe on github.com (see ARCHITECTURE.md) or standalone in the harness.
// First: zod's messages (src/lib/zod-messages.ts).
import '../../src/lib/zod-messages';
import { Component, StrictMode, useEffect, useLayoutEffect, useState, type ErrorInfo, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { browser } from 'wxt/browser';
import { GITHUB_ORIGIN, parentToAppMessage, postToParent } from '../../src/app/bridge';
import { createFixtureDataSource, createRpcDataSource, type DataSource } from '../../src/app/data-source';
import { themeOpenedIn } from '../../src/app/frame-theme';
import { forgetKeptCache, PageQueries, type CacheOwner } from '../../src/app/query-cache';
import { parseAppHash } from '../../src/app/routes';
import { InboxPage } from '../../src/inbox/InboxPage';
import type { Settings } from '../../src/lib/settings';
import { PrPage } from '../../src/pr/PrPage';
import { Button } from '../../src/ui/Button';
import '../../src/ui/tokens.css';

function App({ source }: { source: DataSource }) {
  const [route, setRoute] = useState(() => parseAppHash(location.hash));
  // GitHub's own theme, sent by the parent page; null standalone (harness). Until the parent has said, and until the
  // options' theme is read, both are the theme the parent opened this frame in, which app-theme.ts has shown since the
  // first paint, so the first render keeps it rather than flashing the system's.
  const [githubTheme, setGithubTheme] = useState<'light' | 'dark' | null>(themeOpenedIn);
  const [themeSetting, setThemeSetting] = useState<Settings['theme']>(() => themeOpenedIn() ?? 'auto');
  // Whose cache the page restores: whoever the parent page says is signed in (gg:viewer), undefined until it has said, for
  // two seconds at most (below). Opened directly (the harness) nobody is and the cache stays in memory, unless a test asks
  // for it to be kept on the device (`&keep=<label>`), as the fixtures' viewer, under that label for a version.
  const [cacheOwner, setCacheOwner] = useState<CacheOwner | null | undefined>(() => {
    if (window.parent !== window) return undefined;
    const label = new URLSearchParams(location.search).get('keep');
    return label ? { version: label, login: 'octocat' } : null;
  });

  useEffect(() => {
    const onHashChange = () => setRoute(parseAppHash(location.hash));
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== GITHUB_ORIGIN || event.source !== window.parent) return;
      // GitHub's own page posts to this frame too, and so do the content script's data answers (src/lib/rpc.ts).
      const parsed = parentToAppMessage.safeParse(event.data);
      if (!parsed.success) return;
      const message = parsed.data;
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

  // A parent page that has not said who is signed in within two seconds gets the page with a cache in memory only, rather
  // than a blank frame.
  useEffect(() => {
    if (cacheOwner !== undefined) return;
    const timer = setTimeout(() => {
      console.warn('[gg]', 'github.com has not said who is signed in; this page keeps its cache in memory only');
      setCacheOwner(null);
    }, 2000);
    return () => clearTimeout(timer);
  }, [cacheOwner]);

  // Another page, or another PR, opens at its top: a move inside the app (gg:route) keeps this document and its scroll.
  const shownPage = route.page === 'pr' ? `${route.repo.owner}/${route.repo.name}#${route.number}` : route.page;
  useLayoutEffect(() => window.scrollTo(0, 0), [shownPage]);

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
      {/* Another page starts without the last one's error. */}
      <PageErrorBoundary key={shownPage}>
        {route.page === 'inbox' ? (
          <InboxPage source={source} route={route} />
        ) : route.page === 'pr' ? (
          <PrPage source={source} route={route} />
        ) : (
          <p style={{ padding: 16 }}>Open github.com or a pull request.</p>
        )}
      </PageErrorBoundary>
    </PageQueries>
  );
}

/**
 * A page that fails to render says so, with a Reload, rather than leave the frame blank. What the device kept is the
 * likeliest cause (written by another build, or not as this one reads it), so it is forgotten and the reload asks GitHub
 * for everything.
 */
class PageErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null; componentStack: string; copied: 'idle' | 'copied' | 'failed' }> {
  override state: { error: Error | null; componentStack: string; copied: 'idle' | 'copied' | 'failed' } = { error: null, componentStack: '', copied: 'idle' };

  static getDerivedStateFromError(error: unknown): { error: Error } {
    return { error: error instanceof Error ? error : new Error(String(error)) };
  }

  override componentDidCatch(error: unknown, info: ErrorInfo): void {
    console.error('[gg]', 'The page could not be shown; forgetting what the device kept.', error, info.componentStack);
    this.setState({ componentStack: info.componentStack ?? '' });
    void forgetKeptCache();
  }

  override render(): ReactNode {
    const { error, componentStack, copied } = this.state;
    if (!error) return this.props.children;
    return (
      <div role="alert" style={{ maxWidth: 640, margin: '48px auto', padding: 16, border: '1px solid var(--gg-danger)', borderRadius: 'var(--gg-radius)', background: 'var(--gg-danger-bg)' }}>
        <strong>This page could not be shown</strong>
        <p style={{ margin: '4px 0 12px', color: 'var(--gg-fg-muted)', overflowWrap: 'anywhere' }}>{error.message}</p>
        <div style={{ display: 'flex', gap: 8 }}>
          <Button variant="primary" onClick={() => location.reload()}>
            Reload
          </Button>
          {/* Everything a bug report needs, in one paste: which build, which page, the error and where it was thrown. The
              page's own toasts went with the page, so the button says how it went. */}
          <Button
            onClick={() => {
              const details = [
                `CarbonLayer ${browser.runtime.getManifest().version}, build ${import.meta.env.BUILD_ID}`,
                `Page: ${location.hash}`,
                error.stack ?? `${error.name}: ${error.message}`,
                componentStack && `Component stack:${componentStack}`,
              ]
                .filter(Boolean)
                .join('\n');
              navigator.clipboard.writeText(details).then(
                () => this.setState({ copied: 'copied' }),
                () => this.setState({ copied: 'failed' }),
              );
            }}
          >
            {copied === 'copied' ? 'Copied' : copied === 'failed' ? 'Could not copy' : 'Copy details'}
          </Button>
          {/* GitHub's own page for this URL, for this visit, as the header's switch would show it. */}
          {window.parent !== window && <Button onClick={() => postToParent({ type: 'gg:open-native' })}>Switch to GitHub</Button>}
        </div>
      </div>
    );
  }
}

async function start() {
  const useFixtures = new URLSearchParams(location.search).get('fixtures') === '1';
  const source = useFixtures ? createFixtureDataSource((await import('../../src/fixtures')).fixtures) : createRpcDataSource();
  const root = document.getElementById('root');
  if (!root) throw new Error('app.html has no #root to render into');
  createRoot(root).render(
    <StrictMode>
      <App source={source} />
    </StrictMode>,
  );
}

void start();
