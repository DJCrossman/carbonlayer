import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PrDetail } from '../model';
import { mutations, rememberPullRequest } from './mutations';

// Every request the mutations send, as `METHOD path body`; GETs are answered from `reads`.
let sent: Array<{ method: string; path: string; body: unknown }> = [];
let reads: Record<string, unknown> = {};

beforeEach(() => {
  sent = [];
  reads = {};
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit = {}) => {
      const method = init.method ?? 'GET';
      if (method === 'GET') {
        const key = Object.keys(reads).find((prefix) => url.startsWith(prefix));
        return key ? Response.json(reads[key]) : Response.json({ error: 'Not Found' }, { status: 404 });
      }
      sent.push({ method, path: url, body: init.body ? JSON.parse(String(init.body)) : undefined });
      return Response.json({ status: 'merged', uuid: 'u-1' });
    }),
  );
  rememberPullRequest(pullRequest({ id: 'PR_1', stackSource: 'none' }));
  rememberPullRequest(pullRequest({ id: 'PR_2', number: 2, stackSource: 'native' }));
});

afterEach(() => vi.unstubAllGlobals());

const P = '/o/r/pull/1/page_data';

describe('mutations', () => {
  it('submits a review after adding its batched inline comments to the pending review', async () => {
    await mutations['pr.review']({ prId: 'PR_1', event: 'REQUEST_CHANGES', body: 'Needs work', threads: [{ path: 'a.ts', line: 3, side: 'LEFT', body: 'Why?' }] });
    expect(sent).toEqual([
      {
        method: 'POST',
        path: `${P}/create_review_comment`,
        body: {
          text: 'Why?',
          submitBatch: false,
          comparisonStartOid: 'base',
          comparisonEndOid: 'head',
          subjectType: 'line',
          path: 'a.ts',
          line: 3,
          side: 'left',
          positioning: { type: 'line', baseCommitOid: 'base', headCommitOid: 'head', path: 'a.ts', line: 3, commitOid: 'base' },
        },
      },
      { method: 'PUT', path: `${P}/submit_review`, body: { body: 'Needs work', event: 'request changes', headSha: 'head' } },
    ]);
  });

  it('posts single comments, replies and thread resolution', async () => {
    await mutations['pr.comment']({ prId: 'PR_1', body: 'Thanks' });
    await mutations['pr.addThread']({ prId: 'PR_1', path: 'a.ts', line: 9, side: 'RIGHT', body: 'Nice' });
    await mutations['pr.replyThread']({ threadId: '100', body: 'Done' });
    await mutations['pr.resolveThread']({ threadId: '100', resolved: true });
    await mutations['pr.resolveThread']({ threadId: '100', resolved: false });
    expect(sent[0]).toEqual({ method: 'POST', path: `${P}/create_timeline_comment`, body: { text: 'Thanks' } });
    expect(sent[1]?.body).toMatchObject({ submitBatch: true, side: 'right', positioning: { commitOid: 'head' } });
    expect(sent[2]).toEqual({
      method: 'POST',
      path: `${P}/create_review_comment`,
      body: { text: 'Done', submitBatch: true, inReplyTo: 9002, path: 'src/a.ts', comparisonStartOid: 'base', comparisonEndOid: 'head' },
    });
    expect(sent.slice(3)).toEqual([
      { method: 'POST', path: `${P}/resolve_thread`, body: { threadId: '100' } },
      { method: 'POST', path: `${P}/unresolve_thread`, body: { threadId: '100' } },
    ]);
  });

  it('merges with the commit message GitHub proposes, but not after new pushes', async () => {
    reads = {
      [`${P}/header`]: { pullRequest: { headSha: 'head' } },
      [`${P}/merge_box`]: { mergeRequirements: { commitMessageHeadline: 'Add widgets (#1)', commitMessageBody: '* one' } },
    };
    await mutations['pr.merge']({ prId: 'PR_1', method: 'SQUASH', expectedHeadOid: 'head' });
    expect(sent).toEqual([
      { method: 'POST', path: `${P}/merge`, body: { mergeMethod: 'SQUASH', commitTitle: 'Add widgets (#1)', commitMessage: '* one', bypassBranchProtections: false } },
    ]);

    reads[`${P}/header`] = { pullRequest: { headSha: 'newer' } };
    await expect(mutations['pr.merge']({ prId: 'PR_1', method: 'SQUASH', expectedHeadOid: 'head' })).rejects.toThrow('New commits were pushed');
  });

  it('merges a GitHub-native stack through the stack queue', async () => {
    reads = { '/o/r/pull/2/page_data/header': { pullRequest: { headSha: 'head' } }, '/o/r/pull/2/page_data/merge_box': { mergeRequirements: {} } };
    await mutations['pr.merge']({ prId: 'PR_2', method: 'MERGE', expectedHeadOid: 'head' });
    expect(sent).toEqual([
      { method: 'POST', path: '/o/r/pull/2/page_data/enqueue_stack', body: { mergeAction: 'DIRECT_MERGE', mergeMethod: 'MERGE', commitTitle: '', commitMessage: '', bypassRules: 'false' } },
    ]);
  });

  it('toggles viewed files, draft state and auto-merge', async () => {
    reads = { [`${P}/merge_box`]: { mergeRequirements: { commitMessageHeadline: 'T', commitMessageBody: 'B' } } };
    await mutations['pr.markFileViewed']({ prId: 'PR_1', path: 'a.ts', viewed: true });
    await mutations['pr.markFileViewed']({ prId: 'PR_1', path: 'a.ts', viewed: false });
    await mutations['pr.setDraft']({ prId: 'PR_1', draft: true });
    await mutations['pr.setDraft']({ prId: 'PR_1', draft: false });
    await mutations['pr.setAutoMerge']({ prId: 'PR_1', enabled: true, method: 'REBASE' });
    await mutations['pr.setAutoMerge']({ prId: 'PR_1', enabled: false, method: 'REBASE' });
    expect(sent.map(({ method, path, body }) => [method, path, body])).toEqual([
      ['POST', '/o/r/pull/1/file_review', { path: 'a.ts', viewed: 'viewed' }],
      ['DELETE', '/o/r/pull/1/file_review', { path: 'a.ts', _method: 'delete' }],
      ['POST', `${P}/convert_to_draft`, undefined],
      ['POST', `${P}/mark_ready_for_review`, undefined],
      ['POST', `${P}/enable_auto_merge`, { mergeMethod: 'REBASE', commitTitle: 'T', commitMessage: 'B' }],
      ['POST', `${P}/disable_auto_merge`, undefined],
    ]);
  });

  it('refuses to write to a pull request the app has not loaded', async () => {
    await expect(mutations['pr.comment']({ prId: 'PR_unknown', body: 'x' })).rejects.toThrow('Open the pull request first');
    await expect(mutations['pr.resolveThread']({ threadId: 'nope', resolved: true })).rejects.toThrow('Open the pull request first');
  });
});

function pullRequest({ id, number = 1, stackSource }: { id: string; number?: number; stackSource: 'native' | 'none' }): PrDetail {
  return {
    id,
    repo: { owner: 'o', name: 'r' },
    number,
    headOid: 'head',
    baseOid: 'base',
    stack: { entries: [], currentIndex: 0, trunk: 'main', source: stackSource },
    threads: [{ id: `${number}00`, path: 'src/a.ts', comments: [{ id: '9001' }, { id: '9002' }] }],
  } as unknown as PrDetail;
}
