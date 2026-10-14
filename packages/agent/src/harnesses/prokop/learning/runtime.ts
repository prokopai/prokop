import type { LearningRuntimePort } from '@prokopai/core/application/ports/learning-runtime';
import { executeMemoryTool } from '#agent/harnesses/shared/memory/memory-tool';
import { executeSkillManageTool } from '#agent/harnesses/shared/skills/skill-manage-tool';

/**
 * What host-side learning (bootstrap/learning) takes from Prokop: its
 * identity and the memory and skill tool logic the host runs on staging
 * directories. The review itself runs through `runLearningReview`.
 */
export function createProkopLearningRuntime(): LearningRuntimePort {
  return {
    harness: 'prokop',
    // The host calls these on its own staging directories: always a local write.
    memory: (input, directory) => executeMemoryTool(input, directory, 'none', undefined, { local: true }),
    skills: (input, directory) => executeSkillManageTool(input, directory, 'none', undefined, { local: true }),
  };
}
