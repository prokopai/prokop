import type { z } from 'zod';
import { RpcErrorCode } from './jsonrpc';
import type { NotificationSpec, RequestSpec } from './registry';

/** The methods one side sends: its requests and its notifications. */
export interface ProtocolSide {
  requests: Record<string, RequestSpec>;
  notifications: Record<string, NotificationSpec>;
}

/**
 * Carries whole JSON-RPC messages in send order. The in-process loopback
 * (`createLoopback`) is one implementation; stdio framing is another.
 */
export interface MessageChannel {
  send(message: unknown): void;
  /** Registers the single receiver. Messages sent earlier are buffered. */
  receive(handler: (message: unknown) => void): void;
  close(reason?: Error): void;
  /** Resolves with the reason once either end closes. */
  readonly closed: Promise<Error>;
}

/** An error response from the peer, or a local protocol failure for one request. */
export class RpcRequestError extends Error {
  constructor(readonly code: number, message: string, readonly data?: unknown) {
    super(message);
    this.name = 'RpcRequestError';
  }
}

export interface RequestContext {
  /** Aborted when the requester sends `$/cancel` or the channel closes. */
  signal: AbortSignal;
}

type RequestsOf<S extends ProtocolSide> = S['requests'];
type NotificationsOf<S extends ProtocolSide> = S['notifications'];

export type RequestHandlers<In extends ProtocolSide> = {
  [M in keyof RequestsOf<In>]?: (
    params: z.output<RequestsOf<In>[M]['params']>,
    context: RequestContext,
  ) => z.input<RequestsOf<In>[M]['result']> | Promise<z.input<RequestsOf<In>[M]['result']>>;
};

export type NotificationHandlers<In extends ProtocolSide> = {
  [M in keyof NotificationsOf<In>]?: (params: z.output<NotificationsOf<In>[M]['params']>) => void;
};

export interface Endpoint<Out extends ProtocolSide> {
  request<M extends keyof RequestsOf<Out> & string>(
    method: M,
    params: z.input<RequestsOf<Out>[M]['params']>,
    options?: { signal?: AbortSignal; timeoutMs?: number },
  ): Promise<z.output<RequestsOf<Out>[M]['result']>>;
  notify<M extends keyof NotificationsOf<Out> & string>(
    method: M,
    params: z.input<NotificationsOf<Out>[M]['params']>,
  ): void;
  close(reason?: Error): void;
  readonly closed: Promise<Error>;
}

const CANCEL = '$/cancel';

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : 'Request failed';
}

/**
 * One side of the protocol. `outgoing` is what this side sends, `incoming`
 * what it accepts. Incoming params and results are validated against the
 * protocol schemas. A request handler starts in arrival order and its
 * synchronous part runs before the next message is read, so synchronous
 * SQLite handlers apply writes in send order.
 */
export function createEndpoint<Out extends ProtocolSide, In extends ProtocolSide>(options: {
  channel: MessageChannel;
  outgoing: Out;
  incoming: In;
  handlers: RequestHandlers<In>;
  notifications?: NotificationHandlers<In>;
  /** Malformed messages and failing notification handlers. Never sent to the peer. */
  onProtocolError?: (error: Error) => void;
}): Endpoint<Out> {
  const { channel, outgoing, incoming } = options;
  const handlers = options.handlers as Record<string, ((params: unknown, context: RequestContext) => unknown) | undefined>;
  const notificationHandlers = (options.notifications ?? {}) as Record<string, ((params: unknown) => void) | undefined>;
  const reportProtocolError = (error: Error): void => options.onProtocolError?.(error);
  const pending = new Map<number, {
    method: string;
    resolve(value: unknown): void;
    reject(error: Error): void;
    cleanup(): void;
  }>();
  const running = new Map<string | number, AbortController>();
  let nextId = 1;
  let closedReason: Error | null = null;

  const send = (message: unknown): void => {
    if (closedReason) return;
    try {
      channel.send(message);
    } catch (error) {
      fail(error instanceof Error ? error : new Error('Channel send failed'));
    }
  };

  const fail = (reason: Error): void => {
    if (closedReason) return;
    closedReason = reason;
    for (const entry of pending.values()) {
      entry.cleanup();
      entry.reject(new RpcRequestError(RpcErrorCode.ChannelClosed, reason.message));
    }
    pending.clear();
    for (const controller of running.values()) controller.abort(reason);
    running.clear();
    channel.close(reason);
  };

  const respondError = (id: string | number | null, code: number, message: string, data?: unknown): void => {
    send({ jsonrpc: '2.0', id, error: data === undefined ? { code, message } : { code, message, data } });
  };

  const handleRequest = (id: string | number, method: string, rawParams: unknown): void => {
    const spec = incoming.requests[method];
    const handler = handlers[method];
    if (!spec || !handler) {
      respondError(id, RpcErrorCode.MethodNotFound, `Unknown method ${method}`);
      return;
    }
    const parsed = spec.params.safeParse(rawParams);
    if (!parsed.success) {
      respondError(id, RpcErrorCode.InvalidParams, `Invalid params for ${method}`, parsed.error.issues);
      return;
    }
    const controller = new AbortController();
    running.set(id, controller);
    let result: unknown;
    try {
      result = handler(parsed.data, { signal: controller.signal });
    } catch (error) {
      running.delete(id);
      respondError(id, RpcErrorCode.InternalError, errorText(error));
      return;
    }
    void Promise.resolve(result).then(
      (value) => {
        running.delete(id);
        send({ jsonrpc: '2.0', id, result: value ?? null });
      },
      (error: unknown) => {
        running.delete(id);
        if (controller.signal.aborted) respondError(id, RpcErrorCode.Cancelled, 'Request cancelled');
        else respondError(id, RpcErrorCode.InternalError, errorText(error));
      },
    );
  };

  const handleNotification = (method: string, rawParams: unknown): void => {
    if (method === CANCEL) {
      const id = record(rawParams)?.id;
      if (typeof id === 'string' || typeof id === 'number') running.get(id)?.abort(new Error('Request cancelled'));
      return;
    }
    const spec = incoming.notifications[method];
    const handler = notificationHandlers[method];
    if (!spec || !handler) {
      reportProtocolError(new Error(`Unhandled notification ${method}`));
      return;
    }
    const parsed = spec.params.safeParse(rawParams);
    if (!parsed.success) {
      reportProtocolError(new Error(`Invalid params for notification ${method}`));
      return;
    }
    try {
      handler(parsed.data);
    } catch (error) {
      reportProtocolError(error instanceof Error ? error : new Error(`Notification ${method} failed`));
    }
  };

  const handleResponse = (id: number, message: Record<string, unknown>): void => {
    const entry = pending.get(id);
    if (!entry) return; // Cancelled or timed out locally; the late answer is dropped.
    pending.delete(id);
    entry.cleanup();
    const error = record(message.error);
    if (error) {
      const code = typeof error.code === 'number' ? error.code : RpcErrorCode.InternalError;
      entry.reject(new RpcRequestError(code, typeof error.message === 'string' ? error.message : 'Request failed', error.data));
      return;
    }
    const parsed = outgoing.requests[entry.method]!.result.safeParse(message.result);
    if (parsed.success) entry.resolve(parsed.data);
    else entry.reject(new RpcRequestError(RpcErrorCode.InvalidResult, `Invalid result for ${entry.method}`, parsed.error.issues));
  };

  channel.receive((raw) => {
    if (closedReason) return;
    const message = record(raw);
    if (!message || message.jsonrpc !== '2.0') {
      reportProtocolError(new Error('Invalid JSON-RPC message'));
      return;
    }
    const { id, method } = message;
    const hasId = typeof id === 'string' || typeof id === 'number';
    if (typeof method === 'string') {
      if (hasId) handleRequest(id, method, message.params);
      else handleNotification(method, message.params);
    } else if (typeof id === 'number' && ('result' in message || 'error' in message)) {
      handleResponse(id, message);
    } else {
      reportProtocolError(new Error('Invalid JSON-RPC message'));
    }
  });
  void channel.closed.then(fail);

  return {
    request(method, params, requestOptions) {
      if (closedReason) {
        return Promise.reject(new RpcRequestError(RpcErrorCode.ChannelClosed, closedReason.message));
      }
      if (!outgoing.requests[method]) {
        return Promise.reject(new RpcRequestError(RpcErrorCode.MethodNotFound, `Unknown method ${method}`));
      }
      const signal = requestOptions?.signal;
      if (signal?.aborted) return Promise.reject(new RpcRequestError(RpcErrorCode.Cancelled, 'Request cancelled'));
      const id = nextId++;
      return new Promise((resolve, reject) => {
        let timer: ReturnType<typeof setTimeout> | undefined;
        const onAbort = (): void => {
          if (!pending.delete(id)) return;
          cleanup();
          send({ jsonrpc: '2.0', method: CANCEL, params: { id } });
          reject(new RpcRequestError(RpcErrorCode.Cancelled, 'Request cancelled'));
        };
        const cleanup = (): void => {
          if (timer) clearTimeout(timer);
          signal?.removeEventListener('abort', onAbort);
        };
        if (requestOptions?.timeoutMs !== undefined) {
          timer = setTimeout(() => {
            if (!pending.delete(id)) return;
            cleanup();
            send({ jsonrpc: '2.0', method: CANCEL, params: { id } });
            reject(new RpcRequestError(RpcErrorCode.Cancelled, `${method} timed out`));
          }, requestOptions.timeoutMs);
        }
        signal?.addEventListener('abort', onAbort, { once: true });
        pending.set(id, { method, resolve: resolve as (value: unknown) => void, reject, cleanup });
        send({ jsonrpc: '2.0', id, method, params });
      });
    },
    notify(method, params) {
      send({ jsonrpc: '2.0', method, params });
    },
    close(reason = new Error('Endpoint closed')) {
      fail(reason);
    },
    closed: channel.closed,
  };
}
