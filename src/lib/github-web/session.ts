// Same-origin requests to github.com with the user's session, made from the content script. These are the
// endpoints GitHub's own React UI calls (docs/research/github-web-endpoints.md); cookies ride along.
// A signed-out session gets a redirect to /login, a JSON 404 from the session-only endpoints, and pages whose
// `meta[name="user-login"]` is empty; the PR page decides from that meta (pull-request.ts).

import { z } from 'zod/mini';
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
  // GitHub's gateway now and then answers a read 502, 503 or 504 that succeeds when asked again: it is asked again a
  // second later, then three seconds after that, before its failure is shown.
  const waits = [1_000, 3_000];
  for (;;) {
    try {
      response = await fetch(path, { headers, credentials: 'same-origin' });
    } catch {
      throw new Error('Could not reach GitHub (network error)');
    }
    const wait = waits.shift();
    if (wait === undefined || ![502, 503, 504].includes(response.status)) break;
    await new Promise((resolve) => setTimeout(resolve, wait));
  }
  if (response.redirected && new URL(response.url).pathname === '/login') throw new Error(SIGNED_OUT);
  if (response.ok) return response;
  if (response.status === 404 && response.headers.get('content-type')?.includes('json')) {
    // Only "Couldn’t authenticate you" names the session; a plain {"error":"Not Found"} may be a missing feature.
    const notFound = z.object({ error: z.string() }).safeParse(await response.json().catch(() => null));
    if (notFound.success && /authenticate/i.test(notFound.data.error)) throw new Error(SIGNED_OUT);
  }
  throw new Error(`GitHub answered ${response.status} for ${path.split('?')[0]}`);
}

/**
 * A write, sent the way GitHub's React UI sends it: JSON body, its verified-fetch headers, and the page's fetch
 * nonce (refreshed from every response). GitHub's own `{ error }` message is passed on verbatim. The answer is unread
 * here: the one write that reads it gives it to `readAnswer` with the fields it reads.
 */
export async function send(path: string, method: 'POST' | 'PUT' | 'DELETE', body?: unknown): Promise<unknown> {
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
  const answer: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const refused = z.object({ error: z.string().check(z.minLength(1)) }).safeParse(answer);
    throw new Error(refused.success ? refused.data.error : `GitHub answered ${response.status} to ${method} ${path.split('?')[0]}`);
  }
  return answer;
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

/** A JSON endpoint of GitHub's web UI, read by `schema`: the fields its reader relies on (see `readAnswer`). */
export async function getJson<S extends z.ZodMiniType>(path: string, schema: S): Promise<z.infer<S>> {
  const answer: unknown = await (await request(path, 'application/json')).json();
  return readAnswer(path.split('?')[0] ?? path, schema, answer);
}

/**
 * What GitHub answered at `endpoint`, in the shape `schema` gives the fields its reader relies on; other keys are left
 * unread. An answer of another shape means GitHub changed it: that throws, naming the endpoint and what differs, and the
 * error takes the reader's own way to the page (a stage's error with its Retry, a section's error, a row or card left as
 * it was).
 */
export function readAnswer<S extends z.ZodMiniType>(endpoint: string, schema: S, answer: unknown): z.infer<S> {
  const read = schema.safeParse(answer);
  if (!read.success) throw new Error(`${endpoint} did not match: ${z.prettifyError(read.error)}`);
  return read.data;
}

/** A github.com page, parsed into a document (for its embedded React data and server-rendered timeline). */
export async function getPage(path: string): Promise<Document> {
  return new DOMParser().parseFromString(await (await request(path, 'text/html')).text(), 'text/html');
}

/**
 * The route data GitHub embeds in a page (`<script type="application/json" data-target="react-app.embeddedData">`,
 * `{ payload: { <routeKey>: … } }`), read by `schema` as `readAnswer` reads an answer. A page can carry several; this is
 * the one whose payload has `routeKey`, or null when none has.
 */
export function embeddedPayload<S extends z.ZodMiniType>(page: Document, routeKey: string, schema: S): z.infer<S> | null {
  for (const script of page.querySelectorAll('script[type="application/json"][data-target="react-app.embeddedData"]')) {
    let data: unknown;
    try {
      data = JSON.parse(script.textContent ?? '');
    } catch {
      // Another app's data that does not parse: keep looking.
      continue;
    }
    const embedded = z.object({ payload: z.record(z.string(), z.unknown()) }).safeParse(data);
    if (embedded.success && routeKey in embedded.data.payload) return readAnswer(`the page's embedded ${routeKey}`, schema, embedded.data.payload[routeKey]);
  }
  return null;
}

/** A GitHub account by login. GitHub serves every account's avatar at /<login>.png. */
export function githubUser(login: string, avatarUrl?: string | null): UserRef {
  return { login, avatarUrl: avatarUrl || `https://github.com/${login}.png?size=40`, url: `https://github.com/${login}` };
}

/** Runs `work` over `items` with at most `limit` requests to GitHub in flight, keeping results in order. */
export async function politely<T, R>(items: T[], limit: number, work: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = [];
  // Each worker takes the next item from the one queue.
  const queue = items.entries();
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (const [index, item] of queue) results[index] = await work(item);
  });
  await Promise.all(workers);
  return results;
}

/**
 * The first value in a response for which `matches(key, value)` holds, searching nested objects breadth-first. Only
 * for what the docs do not record the place of (docs/research/github-web-endpoints.md): a reader looks it up by name
 * wherever GitHub happens to nest it, then reads what it found with its schema.
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
