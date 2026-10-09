import { afterEach, describe, expect, it, vi } from 'vitest';
import { SIGNED_OUT, embeddedPayload, getJson, request, send } from './session';

afterEach(() => {
  vi.unstubAllGlobals();
  document.head.innerHTML = '';
});

describe('embeddedPayload', () => {
  it("returns the embedded React data whose payload carries the route, skipping other apps' data", () => {
    const html = `<html><body>
      <script type="application/json" data-target="react-app.embeddedData">{not json</script>
      <script type="application/json" data-target="react-app.embeddedData">{"payload":{"otherRoute":{}}}</script>
      <script type="application/json" data-target="react-app.embeddedData">{"payload":{"pullRequestsLayoutRoute":{"pullRequest":{"number":7}}},"appPayload":{"current_user":"ana"}}</script>
    </body></html>`;
    const page = new DOMParser().parseFromString(html, 'text/html');
    expect(embeddedPayload(page, 'pullRequestsLayoutRoute')).toEqual({
      payload: { pullRequestsLayoutRoute: { pullRequest: { number: 7 } } },
      appPayload: { current_user: 'ana' },
    });
    expect(embeddedPayload(page, 'pullsDashboardSurfaceContentRoute')).toBeNull();
  });
});

describe('reading with the session', () => {
  it('sends only the headers GitHub’s UI sends on JSON reads', async () => {
    const fetch = vi.fn(async () => Response.json({ ok: 1 }));
    vi.stubGlobal('fetch', fetch);
    await expect(getJson('/pulls/inbox/queries?filter=review-requested')).resolves.toEqual({ ok: 1 });
    expect(fetch).toHaveBeenCalledWith('/pulls/inbox/queries?filter=review-requested', {
      headers: { Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
      credentials: 'same-origin',
    });
  });

  it('recognises a signed-out session by the login redirect or GitHub saying it cannot authenticate', async () => {
    const redirected = { ok: true, status: 200, redirected: true, url: 'https://github.com/login?return_to=x', headers: new Headers() } as Response;
    vi.stubGlobal('fetch', vi.fn(async () => redirected));
    await expect(request('/pulls/inbox', 'text/html')).rejects.toThrow(SIGNED_OUT);

    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ error: 'Couldn’t authenticate you' }, { status: 404 })));
    await expect(getJson('/pulls/search?q=x')).rejects.toThrow(SIGNED_OUT);
  });

  it('reports any other 404 as such, without its query', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ error: 'Not Found' }, { status: 404 })));
    await expect(getJson('/o/r/pull/1/page_data/merge_box?merge_method=MERGE')).rejects.toThrow('GitHub answered 404 for /o/r/pull/1/page_data/merge_box');
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
