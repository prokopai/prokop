import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { schemaPath } from '../scripts/generate-schema';
import { agentToHostNotifications, agentToHostRequests, hostToAgentRequests } from '../src/index';
import { SessionEntity } from '../src/entities';
import { buildProtocolJsonSchema, protocolJsonSchemaText } from '../src/json-schema';

const commit = agentToHostRequests['store.commit'].params;

function refs(value: unknown, out: string[] = []): string[] {
  if (Array.isArray(value)) value.forEach(item => refs(item, out));
  else if (value && typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) {
      if (key === '$ref' && typeof item === 'string') out.push(item);
      else refs(item, out);
    }
  }
  return out;
}

describe('JSON Schema output', () => {
  test('the committed schema file matches the zod types (run `bun run schema` after changes)', () => {
    expect(readFileSync(schemaPath, 'utf8')).toBe(protocolJsonSchemaText());
  });

  test('every $ref resolves to a $defs entry', () => {
    const document = buildProtocolJsonSchema();
    const defs = document.$defs as Record<string, unknown>;
    const missing = refs(document).filter(ref => !(ref.replace('#/$defs/', '') in defs));
    expect(missing).toEqual([]);
  });
});

describe('method tables', () => {
  test('host and agent request names do not collide', () => {
    const both = Object.keys(hostToAgentRequests).filter(method => method in agentToHostRequests);
    expect(both).toEqual([]);
  });
});

describe('entities', () => {
  test('unknown SDK fields pass through untouched', () => {
    const session = { id: 's1', workspaceId: 'w1', title: 'Kept', metadata: { a: 1 } };
    expect(SessionEntity.parse(session) as unknown).toEqual(session);
  });

  test('identity keys are required', () => {
    expect(SessionEntity.safeParse({ workspaceId: 'w1' }).success).toBe(false);
  });
});

describe('store.commit', () => {
  test('a Claude fork commit (claude-cli/fork.ts:100) fits', () => {
    const parsed = commit.parse({
      writes: [
        { op: 'session.create', session: { id: 'fork', workspaceId: 'w1', harness: 'claude-cli', parentId: null } },
        { op: 'native.put', record: { harness: 'claude-cli', kind: 'binding', key: 'fork', sessionId: 'fork',
          lookup: 'native-1', blocksSwitch: false, value: { nativeSessionId: 'native-1', pending: false } } },
        { op: 'message.create', message: { id: 'm1', sessionId: 'fork', role: 'user', createdAt: 1 } },
        { op: 'native.put', record: { harness: 'claude-cli', kind: 'inherited-user', key: 'm1', sessionId: 'fork',
          messageId: 'm1', blocksSwitch: false, value: { nativeUserId: 'u1' } } },
        { op: 'part.create', sessionId: 'fork', part: { id: 'p1', messageId: 'm1', type: 'text', text: 'hi' } },
        { op: 'native.delete', target: { harness: 'claude-cli', kind: 'fork-intent', key: 'source' } },
      ],
    });
    expect(parsed.checks).toEqual([]);
    expect(parsed.writes).toHaveLength(6);
  });

  test('a Claude rollback (claude-cli/rollback.ts:196) expresses its guards as checks', () => {
    const parsed = commit.parse({
      checks: [
        { check: 'native.equals', target: { harness: 'claude-cli', kind: 'rollback-intent', key: 's1' },
          value: { phase: 'fork', targetMessageId: 'm3' } },
        { check: 'native.equals', target: { harness: 'claude-cli', kind: 'binding', key: 's1' },
          value: { nativeSessionId: 'n1', pending: false } },
        { check: 'session.messageIds', sessionId: 's1', ids: ['m1', 'm2', 'm3', 'm4'] },
      ],
      writes: [
        { op: 'message.delete', id: 'm3' },
        { op: 'message.delete', id: 'm4' },
      ],
    });
    expect(parsed.checks).toHaveLength(3);
  });

  test('a Codex steer with its within-callback (codex-cli/execution.ts:833) fits', () => {
    expect(commit.safeParse({
      writes: [
        { op: 'queue.delete', id: 'q1', ifExists: true },
        { op: 'message.create', message: { id: 'u2', sessionId: 's1', role: 'user' } },
        { op: 'message.update', id: 'a1', updates: { status: 'completed' } },
        { op: 'message.create', message: { id: 'a2', sessionId: 's1', role: 'assistant' } },
        { op: 'native.put', record: { harness: 'codex-cli', kind: 'binding', key: 's1', sessionId: 's1',
          blocksSwitch: true, value: { pendingAssistantId: 'a2' } } },
      ],
    }).success).toBe(true);
  });

  test('an empty commit and unknown ops are rejected', () => {
    expect(commit.safeParse({ writes: [] }).success).toBe(false);
    expect(commit.safeParse({ writes: [{ op: 'session.drop', id: 's1' }] }).success).toBe(false);
  });
});

describe('deliver', () => {
  const deliver = agentToHostNotifications.deliver.params;

  test('a Prokop part.append delta is routed to the session', () => {
    expect(deliver.safeParse({
      seq: 7,
      audience: { scope: 'session', sessionId: 's1' },
      message: { type: 'part.append', sessionId: 's1', partId: 'p1', field: 'text', delta: 'he' },
    }).success).toBe(true);
  });

  test('ask_targets needs the ask authority', () => {
    expect(deliver.safeParse({
      seq: 1, audience: { scope: 'ask_targets', sessionId: 's1' }, message: { type: 'ask.request' },
    }).success).toBe(false);
  });
});
