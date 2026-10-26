/**
 * The demo world every scene views: one workspace on the linkshelf repo with
 * sessions in different states, three of them in their own worktrees. Built
 * once per run; scenes only open views.
 */
import type { CreateScheduledJobInput } from '../../../packages/sdk/src';
import { createDemoRepo, createInvoicerRepo } from '../seed';
import type { Demo } from '../script';
import { playAgentMessage } from './agent-message';
import { createDemoAgents, type DemoAgents } from './agents';
import { buildScript } from './build-script';
import { playDelegation, type DelegationSessions } from './delegation';
import { createDemoGroup, playGroup, type DemoGroup } from './group';
import { datePreference } from './date-preference';
import { explainSlugs } from './explain-slugs';
import { fixExpiredLinks } from './fix-expired-links';
import { redirectFlow, weeklyClicks } from './gallery';
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

/** Stills-only stories for the website gallery, played before STORIES. */
export const GALLERY_STORIES = {
  redirectFlow,
  weeklyClicks,
} satisfies Record<string, Story>;
export type GalleryStoryName = keyof typeof GALLERY_STORIES;

/** A recurring job, so the sidebar's Scheduled section has a row. */
const DEPENDENCY_CHECK: CreateScheduledJobInput = {
  name: 'Weekly dependency check',
  prompt: 'Check for outdated dependencies, update the safe ones, run the tests, and summarize anything that needs a decision.',
  scheduleKind: 'weekly',
  scheduleConfig: { type: 'weekly', days: [1], time: '09:00' },
};

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
  gallery: Record<GalleryStoryName, string>;
  /** Reviewer and Tester beside the default agent. */
  agents: DemoAgents;
  /** The group of the three, its conversation played. */
  group: DemoGroup;
  /** The session that asked Reviewer a question through message_agent. */
  agentMessage: string;
  /** The session that delegated to Claude Code and into a worktree, with its children. */
  delegation: DelegationSessions;
}

/** The world for clips: stories they play live are missing until recorded. */
export interface ClipWorld extends Omit<World, 'sessions' | 'invoicerWorkspaceId' | 'gallery' | 'agents' | 'group' | 'agentMessage' | 'delegation'> {
  /** Null when the clip adds the invoicer folder itself. */
  invoicerWorkspaceId: string | null;
  sessions: Partial<World['sessions']>;
  gallery: Partial<World['gallery']>;
  /** Present with the `agents` option. */
  agents: DemoAgents | null;
  /** Present with the `agents` option; its conversation is played only with `group`. */
  group: DemoGroup | null;
  agentMessage: string | null;
  delegation: DelegationSessions | null;
}

export interface ClipWorldOptions {
  /** Register invoicer as a workspace. Without it the folder exists but is not added. */
  invoicerWorkspace?: boolean;
  /** Play the gallery stories first and add the scheduled job. Stills only. */
  gallery?: boolean;
  /** Create Reviewer and Tester and the group of the three (its conversation not played). */
  agents?: boolean;
  /** Also play the group conversation, the agent-to-agent question and the delegation. Needs `agents`. */
  conversations?: boolean;
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
  { invoicerWorkspace = true, gallery = false, agents = false, conversations = false }: ClipWorldOptions = {},
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
  const world: ClipWorld = {
    repo, workspaceId: workspace.id, invoicerWorkspaceId: invoicer?.id ?? null, agentId: agent.id, worktrees, sessions: {}, gallery: {},
    agents: null, group: null, agentMessage: null, delegation: null,
  };
  if (agents) {
    world.agents = await createDemoAgents(demo, agent.id);
    world.group = await createDemoGroup(demo, workspace.id, agent.id, world.agents);
  }

  if (gallery) {
    await demo.rest.scheduler.create(workspace.id, { ...DEPENDENCY_CHECK, preconfigId: agent.id });
    for (const [name, story] of Object.entries(GALLERY_STORIES) as Array<[GalleryStoryName, Story]>) {
      const sessionId = await createStorySession(demo, world, story);
      await demo.runTurn(sessionId, story.prompt, story.steps, { until: story.until });
      world.gallery[name] = sessionId;
    }
  }

  for (const [name, story] of Object.entries(STORIES) as Array<[StoryName, Story]>) {
    if (live.includes(name)) continue;
    const sessionId = await createStorySession(demo, world, story);
    await demo.runTurn(sessionId, story.prompt, story.steps, { until: story.until });
    world.sessions[name] = sessionId;
  }

  // After the stories: the group reviews the expiry fix they made, and the
  // catch-all rules the other two use need nothing else unscripted running.
  if (conversations) {
    if (!world.agents || !world.group) throw new Error('conversations need the agents option');
    await playGroup(demo, world.group, world.agents);
    world.agentMessage = await playAgentMessage(demo, workspace.id, agent.id, world.agents);
    world.delegation = await playDelegation(demo, workspace.id, agent.id, world.agents);
  }
  return world;
}

export async function buildWorld(demo: Demo, home: string): Promise<World> {
  const world = await buildClipWorld(demo, home, [], { gallery: true, agents: true, conversations: true });
  // Nothing was left out, so every story has its session and invoicer is registered.
  return {
    ...world,
    invoicerWorkspaceId: world.invoicerWorkspaceId!,
    sessions: world.sessions as World['sessions'],
    gallery: world.gallery as World['gallery'],
    agents: world.agents!,
    group: world.group!,
    agentMessage: world.agentMessage!,
    delegation: world.delegation!,
  };
}
