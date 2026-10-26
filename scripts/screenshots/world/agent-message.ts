/**
 * An agent asking another agent: the default agent is asked about 410 Gone
 * and puts the question to Reviewer with `message_agent`. Reviewer answers
 * from a conversation in its own home; the answer comes back as a message
 * and the agent passes it on. Reviewer's turn runs in a session that does
 * not exist yet, so its answer is queued as a catch-all rule.
 */
import type { Demo, Step } from '../script';
import type { DemoAgents } from './agents';

export const AGENT_MESSAGE_TITLE = 'Second opinion on 410 Gone';
export const AGENT_MESSAGE_PROMPT = 'Is 410 Gone the right status for an expired link, or should it stay 404? Ask Reviewer what it thinks too.';
/** Visible once the agent relayed Reviewer's answer. */
export const AGENT_MESSAGE_READY = 'before merging';

const QUESTION = 'In linkshelf, src/routes/redirect.ts now returns 410 Gone for an expired link instead of 404. Is 410 the right status here, and is there a client-side consequence we should warn about?';

const PARENT_STEPS: Step[] = [
  {
    type: 'tool-call',
    text: 'Asking Reviewer.',
    toolName: 'message_agent',
    args: { agent_id: 'reviewer', message: QUESTION, intent: 'question' },
    usage: { inputTokens: 12_140, outputTokens: 96 },
  },
  {
    type: 'text',
    content: [
      'My take: **410 is right.** The slug existed and is deliberately gone, which is exactly what 410 means. A 404 reads as "never existed" and tells a monitoring client to keep retrying.',
      '',
      'Reviewer has the question; its answer will show up here.',
    ].join('\n'),
    usage: { inputTokens: 12_400, outputTokens: 88 },
  },
  {
    type: 'text',
    content: 'Reviewer agrees on 410 and adds one thing: browsers and CDNs may cache a 410 as permanent, so a link that can be renewed later should send `Cache-Control: no-store` with the 410. I would add that header before merging.',
    usage: { inputTokens: 12_980, outputTokens: 74 },
  },
];

const REVIEWER_ANSWER: Step = {
  type: 'text',
  content: [
    '410 Gone is the right status. The resource existed and is intentionally unavailable, and 410 tells clients not to retry; 404 says nothing about why.',
    '',
    'One consequence: browsers and CDNs may cache a 410 as permanent. If a link can be renewed after it expired, send `Cache-Control: no-store` with the 410 so the renewed link is not stuck behind a cached Gone. Otherwise no concerns.',
  ].join('\n'),
  usage: { inputTokens: 1_240, outputTokens: 102 },
};

/** Creates the session and plays it to the relayed answer. */
export async function playAgentMessage(demo: Demo, workspaceId: string, defaultAgentId: string, agents: DemoAgents): Promise<string> {
  const { session } = await demo.rest.sessions.create({ workspaceId, title: AGENT_MESSAGE_TITLE, preconfigId: defaultAgentId });
  await demo.scriptTitle(session.id, AGENT_MESSAGE_TITLE);
  // Reviewer's conversation session is created by the message; its one turn takes the catch-all.
  await demo.queueCatchAll(`${agents.reviewer} answer`, [REVIEWER_ANSWER]);
  // The third step answers the wake that carries Reviewer's reply; runTurn
  // waits until that step is consumed too and the session is idle again.
  await demo.runTurn(session.id, AGENT_MESSAGE_PROMPT, PARENT_STEPS, { timeoutMs: 120_000 });
  return session.id;
}
