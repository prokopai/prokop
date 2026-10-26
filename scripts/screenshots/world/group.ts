/**
 * The group chat: the person asks Reviewer to look over the expiry fix (made
 * by the fixExpiredLinks story in the main checkout). Reviewer reads the
 * change, hands the untested case to Tester, and posts its verdict; Tester
 * adds the test, runs the real suite, and reports. Every member answers from
 * its own hidden session, so the steps are queued per member session.
 */
import type { Demo, Step } from '../script';
import type { DemoAgents } from './agents';
import { REPO_DISPLAY_PATH, repoPath as file } from './types';

export const GROUP_NAME = 'Release check';
export const GROUP_POST = '@Reviewer the expiry fix on main is ready. Look it over, and hand anything the tests miss to Tester.';
/** Visible once Tester's reply is in the thread. */
export const GROUP_READY = 'Boundary covered';

export const REVIEWER_STEPS: Step[] = [
  {
    type: 'tool-call',
    text: 'Reading the handler and its tests.',
    toolName: 'read-file',
    args: { path: file('src/routes/redirect.ts') },
    usage: { inputTokens: 9_410, outputTokens: 48 },
  },
  {
    type: 'tool-call',
    toolName: 'read-file',
    args: { path: file('test/redirect.test.ts') },
    usage: { inputTokens: 9_980, outputTokens: 31 },
  },
  {
    type: 'tool-call',
    text: 'The change is right. One case is untested: a link whose `expiresAt` equals `now`. Handing it to Tester.',
    toolName: 'handoff_to_agent',
    args: {
      agent_id: 'tester',
      message: 'The expiry fix in src/routes/redirect.ts treats expiresAt <= now as expired (410, no click). test/redirect.test.ts covers a link expired a month ago and a valid one, not the boundary where expiresAt equals now. Add that case by calling redirect() with an explicit now, then run the suite.',
    },
    usage: { inputTokens: 10_900, outputTokens: 188 },
  },
  {
    type: 'text',
    content: [
      'Reviewed `src/routes/redirect.ts` and its tests.',
      '',
      '- **Correct.** Expiry is checked before the redirect and before the click is counted, and `expiresAt <= now` is the right comparison: a link that expires at this millisecond is gone.',
      '- **Testable.** `now` is a parameter with a default, so the boundary can be tested without touching `Date`.',
      '- **Gap.** No test pins the boundary itself; Tester has it.',
      '',
      'Verdict: good to merge once the boundary test passes.',
    ].join('\n'),
    usage: { inputTokens: 11_300, outputTokens: 142 },
  },
];

export const TESTER_STEPS: Step[] = [
  {
    type: 'tool-call',
    text: 'Adding the boundary case next to the other expiry tests.',
    toolName: 'edit',
    args: {
      path: file('test/redirect.test.ts'),
      revision: null,
      edits: [
        {
          oldString: "import { createServer } from '../src/server';",
          newString: "import { createServer } from '../src/server';\nimport { redirect } from '../src/routes/redirect';\nimport { LinkStore } from '../src/store';",
        },
        {
          oldString: "  test('returns 404 for unknown slugs', async () => {",
          newString: [
            "  test('a link expiring exactly now is gone', () => {",
            '    const store = new LinkStore();',
            '    const now = 1_700_000_000_000;',
            "    store.create('exact', 'https://example.com/exact', 1, now - 24 * 60 * 60 * 1000);",
            '',
            "    expect(redirect('exact', store, now).status).toBe(410);",
            '  });',
            '',
            "  test('returns 404 for unknown slugs', async () => {",
          ].join('\n'),
        },
      ],
    },
    usage: { inputTokens: 8_720, outputTokens: 296 },
  },
  {
    type: 'tool-call',
    text: 'Running the suite.',
    toolName: 'shell',
    // Bun reports results on stderr, which the transcript styles as an error.
    args: { command: 'bun test 2>&1', cwd: REPO_DISPLAY_PATH },
    usage: { inputTokens: 9_200, outputTokens: 39 },
  },
  {
    type: 'text',
    content: `${GROUP_READY}: \`test/redirect.test.ts\` now calls \`redirect()\` with a link whose \`expiresAt\` equals \`now\` and expects 410. \`bun test\`: 9 pass, 0 fail.`,
    usage: { inputTokens: 9_860, outputTokens: 71 },
  },
];

export interface DemoGroup {
  id: string;
  /** Member session ids by agent id. */
  sessions: Record<string, string>;
}

/** Creates the group of the default agent, Reviewer and Tester, with the default agent answering unaddressed posts. */
export async function createDemoGroup(demo: Demo, workspaceId: string, defaultAgentId: string, agents: DemoAgents): Promise<DemoGroup> {
  const { group } = await demo.rest.groups.create({
    workspaceId,
    name: GROUP_NAME,
    memberAgentIds: [defaultAgentId, agents.reviewer, agents.tester],
    defaultAgentId,
  });
  const sessions: Record<string, string> = {};
  for (const member of group.members) sessions[member.agentId] = member.sessionId;
  return { id: group.id, sessions };
}

/**
 * The conversation, driven by polling. The handoff wakes Tester at once,
 * while a member's reply is posted when its turn ends, so a Tester that
 * answers straight away lands above the review that sent it. Tester's
 * session therefore waits at its first model call, with no rule queued,
 * until Reviewer's reply is in the thread; that call is then answered with
 * Tester's first step and the rest are queued as usual.
 */
export class GroupPlay {
  private testerScripted = false;

  constructor(
    private readonly demo: Demo,
    private readonly group: DemoGroup,
    private readonly agents: DemoAgents,
    private readonly pace: (step: Step) => Step = (step) => step,
  ) {}

  /** Queues Reviewer's answer; the post can then come from the API or a recorded client. */
  async start(): Promise<void> {
    await this.demo.queueSteps(this.group.sessions[this.agents.reviewer]!, REVIEWER_STEPS.map(this.pace));
  }

  /** Moves the conversation on where it can, and is true once Tester replied and no member is working. */
  async done(): Promise<boolean> {
    const { messages } = await this.demo.rest.groups.listMessages(this.group.id);
    const replied = (agentId: string) => messages.some((message) => message.authorKind === 'agent' && message.authorAgentId === agentId);
    if (!this.testerScripted) {
      const tester = this.group.sessions[this.agents.tester]!;
      if (!replied(this.agents.reviewer) || !(await this.demo.hasPendingCall(tester))) return false;
      const [first, ...rest] = TESTER_STEPS.map(this.pace);
      // The later steps are rules before the first is answered, so the next call finds them.
      await this.demo.queueSteps(tester, rest);
      await this.demo.answerPendingCall(tester, first!);
      this.testerScripted = true;
      return false;
    }
    if (!replied(this.agents.tester)) return false;
    for (const sessionId of Object.values(this.group.sessions)) if (await this.demo.isRunning(sessionId)) return false;
    return true;
  }
}

/** Posts the opening message and plays the whole conversation. */
export async function playGroup(demo: Demo, group: DemoGroup, agents: DemoAgents): Promise<void> {
  const play = new GroupPlay(demo, group, agents);
  await play.start();
  await demo.rest.groups.post(group.id, { text: GROUP_POST, mentions: [agents.reviewer] });
  await demo.waitFor('the group conversation', () => play.done(), 90_000);
}
