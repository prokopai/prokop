import type { AgentEndpoint } from '@prokopai/agent-protocol';
import { SandboxController } from '@/infrastructure/sandbox/controller';
import type { LlmCallContext, SandboxResponse } from '@/infrastructure/sandbox/types';

/**
 * The agent process's sandbox controller: every sandboxed model call is
 * answered by the host's controller (`sandbox.call`), so its rules, history
 * and the sandbox clients connected to the host work as in one process.
 */
export class ForwardingSandboxController extends SandboxController {
  private readonly calls = new Map<string, { sessionId: string; abort: AbortController }>();

  constructor(private readonly agent: AgentEndpoint) {
    super();
  }

  override async waitForResponse(context: LlmCallContext, abortSignal?: AbortSignal): Promise<SandboxResponse> {
    const abort = new AbortController();
    const signal = abortSignal ? AbortSignal.any([abortSignal, abort.signal]) : abort.signal;
    this.calls.set(context.callId, { sessionId: context.sessionId, abort });
    try {
      return await this.agent.request('sandbox.call', { context: context as unknown as Record<string, unknown> },
        { signal }) as unknown as SandboxResponse;
    } catch (error) {
      // Same rejection a local controller gives an aborted call.
      if (signal.aborted) throw new DOMException('The operation was aborted.', 'AbortError');
      throw error;
    } finally {
      this.calls.delete(context.callId);
    }
  }

  override complete(callId: string): void {
    this.agent.notify('sandbox.completed', { callId });
  }

  override rejectAllPendingForSession(sessionId: string): string[] {
    const rejected: string[] = [];
    for (const [callId, call] of this.calls) {
      if (call.sessionId !== sessionId) continue;
      call.abort.abort();
      rejected.push(callId);
    }
    return rejected;
  }
}
