import type { HeadlessSessionRunInput, HeadlessSessionRunResult, LearningReviewSpec } from '@prokopai/core/application/ports/headless-execution';
import { getLearningReviewToolPort } from '@prokopai/core/application/ports/learning-review-tools';
import { listDomainToolFallbackDefinitions } from '@prokopai/core/infrastructure/tools/domain-tool-source';
import { executeLearningComposition } from './learning-composition';

export { createProkopLearningRuntime } from './runtime';


/**
 * A learning review as a headless run: an isolated agent scope with only the
 * review tools, each of which calls back to the host
 * (`LearningReviewToolPort`, `learning.tool` over the agent protocol).
 */
export function runLearningReview(
  input: HeadlessSessionRunInput & { learning: LearningReviewSpec },
  signal: AbortSignal | undefined,
  execute?: Parameters<typeof executeLearningComposition>[1],
): Promise<HeadlessSessionRunResult> {
  const tools = getLearningReviewToolPort();
  return executeLearningComposition({
    sessionId: input.childSessionId, workspaceId: input.workspaceId, workspacePath: input.workspacePath ?? '',
    preconfig: input.preconfig, systemPrompt: input.learning.systemPrompt, prompt: input.prompt,
    signal: signal ?? new AbortController().signal,
    scope: input.learning.scope, improveSkills: input.learning.improveSkills, home: input.learning.home,
    definitions: listDomainToolFallbackDefinitions(),
    call: (name, args) => tools.call(input.childSessionId, name, args),
  }, execute);
}
