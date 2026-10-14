import type { MessageChannel } from './endpoint';

/**
 * Two connected in-process channel ends. Every message goes through
 * `JSON.stringify`/`JSON.parse`, so the loopback drops and converts exactly
 * what stdio framing would (undefined fields, functions, Dates). Delivery is
 * asynchronous and in send order. Closing either end closes both.
 */
export function createLoopback(): [MessageChannel, MessageChannel] {
  let closedReason: Error | null = null;
  let resolveClosed!: (reason: Error) => void;
  const closed = new Promise<Error>((resolve) => { resolveClosed = resolve; });
  const close = (reason = new Error('Channel closed')): void => {
    if (closedReason) return;
    closedReason = reason;
    resolveClosed(reason);
  };

  class End implements MessageChannel {
    peer!: End;
    readonly closed = closed;
    private handler: ((message: unknown) => void) | null = null;
    private readonly buffered: string[] = [];

    send(message: unknown): void {
      if (closedReason) throw new Error('Channel closed');
      const text = JSON.stringify(message);
      queueMicrotask(() => this.peer.deliver(text));
    }

    receive(handler: (message: unknown) => void): void {
      if (this.handler) throw new Error('Loopback channel already has a receiver');
      this.handler = handler;
      for (const text of this.buffered.splice(0)) handler(JSON.parse(text) as unknown);
    }

    close(reason?: Error): void {
      close(reason);
    }

    private deliver(text: string): void {
      if (closedReason) return;
      if (this.handler) this.handler(JSON.parse(text) as unknown);
      else this.buffered.push(text);
    }
  }

  const left = new End();
  const right = new End();
  left.peer = right;
  right.peer = left;
  return [left, right];
}
