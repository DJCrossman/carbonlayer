// Content script on github.com: recognises the inbox (the homepage, signed in) and PR routes, hides GitHub's page
// content below its header, shows app.html there in an iframe, and bridges theme, keystrokes, titles and navigation
// (src/app/bridge.ts): a move to another page the app shows stays in the app, the address bar and history following it.
// It also answers the app's data requests (src/lib/rpc.ts) with the user's github.com session, and the background's, for
// the stack merges it runs (src/lib/stack-merges.ts).
// `?gh=1` leaves GitHub untouched for one visit. On every handled route it adds a "GitHub | CarbonLayer" switch to
// GitHub's header, which saves the surface's setting; while that is off, GitHub's page stays untouched.
// First: zod's messages (src/lib/zod-messages.ts).
import '../src/lib/zod-messages';
import { browser } from 'wxt/browser';
import type { ContentScriptContext } from 'wxt/utils/content-script-context';
import { createIframeUi } from 'wxt/utils/content-script-ui/iframe';
import { defineContentScript } from 'wxt/utils/define-content-script';
import { z } from 'zod/mini';
import { appToParentMessage, type ParentToAppMessage } from '../src/app/bridge';
import { parseGitHubLocation, routeInApp, toAppHash, type AppRoute } from '../src/app/routes';
import { handleRpc } from '../src/lib/github-web';
import { readRpcRequest, rpcRequestSchema, type RpcResponse } from '../src/lib/rpc';
import { getSettings, setSettings, watchSettings, type Settings } from '../src/lib/settings';

export default defineContentScript({
  matches: ['https://github.com/*'],
  // Before GitHub's page is parsed, so a handled route never shows GitHub's own content first.
  runAt: 'document_start',
  async main(ctx) {
    // The entries this tab's history gained from moves inside the app (moveInApp), by key. Below the app, GitHub's page is
    // still the one it showed before such a move. Going Back or Forward to one is the app's alone: GitHub's scripts made
    // no such entry (Turbo restores only an entry carrying its own state), and its React router would otherwise take its
    // hidden page there. Registered before GitHub's scripts run, so it hears the event first.
    const movedInApp = new Set<string>();
    ctx.addEventListener(
      window,
      'popstate',
      (event) => {
        if (movedInApp.has(window.navigation?.currentEntry?.key ?? '')) event.stopImmediatePropagation();
      },
      { capture: true },
    );
    let settings = await getSettings();
    let takeover: ReturnType<typeof takeOverPage> | null = null;
    let pageViewSwitch: ReturnType<typeof addPageViewSwitch> | null = null;
    let awaitingSignIn: MutationObserver | null = null;

    // Which page a surface shows in this tab: what its switch was last set to here, for as long as the tab lives, else the
    // saved default. The switch changes this tab at once and saves the choice as the default for tabs opened later; other
    // open tabs keep their page until they load again, so flipping one tab never flips the rest.
    const enabledHere = (surface: 'inboxEnabled' | 'prEnabled') => {
      const here = sessionStorage.getItem(`gg:${surface}`);
      return here === null ? settings[surface] : here === 'on';
    };
    const choosePage = (surface: 'inboxEnabled' | 'prEnabled', showOurs: boolean) => {
      sessionStorage.setItem(`gg:${surface}`, showOurs ? 'on' : 'off');
      settings = { ...settings, [surface]: showOurs };
      const saving = setSettings({ [surface]: showOurs }).catch((error: unknown) => console.error('[gg]', 'Could not save the page view:', error instanceof Error ? error.message : error));
      // After a move inside the app, GitHub's page below it is another URL's: GitHub's view of this one loads afresh.
      if (!showOurs && takeover && movedInApp.has(window.navigation?.currentEntry?.key ?? '')) {
        takeover.leavingFor = location.href;
        void saving.finally(() => location.reload());
        return;
      }
      sync(new URL(location.href));
    };
    // Whether this tab shows CarbonLayer's page for a route rather than GitHub's.
    const showsOurs = (route: AppRoute) => (route.page === 'inbox' && enabledHere('inboxEnabled')) || (route.page === 'pr' && enabledHere('prEnabled'));
    /**
     * Moves this tab to `url` inside the app, without loading a page, when the app shows that page here: the address bar
     * and history follow (`pushState`), GitHub's page below stays as it was. False for any other page, which loads.
     */
    const moveInApp = (url: URL) => {
      const signedIn = Boolean(document.querySelector('meta[name="user-login"]')?.getAttribute('content'));
      if (!routeInApp(url, { showsOurs, signedIn })) return false;
      if (url.href !== location.href) {
        history.pushState(null, '', url.href);
        const entry = window.navigation?.currentEntry;
        if (entry) movedInApp.add(entry.key);
      }
      sync(url);
      return true;
    };

    // Navigations are reported before they commit (below), so the destination comes from the event; settings changes and
    // moves inside the app use the committed location.
    const sync = (url: URL) => {
      if (takeover?.leavingFor === url.href) return;
      let route = parseGitHubLocation(url);
      if (route.page === 'inbox') {
        // Signed out, the homepage is GitHub's marketing page, which stays GitHub's. <meta name="user-login"> in <head>
        // names who is signed in, empty for no one; at document_start the parser has not reached it yet, so the
        // homepage waits for it (or for <body>, which means it is not coming) before hiding or mounting anything.
        const login = document.querySelector('meta[name="user-login"]')?.getAttribute('content');
        if (login === undefined && !document.body) {
          if (!awaitingSignIn) {
            awaitingSignIn = new MutationObserver(() => {
              if (!document.querySelector('meta[name="user-login"]') && !document.body) return;
              awaitingSignIn?.disconnect();
              awaitingSignIn = null;
              sync(new URL(location.href));
            });
            awaitingSignIn.observe(document.documentElement, { childList: true, subtree: true });
          }
          return;
        }
        if (!login) route = { page: 'none' };
      }
      const enabled = showsOurs(route);
      if (!enabled) {
        takeover?.release();
        takeover = null;
      } else if (takeover) {
        takeover.show(route);
      } else {
        takeover = takeOverPage(ctx, route, settings.theme, moveInApp);
      }
      // The way between GitHub's page and ours, on every handled route.
      if (route.page === 'none') {
        pageViewSwitch?.remove();
        pageViewSwitch = null;
      } else {
        pageViewSwitch ??= addPageViewSwitch(choosePage);
        pageViewSwitch.show(route.page === 'inbox' ? 'inboxEnabled' : 'prEnabled', enabled);
      }
    };

    sync(new URL(location.href));
    // GitHub's own moves (Turbo and React visits), Back and Forward, and the app's: the route follows, before the move
    // commits. A move to another document is that document's to show: this one keeps its route while it unloads, and
    // should it come back from the back/forward cache.
    if (window.navigation) {
      ctx.addEventListener(window.navigation, 'navigate', (event) => {
        if (event instanceof NavigateEvent && event.destination.sameDocument) sync(new URL(event.destination.url));
      });
    } else {
      ctx.addEventListener(window, 'wxt:locationchange', (event) => sync(event.newUrl));
    }
    const unwatchSettings = watchSettings((next) => {
      // A saved page choice is for tabs opened later: this tab keeps the page it shows (the popup reaches the tab in
      // view through `gg:choose` instead).
      settings = { ...next, inboxEnabled: settings.inboxEnabled, prEnabled: settings.prEnabled };
      sync(new URL(location.href));
    });
    // The popup's switches; this tab may hear other runtime messages.
    const onChoose = (message: unknown) => {
      const choice = chooseMessage.safeParse(message);
      if (choice.success) choosePage(choice.data.surface, choice.data.showOurs);
    };
    browser.runtime.onMessage.addListener(onChoose);
    // The background's stack merges (src/lib/stack-merges.ts) ask GitHub through a github.com tab with the requests the
    // app's frame makes, answered the same way, with this page's session.
    const onAsked = (message: unknown, _sender: unknown, sendResponse: (answer: RpcResponse) => void) => {
      const asked = rpcRequestSchema.safeParse(message);
      if (!asked.success) return;
      const { id } = asked.data;
      void Promise.resolve()
        .then(() => handleRpc(readRpcRequest(asked.data)))
        .catch((error: unknown): RpcResponse => ({ kind: 'gg-rpc-result', id, ok: false, error: error instanceof Error ? error.message : String(error) }))
        .then(sendResponse);
      return true;
    };
    browser.runtime.onMessage.addListener(onAsked);
    ctx.onInvalidated(() => {
      unwatchSettings();
      browser.runtime.onMessage.removeListener(onChoose);
      browser.runtime.onMessage.removeListener(onAsked);
      awaitingSignIn?.disconnect();
      takeover?.release();
      takeover = null;
      pageViewSwitch?.remove();
      pageViewSwitch = null;
    });
  },
});

/**
 * Hides GitHub's content below its header and shows the app there, until `release()` puts the page back as it was. A
 * page the app asks for moves the tab inside the app when `moveInApp` can, else loads.
 */
function takeOverPage(ctx: ContentScriptContext, initialRoute: AppRoute, themeSetting: Settings['theme'], moveInApp: (url: URL) => boolean) {
  const appOrigin = new URL(browser.runtime.getURL('/')).origin;
  const html = document.documentElement;
  // A style sheet rather than inline styles on GitHub's elements: it hides `main` before the parser reaches it and
  // whatever `main` a Turbo visit brings. Like the app's wrapper below, it sits on <html>, outside the <head> and
  // <body> Turbo replaces.
  // GitHub paints its whole page as one stacking context (`body > div { isolation: isolate }`), which would put the
  // app's frame over the header's menus and overlays as well; without the isolation they keep their own z-index (1000).
  const hideGitHub = document.createElement('style');
  hideGitHub.textContent = 'main { display: none !important; } html { overflow: hidden !important; } body > div { isolation: auto !important; }';
  html.append(hideGitHub);
  window.scrollTo(0, 0);

  // The hash the app shows, or will show once it has loaded and said gg:ready.
  let appHash = toAppHash(initialRoute);
  const loadedHash = appHash;
  let ready = false;
  const listeners = new AbortController();
  const signal = listeners.signal;
  // GitHub's theme: the one its <html> names, or the system's when it follows the system.
  const systemTheme = matchMedia('(prefers-color-scheme: dark)');
  const githubTheme = () => {
    const mode = html.dataset.colorMode;
    return mode === 'light' || mode === 'dark' ? mode : systemTheme.matches ? 'dark' : 'light';
  };

  const ui = createIframeUi(ctx, {
    page: '/app.html',
    position: 'inline',
    // On <html> next to <body>, not in it: a Turbo visit swaps <body> and would take the app with it.
    anchor: 'html',
    append: 'last',
    onBeforeMount(wrapper, iframe) {
      // Below GitHub's own menus and overlays (z-index 1000 once the page's isolation is lifted above), above everything
      // else on the page; hidden until it can sit below GitHub's header.
      wrapper.style.cssText = 'position: fixed; left: 0; right: 0; bottom: 0; z-index: 30; visibility: hidden;';
      iframe.style.cssText = 'display: block; width: 100%; height: 100%; border: 0; background: var(--bgColor-default, #fff);';
      iframe.title = 'Pull requests';
      iframe.allow = 'clipboard-write';
      // Opened in the theme the app will show, the options' or else GitHub's, which app.html puts on before its first
      // paint: until the app has heard it from this page, its frame would show the light default, white on GitHub's dark.
      iframe.src = browser.runtime.getURL(`/app.html?theme=${themeSetting === 'auto' ? githubTheme() : themeSetting}${appHash}`);
      // Inside a shadow root: on the signed-in homepage something strips the iframe out of the wrapper shortly after
      // it loads (page scripts and other extensions sweep `document.querySelectorAll('iframe')`); a shadow root is
      // outside their reach, and the guard below puts the frame back if anything still removes it.
      wrapper.attachShadow({ mode: 'open' }).append(iframe);
    },
  });
  ui.mount();
  const frameGuard = new MutationObserver(() => {
    if (!ui.wrapper.isConnected) html.append(ui.wrapper);
    if (!ui.iframe.isConnected) ui.wrapper.shadowRoot?.append(ui.iframe);
  });
  frameGuard.observe(html, { childList: true });
  const frameRoot = ui.wrapper.shadowRoot;
  if (!frameRoot) throw new Error("The app's frame has no shadow root to guard");
  frameGuard.observe(frameRoot, { childList: true });

  // GitHub's header is parsed after this runs at document_start, and replaced with <body> on Turbo visits.
  let header: Element | null = null;
  const placeBelowHeader = () => {
    ui.wrapper.style.top = `${Math.max(0, header?.getBoundingClientRect().bottom ?? 0)}px`;
    ui.wrapper.style.visibility = 'visible';
  };
  const headerResizes = new ResizeObserver(placeBelowHeader);
  const findHeader = () => {
    const found = document.querySelector(GITHUB_HEADER);
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
  const postTheme = () => post({ type: 'gg:theme', theme: githubTheme() });
  const themeChanges = new MutationObserver(() => ready && postTheme());
  themeChanges.observe(html, { attributes: true, attributeFilter: ['data-color-mode'] });
  systemTheme.addEventListener('change', () => ready && postTheme(), { signal });
  // Coming back to the window refreshes the app's page; the frame hears of it itself only when the focus lands inside it.
  window.addEventListener('focus', () => ready && post({ type: 'gg:focus' }), { signal });
  // Who is signed in, whose cache the app restores: <meta name="user-login"> in GitHub's <head>, empty for no one, once
  // the parser has reached it.
  const postViewer = () => {
    const meta = document.querySelector('meta[name="user-login"]');
    if (!meta && document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', postViewer, { once: true, signal });
      return;
    }
    post({ type: 'gg:viewer', login: meta?.getAttribute('content') || null });
  };

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
      // Only the app's frame gets here: what it posts is a data request or one of the bridge's messages.
      const data: unknown = event.data;
      const asked = rpcRequestSchema.safeParse(data);
      if (asked.success) {
        // Data requests run here, not in the app: only a github.com document can fetch with the user's session.
        // handleRpc answers every request, failures included; a request of another shape is answered with what differs,
        // and an answer that cannot be cloned with why, so the app does not wait 60 s for it.
        const { id } = asked.data;
        void Promise.resolve()
          .then(() => handleRpc(readRpcRequest(asked.data)))
          .catch((error: unknown): RpcResponse => ({ kind: 'gg-rpc-result', id, ok: false, error: error instanceof Error ? error.message : String(error) }))
          .then((answer) => {
            try {
              post(answer);
            } catch (error) {
              post({ kind: 'gg-rpc-result', id, ok: false, error: `The answer could not be posted: ${error instanceof Error ? error.message : String(error)}` });
            }
          });
        return;
      }
      const message = appToParentMessage.parse(data);
      switch (message.type) {
        case 'gg:ready':
          ready = true;
          postTheme();
          postViewer();
          if (appHash !== loadedHash) post({ type: 'gg:route', hash: appHash });
          break;
        case 'gg:navigate': {
          const url = new URL(message.url, location.href);
          if (url.protocol !== 'https:' && url.protocol !== 'http:') return;
          if (message.newTab) {
            window.open(url.href, '_blank', 'noopener');
          } else if (!moveInApp(url)) {
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
      // ⌘. / ⌘C / ⌘, copy the app's PR (src/app/copy-pull-request.ts), and only the focused document may write to the
      // clipboard, so the frame takes the focus first. ⌘C with text selected on GitHub's page copies that text, as ever.
      const copyKey = (event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey && ['.', 'c', ','].includes(event.key);
      if (copyKey) {
        if (event.key === 'c' && document.getSelection()?.type === 'Range') return;
        ui.iframe.focus();
      }
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
        copyKey ||
        ((event.metaKey || event.ctrlKey) && event.shiftKey && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) ||
        (!event.metaKey && !event.ctrlKey && !event.altKey && APP_KEYS.has(event.key.toLowerCase()));
      if (!ownedByApp) return;
      // GitHub binds several of these keys too, and they would act on the hidden page; Chrome binds ⌘, and ⌘. as well.
      event.preventDefault();
      event.stopPropagation();
    },
    { capture: true, signal },
  );

  const takeover: { leavingFor: string | null; show: (route: AppRoute) => void; release: () => void } = {
    /** Where a same-tab navigation the app asked for is heading while this document unloads; not worth tearing down for. */
    leavingFor: null,
    /** Moves the already-loaded app to another handled route, without reloading it. */
    show(route: AppRoute) {
      const hash = toAppHash(route);
      if (hash === appHash) return;
      appHash = hash;
      if (ready) post({ type: 'gg:route', hash });
    },
    release() {
      frameGuard.disconnect();
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

/** The popup's switch for the tab in view (`gg:choose`): which page a surface shows here. */
const chooseMessage = z.object({ type: z.literal('gg:choose'), surface: z.enum(['inboxEnabled', 'prEnabled']), showOurs: z.boolean() });

/**
 * GitHub's global header: signed in, a React partial whose <header> carries the GlobalNav class; signed out, the
 * marketing header (role="banner"), with the repository's navigation in a second header below it; on older pages
 * header.AppHeader. The first one in the document is the bar at the top of the page.
 */
const GITHUB_HEADER =
  'header.GlobalNav, react-partial[partial-name="global-nav-bar"] header, header.AppHeader, .AppHeader, header[role="banner"]';

/** Keys the app binds, chord strokes included (inbox and PR page); GitHub keeps every other shortcut. */
const APP_KEYS = new Set(['j', 'k', 'o', 'enter', 'r', '?', 'n', 'p', 'f', 's', 'v', 'e', 'g', 'c', 'a', 'y', 'd', 'h']);

/**
 * "GitHub | CarbonLayer" (with CarbonLayer's mark) in GitHub's header, just before its + and notification buttons
 * (signed out, before the search box): which page this surface shows, and the way to change it. A click saves the
 * surface's setting; the settings watcher then mounts or releases the app in place and calls `show` again.
 *
 * GitHub's headers are React partials rendered on the server and hydrated later, and an element inserted among their
 * children before hydration makes React render the header again without it. So the switch sits in a shadow root on
 * the button cluster, next to a <slot> that keeps GitHub's own children rendering as before: hydration walks only
 * those children and never sees it. GitHub's colour variables reach into the shadow root, so it fits either theme.
 */
function addPageViewSwitch(onChoose: (surface: 'inboxEnabled' | 'prEnabled', showOurs: boolean) => void) {
  const group = document.createElement('div');
  group.setAttribute('role', 'group');
  group.setAttribute('aria-label', 'Page view');
  const style = document.createElement('style');
  style.textContent = `
    [role="group"] {
      display: inline-flex; flex: none; align-self: center; box-sizing: border-box; height: 26px; overflow: hidden;
      border: 1px solid var(--borderColor-default, #d1d9e0); border-radius: 6px; background: var(--bgColor-default, #ffffff);
      white-space: nowrap;
    }
    button {
      display: inline-flex; align-items: center; gap: 4px;
      margin: 0; padding: 0 8px; border: 0; background: none; color: var(--fgColor-muted, #59636e); cursor: pointer;
      font: 500 12px/1 var(--fontStack-sansSerif, -apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans", Helvetica, Arial, sans-serif);
    }
    button + button { border-inline-start: 1px solid var(--borderColor-default, #d1d9e0); }
    button:hover { background: var(--bgColor-muted, #f6f8fa); color: var(--fgColor-default, #1f2328); }
    button[aria-pressed="true"] {
      background: var(--bgColor-accent-muted, var(--fgColor-default, #1f2328));
      color: var(--fgColor-accent, var(--bgColor-default, #ffffff));
      cursor: default;
    }
    button:focus-visible { outline: 2px solid var(--focus-outlineColor, #0969da); outline-offset: -2px; }
  `;
  const github = document.createElement('button');
  github.textContent = 'GitHub';
  github.title = "Show GitHub's own page here from now on";
  const mark = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  mark.setAttribute('viewBox', '0 0 28 28');
  mark.setAttribute('width', '14');
  mark.setAttribute('height', '14');
  mark.setAttribute('fill', 'currentColor');
  mark.setAttribute('aria-hidden', 'true');
  const markPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  markPath.setAttribute('d', CARBONLAYER_MARK);
  mark.append(markPath);
  const ours = document.createElement('button');
  ours.append(mark, 'CarbonLayer');
  ours.title = "Show CarbonLayer's page here from now on";
  let setting: 'inboxEnabled' | 'prEnabled' = 'prEnabled';
  let oursShown = false;
  for (const button of [github, ours]) {
    button.type = 'button';
    button.addEventListener('click', () => {
      const showOurs = button === ours;
      if (showOurs !== oursShown) onChoose(setting, showOurs);
    });
  }
  group.append(style, github, ours);

  const listeners = new AbortController();
  let header: Element | null = null;
  let cluster: Element | null = null;
  // Once GitHub's header is parsed whole, so its button cluster is there too, and again whenever a Turbo visit swaps
  // <body> or React renders the header again without the switch.
  const place = () => {
    if (document.readyState === 'loading') return;
    const found = document.querySelector(GITHUB_HEADER);
    if (found !== header) {
      header = found;
      headerChanges.disconnect();
      // The whole partial: React may replace the <header> element itself.
      if (header) headerChanges.observe(header.closest('react-partial') ?? header, { childList: true, subtree: true });
    }
    if (!header || (cluster?.isConnected && header.contains(cluster))) return;
    // Signed in: the + / issues / pull requests / notifications cluster (older headers: .AppHeader-actions). Signed
    // out: the search box and the sign-in buttons. Failing those, the end of the header.
    const candidates = [
      header.querySelector('[data-testid="top-bar-actions"]'),
      header.querySelector('[data-testid="top-nav-right"]'),
      header.querySelector('.AppHeader-actions'),
      header.querySelector('[class*="MarketingHeader-module__ctaContainer"]'),
      header,
    ];
    for (const candidate of candidates) {
      if (!candidate) continue;
      // Ours already when the switch was here before, from this script or an earlier copy of it.
      let root = candidate.shadowRoot;
      if (!root) {
        try {
          root = candidate.attachShadow({ mode: 'open' });
        } catch {
          // An element that cannot host a shadow root, or already hosts a closed one.
          continue;
        }
        const githubContent = document.createElement('slot');
        githubContent.id = 'gg-github-content';
        root.append(githubContent);
      } else if (!root.getElementById('gg-github-content')) {
        // Someone else's.
        continue;
      }
      // Clusters that do not space their buttons with a gap space them with margins; the switch brings its own.
      const spacing = parseFloat(getComputedStyle(candidate).columnGap) > 0 ? '0' : '8px';
      if (candidate === header) {
        group.style.margin = `0 0 0 ${spacing}`;
        root.append(group);
      } else {
        group.style.margin = `0 ${spacing} 0 0`;
        root.prepend(group);
      }
      cluster = candidate;
      return;
    }
  };
  const pageChanges = new MutationObserver(place);
  pageChanges.observe(document.documentElement, { childList: true });
  const headerChanges = new MutationObserver(place);
  document.addEventListener('DOMContentLoaded', place, { once: true, signal: listeners.signal });
  place();

  return {
    /** Shows which page the surface whose switch is `surfaceSetting` is set to: ours when `oursOn`. */
    show(surfaceSetting: 'inboxEnabled' | 'prEnabled', oursOn: boolean) {
      setting = surfaceSetting;
      oursShown = oursOn;
      github.setAttribute('aria-pressed', String(!oursOn));
      ours.setAttribute('aria-pressed', String(oursOn));
    },
    remove() {
      listeners.abort();
      pageChanges.disconnect();
      headerChanges.disconnect();
      // A shadow root cannot be removed; left with only its <slot>, it renders GitHub's children exactly as before.
      group.remove();
    },
  };
}

/** CarbonLayer's mark (assets/logo.svg) as one path on a 28px grid, as `logo` in src/ui/Icon.tsx. */
const CARBONLAYER_MARK =
  'M17.644 0 3.73 3.729 0 17.644l10.187 10.187 13.915-3.729 3.73-13.915zm2.27 24.312H7.917L1.92 13.915 7.917 3.518h11.997l5.998 10.397zM20.704 7.123l-9.27-2.484-6.788 6.793 2.482 9.276 9.27 2.484 6.788-6.793zM12.709 16.765C10.692 16.52 9.272 15.07 9.272 13.191C9.272 12.427 9.547 11.603 10.005 11.053C9.806 10.549 9.837 9.48 10.066 9.037C10.677 8.961 11.502 9.282 11.991 9.724C12.571 9.541 13.182 9.449 13.931 9.449C14.679 9.449 15.29 9.541 15.839 9.709C16.313 9.281 17.153 8.961 17.764 9.037C17.978 9.449 18.009 10.519 17.809 11.037C18.299 11.618 18.558 12.397 18.558 13.191C18.558 15.07 17.138 16.49 15.091 16.75C15.61 17.086 15.962 17.819 15.962 18.659L15.962 23.075L11.96 22.003L11.96 19.04A1.972 1.972 0 0 1 11.227 19.193C10.219 19.193 9.623 18.643 9.196 17.62C9.028 17.207 8.844 16.963 8.493 16.917C8.309 16.902 8.249 16.826 8.249 16.734C8.249 16.55 8.555 16.414 8.859 16.414C9.303 16.414 9.684 16.688 10.081 17.253C10.387 17.696 10.707 17.895 11.09 17.895C11.471 17.895 11.715 17.757 12.067 17.406C12.327 17.147 12.525 16.917 12.709 16.764Z';

declare global {
  interface Window {
    /** The parts of the Navigation API used here, which TypeScript's DOM library does not declare yet; Chrome has had them since 102. */
    readonly navigation?: EventTarget & { readonly currentEntry: NavigationHistoryEntry | null };
  }

  /** The Navigation API's `navigate` event, the parts used here (Chrome since 102, wherever `window.navigation` is). */
  interface NavigateEvent extends Event {
    readonly destination: { readonly url: string; readonly sameDocument: boolean };
  }

  var NavigateEvent: { prototype: NavigateEvent; new (type: string): NavigateEvent };
}
