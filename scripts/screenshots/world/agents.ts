/**
 * Two more agents beside the default one, so the demo can show a group chat,
 * an agent asking another agent, and delegation. Both run on Prokop's
 * runtime, which the sandbox scripts; the default agent is opened up so no
 * delegation or message of its own needs an approval.
 */
import type { Demo } from '../script';

export interface DemoAgents {
  reviewer: string;
  tester: string;
}

const REVIEWER = {
  id: 'reviewer',
  name: 'Reviewer',
  description: 'Reviews changes for correctness and clarity before they merge. Reads, never edits.',
  systemPrompt: [
    'You review code changes. Read the files involved, judge correctness, naming and test coverage,',
    'and answer with concrete findings, most important first, then a one-line verdict. Never edit files.',
  ].join(' '),
  tools: ['read-file', 'glob', 'grep'],
};

const TESTER = {
  id: 'tester',
  name: 'Tester',
  description: 'Writes the missing tests for a change and runs the suite.',
  systemPrompt: [
    'You add tests for changes other agents made. Read the existing tests first, add only what is missing,',
    'run the suite with `bun test`, and report the result in one short paragraph.',
  ].join(' '),
  tools: ['read-file', 'edit', 'write-file', 'glob', 'grep', 'shell'],
};

export async function createDemoAgents(demo: Demo, defaultAgentId: string): Promise<DemoAgents> {
  for (const agent of [REVIEWER, TESTER]) {
    await demo.rest.preconfigs.create({
      ...agent,
      // Chat with it directly and delegate to it as a role.
      mode: 'both',
      acceptsMessages: true,
      canSpawnSubagents: [],
      settings: { temperature: 0.2 },
    });
  }
  // The default agent may delegate to both, pick any runtime for a task,
  // start worktree sessions, and message other agents, without asking.
  // An update replaces the stored definition, so everything travels along.
  const { preconfig } = await demo.rest.preconfigs.get(defaultAgentId);
  const { id: _id, ...current } = preconfig;
  await demo.rest.preconfigs.update(defaultAgentId, {
    ...current,
    canSpawnSubagents: ['explore', REVIEWER.id, TESTER.id],
    delegationTargets: 'any',
    launches: 'allow',
    canMessage: true,
  });
  // Messaging and the group need a home per agent; a fresh preconfig may not have one yet.
  const { agents } = await demo.rest.agents.list();
  for (const id of [REVIEWER.id, TESTER.id]) {
    if (!agents.find((agent) => agent.id === id)?.hasHome) await demo.rest.agents.promote(id);
  }
  return { reviewer: REVIEWER.id, tester: TESTER.id };
}
