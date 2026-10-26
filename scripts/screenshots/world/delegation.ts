/**
 * Delegation across runtimes from one conversation: the default agent sends
 * a review to Reviewer on Claude Code (a real CLI run on a real model, the
 * sandbox only scripts Prokop's runtime) and starts an implementation
 * session in a new worktree on Prokop (scripted through catch-all rules,
 * since its session does not exist yet). Both results come back as notes.
 */
import type { Demo, Step } from '../script';
import type { DemoAgents } from './agents';

export const DELEGATION_TITLE = 'Review the fix, start the cleanup';
export const DELEGATION_PROMPT = 'Have Reviewer check the expiry fix on Claude Code, and start the expired-link cleanup on its own branch so I can pick it up later.';
/** Visible once both tasks reported back. */
export const DELEGATION_READY = 'Both tasks are done';
/** The worktree session's final line. */
export const CLEANUP_READY = 'removes every expired link';

const REVIEW_PROMPT = [
  'Review the uncommitted change in src/routes/redirect.ts and test/redirect.test.ts of this repository:',
  'expired links now return 410 Gone and are not counted as clicks. Do not edit anything.',
  'Reply with at most three findings, most important first, and a one-line verdict.',
].join(' ');

const CLEANUP_PROMPT = 'Add a removeExpired(now) method to LinkStore in src/store.ts that deletes every expired link and returns how many it removed, with a test in test/cleanup.test.ts. Run the test. Keep it small.';

function parentSteps(agents: DemoAgents, claudeModel: string): Step[] {
  return [
    {
      type: 'tool-call',
      text: 'Sending the review to Reviewer on Claude Code.',
      toolName: 'delegate_task',
      args: {
        subagent_type: agents.reviewer,
        description: 'Review the expiry fix',
        prompt: REVIEW_PROMPT,
        target: { harness: 'claude-cli', model: claudeModel, variant: 'low' },
      },
      usage: { inputTokens: 13_020, outputTokens: 164 },
    },
    {
      type: 'tool-call',
      text: 'Starting the cleanup in its own worktree.',
      toolName: 'delegate_task',
      args: {
        subagent_type: 'prokop-code',
        description: 'Expired-link cleanup',
        prompt: CLEANUP_PROMPT,
        isolation: 'worktree',
      },
      usage: { inputTokens: 13_610, outputTokens: 142 },
    },
    {
      type: 'text',
      content: 'Both are running: Reviewer is reading the fix on Claude Code, and a new session is adding the cleanup on its own branch. I will report when each finishes.',
      usage: { inputTokens: 13_900, outputTokens: 58 },
    },
    // Woken by the cleanup session finishing (scripted, so first).
    {
      type: 'text',
      content: 'The cleanup is done in its worktree: `LinkStore.removeExpired(now)` in `src/store.ts` with a passing test. Open that session to review the diff. The review is still running.',
      usage: { inputTokens: 14_380, outputTokens: 64 },
    },
    // Woken by the review finishing.
    {
      type: 'text',
      content: `Reviewer's findings are in the note above. ${DELEGATION_READY}.`,
      usage: { inputTokens: 15_120, outputTokens: 28 },
    },
  ];
}

const CLEANUP_STEPS: Step[] = [
  {
    type: 'tool-call',
    text: 'Reading the store.',
    toolName: 'read-file',
    args: { path: 'src/store.ts' },
    usage: { inputTokens: 6_210, outputTokens: 42 },
  },
  {
    type: 'tool-call',
    text: 'Adding `removeExpired` next to `recordClick`.',
    toolName: 'edit',
    args: {
      path: 'src/store.ts',
      revision: null,
      edits: [
        {
          oldString: '  recordClick(slug: string): void {',
          newString: [
            '  /** Deletes every link whose expiry has passed and returns how many went. */',
            '  removeExpired(now = Date.now()): number {',
            '    let removed = 0;',
            '    for (const [slug, link] of this.links) {',
            '      if (link.expiresAt !== null && link.expiresAt <= now) {',
            '        this.links.delete(slug);',
            '        removed += 1;',
            '      }',
            '    }',
            '    return removed;',
            '  }',
            '',
            '  recordClick(slug: string): void {',
          ].join('\n'),
        },
      ],
    },
    usage: { inputTokens: 6_840, outputTokens: 236 },
  },
  {
    type: 'tool-call',
    text: 'One test: an expired link goes, a valid one stays.',
    toolName: 'write-file',
    args: {
      path: 'test/cleanup.test.ts',
      content: [
        "import { expect, test } from 'bun:test';",
        "import { LinkStore } from '../src/store';",
        '',
        "test('removeExpired deletes expired links and keeps the rest', () => {",
        '  const store = new LinkStore();',
        '  const now = 1_700_000_000_000;',
        '  const day = 24 * 60 * 60 * 1000;',
        "  store.create('old', 'https://example.com/old', 1, now - 2 * day);",
        "  store.create('fresh', 'https://example.com/fresh', 30, now);",
        "  store.create('forever', 'https://example.com/forever', null, now);",
        '',
        '  expect(store.removeExpired(now)).toBe(1);',
        "  expect(store.has('old')).toBe(false);",
        "  expect(store.has('fresh')).toBe(true);",
        "  expect(store.has('forever')).toBe(true);",
        '});',
        '',
      ].join('\n'),
    },
    usage: { inputTokens: 7_320, outputTokens: 214 },
  },
  {
    type: 'tool-call',
    text: 'Running it.',
    toolName: 'shell',
    args: { command: 'bun test test/cleanup.test.ts 2>&1' },
    usage: { inputTokens: 7_800, outputTokens: 36 },
  },
  {
    type: 'text',
    content: `Done. \`LinkStore.removeExpired(now)\` ${CLEANUP_READY} and returns the count; \`test/cleanup.test.ts\` passes. Nothing calls it yet: wire it to a timer in \`src/server.ts\` when you pick this up.`,
    usage: { inputTokens: 8_260, outputTokens: 72 },
  },
];

export interface DelegationSessions {
  parent: string;
  /** Reviewer's Claude Code subagent session. */
  review: string;
  /** The cleanup session in its new worktree. */
  cleanup: string;
}

/** Creates the session and plays it until both tasks reported back. */
export async function playDelegation(demo: Demo, workspaceId: string, defaultAgentId: string, agents: DemoAgents): Promise<DelegationSessions> {
  const { harnesses } = await demo.rest.sessions.harnesses();
  const claude = harnesses.find((harness) => harness.id === 'claude-cli');
  if (!claude?.available || claude.enabled === false) throw new Error('The delegation story needs Claude Code installed and logged in');
  const catalog = (await demo.rest.sessions.claudeCatalog()).models;
  const claudeModel = catalog.find((model) => model.isDefault) ?? catalog[0];
  if (!claudeModel) throw new Error('No Claude Code models in the catalog');

  const before = new Set((await demo.rest.sessions.list()).sessions.map((session) => session.id));
  const { session } = await demo.rest.sessions.create({ workspaceId, title: DELEGATION_TITLE, preconfigId: defaultAgentId });
  await demo.scriptTitle(session.id, DELEGATION_TITLE);
  await demo.queueCatchAll('cleanup session', CLEANUP_STEPS);
  // The last two steps answer the two wakes; runTurn waits until they are
  // consumed as well, which includes the real Claude Code run.
  await demo.runTurn(session.id, DELEGATION_PROMPT, parentSteps(agents, claudeModel.model), { timeoutMs: 600_000 });

  const created = (await demo.rest.sessions.list()).sessions.filter((candidate) => !before.has(candidate.id) && candidate.id !== session.id);
  const review = created.find((candidate) => candidate.parentId === session.id);
  const cleanup = created.find((candidate) => candidate.parentId !== session.id && candidate.workspaceId === workspaceId && !candidate.metadata?.groupMember);
  if (!review || !cleanup) throw new Error(`Delegated sessions missing: review ${review?.id ?? 'none'}, cleanup ${cleanup?.id ?? 'none'}`);
  return { parent: session.id, review: review.id, cleanup: cleanup.id };
}
