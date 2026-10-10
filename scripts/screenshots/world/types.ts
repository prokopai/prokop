import type { Step } from '../script';

export type WorktreeName = 'stats-expired-flag' | 'rate-limit' | 'build-script';

/**
 * One scripted conversation. The world plays it to where scenes need it;
 * a clip queues the same steps and sends the prompt from the recorded client.
 */
export interface Story {
  title: string;
  prompt: string;
  steps: Step[];
  /** The managed worktree the session runs in; omitted for the main checkout. */
  worktree?: WorktreeName;
  /** Where the world leaves the turn, see `Demo.runTurn`. */
  until?: 'idle' | 'running' | 'ask';
}

/**
 * The repo as scripted tool calls name it. The server's HOME is the fake
 * home, so `~/` resolves to the real repo while transcripts show a clean
 * path instead of the temp directory.
 */
export const REPO_DISPLAY_PATH = '~/code/linkshelf';

export function repoPath(path: string): string {
  return `${REPO_DISPLAY_PATH}/${path}`;
}
