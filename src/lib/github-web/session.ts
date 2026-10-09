// Same-origin requests to github.com with the user's session, made from the content script. These are the
// endpoints GitHub's own React UI calls (docs/research/github-web-endpoints.md); cookies ride along.
// A signed-out session gets a redirect to /login, or a JSON 404 from the session-only endpoints.

import type { UserRef } from '../model';

export const SIGNED_OUT = 'Sign in to GitHub in this tab first';

/**
 * The one place a request leaves for GitHub: sends only the headers GitHub's UI sends, and turns a
 * signed-out answer or any other failure into a message the UI can show as is.
 */
export async function request(path: string, accept: 'application/json' | 'text/html'): Promise<Response> {
  const headers: Record<string, string> = accept === 'application/json' ? { Accept: accept, 'X-Requested-With': 'XMLHttpRequest' } : { Accept: accept };
  let response: Response;
  try {
    response = await fetch(path, { headers, credentials: 'same-origin' });
  } catch {
    throw new Error('Could not reach GitHub (network error)');
  }
  if (response.redirected && new URL(response.url).pathname === '/login') throw new Error(SIGNED_OUT);
  if (response.ok) return response;
  if (response.status === 404 && response.headers.get('content-type')?.includes('json')) {
    const body = (await response.json().catch(() => null)) as { error?: unknown } | null;
    // Session-only endpoints answer a missing session with 404 {"error":"Not Found" | "Couldn’t authenticate you"};
    // a page_data 404 while this tab is signed in is a real "not found".
    const tabSignedIn = !!document.querySelector('meta[name="user-login"]')?.getAttribute('content');
    if (/authenticate/i.test(String(body?.error)) || (path.includes('/page_data/') && !tabSignedIn)) throw new Error(SIGNED_OUT);
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

export interface EmbeddedData {
  payload: Record<string, unknown>;
  appPayload: Record<string, unknown>;
}

const loggedShapes = new Set<string>();
