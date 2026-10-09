import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PrDetail } from '../model';
import { graphql } from './client';
import { fetchPullRequest } from './pull-request';
import { fetchPr, mutate } from './service';

vi.mock('./client', () => ({ graphql: vi.fn(async () => ({})) }));
vi.mock('./pull-request', () => ({ fetchPullRequest: vi.fn() }));

const repo = { owner: 'acme', name: 'widgets' };

describe('PR page cache', () => {
  beforeEach(() => {
    vi.mocked(fetchPullRequest).mockReset();
    vi.mocked(fetchPullRequest).mockImplementation(async () => ({ id: 'PR_1', threads: [{ id: 'THREAD_1' }] }) as PrDetail);
  });

  it('serves repeat loads from memory until forced', async () => {
    await fetchPr('token-a', repo, 1);
    await fetchPr('token-a', repo, 1);
    expect(fetchPullRequest).toHaveBeenCalledTimes(1);
    await fetchPr('token-a', repo, 1, true);
    expect(fetchPullRequest).toHaveBeenCalledTimes(2);
  });

  it('forgets a PR once a mutation touches it or one of its threads', async () => {
    await fetchPr('token-b', repo, 1);
    await mutate('token-b', 'THREAD_1', 'mutation', {});
    await fetchPr('token-b', repo, 1);
    expect(fetchPullRequest).toHaveBeenCalledTimes(2);
    expect(graphql).toHaveBeenCalledWith('token-b', 'mutation', {});
  });

  it('does not keep failures', async () => {
    vi.mocked(fetchPullRequest).mockRejectedValueOnce(new Error('boom'));
    await expect(fetchPr('token-c', repo, 1)).rejects.toThrow('boom');
    await expect(fetchPr('token-c', repo, 1)).resolves.toMatchObject({ id: 'PR_1' });
  });
});
