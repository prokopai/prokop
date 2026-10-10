/**
 * The demo world every scene views: one workspace on the linkshelf repo with
 * sessions in different states, three of them in their own worktrees. Built
 * once per run; scenes only open views.
 */
import { createDemoRepo } from '../seed';
import type { Demo } from '../script';
import { buildScript } from './build-script';
import { explainSlugs } from './explain-slugs';
import { fixExpiredLinks } from './fix-expired-links';
import { rateLimit } from './rate-limit';
import { statsExpiredFlag } from './stats-expired-flag';
import type { Story, WorktreeName } from './types';

export { FIX_EXPIRED_LINKS_READY } from './fix-expired-links';
export type { Story } from './types';

/** Oldest first, so the hero session ends up on top of the sidebar. */
export const STORIES = { explainSlugs, statsExpiredFlag, rateLimit, buildScript, fixExpiredLinks } satisfies Record<string, Story>;
export type StoryName = keyof typeof STORIES;

const WORKTREES: Record<WorktreeName, string> = {
  'stats-expired-flag': 'feat/stats-expired-flag',
  'rate-limit': 'feat/rate-limit',
  'build-script': 'chore/build-script',
};

export interface World {
  repo: string;
  workspaceId: string;
  worktrees: Record<WorktreeName, string>;
  sessions: Record<StoryName, string>;
}

/** The world for clips: stories they play live are missing until recorded. */
export interface ClipWorld extends Omit<World, 'sessions'> {
  sessions: Partial<World['sessions']>;
}

/** Creates the story's titled session, bound to its worktree. */
export async function createStorySession(demo: Demo, world: Pick<World, 'workspaceId' | 'worktrees'>, story: Story): Promise<string> {
  const { session } = await demo.rest.sessions.create({ workspaceId: world.workspaceId, title: story.title });
  if (story.worktree) await demo.rest.sessions.bindWorktree(session.id, world.worktrees[story.worktree]);
  await demo.scriptTitle(session.id, story.title);
  return session.id;
}

/** Builds the world, leaving out the `live` stories. */
export async function buildClipWorld(demo: Demo, home: string, live: readonly StoryName[] = []): Promise<ClipWorld> {
  const repo = createDemoRepo(home);
  const { workspace } = await demo.rest.workspaces.create({ name: 'linkshelf', path: repo });
  const worktrees = {} as Record<WorktreeName, string>;
  for (const [name, branch] of Object.entries(WORKTREES) as Array<[WorktreeName, string]>) {
    worktrees[name] = (await demo.rest.workspaces.createWorktree(workspace.id, { name, branch: `refs/heads/${branch}` })).worktree.id;
  }
  const world: ClipWorld = { repo, workspaceId: workspace.id, worktrees, sessions: {} };

  for (const [name, story] of Object.entries(STORIES) as Array<[StoryName, Story]>) {
    if (live.includes(name)) continue;
    const sessionId = await createStorySession(demo, world, story);
    await demo.runTurn(sessionId, story.prompt, story.steps, { until: story.until });
    world.sessions[name] = sessionId;
  }
  return world;
}

export async function buildWorld(demo: Demo, home: string): Promise<World> {
  const world = await buildClipWorld(demo, home);
  // Nothing was left out, so every story has its session.
  return { ...world, sessions: world.sessions as World['sessions'] };
}
