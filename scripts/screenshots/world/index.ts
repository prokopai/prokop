/**
 * The demo world every scene views: one workspace on the linkshelf repo with
 * sessions in different states, three of them in their own worktrees. Built
 * once per run; scenes only open views.
 */
import { createDemoRepo, createInvoicerRepo } from '../seed';
import type { Demo } from '../script';
import { buildScript } from './build-script';
import { datePreference } from './date-preference';
import { explainSlugs } from './explain-slugs';
import { fixExpiredLinks } from './fix-expired-links';
import { rateLimit } from './rate-limit';
import { statsExpiredFlag } from './stats-expired-flag';
import { testInvoices } from './test-invoices';
import type { Story, WorktreeName } from './types';

export { FIX_EXPIRED_LINKS_READY } from './fix-expired-links';
export type { Story } from './types';

/**
 * Oldest first, so the hero session ends up on top of the sidebar. The
 * date preference comes first: invoicer's search finds it.
 */
export const STORIES = {
  datePreference,
  explainSlugs,
  statsExpiredFlag,
  rateLimit,
  buildScript,
  testInvoices,
  fixExpiredLinks,
} satisfies Record<string, Story>;
export type StoryName = keyof typeof STORIES;

const WORKTREES: Record<WorktreeName, string> = {
  'stats-expired-flag': 'feat/stats-expired-flag',
  'rate-limit': 'feat/rate-limit',
  'build-script': 'chore/build-script',
};

export interface World {
  repo: string;
  /** linkshelf, where every scene and most stories play. */
  workspaceId: string;
  invoicerWorkspaceId: string;
  /** The default agent, which every session runs as, so agent-scoped search spans both projects. */
  agentId: string;
  worktrees: Record<WorktreeName, string>;
  sessions: Record<StoryName, string>;
}

/** The world for clips: stories they play live are missing until recorded. */
export interface ClipWorld extends Omit<World, 'sessions' | 'invoicerWorkspaceId'> {
  /** Null when the clip adds the invoicer folder itself. */
  invoicerWorkspaceId: string | null;
  sessions: Partial<World['sessions']>;
}

export interface ClipWorldOptions {
  /** Register invoicer as a workspace. Without it the folder exists but is not added. */
  invoicerWorkspace?: boolean;
}

/** Creates the story's titled session, bound to its worktree. */
export async function createStorySession(
  demo: Demo,
  world: Pick<ClipWorld, 'workspaceId' | 'invoicerWorkspaceId' | 'agentId' | 'worktrees'>,
  story: Story,
): Promise<string> {
  const workspaceId = story.project === 'invoicer' ? world.invoicerWorkspaceId : world.workspaceId;
  if (!workspaceId) throw new Error(`${story.title} needs the invoicer workspace`);
  // Like New Session in the client, which starts with the default agent.
  const { session } = await demo.rest.sessions.create({ workspaceId, title: story.title, preconfigId: world.agentId });
  if (story.worktree) await demo.rest.sessions.bindWorktree(session.id, world.worktrees[story.worktree]);
  await demo.scriptTitle(session.id, story.title);
  return session.id;
}

/** Builds the world, leaving out the `live` stories. */
export async function buildClipWorld(
  demo: Demo,
  home: string,
  live: readonly StoryName[] = [],
  { invoicerWorkspace = true }: ClipWorldOptions = {},
): Promise<ClipWorld> {
  const repo = createDemoRepo(home);
  const { workspace } = await demo.rest.workspaces.create({ name: 'linkshelf', path: repo });
  const invoicerRepo = createInvoicerRepo(home);
  const invoicer = invoicerWorkspace ? (await demo.rest.workspaces.create({ name: 'invoicer', path: invoicerRepo })).workspace : null;
  const worktrees = {} as Record<WorktreeName, string>;
  for (const [name, branch] of Object.entries(WORKTREES) as Array<[WorktreeName, string]>) {
    worktrees[name] = (await demo.rest.workspaces.createWorktree(workspace.id, { name, branch: `refs/heads/${branch}` })).worktree.id;
  }
  const agent = (await demo.rest.agents.list()).agents.find((candidate) => candidate.isDefault);
  if (!agent) throw new Error('No default agent; the instance was initialized without preconfigs');
  const world: ClipWorld = { repo, workspaceId: workspace.id, invoicerWorkspaceId: invoicer?.id ?? null, agentId: agent.id, worktrees, sessions: {} };

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
  // Nothing was left out, so every story has its session and invoicer is registered.
  return { ...world, invoicerWorkspaceId: world.invoicerWorkspaceId!, sessions: world.sessions as World['sessions'] };
}
