// The service worker: answers RPC messages (src/lib/rpc.ts) from the app iframe, content script, options
// page and popup by calling GitHub with the PAT from settings. The token never leaves this worker.

import {
  ADD_COMMENT,
  ADD_REVIEW,
  CONVERT_TO_DRAFT,
  DISABLE_AUTO_MERGE,
  ENABLE_AUTO_MERGE,
  MARK_FILE_VIEWED,
  MARK_READY_FOR_REVIEW,
  MERGE_PULL_REQUEST,
  REPLY_TO_THREAD,
  RESOLVE_THREAD,
  UNMARK_FILE_VIEWED,
  UNRESOLVE_THREAD,
} from '../src/lib/github/queries';
import { authStatus, fetchInbox, fetchPr, mutate } from '../src/lib/github/service';
import type { RpcMethod, RpcMethods, RpcRequest, RpcResponse } from '../src/lib/rpc';
import { getSettings, type Settings } from '../src/lib/settings';

export default defineBackground(() => {
  browser.runtime.onMessage.addListener((message: unknown, _sender, sendResponse: (response: RpcResponse) => void) => {
    if (!isRpcRequest(message)) return;
    void answer(message).then(sendResponse);
    return true; // Keeps the channel open for the async response.
  });
});

const handlers: { [M in RpcMethod]: (args: RpcMethods[M]['args'], settings: Settings) => Promise<RpcMethods[M]['result']> } = {
  'auth.status': (_args, { token }) => authStatus(token),
  'inbox.fetch': ({ views, force }, { token, inboxScope }) => fetchInbox(token, views, inboxScope, force),
  'pr.fetch': ({ repo, number, force }, { token }) => fetchPr(token, repo, number, force),
  'pr.review': ({ prId, event, body, threads }, { token }) => mutate(token, prId, ADD_REVIEW, { prId, event, body, threads }),
  'pr.comment': ({ prId, body }, { token }) => mutate(token, prId, ADD_COMMENT, { subjectId: prId, body }),
  'pr.merge': ({ prId, method, expectedHeadOid }, { token }) => mutate(token, prId, MERGE_PULL_REQUEST, { prId, method, expectedHeadOid }),
  // A single inline comment is a one-comment review, as GitHub's own "Add single comment" does.
  'pr.addThread': ({ prId, path, line, side, body }, { token }) =>
    mutate(token, prId, ADD_REVIEW, { prId, event: 'COMMENT', threads: [{ path, line, side, body }] }),
  'pr.replyThread': ({ threadId, body }, { token }) => mutate(token, threadId, REPLY_TO_THREAD, { threadId, body }),
  'pr.resolveThread': ({ threadId, resolved }, { token }) => mutate(token, threadId, resolved ? RESOLVE_THREAD : UNRESOLVE_THREAD, { threadId }),
  'pr.markFileViewed': ({ prId, path, viewed }, { token }) =>
    mutate(token, prId, viewed ? MARK_FILE_VIEWED : UNMARK_FILE_VIEWED, { prId, path }),
  'pr.setDraft': ({ prId, draft }, { token }) => mutate(token, prId, draft ? CONVERT_TO_DRAFT : MARK_READY_FOR_REVIEW, { prId }),
  'pr.setAutoMerge': ({ prId, enabled, method }, { token }) =>
    enabled ? mutate(token, prId, ENABLE_AUTO_MERGE, { prId, method }) : mutate(token, prId, DISABLE_AUTO_MERGE, { prId }),
};

async function answer(request: RpcRequest): Promise<RpcResponse> {
  try {
    // Read on every call: settings are cheap to read and the user may have just changed the token.
    const settings = await getSettings();
    // The table is typed per method; this one call site cannot express the method/args correlation.
    const handler = handlers[request.method] as (args: unknown, settings: Settings) => Promise<RpcMethods[RpcMethod]['result']>;
    return { ok: true, result: await handler(request.args, settings) };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[rpc] ${request.method} failed: ${message}`);
    return { ok: false, error: message };
  }
}

function isRpcRequest(message: unknown): message is RpcRequest {
  if (typeof message !== 'object' || message === null) return false;
  const { kind, method } = message as { kind?: unknown; method?: unknown };
  return kind === 'gg-rpc' && typeof method === 'string' && Object.hasOwn(handlers, method);
}
