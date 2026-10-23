import { describe, expect, test } from 'bun:test';
import { claudeToolSummary, delegationResultFrom, messagingResultVisualization, messagingToolSummary } from '@prokopai/agent/internal/harnesses/shared/tool-viz';

describe('message_agent rows', () => {
  const input = { agent_id: 'marketing', message: 'What are\n  our brand colors?', intent: 'question' };

  test('the summary names the recipient and the message on one line', () => {
    expect(messagingToolSummary(input)).toBe('marketing: What are our brand colors?');
    expect(claudeToolSummary('message_agent', input)).toBe('marketing: What are our brand colors?');
    expect(messagingToolSummary({ agent_id: 'marketing' })).toBe('marketing');
  });

  test('a sent message carries its intent as the badge; a refusal says why', () => {
    const sent = JSON.stringify({ delivered: true, conversation_session_id: 'c1', intent: 'question', hop: 1 });
    expect(messagingResultVisualization(input, JSON.parse(sent))).toEqual({ type: 'none', badge: 'question', message: 'To marketing: What are our brand colors?' });
    // Claude keeps the MCP result as content blocks; the shared parser unwraps them.
    expect(messagingResultVisualization(input, delegationResultFrom({ content: [{ type: 'text', text: sent }] }))).toMatchObject({ badge: 'question' });
    expect(messagingResultVisualization(input, { delivered: false, code: 'hop_limit', error: 'Too many hops' }))
      .toEqual({ type: 'none', badge: 'not sent', message: 'Too many hops' });
    expect(messagingResultVisualization(input, null)).toEqual({ type: 'none', message: 'Result unavailable' });
  });
});
