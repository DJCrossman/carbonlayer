// RPC contract between the content scripts / pages (callers) and the background (handler).
// Callers use `rpc('pr.fetch', { ... })`; the background registers one handler per method.

import type { PrDetail, RepoRef, View, ViewResult } from './model';

export type MergeMethod = 'MERGE' | 'SQUASH' | 'REBASE';

export interface Settings {
  /** PAT lives in chrome.storage.local only; never synced. */
  token: string;
  views: View[];
  inboxEnabled: boolean;
  prEnabled: boolean;
  diffLayout: 'unified' | 'split';
  theme: 'auto' | 'light' | 'dark';
}

export interface RpcMethods {
  'settings.get': { args: undefined; result: Settings };
  'settings.set': { args: Partial<Settings>; result: Settings };
  'auth.status': { args: undefined; result: { ok: boolean; login: string | null; error: string | null } };
  'inbox.fetch': { args: { views: View[]; force?: boolean }; result: ViewResult[] };
  'pr.fetch': { args: { repo: RepoRef; number: number; force?: boolean }; result: PrDetail };
  'pr.review': {
    args: { prId: string; event: 'APPROVE' | 'REQUEST_CHANGES' | 'COMMENT'; body: string };
    result: undefined;
  };
  'pr.comment': { args: { prId: string; body: string }; result: undefined };
  'pr.merge': { args: { prId: string; method: MergeMethod; expectedHeadOid: string }; result: undefined };
  'pr.addThread': {
    args: { prId: string; path: string; line: number; side: 'LEFT' | 'RIGHT'; body: string };
    result: undefined;
  };
  'pr.replyThread': { args: { threadId: string; body: string }; result: undefined };
  'pr.resolveThread': { args: { threadId: string; resolved: boolean }; result: undefined };
  'pr.markFileViewed': { args: { prId: string; path: string; viewed: boolean }; result: undefined };
  'pr.setDraft': { args: { prId: string; draft: boolean }; result: undefined };
}

export type RpcMethod = keyof RpcMethods;

export interface RpcRequest<M extends RpcMethod = RpcMethod> {
  kind: 'gg-rpc';
  method: M;
  args: RpcMethods[M]['args'];
}

export type RpcResponse<M extends RpcMethod = RpcMethod> =
  | { ok: true; result: RpcMethods[M]['result'] }
  | { ok: false; error: string };

export async function rpc<M extends RpcMethod>(method: M, args: RpcMethods[M]['args']): Promise<RpcMethods[M]['result']> {
  const request: RpcRequest<M> = { kind: 'gg-rpc', method, args };
  const response = (await chrome.runtime.sendMessage(request)) as RpcResponse<M> | undefined;
  if (!response) throw new Error(`No response from background for ${method}`);
  if (!response.ok) throw new Error(response.error);
  return response.result;
}
