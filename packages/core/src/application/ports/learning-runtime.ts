import type { SessionHarness } from '@prokopai/sdk';

/** Knowledge destinations a learning run writes to. */
export interface LearningKnowledgeDirectories {
  memoryDirectory: string;
  skillsDirectory: string;
}

/** Outcome of a memory or skill operation on a staging directory. */
export interface LearningKnowledgeResult {
  success: boolean;
  error?: string;
}

/**
 * What host-side learning needs from the reviewing harness besides the
 * review run itself, which goes through the headless port with a
 * `learning` spec. The host runs the harness's memory and skill tool logic
 * against an isolated staging directory; staging, journaling and activation
 * stay host-owned.
 */
export interface LearningRuntimePort {
  /** Harness identity stamped on learning-created sessions. */
  harness: SessionHarness;
  memory(input: Record<string, unknown>, directory: string): Promise<LearningKnowledgeResult>;
  skills(input: Record<string, unknown>, directory: string): Promise<LearningKnowledgeResult>;
}
