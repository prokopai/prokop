import type { MessageChannel } from './endpoint';

/** Where outgoing lines go: a child's stdin (`FileSink`) or this process's stdout. */
export interface LineWriter {
  write(text: string): unknown;
  /** Pushes buffered bytes to the peer now (Bun `FileSink`). */
  flush?(): unknown;
  end?(): unknown;
}

export interface StreamChannelOptions {
  readable: ReadableStream<Uint8Array>;
  writer: LineWriter;
  /** A line that is not JSON. The line is dropped; the channel stays open. */
  onInvalidLine?: (line: string, error: Error) => void;
}

/**
 * A channel over a byte stream pair, one JSON message per line (the Codex
 * app-server framing). Same contract as the loopback: messages arrive in
 * send order, are buffered until a receiver registers, and `closed`
 * resolves once, on `close()`, end of input or a read error.
 */
export function createStreamChannel(options: StreamChannelOptions): MessageChannel {
  let closedReason: Error | null = null;
  let resolveClosed!: (reason: Error) => void;
  const closed = new Promise<Error>((resolve) => { resolveClosed = resolve; });
  let handler: ((message: unknown) => void) | null = null;
  const buffered: unknown[] = [];
  const reader = options.readable.getReader();

  const finish = (reason: Error): void => {
    if (closedReason) return;
    closedReason = reason;
    void reader.cancel().catch(() => {});
    try {
      options.writer.end?.();
    } catch {
      // The peer may already be gone.
    }
    resolveClosed(reason);
  };

  const deliver = (line: string): void => {
    if (!line.trim()) return;
    let message: unknown;
    try {
      message = JSON.parse(line);
    } catch (error) {
      options.onInvalidLine?.(line, error instanceof Error ? error : new Error(String(error)));
      return;
    }
    if (handler) handler(message);
    else buffered.push(message);
  };

  void (async () => {
    const decoder = new TextDecoder();
    let pending = '';
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        pending += decoder.decode(value, { stream: true });
        let newline = pending.indexOf('\n');
        while (newline >= 0 && !closedReason) {
          deliver(pending.slice(0, newline));
          pending = pending.slice(newline + 1);
          newline = pending.indexOf('\n');
        }
        if (closedReason) return;
      }
      pending += decoder.decode();
      if (pending) deliver(pending);
      finish(new Error('Channel closed: end of input'));
    } catch (error) {
      finish(error instanceof Error ? error : new Error(String(error)));
    }
  })();

  return {
    closed,
    send(message) {
      if (closedReason) throw new Error('Channel closed');
      options.writer.write(`${JSON.stringify(message)}\n`);
      options.writer.flush?.();
    },
    receive(next) {
      if (handler) throw new Error('Stream channel already has a receiver');
      handler = next;
      for (const message of buffered.splice(0)) next(message);
    },
    close(reason = new Error('Channel closed')) {
      finish(reason);
    },
  };
}
