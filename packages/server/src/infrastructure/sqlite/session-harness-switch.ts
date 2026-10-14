/**
 * Harness switch after the first message. One transaction compares and swaps
 * the owner, detaches the old native thread, records the switch on the
 * session row and stores a frozen handoff brief for the new segment.
 * Empty sessions keep the plain pre-message selection with no brief.
 */

import type { HarnessModelChoice, Session, SessionHarness, SessionHarnessSwitch } from '@prokopai/sdk';
import { buildHandoffBrief } from '@/domains/sessions/handoff-brief';
import { notifyLearningActivity } from '@/application/learning/activity';
import { getDatabase } from './database';
import { clearSessionHarnessState, hasBlockingHarnessState, putHarnessState } from './harness-state';
import { listMessagesWithParts } from './message-store';
import { getSession, selectEmptySessionHarnessModel } from './session-store';

export type HarnessSwitchResult = { ok: true; session: Session } | { ok: false; message: string };

const MAX_RECORDED_SWITCHES = 20;

// Native runtime state of the detached thread. Compaction boundary ids stay
// so earlier transcript markers keep rendering.
const NATIVE_METADATA_KEYS = [
  'codexGoal', 'codexGoalPending', 'codexUsage', 'codexCompactPending', 'codexCompactedAt',
  'claudeGoal', 'claudeUsage', 'claudeContext', 'claudeCompactPending', 'claudeCompactedAt', 'claudeCompaction',
] as const;

const LOCKED = 'Harness can change only while the session is idle';

function goalRunning(metadata: Record<string, unknown>): boolean {
  return [metadata.goal, metadata.codexGoal, metadata.claudeGoal].some(goal => {
    const status = goal && typeof goal === 'object' ? (goal as Record<string, unknown>).status : undefined;
    return status === 'active' || status === 'uncertain';
  });
}

export function switchSessionHarnessModel(
  sessionId: string,
  expectedHarness: SessionHarness,
  expectedUpdatedAt: string,
  choice: HarnessModelChoice,
): HarnessSwitchResult {
  const db = getDatabase();
  const hasMessages = !!db.query('SELECT 1 FROM messages WHERE session_id = ? LIMIT 1').get(sessionId);
  if (!hasMessages) {
    const selected = selectEmptySessionHarnessModel(sessionId, expectedHarness, expectedUpdatedAt, choice);
    return selected ? { ok: true, session: selected } : { ok: false, message: LOCKED };
  }

  const result = db.transaction((): HarnessSwitchResult => {
    const session = getSession(sessionId);
    if (!session || (session.harness ?? 'prokop') !== expectedHarness || session.updatedAt !== expectedUpdatedAt
      || session.status !== 'active' || session.parentId || session.runningAt || session.compacting) {
      return { ok: false, message: LOCKED };
    }
    const exists = (sql: string) => !!db.query(sql).get(sessionId);
    if (exists('SELECT 1 FROM queued_messages WHERE session_id = ? LIMIT 1')) {
      return { ok: false, message: 'Send or remove queued messages before switching harness' };
    }
    if (exists("SELECT 1 FROM pending_asks WHERE session_id = ? AND status = 'pending' LIMIT 1")) {
      return { ok: false, message: 'Answer pending approvals before switching harness' };
    }
    // Pending native turns and rollback or fork intents block; harness_state marks them.
    if (hasBlockingHarnessState(sessionId)) {
      return { ok: false, message: 'The current harness needs recovery before switching' };
    }
    const metadata = { ...(session.metadata ?? {}) };
    if (goalRunning(metadata) || metadata.codexGoalPending || metadata.codexCompactPending
      || metadata.claudeCompactPending) {
      return { ok: false, message: 'Stop the active Goal or Compact before switching harness' };
    }
    const messages = listMessagesWithParts(sessionId);
    const last = messages.at(-1);
    if (!last || (last.message.role === 'assistant' && last.message.status === 'streaming')) {
      return { ok: false, message: LOCKED };
    }

    for (const key of NATIVE_METADATA_KEYS) delete metadata[key];
    const now = new Date().toISOString();
    const record: SessionHarnessSwitch = {
      from: expectedHarness, to: choice.harness, modelId: choice.modelId,
      afterMessageId: last.message.id, createdAt: now,
    };
    const switches = [...(session.harnessSwitches ?? []), record].slice(-MAX_RECORDED_SWITCHES);
    const updated = db.run(`UPDATE sessions SET harness = ?, selected_model = ?, selected_provider = ?,
      selected_variant = NULL, metadata = ?, harness_switches = ?, updated_at = ?
      WHERE id = ? AND harness = ? AND updated_at = ?`, [
      choice.harness, choice.modelId, choice.harness === 'prokop' ? choice.providerId : null,
      JSON.stringify(metadata), JSON.stringify(switches), now,
      sessionId, expectedHarness, expectedUpdatedAt,
    ]);
    if (updated.changes !== 1) return { ok: false, message: LOCKED };

    // Detach the old native thread. Returning to a harness used earlier starts a
    // fresh thread too, because that thread never saw the turns in between.
    // Bindings, inherited user IDs and model selections of both harnesses go; intents cannot exist here.
    clearSessionHarnessState(sessionId);
    if (choice.harness === 'codex-cli' || choice.harness === 'claude-cli') {
      putHarnessState({ harness: choice.harness, kind: 'model', key: sessionId, sessionId, blocksSwitch: false,
        value: { model: choice.modelId, effort: choice.effort } });
    }
    const brief = buildHandoffBrief({ sessionId, from: expectedHarness, to: choice.harness, messages });
    db.run(`INSERT INTO session_harness_briefs (session_id, after_message_id, brief, created_at) VALUES (?, ?, ?, ?)
      ON CONFLICT(session_id) DO UPDATE SET after_message_id = excluded.after_message_id,
        brief = excluded.brief, created_at = excluded.created_at`, [sessionId, last.message.id, brief, now]);
    const switched = getSession(sessionId);
    return switched ? { ok: true, session: switched } : { ok: false, message: LOCKED };
  })();
  if (result.ok) notifyLearningActivity();
  return result;
}

export interface HandoffSegment {
  afterMessageId: string;
  brief: string;
}

/** Current segment of a switched session, or null when it never switched. */
export function getHandoffSegment(sessionId: string): HandoffSegment | null {
  const row = getDatabase().query<{ after_message_id: string; brief: string }, [string]>(
    'SELECT after_message_id, brief FROM session_harness_briefs WHERE session_id = ?',
  ).get(sessionId);
  return row ? { afterMessageId: row.after_message_id, brief: row.brief } : null;
}

/** Instructions text for the current segment; null when the session never switched. */
export function readHandoffBrief(sessionId: string): string | null {
  return getHandoffSegment(sessionId)?.brief ?? null;
}
