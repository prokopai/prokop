import type { ToolResult } from '@prokopai/sdk/tool';

/**
 * Agent side of a learning review's tools. The review runs in the agent
 * (a headless run with a `learning` spec); each tool call goes back to the
 * host, which runs it against the review it opened for the session.
 */
export interface LearningReviewToolPort {
  call(sessionId: string, name: string, input: unknown): Promise<ToolResult>;
}

let current: LearningReviewToolPort | null = null;

export function installLearningReviewToolPort(port: LearningReviewToolPort | null): void {
  current = port;
}

/** Fails closed per call when no port is installed. */
export function getLearningReviewToolPort(): LearningReviewToolPort {
  return current ?? { call: async () => ({ success: false, error: 'Learning review tools are unavailable' }) };
}
