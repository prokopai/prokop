import { z } from 'zod';
import { named } from './registry';

/**
 * JSON-RPC 2.0, one message per line over the agent's stdio, the same framing
 * as the Codex app-server (`harnesses/codex-cli/app-server.ts`). Both sides
 * send requests and notifications; responses go back on the same stream.
 */

export const RequestId = named('RequestId', z.union([z.number().int(), z.string()]));

export const RpcRequest = named('RpcRequest', z.object({
  jsonrpc: z.literal('2.0'),
  id: RequestId,
  method: z.string(),
  params: z.unknown(),
}));

export const RpcNotification = named('RpcNotification', z.object({
  jsonrpc: z.literal('2.0'),
  method: z.string(),
  params: z.unknown(),
}));

export const RpcError = named('RpcError', z.object({
  code: z.number().int(),
  message: z.string(),
  data: z.unknown().optional(),
}));

export const RpcResponse = named('RpcResponse', z.union([
  z.object({ jsonrpc: z.literal('2.0'), id: RequestId, result: z.unknown() }),
  z.object({ jsonrpc: z.literal('2.0'), id: RequestId.nullable(), error: RpcError }),
]));

export const RpcErrorCode = {
  ParseError: -32700,
  InvalidRequest: -32600,
  MethodNotFound: -32601,
  InvalidParams: -32602,
  InternalError: -32603,
  /** The request was cancelled with `$/cancel`. */
  Cancelled: -32800,
  /** The channel closed (peer exited); every in-flight request fails with this. */
  ChannelClosed: -32001,
  /** The peer answered with a result that does not match the method's schema. */
  InvalidResult: -32002,
} as const;
