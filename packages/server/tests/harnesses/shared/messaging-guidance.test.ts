import { expect, test } from 'bun:test';
import { messagingGuidance, PROKOP_MESSAGING_CALL } from '@prokopai/agent/internal/harnesses/shared/messaging-guidance';
import { CLAUDE_MESSAGING_CALL } from '@prokopai/agent/internal/harnesses/claude-cli/instructions';
import { CODEX_MESSAGING_CALL } from '@prokopai/agent/internal/harnesses/codex-cli/instructions';

test('every harness tells the model what message_agent is for and how to call it', () => {
  const prokop = messagingGuidance(PROKOP_MESSAGING_CALL, false);
  const claude = messagingGuidance(CLAUDE_MESSAGING_CALL, true);
  const codex = messagingGuidance(CODEX_MESSAGING_CALL, true);
  for (const text of [prokop, claude, codex]) {
    expect(text).toContain('message_agent sends a message to another of the user\'s agents');
    expect(text).toContain('starts with "[message from"');
    expect(text).toContain('do not poll');
  }
  expect(prokop).toContain('message_agent in your tool list');
  expect(claude).toContain('mcp__workspace__message_agent');
  expect(codex).toContain('mcp_call_tool with tool "message_agent"');
  // The CLIs have tools that list and message live sessions of their own kind; those never reach these agents.
  expect(prokop).not.toContain('session-listing');
  expect(claude).toContain('never these agents');
  expect(codex).toContain('never these agents');
});
