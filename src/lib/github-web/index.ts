// Answers RPC requests using the github.com session: same-origin fetches from the content script
// against the JSON endpoints GitHub's own React UI uses. No token, no api.github.com.
// (Stub: the data-layer slice replaces this file.)

import type { RpcRequest, RpcResponse } from '../rpc';

export async function handleRpc(request: RpcRequest): Promise<RpcResponse> {
  return { kind: 'gg-rpc-result', id: request.id, ok: false, error: `${request.method} is not implemented yet` };
}
