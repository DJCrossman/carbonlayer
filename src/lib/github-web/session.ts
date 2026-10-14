// Same-origin requests to github.com with the user's session, made from the content script. These are the
// endpoints GitHub's own React UI calls (docs/research/github-web-endpoints.md); cookies ride along.
// A signed-out session gets a redirect to /login, a JSON 404 from the session-only endpoints, and pages whose
// `meta[name="user-login"]` is empty; the PR page decides from that meta (pull-request.ts).

import type { UserRef } from '../model';

export const SIGNED_OUT = 'Sign in to github.com in this tab, then reload.';

/**
 * The one place a read leaves for GitHub: sends only the headers GitHub's UI sends, and turns a
 * signed-out answer or any other failure into a message the UI can show as is. `xhr` marks it as one of GitHub's own
 * scripts' requests, as its JSON routes and the HTML partials its classic pages load into dialogs are.
 */
export async function request(path: string, accept: 'application/json' | 'text/html', { xhr = accept === 'application/json' } = {}): Promise<Response> {
  // JSON routes get the headers GitHub's React page sends with its own page_data reads, Content-Type included on a GET
  // (the nonce and client version come from the page's metas when the content script has a page, so a read made while
  // GitHub's <head> is still being parsed waits for them); without them some routes answer 404.
  if (xhr) await untilHeadParsed();
  const nonce = typeof document === 'undefined' ? null : document.querySelector('meta[name="fetch-nonce"]')?.getAttribute('content');
  const release = typeof document === 'undefined' ? null : document.querySelector('meta[name="release"]')?.getAttribute('content');
  const headers: Record<string, string> = xhr
    ? {
        Accept: accept,
        ...(accept === 'application/json' && { 'Content-Type': 'application/json' }),
        'X-Requested-With': 'XMLHttpRequest',
        'GitHub-Verified-Fetch': 'true',
        'GitHub-Is-React': 'true',
        ...(nonce && { 'X-Fetch-Nonce': nonce }),
        ...(release && { 'X-GitHub-Client-Version': release }),
      }
    : { Accept: accept };
  let response: Response;
  try {
    response = await fetch(path, { headers, credentials: 'same-origin' });
  } catch {
    throw new Error('Could not reach GitHub (network error)');
  }
  if (response.redirected && new URL(response.url).pathname === '/login') throw new Error(SIGNED_OUT);
  if (response.ok) return response;
  if (response.status === 404 && response.headers.get('content-type')?.includes('json')) {
    // Only "Couldn’t authenticate you" names the session; a plain {"error":"Not Found"} may be a missing feature.
    const body = (await response.json().catch(() => null)) as { error?: unknown } | null;
    if (/authenticate/i.test(String(body?.error))) throw new Error(SIGNED_OUT);
  }
  throw new Error(`GitHub answered ${response.status} for ${path.split('?')[0]}`);
}

/**
 * A write, sent the way GitHub's React UI sends it: JSON body, its verified-fetch headers, and the page's fetch
 * nonce (refreshed from every response). GitHub's own `{ error }` message is passed on verbatim.
 */
export async function send<T>(path: string, method: 'POST' | 'PUT' | 'DELETE', body?: unknown): Promise<T> {
  const nonce = document.querySelector('meta[name="fetch-nonce"]');
  let response: Response;
  try {
    response = await fetch(path, {
      method,
      credentials: 'same-origin',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'GitHub-Verified-Fetch': 'true',
        'GitHub-Is-React': 'true',
        'X-Requested-With': 'XMLHttpRequest',
        'X-Fetch-Nonce': nonce?.getAttribute('content') ?? '',
        'X-GitHub-Client-Version': document.querySelector('meta[name="release"]')?.getAttribute('content') ?? '',
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new Error('Could not reach GitHub (network error)');
  }
  const nextNonce = response.headers.get('X-Fetch-Nonce');
  if (nonce && nextNonce) nonce.setAttribute('content', nextNonce);
  if (response.redirected && new URL(response.url).pathname === '/login') throw new Error(SIGNED_OUT);
  const data = (await response.json().catch(() => null)) as (T & { error?: unknown }) | null;
  if (!response.ok) {
    throw new Error(typeof data?.error === 'string' && data.error ? data.error : `GitHub answered ${response.status} to ${method} ${path.split('?')[0]}`);
  }
  return data as T;
}

/**
 * A form GitHub's React UI posts to have something rendered, not changed (its comment box's Preview tab): multipart
 * fields with only the headers GitHub's `verifiedFetch` adds, answered with HTML.
 */
export async function render(path: string, fields: Record<string, string>): Promise<string> {
  const nonce = document.querySelector('meta[name="fetch-nonce"]');
  const body = new FormData();
  for (const [name, value] of Object.entries(fields)) body.append(name, value);
  let response: Response;
  try {
    response = await fetch(path, {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        'GitHub-Verified-Fetch': 'true',
        'X-Requested-With': 'XMLHttpRequest',
        'X-Fetch-Nonce': nonce?.getAttribute('content') ?? '',
        'X-GitHub-Client-Version': document.querySelector('meta[name="release"]')?.getAttribute('content') ?? '',
      },
      body,
    });
  } catch {
    throw new Error('Could not reach GitHub (network error)');
  }
  const nextNonce = response.headers.get('X-Fetch-Nonce');
  if (nonce && nextNonce) nonce.setAttribute('content', nextNonce);
  if (response.redirected && new URL(response.url).pathname === '/login') throw new Error(SIGNED_OUT);
  if (!response.ok) throw new Error(`GitHub answered ${response.status} to POST ${path}`);
  return response.text();
}

/**
 * A classic, server-rendered form, submitted as the browser would: form-encoded, with the fields it carries (its own
 * `authenticity_token` among them). Only ever to github.com itself. A 2xx, or a redirect anywhere but sign-in, is success.
 */
export async function submitForm(action: string, fields: Array<[string, string]>): Promise<void> {
  const url = new URL(action, location.origin);
  if (url.origin !== location.origin) throw new Error(`GitHub's form points away from GitHub (${url.origin}); not sending it`);
  let response: Response;
  try {
    response = await fetch(url.href, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { Accept: 'text/html', 'Content-Type': 'application/x-www-form-urlencoded', 'X-Requested-With': 'XMLHttpRequest' },
      body: new URLSearchParams(fields).toString(),
    });
  } catch {
    throw new Error('Could not reach GitHub (network error)');
  }
  if (response.redirected && new URL(response.url).pathname === '/login') throw new Error(SIGNED_OUT);
  if (!response.ok && !response.redirected) throw new Error(`GitHub answered ${response.status} to POST ${url.pathname}`);
}

/** A JSON endpoint of GitHub's web UI. */
export async function getJson<T>(path: string): Promise<T> {
  return (await (await request(path, 'application/json')).json()) as T;
}

/** A github.com page, parsed into a document (for its embedded React data and server-rendered timeline). */
export async function getPage(path: string): Promise<Document> {
  return new DOMParser().parseFromString(await (await request(path, 'text/html')).text(), 'text/html');
}

/**
 * The React data GitHub embeds in a page (`<script type="application/json" data-target="react-app.embeddedData">`).
 * A page can carry several; this is the one whose payload has `routeKey`, or null when none has.
 */
export function embeddedPayload(page: Document, routeKey: string): EmbeddedData | null {
  for (const script of page.querySelectorAll('script[type="application/json"][data-target="react-app.embeddedData"]')) {
    try {
      const data = JSON.parse(script.textContent ?? '') as Partial<EmbeddedData>;
      if (data.payload && routeKey in data.payload) return { payload: data.payload, appPayload: data.appPayload ?? {} };
    } catch {
      // Another app's data that does not parse: keep looking.
    }
  }
  return null;
}

/** A GitHub account by login. GitHub serves every account's avatar at /<login>.png. */
export function githubUser(login: string, avatarUrl?: string | null): UserRef {
  return { login, avatarUrl: avatarUrl || `https://github.com/${login}.png?size=40`, url: `https://github.com/${login}` };
}

/** Runs `work` over `items` with at most `limit` requests to GitHub in flight, keeping results in order. */
export async function politely<T, R>(items: T[], limit: number, work: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await work(items[index]!);
    }
  });
  await Promise.all(workers);
  return results;
}

/**
 * The first value in an unconfirmed response for which `matches(key, value)` holds, searching nested objects
 * breadth-first. Several endpoint shapes were inferred from GitHub's components rather than observed, so
 * readers look fields up by name wherever GitHub happens to nest them.
 */
export function findInPayload(data: unknown, matches: (key: string, value: unknown) => boolean): unknown {
  const queue: unknown[] = [data];
  for (let visited = 0; queue.length > 0 && visited < 2000; visited++) {
    const node = queue.shift();
    if (typeof node !== 'object' || node === null) continue;
    for (const [key, value] of Object.entries(node)) {
      if (matches(key, value)) return value;
      if (typeof value === 'object' && value !== null) queue.push(value);
    }
  }
  return undefined;
}

/** Logs the top-level keys of a response whose shape is still unconfirmed, once per label. */
export function noteShape(label: string, data: unknown): void {
  if (loggedShapes.has(label)) return;
  loggedShapes.add(label);
  const keys =
    typeof data !== 'object' || data === null
      ? [data === null ? 'null' : typeof data]
      : Array.isArray(data)
        ? [`array(${data.length})`, ...Object.keys(data[0] ?? {})]
        : Object.keys(data);
  console.debug('[gg]', label, keys);
}

/**
 * Resolves once GitHub's <head> is parsed as far as its fetch nonce: at once, unless this document is still loading with
 * neither the nonce nor a <body> (which means the head is done) yet; then as soon as one of them appears, or at
 * DOMContentLoaded.
 */
function untilHeadParsed(): Promise<void> {
  const parsed = () => document.readyState !== 'loading' || !!document.body || !!document.querySelector('meta[name="fetch-nonce"]');
  if (typeof document === 'undefined' || parsed()) return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => {
      if (!parsed()) return;
      observer.disconnect();
      document.removeEventListener('DOMContentLoaded', done);
      resolve();
    };
    const observer = new MutationObserver(done);
    observer.observe(document.documentElement, { childList: true, subtree: true });
    document.addEventListener('DOMContentLoaded', done);
  });
}

interface EmbeddedData {
  payload: Record<string, unknown>;
  appPayload: Record<string, unknown>;
}

const loggedShapes = new Set<string>();
