// Content script on github.com: recognises the inbox and PR routes, hides GitHub's page content below its header,
// shows app.html there in an iframe, and bridges theme, keystrokes, titles and navigation (src/app/bridge.ts). It also
// answers the app's data requests (src/lib/rpc.ts) with the user's github.com session. `?gh=1` or a disabled setting
// leaves GitHub untouched.
import { browser } from 'wxt/browser';
import type { ContentScriptContext } from 'wxt/utils/content-script-context';
import { createIframeUi } from 'wxt/utils/content-script-ui/iframe';
import { defineContentScript } from 'wxt/utils/define-content-script';
import { isAppToParentMessage, type ParentToAppMessage } from '../src/app/bridge';
import { parseGitHubLocation, toAppHash, type AppRoute } from '../src/app/routes';
import { handleRpc } from '../src/lib/github-web';
import { isRpcRequest, type RpcResponse } from '../src/lib/rpc';
import { getSettings, watchSettings } from '../src/lib/settings';

export default defineContentScript({
  matches: ['https://github.com/*'],
  runAt: 'document_idle',
  async main(ctx) {
    let settings = await getSettings();
    let takeover: ReturnType<typeof takeOverPage> | null = null;

    // WXT reports navigations through the Navigation API before they commit, so the destination comes from the event;
    // settings changes and body swaps use the committed location.
    const sync = (url: URL) => {
      if (takeover?.leavingFor === url.href) return;
      const route = parseGitHubLocation(url);
      const enabled = (route.page === 'inbox' && settings.inboxEnabled) || (route.page === 'pr' && settings.prEnabled);
      if (takeover && (!enabled || !takeover.isIntact())) {
        takeover.release();
        takeover = null;
      }
      if (!enabled) return;
      if (takeover) takeover.show(route);
      else takeover = takeOverPage(ctx, route);
    };

    sync(new URL(location.href));
    ctx.addEventListener(window, 'wxt:locationchange', (event) => sync(event.newUrl));
    const unwatchSettings = watchSettings((next) => {
      settings = next;
      sync(new URL(location.href));
    });
    // Turbo swaps <body> on some navigations, taking the iframe with it and bringing GitHub's content back.
    const bodySwaps = new MutationObserver(() => {
      if (takeover && !takeover.isIntact()) sync(new URL(location.href));
    });
    bodySwaps.observe(document.documentElement, { childList: true });
    ctx.onInvalidated(() => {
      unwatchSettings();
      bodySwaps.disconnect();
      takeover?.release();
      takeover = null;
    });
  },
});

/** Hides GitHub's content below its header and shows the app there, until `release()` puts the page back as it was. */
function takeOverPage(ctx: ContentScriptContext, initialRoute: AppRoute) {
  const appOrigin = new URL(browser.runtime.getURL('/')).origin;
  const html = document.documentElement;
  const main = document.querySelector<HTMLElement>('main') ?? document.querySelector<HTMLElement>('.application-main');
  const header = document.querySelector<HTMLElement>('header.AppHeader, .AppHeader, header[role="banner"]');
  const restore = { mainDisplay: main?.style.display ?? '', htmlOverflow: html.style.overflow };
  if (main) main.style.display = 'none';
  html.style.overflow = 'hidden';
  window.scrollTo(0, 0);

  // The hash the app shows, or will show once it has loaded and said gg:ready.
  let appHash = toAppHash(initialRoute);
  const loadedHash = appHash;
  let ready = false;
  const listeners = new AbortController();
  const signal = listeners.signal;

  const ui = createIframeUi(ctx, {
    page: '/app.html',
    position: 'inline',
    anchor: 'body',
    append: 'last',
    onBeforeMount(wrapper, iframe) {
      // Below GitHub's own menus and dialogs (z-index 100+), above everything else on the page.
      wrapper.style.cssText = 'position: fixed; left: 0; right: 0; bottom: 0; z-index: 30;';
      iframe.style.cssText = 'display: block; width: 100%; height: 100%; border: 0; background: var(--bgColor-default, #fff);';
      iframe.title = 'Pull requests';
      iframe.allow = 'clipboard-write';
      iframe.src = browser.runtime.getURL(`/app.html${appHash}`);
    },
  });
  ui.mount();

  const placeBelowHeader = () => {
    ui.wrapper.style.top = `${Math.max(0, header?.getBoundingClientRect().bottom ?? 0)}px`;
  };
  placeBelowHeader();
  const headerResizes = new ResizeObserver(placeBelowHeader);
  if (header) headerResizes.observe(header);
  window.addEventListener('resize', placeBelowHeader, { signal });

  const post = (message: ParentToAppMessage | RpcResponse) => ui.iframe.contentWindow?.postMessage(message, appOrigin);
  const systemTheme = matchMedia('(prefers-color-scheme: dark)');
  const postTheme = () => {
    const mode = html.dataset.colorMode;
    post({ type: 'gg:theme', theme: mode === 'light' || mode === 'dark' ? mode : systemTheme.matches ? 'dark' : 'light' });
  };
  const themeChanges = new MutationObserver(() => ready && postTheme());
  themeChanges.observe(html, { attributes: true, attributeFilter: ['data-color-mode'] });
  systemTheme.addEventListener('change', () => ready && postTheme(), { signal });

  ui.iframe.addEventListener(
    'load',
    () => {
      // Take focus so the app's shortcuts work at once, unless the user is already typing somewhere.
      const active = document.activeElement;
      if (!(active instanceof HTMLElement && (active.isContentEditable || active.matches('input, textarea, select')))) ui.iframe.focus();
    },
    { once: true, signal },
  );

  window.addEventListener(
    'message',
    (event) => {
      if (event.origin !== appOrigin || event.source !== ui.iframe.contentWindow) return;
      if (isRpcRequest(event.data)) {
        // Data requests run here, not in the app: only a github.com document can fetch with the user's session.
        const { id } = event.data;
        handleRpc(event.data).then(post, (error: unknown) =>
          post({ kind: 'gg-rpc-result', id, ok: false, error: error instanceof Error ? error.message : String(error) }),
        );
        return;
      }
      if (!isAppToParentMessage(event.data)) return;
      const message = event.data;
      switch (message.type) {
        case 'gg:ready':
          ready = true;
          postTheme();
          if (appHash !== loadedHash) post({ type: 'gg:route', hash: appHash });
          break;
        case 'gg:navigate': {
          const url = new URL(message.url, location.href);
          if (url.protocol !== 'https:' && url.protocol !== 'http:') return;
          if (message.newTab) {
            window.open(url.href, '_blank', 'noopener');
          } else {
            takeover.leavingFor = url.href;
            location.assign(url.href);
          }
          break;
        }
        case 'gg:replace-url': {
          const url = new URL(message.url, location.href);
          if (url.origin !== location.origin) return;
          // The app already shows this route; remember it so the navigation event it causes is not echoed back.
          appHash = toAppHash(parseGitHubLocation(url));
          // Keep history.state: Turbo stores its restoration id there and needs it for back/forward.
          history.replaceState(history.state, '', url.href);
          break;
        }
        case 'gg:title':
          document.title = message.title;
          break;
        case 'gg:open-native': {
          const url = new URL(location.href);
          url.searchParams.set('gh', '1');
          location.assign(url.href);
          break;
        }
      }
    },
    { signal },
  );

  window.addEventListener(
    'keydown',
    (event) => {
      if (document.activeElement === ui.iframe) return;
      const target = event.target;
      if (target instanceof HTMLElement && (target.isContentEditable || target.matches('input, textarea, select'))) return;
      if (document.querySelector('dialog[open], [aria-modal="true"]')) return;
      post({
        type: 'gg:keydown',
        key: event.key,
        code: event.code,
        altKey: event.altKey,
        ctrlKey: event.ctrlKey,
        metaKey: event.metaKey,
        shiftKey: event.shiftKey,
      });
      const ownedByApp =
        ((event.metaKey || event.ctrlKey) && event.shiftKey && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) ||
        (!event.metaKey && !event.ctrlKey && !event.altKey && APP_KEYS.has(event.key.toLowerCase()));
      if (!ownedByApp) return;
      // GitHub binds several of these keys too, and they would act on the hidden page.
      event.preventDefault();
      event.stopPropagation();
    },
    { capture: true, signal },
  );

  const takeover = {
    /** Where a same-tab navigation the app asked for is heading while this document unloads; not worth tearing down for. */
    leavingFor: null as string | null,
    /** False once GitHub re-rendered underneath (Turbo body swap): the iframe or the hidden content is gone. */
    isIntact: () => ui.wrapper.isConnected && (main === null || main.isConnected),
    /** Moves the already-loaded app to another handled route, without reloading it. */
    show(route: AppRoute) {
      const hash = toAppHash(route);
      if (hash === appHash) return;
      appHash = hash;
      if (ready) post({ type: 'gg:route', hash });
    },
    release() {
      listeners.abort();
      headerResizes.disconnect();
      themeChanges.disconnect();
      ui.remove();
      if (main) main.style.display = restore.mainDisplay;
      html.style.overflow = restore.htmlOverflow;
    },
  };
  return takeover;
}

/** Keys the app binds (inbox and PR page); GitHub keeps every other shortcut. */
const APP_KEYS = new Set(['j', 'k', 'o', 'enter', 'r', '?', 'n', 'p', 'f', 's', 'v', 'e', 'g', 'c', 'a']);
