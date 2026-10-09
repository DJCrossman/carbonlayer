// Content script on github.com: recognises the inbox and PR routes, hides GitHub's page content below its header,
// shows app.html there in an iframe, and bridges theme, keystrokes, titles and navigation (src/app/bridge.ts). It also
// answers the app's data requests (src/lib/rpc.ts) with the user's github.com session. `?gh=1` or a disabled setting
// leaves GitHub untouched.
import { browser } from 'wxt/browser';
import type { ContentScriptContext } from 'wxt/utils/content-script-context';
import { createIframeUi } from 'wxt/utils/content-script-ui/iframe';
import { defineContentScript } from 'wxt/utils/define-content-script';
import { isBridgeMessage, type AppToParentMessage, type ParentToAppMessage } from '../src/app/bridge';
import { parseGitHubLocation, toAppHash, type AppRoute } from '../src/app/routes';
import { handleRpc } from '../src/lib/github-web';
import { isRpcRequest, type RpcResponse } from '../src/lib/rpc';
import { getSettings, watchSettings } from '../src/lib/settings';

export default defineContentScript({
  matches: ['https://github.com/*'],
  // Before GitHub's page is parsed, so a handled route never shows GitHub's own content first.
  runAt: 'document_start',
  async main(ctx) {
    let settings = await getSettings();
    let takeover: ReturnType<typeof takeOverPage> | null = null;

    // WXT reports navigations through the Navigation API before they commit, and none to the URL already shown, so
    // the destination comes from the event; settings changes use the committed location.
    const sync = (url: URL) => {
      if (takeover?.leavingFor === url.href) return;
      const route = parseGitHubLocation(url);
      const enabled = (route.page === 'inbox' && settings.inboxEnabled) || (route.page === 'pr' && settings.prEnabled);
      if (!enabled) {
        takeover?.release();
        takeover = null;
      } else if (takeover) {
        takeover.show(route);
      } else {
        takeover = takeOverPage(ctx, route);
      }
    };

    sync(new URL(location.href));
    ctx.addEventListener(window, 'wxt:locationchange', (event) => sync(event.newUrl));
    const unwatchSettings = watchSettings((next) => {
      settings = next;
      sync(new URL(location.href));
    });
    ctx.onInvalidated(() => {
      unwatchSettings();
      takeover?.release();
      takeover = null;
    });
  },
});

/** Hides GitHub's content below its header and shows the app there, until `release()` puts the page back as it was. */
function takeOverPage(ctx: ContentScriptContext, initialRoute: AppRoute) {
  const appOrigin = new URL(browser.runtime.getURL('/')).origin;
  const html = document.documentElement;
  // A style sheet rather than inline styles on GitHub's elements: it hides `main` before the parser reaches it and
  // whatever `main` a Turbo visit brings. Like the app's wrapper below, it sits on <html>, outside the <head> and
  // <body> Turbo replaces.
  const hideGitHub = document.createElement('style');
  hideGitHub.textContent = 'main { display: none !important; } html { overflow: hidden !important; }';
  html.append(hideGitHub);
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
    // On <html> next to <body>, not in it: a Turbo visit swaps <body> and would take the app with it.
    anchor: 'html',
    append: 'last',
    onBeforeMount(wrapper, iframe) {
      // Below GitHub's own menus and dialogs (z-index 100+), above everything else on the page; hidden until it can
      // sit below GitHub's header.
      wrapper.style.cssText = 'position: fixed; left: 0; right: 0; bottom: 0; z-index: 30; visibility: hidden;';
      iframe.style.cssText = 'display: block; width: 100%; height: 100%; border: 0; background: var(--bgColor-default, #fff);';
      iframe.title = 'Pull requests';
      iframe.allow = 'clipboard-write';
      iframe.src = browser.runtime.getURL(`/app.html${appHash}`);
    },
  });
  ui.mount();

  // GitHub's header is parsed after this runs at document_start, and replaced with <body> on Turbo visits.
  let header: HTMLElement | null = null;
  const placeBelowHeader = () => {
    ui.wrapper.style.top = `${Math.max(0, header?.getBoundingClientRect().bottom ?? 0)}px`;
    ui.wrapper.style.visibility = 'visible';
  };
  const headerResizes = new ResizeObserver(placeBelowHeader);
  const findHeader = () => {
    const found = document.querySelector<HTMLElement>('header.AppHeader, .AppHeader, header[role="banner"]');
    if (found !== header) {
      if (header) headerResizes.unobserve(header);
      header = found;
      // Observing calls placeBelowHeader once.
      if (header) headerResizes.observe(header);
    }
    // A page without a header gets the app at the top, once it is clear none is coming.
    if (!header && document.readyState !== 'loading') placeBelowHeader();
  };
  const pageChanges = new MutationObserver(findHeader);
  pageChanges.observe(html, { childList: true, subtree: document.readyState === 'loading' });
  document.addEventListener(
    'DOMContentLoaded',
    () => {
      // Parsed: from now on only a new <body> brings a new header.
      pageChanges.disconnect();
      pageChanges.observe(html, { childList: true });
      findHeader();
    },
    { once: true, signal },
  );
  findHeader();
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
        // handleRpc answers every request, failures included.
        void handleRpc(event.data).then(post);
        return;
      }
      if (!isBridgeMessage<AppToParentMessage>(event.data)) return;
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
          takeover.leavingFor = url.href;
          location.assign(url.href);
          break;
        }
      }
    },
    { signal },
  );

  // Keys typed while the app has focus stay in its document and never reach this listener. These are keys typed on
  // GitHub's header or a stray focus on the page: the app gets them, and GitHub does not act on its hidden page.
  window.addEventListener(
    'keydown',
    (event) => {
      if (event.isComposing || document.activeElement === ui.iframe) return;
      // The innermost target: GitHub's custom elements keep their text fields in shadow roots.
      const target = event.composedPath()[0];
      if (target instanceof HTMLElement && (target.isContentEditable || target.matches('input, textarea, select'))) return;
      // Enter and Space on a focused link or button belong to that control.
      if ((event.key === 'Enter' || event.key === ' ') && target instanceof Element && target.closest('a[href], button, summary, [role="button"], [role="menuitem"]')) return;
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
    /** Moves the already-loaded app to another handled route, without reloading it. */
    show(route: AppRoute) {
      const hash = toAppHash(route);
      if (hash === appHash) return;
      appHash = hash;
      if (ready) post({ type: 'gg:route', hash });
    },
    release() {
      listeners.abort();
      pageChanges.disconnect();
      headerResizes.disconnect();
      themeChanges.disconnect();
      ui.remove();
      hideGitHub.remove();
    },
  };
  return takeover;
}

/** Keys the app binds, chord strokes included (inbox and PR page); GitHub keeps every other shortcut. */
const APP_KEYS = new Set(['j', 'k', 'o', 'enter', 'r', '?', 'n', 'p', 'f', 's', 'v', 'e', 'g', 'c', 'a', 'y', 'd', 'h']);
