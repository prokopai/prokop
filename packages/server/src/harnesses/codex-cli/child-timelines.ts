import type { AssistantMessage, Session, TextPart } from '@prokopai/sdk';
import type { ApplicationDeliveryPort } from '@/application/ports/delivery';
import { createMessage, createPart, getSession, updateMessage, updateSession } from '@/infrastructure/storage/runtime';
import { storeTransaction } from '@/infrastructure/storage/transaction';
import { StreamingTextWriter } from '@/harnesses/shared/streaming-text';
import { bindCodexThread, findCodexBindingByThread, getCodexBinding } from './bindings';
import { codexObject, type CodexNotification } from './app-server';
import { CodexToolItems } from './tool-items';

interface ChildTurn {
  id: string;
  assistant: AssistantMessage;
  tools: CodexToolItems;
  deltas: Map<string, { part: TextPart; text: string }>;
}

interface Child {
  sessionId: string;
  threadId: string;
  turns: Map<string, ChildTurn>;
  liveTurns: Set<string>;
}

function validId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 256;
}

function childTitle(path: unknown, role: unknown): string {
  const name = typeof role === 'string' && /^[\w-]{1,64}$/.test(role) ? role
    : typeof path === 'string' && /^\/root\/(?:[\w-]+\/)*[\w-]{1,64}$/.test(path)
      ? path.split('/').at(-1)! : 'Codex agent';
  return `${name} (subagent)`;
}

/**
 * Native children share the parent's app-server, but own Prokop sessions and
 * transcripts. `receive` is awaited per notification, in arrival order.
 */
export class CodexChildTimelines {
  private readonly children = new Map<string, Child>();
  private readonly early = new Map<string, CodexNotification[]>();
  private readonly streamText = new StreamingTextWriter();
  private closed = false;

  constructor(private readonly parent: Session, private readonly parentThreadId: string,
    private readonly root: string, private readonly version: string,
    private readonly delivery: ApplicationDeliveryPort<unknown>,
    private readonly isParentTurn: (turnId: unknown) => boolean,
    private readonly onTurnFinished: (sessionId: string) => void = () => {}) {}

  get liveTurns(): Array<{ threadId: string; turnId: string }> {
    return [...this.children.values()].flatMap(child => [...child.liveTurns].map(turnId => ({ threadId: child.threadId, turnId })));
  }

  get hasLiveTurns(): boolean { return this.liveTurns.length > 0; }
  get hasChildren(): boolean { return this.children.size > 0; }

  childSessionId(threadId: string): string | null { return this.children.get(threadId)?.sessionId ?? null; }

  /** Resolve parent-scoped calls only when a turn belongs to one live child. */
  uniqueLiveTurn(turnId: string): { threadId: string; sessionId: string } | null {
    if (this.closed) return null;
    let match: { threadId: string; sessionId: string } | null = null;
    for (const child of this.children.values()) {
      if (!child.liveTurns.has(turnId)) continue;
      if (match) return null;
      match = { threadId: child.threadId, sessionId: child.sessionId };
    }
    return match;
  }

  accepts(threadId: string, turnId: string): boolean {
    return !this.closed && this.children.get(threadId)?.liveTurns.has(turnId) === true;
  }

  isLiveSession(sessionId: string): boolean {
    return this.liveTurnsForSession(sessionId).length > 0;
  }

  liveTurnsForSession(sessionId: string): Array<{ threadId: string; turnId: string }> {
    return this.liveTurns.filter(turn => this.children.get(turn.threadId)?.sessionId === sessionId);
  }

  private async register(threadId: unknown, parentThreadId: string, path?: unknown, role?: unknown): Promise<Child | null> {
    if (this.closed || !validId(threadId) || threadId === this.parentThreadId
      || this.children.size >= 32 && !this.children.has(threadId)) return null;
    const owner = this.children.get(parentThreadId);
    if (parentThreadId !== this.parentThreadId && !owner) return null;
    const existing = this.children.get(threadId);
    if (existing) return existing;
    const parentId = owner?.sessionId ?? this.parent.id;
    const boundBinding = await findCodexBindingByThread(threadId);
    const bound = boundBinding ? { session_id: boundBinding.sessionId } : null;
    let session: Session;
    if (bound) {
      const candidate = await getSession(bound.session_id);
      if (!candidate || candidate.parentId !== parentId || candidate.workspaceId !== this.parent.workspaceId
        || candidate.workspaceRootId !== this.parent.workspaceRootId || candidate.harness !== 'codex-cli'
        || (await getCodexBinding(candidate.id))?.workspaceRoot !== this.root) return null;
      session = candidate;
    } else {
      const sessionId = crypto.randomUUID();
      const created = await storeTransaction(async (tx) => {
        const created = tx.write<Session>({ op: 'session.create', session: { id: sessionId, workspaceId: this.parent.workspaceId,
          workspaceRootId: this.parent.workspaceRootId, harness: 'codex-cli',
          preconfigId: this.parent.preconfigId, agentId: this.parent.agentId,
          selectedModel: this.parent.selectedModel, selectedProvider: this.parent.selectedProvider,
          permissionMode: this.parent.permissionMode, title: childTitle(path, role),
          status: 'active', metadata: null, parentId,
          agentName: typeof role === 'string' && /^[\w-]{1,64}$/.test(role) ? role : null,
          subagentStatus: 'running' } });
        await bindCodexThread({ sessionId, threadId, cliVersion: this.version, workspaceRoot: this.root },
          tx, { createdInTransaction: true });
        return created;
      });
      session = created.value;
      this.delivery.broadcast({ type: 'session.created', session });
    }
    // Another notification may have registered the thread while this one awaited.
    const raced = this.children.get(threadId);
    if (raced) return raced;
    const child: Child = { sessionId: session.id, threadId, turns: new Map(), liveTurns: new Set() };
    this.children.set(threadId, child);
    const buffered = this.early.get(threadId);
    this.early.delete(threadId);
    for (const event of buffered ?? []) await this.receive(event);
    return child;
  }

  async receive(event: CodexNotification): Promise<void> {
    if (this.closed) return;
    const params = codexObject(event.params);
    if (!params) return;
    if (event.method === 'thread/started') {
      const thread = codexObject(params.thread);
      const spawn = codexObject(codexObject(codexObject(thread?.source)?.subAgent)?.thread_spawn);
      if (validId(spawn?.parentThreadId)) await this.register(thread?.id, spawn.parentThreadId, spawn.agentPath, spawn.role);
      return;
    }
    if ((event.method === 'item/started' || event.method === 'item/completed')
      && validId(params.threadId) && (params.threadId === this.parentThreadId
        ? this.isParentTurn(params.turnId)
        : this.children.get(params.threadId)?.liveTurns.has(params.turnId as string))) {
      const item = codexObject(params.item);
      if (item?.type === 'subAgentActivity' && item.kind === 'started'
        && typeof item.agentPath === 'string' && item.agentPath.startsWith('/root/')) {
        await this.register(item.agentThreadId, params.threadId, item.agentPath);
      }
      if (item?.type === 'collabAgentToolCall' && item.tool === 'spawnAgent'
        && item.senderThreadId === params.threadId && Array.isArray(item.receiverThreadIds)
        && item.receiverThreadIds.length <= 32) {
        for (const threadId of item.receiverThreadIds) await this.register(threadId, params.threadId);
      }
    }
    if (!validId(params.threadId) || params.threadId === this.parentThreadId) return;
    const child = this.children.get(params.threadId);
    if (!child) {
      if (event.method === 'turn/started' || event.method === 'turn/completed' || event.method === 'item/started'
        || event.method === 'item/completed' || event.method === 'item/agentMessage/delta') {
        const buffered = this.early.get(params.threadId) ?? [];
        if ((this.early.size < 16 || this.early.has(params.threadId)) && buffered.length < 16
          && JSON.stringify(event.params).length <= 16_384) {
          buffered.push(event);
          this.early.set(params.threadId, buffered);
        }
      }
      return;
    }
    const turn = codexObject(params.turn);
    const turnId = event.method === 'turn/started' || event.method === 'turn/completed' ? turn?.id : params.turnId;
    if (!validId(turnId)) {
      if (event.method === 'thread/closed' && child.liveTurns.size) await this.finishChild(child, 'interrupted');
      return;
    }
    if (event.method === 'turn/completed' && !child.turns.has(turnId)) {
      await this.receive({ method: 'turn/started', params: { threadId: child.threadId, turn: { id: turnId } } });
    }
    if (event.method === 'turn/started' && !child.turns.has(turnId) && child.turns.size < 32) {
      const assistant = await createMessage({ id: crypto.randomUUID(), sessionId: child.sessionId,
        role: 'assistant', status: 'streaming', modelId: 'codex-cli', providerId: 'codex-cli',
        agent: this.parent.agentId ?? undefined,
        tokens: { prompt: 0, completion: 0 }, cost: 0, createdAt: Date.now() }) as AssistantMessage;
      child.turns.set(turnId, { id: turnId, assistant,
        tools: new CodexToolItems(child.sessionId, assistant.id, turnId, this.delivery), deltas: new Map() });
      child.liveTurns.add(turnId);
      this.delivery.broadcastToSession(child.sessionId, { type: 'message.created', message: assistant });
      const updated = await updateSession(child.sessionId, { subagentStatus: 'running' });
      if (updated) this.delivery.broadcast({ type: 'session.updated', session: updated });
      return;
    }
    const state = child.turns.get(turnId);
    if (!state || !child.liveTurns.has(turnId)) return;
    if (event.method === 'item/started' || event.method === 'item/completed') {
      if (event.method === 'item/started') await state.tools.started(params.item);
      else await state.tools.completed(params.item);
      const item = codexObject(params.item);
      if (event.method === 'item/completed' && item?.type === 'agentMessage'
        && validId(item.id) && typeof item.text === 'string') {
        const entry = state.deltas.get(item.id);
        if (entry) {
          await this.streamText.settle(entry.part.id, item.text);
          this.delivery.broadcastToSession(child.sessionId, { type: 'part.updated', sessionId: child.sessionId,
            part: { ...entry.part, text: item.text } });
        } else {
          const part = await createPart({ id: crypto.randomUUID(), messageId: state.assistant.id,
            type: 'text', text: item.text, createdAt: Date.now() }, child.sessionId);
          this.delivery.broadcastToSession(child.sessionId, { type: 'part.created', sessionId: child.sessionId, part });
        }
      }
    } else if (event.method === 'item/agentMessage/delta' && validId(params.itemId)
      && typeof params.delta === 'string') {
      let entry = state.deltas.get(params.itemId);
      if (!entry) {
        const part = await createPart({ id: crypto.randomUUID(), messageId: state.assistant.id,
          type: 'text', text: '', createdAt: Date.now() }, child.sessionId) as TextPart;
        entry = { part, text: '' };
        state.deltas.set(params.itemId, entry);
        this.delivery.broadcastToSession(child.sessionId, { type: 'part.created', sessionId: child.sessionId, part });
      }
      entry.text += params.delta;
      this.streamText.append(child.sessionId, entry.part, entry.text);
      this.delivery.broadcastToSession(child.sessionId, { type: 'part.append', sessionId: child.sessionId,
        partId: entry.part.id, field: 'text', delta: params.delta });
    } else if (event.method === 'turn/completed') {
      await this.finishTurn(child, state, turn?.status === 'completed' ? 'completed'
        : turn?.status === 'interrupted' ? 'interrupted' : 'error');
    }
  }

  private async finishTurn(child: Child, state: ChildTurn, status: 'completed' | 'interrupted' | 'error'): Promise<void> {
    // Claimed first: a turn finishes once even when close() runs while its writes await.
    if (!child.liveTurns.delete(state.id)) return;
    await state.tools.finish();
    for (const entry of state.deltas.values()) {
      const part = await this.streamText.settle(entry.part.id);
      if (part) this.delivery.broadcastToSession(child.sessionId, { type: 'part.updated', sessionId: child.sessionId, part });
    }
    this.onTurnFinished(child.sessionId);
    const updated = await updateMessage(state.assistant.id, { status, completedAt: Date.now() });
    if (updated) this.delivery.broadcastToSession(child.sessionId, { type: 'message.updated', message: updated });
    const session = await updateSession(child.sessionId, { subagentStatus: child.liveTurns.size ? 'running' : status });
    if (session) this.delivery.broadcast({ type: 'session.updated', session });
  }

  private async finishChild(child: Child, status: 'interrupted' | 'error'): Promise<void> {
    for (const turnId of [...child.liveTurns]) {
      const turn = child.turns.get(turnId);
      if (turn) await this.finishTurn(child, turn, status);
    }
    const session = await updateSession(child.sessionId, { subagentStatus: status });
    if (session) this.delivery.broadcast({ type: 'session.updated', session });
  }

  async close(status: 'interrupted' | 'error'): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.early.clear();
    for (const child of [...this.children.values()]) if (child.liveTurns.size) await this.finishChild(child, status);
  }
}
