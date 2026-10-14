import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PrDetail } from '../model';
import type { RpcRequest } from '../rpc';
import { DEFAULT_SETTINGS } from '../settings';
import { handleRpc } from './index';
import { enrichPull, fetchInbox, fetchViewPage } from './inbox';
import { rememberPullRequest } from './mutations';
import { fetchPullRequestPage } from './pull-request';
import { topRepositories } from './repositories';

vi.mock('../settings', async (original) => ({ ...(await original<typeof import('../settings')>()), getSettings: vi.fn(async () => DEFAULT_SETTINGS) }));
vi.mock('./inbox', () => ({ fetchInbox: vi.fn(async () => [{ prs: [], totalCount: 0, fetchedAt: 'now' }]), enrichPull: vi.fn(), fetchViewPage: vi.fn() }));
vi.mock('./repositories', async (original) => ({ ...(await original<typeof import('./repositories')>()), topRepositories: vi.fn(async () => ({ repos: [], nextCursor: 7 })) }));
vi.mock('./pull-request', () => ({
  fetchPullRequestPage: vi.fn(async () => ({ id: 'PR_1', repo: { owner: 'o', name: 'r' }, number: 1, headOid: 'h', baseOid: 'b', stack: { source: 'none' }, threads: [] }) as unknown as PrDetail),
}));

afterEach(() => vi.unstubAllGlobals());

const call = (method: RpcRequest['method'], args: unknown) => handleRpc({ kind: 'gg-rpc', id: 'req-1', method, args } as RpcRequest);

describe('handleRpc', () => {
  it('answers with the request id, and serves repeat reads from the cache until forced', async () => {
    const views = [{ id: 'a', name: 'Mine', query: 'is:pr author:@me' }];
    expect(await call('inbox.fetch', { views })).toEqual({ kind: 'gg-rpc-result', id: 'req-1', ok: true, result: [{ view: views[0], prs: [], totalCount: 0, fetchedAt: 'now' }] });
    await call('inbox.fetch', { views });
    expect(fetchInbox).toHaveBeenCalledTimes(1);
    await call('inbox.fetch', { views, force: true });
    expect(fetchInbox).toHaveBeenCalledTimes(2);
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
    expect(await call('nope' as RpcRequest['method'], {})).toMatchObject({ ok: false, error: 'Unknown request: nope' });
  });

  it('fetches a later page of a view in the inbox scope, answering with the view as asked', async () => {
    const view = { id: 'a', name: 'Mine', query: 'is:pr author:@me' };
    vi.mocked(fetchViewPage).mockResolvedValue({ view: { ...view, name: 'Earlier name' }, prs: [], totalCount: 40, fetchedAt: 'now' });
    expect(await call('inbox.fetchMore', { view, page: 2 })).toMatchObject({ ok: true, result: { view, totalCount: 40 } });
    expect(fetchViewPage).toHaveBeenCalledWith(view, DEFAULT_SETTINGS.inboxScope, 2);
  });

  it("keeps the first page of the homepage's top repositories, and asks GitHub for every later one", async () => {
    await call('repos.top', {});
    expect(await call('repos.top', { cursor: null })).toMatchObject({ ok: true, result: { repos: [], nextCursor: 7 } });
    expect(topRepositories).toHaveBeenCalledTimes(1);
    await call('repos.top', { cursor: 7 });
    await call('repos.top', { cursor: 7 });
    expect(topRepositories).toHaveBeenCalledTimes(3);
    expect(topRepositories).toHaveBeenLastCalledWith(7);
  });

  it('enriches inbox rows three pull requests at a time, and keeps each answer', async () => {
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
    await call('inbox.enrich', { prs: prs.slice(0, 2) });
    expect(enrichPull).toHaveBeenCalledTimes(7);
  });

  it("previews Markdown with the form GitHub's comment box posts for a pull request, and keeps what it read", async () => {
    document.head.innerHTML = '<meta name="fetch-nonce" content="v2:n1"><meta name="release" content="r1">';
    rememberPullRequest({ id: 'PR_9', repo: { owner: 'o', name: 'r' }, number: 9, databaseId: 900, repositoryDatabaseId: 77 });
    await call('pr.fetch', { repo: { owner: 'o', name: 'r' }, number: 9 });
    const fetch = vi.fn(async (_path: string, _init: RequestInit) => new Response('<p><strong>Hi</strong></p>'));
    vi.stubGlobal('fetch', fetch);

    expect(await call('markdown.preview', { text: '**Hi**', prId: 'PR_9' })).toMatchObject({ ok: true, result: { html: '<p><strong>Hi</strong></p>' } });
    const [path, init] = fetch.mock.calls[0]!;
    expect([path, init.method]).toEqual(['/preview', 'POST']);
    expect(Object.fromEntries(init.body as FormData)).toEqual({ text: '**Hi**', issue: '900', repository: '77', project: '900', subject: '9', subject_type: 'PullRequest' });
    expect(init.headers).toEqual({ 'GitHub-Verified-Fetch': 'true', 'X-Requested-With': 'XMLHttpRequest', 'X-Fetch-Nonce': 'v2:n1', 'X-GitHub-Client-Version': 'r1' });
    await call('pr.fetch', { repo: { owner: 'o', name: 'r' }, number: 9 });
    expect(fetchPullRequestPage).toHaveBeenCalledTimes(1);
  });
});
