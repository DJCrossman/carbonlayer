import { afterEach, assert, describe, expect, it, vi } from 'vitest';
import type { PrDetail } from '../model';
import { readRpcRequest, type RpcResponse } from '../rpc';
import { DEFAULT_SETTINGS } from '../settings';
import { handleRpc } from './index';
import { enrichPull, fetchInbox, fetchViewPage } from './inbox';
import { rememberPullRequest } from './mutations';
import { fetchPullRequestPage } from './pull-request';
import { topRepositories } from './repositories';

vi.mock(import('../settings'), async (original) => ({ ...(await original()), getSettings: vi.fn(async () => DEFAULT_SETTINGS) }));
vi.mock('./inbox', () => ({ fetchInbox: vi.fn(async () => [{ prs: [], totalCount: 0, fetchedAt: 'now' }]), enrichPull: vi.fn(), fetchViewPage: vi.fn() }));
vi.mock(import('./repositories'), async (original) => ({ ...(await original()), topRepositories: vi.fn(async () => ({ repos: [], nextCursor: 7 })) }));
vi.mock('./pull-request', async () => {
  // A fixture PR, as o/r#1.
  const [fixture] = (await import('../../fixtures/pr')).prFixtures;
  if (!fixture) throw new Error('No fixture PR');
  return {
    fetchPullRequestPage: vi.fn(async (): Promise<PrDetail> => ({ ...fixture, id: 'PR_1', repo: { owner: 'o', name: 'r' }, number: 1, headOid: 'h', baseOid: 'b', nativeStack: null, threads: [] })),
  };
});

afterEach(() => vi.unstubAllGlobals());

describe('handleRpc', () => {
  it("answers with the request id, asking GitHub every time: the page's cache decides when", async () => {
    const views = [{ id: 'a', name: 'Mine', query: 'is:pr author:@me' }];
    vi.mocked(fetchInbox).mockImplementation(async (asked) => asked.map((view) => ({ view, prs: [], totalCount: 0, fetchedAt: 'now' })));
    expect(await call('inbox.fetch', { views })).toEqual({ kind: 'gg-rpc-result', id: 'req-1', ok: true, result: [{ view: views[0], prs: [], totalCount: 0, fetchedAt: 'now' }] });
    await call('inbox.fetch', { views });
    expect(fetchInbox).toHaveBeenCalledTimes(2);
    expect(fetchInbox).toHaveBeenLastCalledWith(views, DEFAULT_SETTINGS.inboxScope);
  });

  it('forgets cached pages after a successful write, reloads a forced read, and reports failures as errors', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({})));
    await call('pr.fetch', { repo: { owner: 'o', name: 'r' }, number: 1 });
    await call('pr.fetch', { repo: { owner: 'o', name: 'r' }, number: 1 });
    expect(fetchPullRequestPage).toHaveBeenCalledTimes(1);
    expect(await call('pr.comment', { prId: 'PR_1', body: 'hi' })).toMatchObject({ ok: true });
    await call('pr.fetch', { repo: { owner: 'o', name: 'r' }, number: 1 });
    expect(fetchPullRequestPage).toHaveBeenCalledTimes(2);
    await call('pr.fetch', { repo: { owner: 'o', name: 'r' }, number: 1, force: true });
    expect(fetchPullRequestPage).toHaveBeenCalledTimes(3);

    expect(await call('pr.comment', { prId: 'PR_unknown', body: 'hi' })).toEqual({ kind: 'gg-rpc-result', id: 'req-1', ok: false, error: 'Open the pull request first' });
    expect(await call('nope', {})).toMatchObject({ ok: false, error: 'Unknown request: nope' });
  });

  it('fetches a later page of a view in the inbox scope', async () => {
    const view = { id: 'a', name: 'Mine', query: 'is:pr author:@me' };
    vi.mocked(fetchViewPage).mockResolvedValue({ view, prs: [], totalCount: 40, fetchedAt: 'now' });
    expect(await call('inbox.fetchMore', { view, page: 2 })).toMatchObject({ ok: true, result: { view, totalCount: 40 } });
    expect(fetchViewPage).toHaveBeenCalledWith(view, DEFAULT_SETTINGS.inboxScope, 2);
  });

  it("asks GitHub for the homepage's first page of top repositories, or the one after a cursor", async () => {
    expect(await call('repos.top', { cursor: null })).toMatchObject({ ok: true, result: { repos: [], nextCursor: 7 } });
    expect(topRepositories).toHaveBeenLastCalledWith();
    await call('repos.top', { cursor: 7 });
    expect(topRepositories).toHaveBeenLastCalledWith(7);
  });

  it('enriches inbox rows three pull requests at a time', async () => {
    let inFlight = 0;
    let most = 0;
    vi.mocked(enrichPull).mockImplementation(async (pr) => {
      most = Math.max(most, ++inFlight);
      await new Promise((resolve) => setTimeout(resolve, 5));
      inFlight -= 1;
      return { additions: pr.number };
    });
    document.head.innerHTML = '<meta name="user-login" content="octocat">';
    const prs = Array.from({ length: 7 }, (_, index) => ({
      repo: { owner: 'o', name: 'r' },
      number: index + 1,
      state: 'OPEN',
      isDraft: false,
      author: { login: 'ana', avatarUrl: '', url: '' },
      ci: { state: 'SUCCESS' },
    }));
    expect(await call('inbox.enrich', { prs })).toMatchObject({ ok: true, result: prs.map((pr) => ({ additions: pr.number })) });
    expect(most).toBe(3);
    expect(enrichPull).toHaveBeenCalledWith(prs[0], DEFAULT_SETTINGS.mergeMethod, 'octocat');
  });

  it("previews Markdown with the form GitHub's comment box posts for a pull request, and keeps what it read", async () => {
    document.head.innerHTML = '<meta name="fetch-nonce" content="v2:n1"><meta name="release" content="r1">';
    rememberPullRequest({ id: 'PR_9', repo: { owner: 'o', name: 'r' }, number: 9, databaseId: 900, repositoryDatabaseId: 77 });
    await call('pr.fetch', { repo: { owner: 'o', name: 'r' }, number: 9 });
    const fetch = vi.fn(async (_path: string, _init: RequestInit) => new Response('<p><strong>Hi</strong></p>'));
    vi.stubGlobal('fetch', fetch);

    expect(await call('markdown.preview', { text: '**Hi**', prId: 'PR_9' })).toMatchObject({ ok: true, result: { html: '<p><strong>Hi</strong></p>' } });
    const [first] = fetch.mock.calls;
    assert.isDefined(first);
    const [path, init] = first;
    expect([path, init.method]).toEqual(['/preview', 'POST']);
    assert.instanceOf(init.body, FormData);
    expect(Object.fromEntries(init.body)).toEqual({ text: '**Hi**', issue: '900', repository: '77', project: '900', subject: '9', subject_type: 'PullRequest' });
    expect(init.headers).toEqual({ 'GitHub-Verified-Fetch': 'true', 'X-Requested-With': 'XMLHttpRequest', 'X-Fetch-Nonce': 'v2:n1', 'X-GitHub-Client-Version': 'r1' });
    await call('pr.fetch', { repo: { owner: 'o', name: 'r' }, number: 9 });
    expect(fetchPullRequestPage).toHaveBeenCalledTimes(1);
  });

  it("lists the emoji GitHub's comment box suggests, in its order, and refuses a list of another shape", async () => {
    const fetch = vi.fn(async (_path: string, _init: RequestInit) =>
      Response.json({
        '100': ['https://github.githubassets.com/images/icons/emoji/unicode/1f4af.png?v8', '💯'],
        '+1': ['https://github.githubassets.com/images/icons/emoji/unicode/1f44d.png?v8', '👍'],
        shipit: ['https://github.githubassets.com/images/icons/emoji/shipit.png?v8'],
      }),
    );
    vi.stubGlobal('fetch', fetch);
    expect(await call('markdown.emojis', {})).toMatchObject({
      ok: true,
      result: [
        { name: '100', character: '💯' },
        { name: '+1', character: '👍' },
        { name: 'shipit', imageUrl: 'https://github.githubassets.com/images/icons/emoji/shipit.png?v8' },
      ],
    });
    const [first] = fetch.mock.calls;
    assert.isDefined(first);
    expect(first[0]).toBe('/autocomplete/emojis_for_editor');
    expect(first[1].headers).toMatchObject({ Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest', 'GitHub-Is-React': 'true' });

    fetch.mockImplementation(async () => Response.json({ '+1': { image: 'https://github.githubassets.com/images/icons/emoji/unicode/1f44d.png?v8' } }));
    expect(await call('markdown.emojis', {})).toMatchObject({ ok: false, error: expect.stringMatching(/^\/autocomplete\/emojis_for_editor did not match: /) });
  });
});

/** A request answered the way the content script answers the app's: read by its method's schemas, then handled. */
function call(method: string, args: unknown): Promise<RpcResponse> {
  try {
    return handleRpc(readRpcRequest({ kind: 'gg-rpc', id: 'req-1', method, args }));
  } catch (error) {
    return Promise.resolve({ kind: 'gg-rpc-result', id: 'req-1', ok: false, error: error instanceof Error ? error.message : String(error) });
  }
}
