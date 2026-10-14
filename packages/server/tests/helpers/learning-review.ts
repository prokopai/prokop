import type { Preconfig } from '@prokopai/sdk';
import type { ToolResult } from '@prokopai/sdk/tool';
import type { LearningReviewToolRegistry } from '@/application/learning/review-tools';
import type { HeadlessSessionRunPort } from '@/application/ports/headless-execution';

/** What a learning review sees agent-side: its run input and its host-backed tools. */
export interface ReviewCall {
  sessionId: string;
  preconfig: Preconfig;
  prompt: string;
  systemPrompt: string;
  scope: 'workspace' | 'agent';
  improveSkills: boolean;
  signal: AbortSignal;
  knowledge(name: string, input: unknown): Promise<ToolResult>;
  search(input: unknown): Promise<ToolResult>;
  home?: (input: unknown) => Promise<ToolResult>;
}

/**
 * A headless port standing in for the agent: Prokop learning runs reach
 * `review`, whose tool calls go through the host registry exactly like
 * `learning.tool` calls from the agent.
 */
export function reviewHeadless(
  tools: LearningReviewToolRegistry,
  review: (call: ReviewCall) => Promise<{ error?: string }>,
): Pick<HeadlessSessionRunPort, 'run' | 'supportedHarnesses'> {
  return {
    supportedHarnesses: () => ['prokop'],
    async run(input, options) {
      if (!input.learning) throw new Error('Expected a learning review run');
      const sessionId = input.childSessionId;
      return review({
        sessionId, preconfig: input.preconfig, prompt: input.prompt,
        systemPrompt: input.learning.systemPrompt, scope: input.learning.scope,
        improveSkills: input.learning.improveSkills, signal: options?.signal ?? new AbortController().signal,
        knowledge: (name, args) => tools.call(sessionId, name, args),
        search: args => tools.call(sessionId, 'session_search', args),
        home: input.learning.home ? args => tools.call(sessionId, 'home_files', args) : undefined,
      });
    },
  };
}
