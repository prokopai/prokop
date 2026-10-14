import type { ToolResult } from '@prokopai/sdk/tool';

export type LearningReviewToolHandler = (name: string, input: unknown) => Promise<ToolResult>;

/** Host-side tools of running learning reviews, keyed by review session. */
export interface LearningReviewToolRegistry {
  /** Serves the session's review tools until the returned close is called. */
  open(sessionId: string, handler: LearningReviewToolHandler): () => void;
  call(sessionId: string, name: string, input: unknown): Promise<ToolResult>;
}

export function createLearningReviewToolRegistry(): LearningReviewToolRegistry {
  const open = new Map<string, LearningReviewToolHandler>();
  return {
    open(sessionId, handler) {
      if (open.has(sessionId)) throw new Error('A learning review is already running for this session');
      open.set(sessionId, handler);
      return () => {
        if (open.get(sessionId) === handler) open.delete(sessionId);
      };
    },
    async call(sessionId, name, input) {
      const handler = open.get(sessionId);
      if (!handler) return { success: false, error: 'Learning execution context is no longer authorized' };
      return handler(name, input);
    },
  };
}

/** The host's registry: wired learning opens reviews here, the agent's calls arrive here. */
export const learningReviewTools = createLearningReviewToolRegistry();
