import { forkSession, getSessionMessages } from '@anthropic-ai/claude-agent-sdk';
import type { ForkExecutionResult, SessionExecutionPort } from '@/application/ports/execution';
import type { Session } from '@prokopai/sdk';
import { getSession, listMessagesWithParts } from '@/infrastructure/storage/runtime';
import { storeTransaction } from '@/infrastructure/storage/transaction';
import { HARNESS_SWITCH_FORK_REASON } from '@/domains/sessions/harness-state';
import { getClaudeModelSelection } from './models';
import {
  copyClaudeModelSelection, deleteClaudeForkIntent, getClaudeBinding, getClaudeRollbackIntent, hasClaudeForkIntent,
  insertClaudeBinding, insertClaudeForkIntent, isClaudeNativeSessionBound, setClaudeInheritedUserId,
} from './native-state';
import {
  groupClaudeTurns, groupLocalTurns, inheritedUserIds, localTurnEnd, matchClaudeHistory, type LocalTurn,
} from './rollback';

export interface ClaudeForkDependencies {
  root: string;
  version(): string;
  busy(sessionId: string): boolean;
  readHistory?: typeof getSessionMessages;
  forkHistory?: typeof forkSession;
}

export async function forkClaudeSession(
  input: Parameters<SessionExecutionPort['fork']>[0],
  deps: ClaudeForkDependencies,
): Promise<ForkExecutionResult> {
  const session = await getSession(input.sessionId);
  if (!session || session.harness !== 'claude-cli' || session.parentId || session.status !== 'active'
    || deps.busy(session.id)) throw new Error('Claude session is unavailable or busy');
  const binding = await getClaudeBinding(session.id);
  if (!binding || binding.pending || binding.workspace_root !== deps.root) {
    throw new Error('Claude native history is unavailable');
  }
  if (session.metadata?.claudeCompactPending || session.metadata?.claudeGoal || session.metadata?.claudeCompactedAt) {
    throw new Error('Claude Goal or Compact history cannot be forked');
  }
  if (session.harnessSwitches?.length) throw new Error(HARNESS_SWITCH_FORK_REASON);
  if (await getClaudeRollbackIntent(session.id)) {
    throw new Error('Claude history requires recovery before fork');
  }
  if (await hasClaudeForkIntent(session.id)) {
    throw new Error('A Claude fork has an uncertain outcome; do not retry it');
  }
  const local = await listMessagesWithParts(session.id);
  const inherited = await inheritedUserIds(local);
  let localTurns: LocalTurn[];
  try { localTurns = groupLocalTurns(local); }
  catch { throw new Error('Claude conversation history is not available for fork'); }
  const targetTurn = localTurns.findIndex(turn => turn.user.message.id === input.targetMessageId
    || turn.reply?.message.id === input.targetMessageId);
  const turn = localTurns[targetTurn];
  // Prokop forks at a completed reply (turn included) or at a user message
  // (user-only cutoff: the fork ends with that unanswered prompt).
  const userTarget = turn?.user.message.id === input.targetMessageId;
  if (!turn || (!userTarget && (turn.reply?.message.role !== 'assistant' || turn.reply.message.status !== 'completed'))) {
    throw new Error('Claude fork requires a completed assistant response or a user message');
  }
  const retained = local.slice(0, userTarget ? turn.start + 1 : localTurnEnd(turn));
  // A copied image URL points at the source session's attachments; refuse a
  // fork whose retained history would break when those are removed.
  if (retained.some(entry => entry.parts.some(part => part.type === 'image'))) {
    throw new Error('Claude fork of image history is not supported');
  }
  const history = await (deps.readHistory ?? getSessionMessages)(binding.native_session_id, { dir: deps.root });
  let turns;
  try { turns = matchClaudeHistory(localTurns, history, binding.native_session_id, inherited); }
  catch { throw new Error('Claude conversation history is not available for fork'); }
  const fullTurns = userTarget ? targetTurn : targetTurn + 1;
  if (!userTarget && turns[fullTurns - 1]!.assistantId === null) {
    throw new Error('Claude conversation history is not available for fork');
  }
  const cutoff: string = userTarget ? turns[fullTurns]!.userId : turns[fullTurns - 1]!.assistantId!;
  await insertClaudeForkIntent(session.id, input.targetMessageId);
  // An uncertain native fork cannot be issued a second time: the intent
  // survives a lost response, an unverifiable copy, or a persistence failure.
  const forked = await (deps.forkHistory ?? forkSession)(binding.native_session_id,
    { dir: deps.root, upToMessageId: cutoff });
  const forkedId = forked.sessionId;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(forkedId)
    || forkedId === binding.native_session_id
    || await isClaudeNativeSessionBound(forkedId)) {
    throw new Error('Claude fork identity is invalid');
  }
  const forkedHistory = await (deps.readHistory ?? getSessionMessages)(forkedId, { dir: deps.root });
  let forkedTurns;
  try { forkedTurns = groupClaudeTurns(forkedHistory, forkedId, { allowTrailingUser: true }); }
  catch { throw new Error('Claude fork history cannot be verified'); }
  const expectedTurns = userTarget ? fullTurns + 1 : fullTurns;
  if (forkedTurns.length !== expectedTurns || forkedTurns.some((turn, index) =>
    index < fullTurns
      ? turn.assistantId === null || turn.length !== turns[index]!.length || turn.userText !== turns[index]!.userText
        || turn.answered !== turns[index]!.answered || turn.assistantText !== turns[index]!.assistantText
      : turn.assistantId !== null || turn.length !== 1
        || turn.userText !== turns[fullTurns]!.userText)) {
    throw new Error('Claude fork history cannot be verified');
  }
  const selection = await getClaudeModelSelection(session.id);
  const forkedSessionId = crypto.randomUUID();
  const forkedSession = await storeTransaction((tx) => {
    const created = tx.write<Session>({ op: 'session.create', session: {
      id: forkedSessionId, workspaceId: session.workspaceId, workspaceRootId: session.workspaceRootId,
      harness: 'claude-cli', preconfigId: session.preconfigId,
      title: input.title || `${session.title || 'Untitled'} (fork)`, status: 'active',
      metadata: { ...(session.metadata ?? {}), forkedFrom: session.id }, parentId: null, agentName: null,
      agentId: session.agentId, selectedModel: session.selectedModel,
      selectedProvider: session.selectedProvider, permissionMode: session.permissionMode,
    } });
    insertClaudeBinding(tx, forkedSessionId, forkedId, deps.root, deps.version(), false);
    if (selection) copyClaudeModelSelection(tx, forkedSessionId, selection);
    const ids = new Map(retained.map(entry => [entry.message.id, crypto.randomUUID()]));
    let userTurn = 0;
    for (const entry of retained) {
      const id = ids.get(entry.message.id)!;
      tx.write({ op: 'message.create', message: { ...entry.message, id, sessionId: forkedSessionId,
        ...(entry.message.role === 'assistant' && entry.message.parentId
          ? { parentId: ids.get(entry.message.parentId) } : {}) } });
      if (entry.message.role === 'user') {
        // The fork's native user messages carry fresh uuids; remember them so
        // later Undo or Edit in the fork still matches its native history.
        setClaudeInheritedUserId(tx, forkedSessionId, id, forkedTurns[userTurn++]!.userId);
      }
      for (const part of entry.parts) {
        tx.write({ op: 'part.create', sessionId: forkedSessionId, part: { ...part, id: crypto.randomUUID(), messageId: id } });
      }
    }
    deleteClaudeForkIntent(tx, session.id);
    return created;
  });
  return { forkedSession: forkedSession.value, messages: await listMessagesWithParts(forkedSessionId) };
}
