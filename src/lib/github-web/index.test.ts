import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PrDetail } from '../model';
import type { RpcRequest } from '../rpc';
import { DEFAULT_SETTINGS } from '../settings';
import { handleRpc } from './index';
import { fetchInbox } from './inbox';
import { fetchPullRequestPage } from './pull-request';

vi.mock('../settings', async (original) => ({ ...(await original<typeof import('../settings')>()), getSettings: vi.fn(async () => DEFAULT_SETTINGS) }));
vi.mock('./inbox', () => ({ fetchInbox: vi.fn(async () => [{ prs: [], totalCount: 0, fetchedAt: 'now' }]) }));
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

  it('forgets cached pages after a successful write, and reports failures as errors', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({})));
    await call('pr.fetch', { repo: { owner: 'o', name: 'r' }, number: 1 });
    await call('pr.fetch', { repo: { owner: 'o', name: 'r' }, number: 1 });
    expect(fetchPullRequestPage).toHaveBeenCalledTimes(1);
    expect(await call('pr.comment', { prId: 'PR_1', body: 'hi' })).toMatchObject({ ok: true });
    await call('pr.fetch', { repo: { owner: 'o', name: 'r' }, number: 1 });
    expect(fetchPullRequestPage).toHaveBeenCalledTimes(2);

    expect(await call('pr.comment', { prId: 'PR_unknown', body: 'hi' })).toEqual({ kind: 'gg-rpc-result', id: 'req-1', ok: false, error: 'Open the pull request first' });
    expect(await call('nope' as RpcRequest['method'], {})).toMatchObject({ ok: false, error: 'Unknown request: nope' });
  });
});
