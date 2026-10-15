import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { SIGNED_OUT, embeddedPayload, getJson, request, send } from './session';

afterEach(() => {
  vi.unstubAllGlobals();
  document.head.innerHTML = '';
});

describe('embeddedPayload', () => {
  const html = `<html><body>
      <script type="application/json" data-target="react-app.embeddedData">{not json</script>
      <script type="application/json" data-target="react-app.embeddedData">{"payload":{"otherRoute":{}}}</script>
      <script type="application/json" data-target="react-app.embeddedData">{"payload":{"pullRequestsLayoutRoute":{"pullRequest":{"number":7}}},"appPayload":{"current_user":"ana"}}</script>
    </body></html>`;
  const page = new DOMParser().parseFromString(html, 'text/html');

  it("reads the route data of the embedded React data whose payload carries the route, skipping other apps' data", () => {
    const layout = z.object({ pullRequest: z.object({ number: z.number() }) });
    expect(embeddedPayload(page, 'pullRequestsLayoutRoute', layout)).toEqual({ pullRequest: { number: 7 } });
    expect(embeddedPayload(page, 'pullsDashboardSurfaceContentRoute', layout)).toBeNull();
  });

  it('fails naming the route when its data is of another shape', () => {
    expect(() => embeddedPayload(page, 'pullRequestsLayoutRoute', z.object({ pullRequest: z.object({ number: z.string() }) }))).toThrow(
      /^the page's embedded pullRequestsLayoutRoute did not match: .*expected string, received number[\s\S]*pullRequest\.number/,
    );
  });
});

describe('reading with the session', () => {
  it('sends the headers GitHub’s React page sends on JSON reads, with the page’s nonce and client version', async () => {
    const fetch = vi.fn(async () => Response.json({ ok: 1 }));
    vi.stubGlobal('fetch', fetch);
    document.head.innerHTML = '<meta name="fetch-nonce" content="v2:nonce"><meta name="release" content="abc123">';
    await expect(getJson('/pulls/inbox/queries?filter=review-requested', z.object({ ok: z.number() }))).resolves.toEqual({ ok: 1 });
    expect(fetch).toHaveBeenCalledWith('/pulls/inbox/queries?filter=review-requested', {
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'X-Requested-With': 'XMLHttpRequest',
        'GitHub-Verified-Fetch': 'true',
        'GitHub-Is-React': 'true',
        'X-Fetch-Nonce': 'v2:nonce',
        'X-GitHub-Client-Version': 'abc123',
      },
      credentials: 'same-origin',
    });
    document.head.innerHTML = '';
  });

  it('waits for the page’s nonce when a read starts while GitHub’s <head> is still being parsed', async () => {
    const fetch = vi.fn(async () => Response.json({ ok: 1 }));
    vi.stubGlobal('fetch', fetch);
    // Before the parser reaches <body>.
    const body = document.body;
    body.remove();
    Object.defineProperty(document, 'readyState', { value: 'loading', configurable: true });
    try {
      const reading = getJson('/o/r/pull/1/page_data/status_checks', z.object({ ok: z.number() }));
      expect(fetch).not.toHaveBeenCalled();
      document.head.innerHTML = '<meta name="fetch-nonce" content="v2:late">';
      await expect(reading).resolves.toEqual({ ok: 1 });
      expect(fetch).toHaveBeenCalledWith('/o/r/pull/1/page_data/status_checks', expect.objectContaining({ headers: expect.objectContaining({ 'X-Fetch-Nonce': 'v2:late' }) }));
    } finally {
      Reflect.deleteProperty(document, 'readyState');
      document.documentElement.append(body);
    }
  });

  it('recognises a signed-out session by the login redirect or GitHub saying it cannot authenticate', async () => {
    const redirected = { ok: true, status: 200, redirected: true, url: 'https://github.com/login?return_to=x', headers: new Headers() } as Response;
    vi.stubGlobal('fetch', vi.fn(async () => redirected));
    await expect(request('/pulls/inbox', 'text/html')).rejects.toThrow(SIGNED_OUT);

    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ error: 'Couldn’t authenticate you' }, { status: 404 })));
    await expect(getJson('/pulls/search?q=x', z.unknown())).rejects.toThrow(SIGNED_OUT);
  });

  it('reports any other 404 as such, without its query', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ error: 'Not Found' }, { status: 404 })));
    await expect(getJson('/o/r/pull/1/page_data/merge_box?merge_method=MERGE', z.unknown())).rejects.toThrow('GitHub answered 404 for /o/r/pull/1/page_data/merge_box');
  });

  it('reads only the fields its schema names, and fails naming the endpoint, without its query, when the answer is of another shape', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ diffstat: { linesAdded: 3, linesDeleted: 1, linesChanged: 4 }, other: true })));
    const diffstat = z.object({ diffstat: z.object({ linesAdded: z.number(), linesDeleted: z.number() }) });
    await expect(getJson('/o/r/pull/1/page_data/diffstat', diffstat)).resolves.toEqual({ diffstat: { linesAdded: 3, linesDeleted: 1 } });
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ diffstat: { linesAdded: '3', linesDeleted: 1 } })));
    await expect(getJson('/o/r/pull/1/page_data/diffstat?x=1', diffstat)).rejects.toThrow(/^\/o\/r\/pull\/1\/page_data\/diffstat did not match: .*expected number, received string[\s\S]*diffstat\.linesAdded/);
  });
});

describe('writing with the session', () => {
  it("sends GitHub's verified-fetch headers with the page's nonce, and keeps the nonce fresh", async () => {
    document.head.innerHTML = '<meta name="fetch-nonce" content="v2:one"><meta name="release" content="abc123">';
    const fetch = vi.fn(async () => Response.json({ commentId: 1 }, { headers: { 'X-Fetch-Nonce': 'v2:two' } }));
    vi.stubGlobal('fetch', fetch);
    await send('/o/r/pull/1/page_data/create_timeline_comment', 'POST', { text: 'hi' });
    expect(fetch).toHaveBeenCalledWith('/o/r/pull/1/page_data/create_timeline_comment', {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'GitHub-Verified-Fetch': 'true',
        'GitHub-Is-React': 'true',
        'X-Requested-With': 'XMLHttpRequest',
        'X-Fetch-Nonce': 'v2:one',
        'X-GitHub-Client-Version': 'abc123',
      },
      body: '{"text":"hi"}',
    });
    expect(document.querySelector('meta[name="fetch-nonce"]')?.getAttribute('content')).toBe('v2:two');
  });

  it("passes GitHub's error message on verbatim", async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ error: 'Head branch was modified. Review and try the merge again.' }, { status: 422 })));
    await expect(send('/o/r/pull/1/page_data/merge', 'POST', {})).rejects.toThrow('Head branch was modified. Review and try the merge again.');
  });
});
