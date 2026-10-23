/**
 * One delegation paragraph for every harness: the CLIs keep their native
 * subagents for same-model fan-out, Prokop has none, and all three learn the
 * async default and how to call the tools where they are.
 */

import { expect, test } from 'bun:test';
import { delegationGuidance, PROKOP_DELEGATION_CALL } from '@prokopai/agent/internal/harnesses/shared/delegation-guidance';
import { CLAUDE_DELEGATION_CALL } from '@prokopai/agent/internal/harnesses/claude-cli/instructions';
import { CODEX_DELEGATION_CALL } from '@prokopai/agent/internal/harnesses/codex-cli/instructions';

test('the paragraph names the tools, the async default and the role requirement on every harness', () => {
  const claude = delegationGuidance(CLAUDE_DELEGATION_CALL, true);
  const codex = delegationGuidance(CODEX_DELEGATION_CALL, true);
  const prokop = delegationGuidance(PROKOP_DELEGATION_CALL, false);
  for (const text of [claude, codex, prokop]) {
    expect(text).toContain('delegate_task hands a task to a Prokop child session');
    expect(text).toContain('subagent_type');
    expect(text).toContain('delegation_capabilities first');
    expect(text).toContain('returns at once by default');
    expect(text).toContain('do not poll');
    expect(text).toContain('mode "wait"');
  }
  expect(claude).toContain('Your native subagents');
  expect(claude).toContain('mcp__workspace__delegate_task');
  expect(codex).toContain('Your native subagents');
  expect(codex).toContain('mcp_call_tool');
  expect(prokop).not.toContain('native subagents');
  expect(prokop).toContain('in your tool list');
});
