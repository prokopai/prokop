import type { ForkExecutionResult, SessionExecutionPort } from '@prokopai/core/application/ports/execution';
import { HARNESS_SWITCH_FORK_REASON } from '@prokopai/core/domains/sessions/harness-state';
import type { Session } from '@prokopai/sdk';
import { getSession, listMessagesWithParts } from '@prokopai/core/infrastructure/storage/runtime';
import { storeTransaction } from '@prokopai/core/infrastructure/storage/transaction';
import { CodexAppServer, codexObject, type CodexConnection } from './app-server';
import { bindCodexThread, findCodexBindingByThread, getCodexBinding } from './bindings';
import {
  codexInheritedUserId, copyCodexModelSelection, deleteCodexForkIntent, hasCodexForkIntent, insertCodexForkIntent,
  insertCodexInheritedUserId,
} from './native-state';
import { getCodexModelSelection } from './models';
import { getRollbackIntent, readRollbackHistory, sameTurns } from './rollback';

export async function upstreamUserId(messageId: string): Promise<string> {
  return await codexInheritedUserId(messageId) ?? messageId;
}

export async function forkCodexSession(
  input: Parameters<SessionExecutionPort['fork']>[0],
  deps: { connect(): CodexConnection; version(): string; root(sessionId: string): Promise<string>; busy(sessionId: string): boolean },
): Promise<ForkExecutionResult> {
  const session = await getSession(input.sessionId);
  if (!session || session.harness !== 'codex-cli' || session.status === 'closed' || deps.busy(session.id)) {
    throw new Error('Codex session is unavailable or busy');
  }
  if (session.harnessSwitches?.length) throw new Error(HARNESS_SWITCH_FORK_REASON);
  const root = await deps.root(session.id);
  const version = deps.version();
  const binding = await getCodexBinding(session.id);
  if (!binding || binding.workspaceRoot !== root) {
    throw new Error('Codex thread binding is unavailable or changed');
  }
  const metadata = codexObject(session.metadata);
  if (binding.pendingTurn || binding.goalRequested || metadata?.codexGoal || metadata?.codexGoalPending
    || await getRollbackIntent(session.id)) throw new Error('Codex history requires recovery before fork');
  if (await hasCodexForkIntent(session.id)) {
    throw new Error('A Codex fork has an uncertain outcome; do not retry it');
  }
  const client = new CodexAppServer(deps.connect(), () => {});
  try {
    await client.initialize();
    const resumed = codexObject(await client.request('thread/resume', {
      threadId: binding.threadId, cwd: root, approvalPolicy: 'on-request', sandbox: 'workspace-write',
    }));
    const resumedThread = codexObject(resumed?.thread);
    if (resumedThread?.id !== binding.threadId || codexObject(resumedThread.status)?.type !== 'idle') {
      throw new Error('Codex thread is not idle after resume');
    }
    const goalResponse = codexObject(await client.request('thread/goal/get', { threadId: binding.threadId }));
    if (!goalResponse || !Object.hasOwn(goalResponse, 'goal') || goalResponse.goal !== null) {
      throw new Error('Codex goal history cannot be forked');
    }
    const spans = await readRollbackHistory(client, binding);
    const local = await listMessagesWithParts(session.id);
    const targetIndex = local.findIndex(entry => entry.message.id === input.targetMessageId);
    // A fork keeps whole Codex turns, so it ends at a turn's last reply.
    const spanIndex = spans.findIndex(span => span.end === targetIndex);
    if (targetIndex < 1 || spanIndex < 0 || local[targetIndex]?.message.role !== 'assistant'
      || local[targetIndex].message.status !== 'completed') {
      throw new Error('Codex fork requires a completed assistant response');
    }
    const kept = spans.slice(0, spanIndex + 1);
    const retained = local.slice(0, targetIndex + 1);
    // A copied image URL belongs to the source session. Do not create a fork
    // that breaks when its source attachments are removed.
    if (retained.some(entry => entry.parts.some(part => part.type === 'image'))) {
      throw new Error('Codex fork of image history is not supported');
    }
    const cutoff = kept.at(-1)!.id;
    await insertCodexForkIntent(session.id, input.targetMessageId, cutoff);
    // An uncertain RPC cannot be issued a second time. The intent remains on
    // disconnect, malformed response, or failure to persist the local fork.
    const forked = codexObject(await client.request('thread/fork', {
      threadId: binding.threadId, lastTurnId: cutoff, cwd: root,
      approvalPolicy: 'on-request', sandbox: 'workspace-write',
    }));
    const thread = codexObject(forked?.thread);
    const newThreadId = thread?.id;
    if (typeof newThreadId !== 'string' || !newThreadId || newThreadId === binding.threadId
      || await findCodexBindingByThread(newThreadId)) {
      throw new Error('Codex fork returned an invalid thread');
    }
    const forkResume = codexObject(await client.request('thread/resume', {
      threadId: newThreadId, cwd: root, approvalPolicy: 'on-request', sandbox: 'workspace-write',
    }));
    const forkResumeThread = codexObject(forkResume?.thread);
    if (forkResumeThread?.id !== newThreadId || codexObject(forkResumeThread.status)?.type !== 'idle') {
      throw new Error('Codex forked thread is not idle');
    }
    const read = codexObject(await client.request('thread/read', { threadId: newThreadId, includeTurns: true }));
    const history = codexObject(read?.thread);
    const turns = history?.turns;
    if (history?.id !== newThreadId || codexObject(history.status)?.type !== 'idle'
      || !Array.isArray(turns) || turns.length !== kept.length) {
      throw new Error('Codex fork history does not match the selected response');
    }
    const upstream = new Map<string, string>();
    for (const entry of retained) {
      if (entry.message.role === 'user') upstream.set(entry.message.id, await upstreamUserId(entry.message.id));
    }
    const actual = turns.map((raw: unknown, index: number) => {
      const turn = codexObject(raw);
      const items = turn?.items;
      const span = kept[index]!;
      const users = retained.slice(span.start, span.end + 1).filter(entry => entry.message.role === 'user');
      const userItems = Array.isArray(items) ? items.map(codexObject).filter(item => item?.type === 'userMessage') : [];
      if (typeof turn?.id !== 'string' || turn.itemsView !== 'full'
        || !['completed', 'failed', 'interrupted'].includes(String(turn.status)) || !Array.isArray(items)
        || userItems.length !== users.length
        || userItems.some((item, position) => item?.clientId !== upstream.get(users[position]!.message.id))) {
        throw new Error('Codex fork history does not match the selected response');
      }
      return turn.id;
    });
    if (!sameTurns(actual, kept.map(span => span.id))) {
      throw new Error('Codex fork history does not match the selected response');
    }
    const selection = await getCodexModelSelection(session.id);
    const forkedSessionId = crypto.randomUUID();
    const forkedSession = await storeTransaction(async (tx) => {
      const { codexGoal: _goal, codexGoalPending: _pending, ...sourceMetadata } = metadata ?? {};
      const created = tx.write<Session>({ op: 'session.create', session: {
        id: forkedSessionId, workspaceId: session.workspaceId, workspaceRootId: session.workspaceRootId,
        harness: 'codex-cli', preconfigId: session.preconfigId,
        title: input.title || `${session.title || 'Untitled'} (fork)`, status: 'active',
        metadata: { ...sourceMetadata, forkedFrom: session.id }, parentId: null, agentName: null,
        agentId: session.agentId, selectedModel: session.selectedModel,
        selectedProvider: session.selectedProvider, permissionMode: session.permissionMode,
      } });
      await bindCodexThread({ sessionId: forkedSessionId, threadId: newThreadId, cliVersion: version, workspaceRoot: root },
        tx, { createdInTransaction: true });
      if (selection) copyCodexModelSelection(tx, forkedSessionId, selection);
      const ids = new Map(retained.map(entry => [entry.message.id, crypto.randomUUID()]));
      for (const entry of retained) {
        const message = entry.message;
        const id = ids.get(message.id)!;
        tx.write({ op: 'message.create', message: { ...message, id, sessionId: forkedSessionId,
          ...(message.role === 'assistant' && message.parentId
            ? { parentId: ids.get(message.parentId) } : {}) } });
        if (message.role === 'user') insertCodexInheritedUserId(tx, forkedSessionId, id, upstream.get(message.id)!);
        for (const part of entry.parts) {
          tx.write({ op: 'part.create', sessionId: forkedSessionId, part: { ...part, id: crypto.randomUUID(), messageId: id } });
        }
      }
      deleteCodexForkIntent(tx, session.id);
      return created;
    });
    return { forkedSession: forkedSession.value, messages: await listMessagesWithParts(forkedSession.value.id) };
  } finally {
    await client.close();
  }
}
