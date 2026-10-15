import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { readRpcRequest, rpc } from './rpc';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('readRpcRequest', () => {
  it("reads a request's args by its method's schema", () => {
    expect(readRpcRequest({ kind: 'gg-rpc', id: 'req-1', method: 'pr.comment', args: { prId: 'PR_1', body: 'Looks good', extra: 1 } })).toEqual({
      kind: 'gg-rpc',
      id: 'req-1',
      method: 'pr.comment',
      args: { prId: 'PR_1', body: 'Looks good' },
    });
  });

  it('refuses a method this build does not have, and args of another shape, naming what differs', () => {
    expect(() => readRpcRequest({ kind: 'gg-rpc', id: 'req-1', method: 'nope', args: {} })).toThrow('Unknown request: nope');
    expect(() => readRpcRequest({ kind: 'gg-rpc', id: 'req-1', method: 'pr.merge', args: { prId: 'PR_1', method: 'FAST_FORWARD', expectedHeadOid: 'abc' } })).toThrow(
      /pr\.merge was asked with args of another shape: .*\n.*method/,
    );
  });
});

describe('rpc', () => {
  it("reads the content script's answer by the method's schema, and refuses one of another shape, saying what differs", async () => {
    // The app sits inside github.com's page, which a frame's window stands in for, answering each request with `answer`.
    const frame = document.body.appendChild(document.createElement('iframe'));
    const parent = frame.contentWindow;
    if (!parent) throw new Error('happy-dom gave the frame no window');
    let answer: (id: string) => unknown = () => null;
    vi.spyOn(window, 'parent', 'get').mockReturnValue(parent);
    vi.spyOn(parent, 'postMessage').mockImplementation((request: unknown) => {
      const { id } = z.object({ id: z.string() }).parse(request);
      setTimeout(() => window.dispatchEvent(new MessageEvent('message', { data: answer(id), origin: 'https://github.com', source: parent })));
    });
    answer = (id) => ({ kind: 'gg-rpc-result', id, ok: true, result: { offered: true, unread: 1 } });
    await expect(rpc('pr.rerunAllJobs', { prId: 'PR_1', runId: '7' })).resolves.toEqual({ offered: true });
    answer = (id) => ({ kind: 'gg-rpc-result', id, ok: true, result: { offered: 'yes' } });
    await expect(rpc('pr.rerunAllJobs', { prId: 'PR_1', runId: '7' })).rejects.toThrow(/The answer to pr\.rerunAllJobs did not match: .*\n.*offered/);
  });
});
