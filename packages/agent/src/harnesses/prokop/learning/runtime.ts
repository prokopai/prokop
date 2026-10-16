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
    memory: (input, directory) => executeMemoryTool(input, directory, 'none'),
    skills: (input, directory) => executeSkillManageTool(input, directory, 'none'),
  };
}
