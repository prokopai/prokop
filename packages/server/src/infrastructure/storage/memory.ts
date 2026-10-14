import type { Message, MessageWithParts, Part, QueuedMessage, ResponseFormat, Session, ToolPart, Workspace } from '@prokopai/sdk/types';
import { createInMemoryToolOutputArtifactStore } from '@/infrastructure/storage/tool-output-artifacts';
import { CommitFailure, nativeValueMatches } from '@/infrastructure/storage/commit-guards';
import type {
  AttachmentRecord,
  AttachmentStore,
  CommitCheck,
  CommitRequest,
  CommitResult,
  CommitWrite,
  ConversationIndex,
  ConversationStore,
  MessageQueueStore,
  NativeKey,
  NativeRecord,
  ResponseFormatStore,
  SessionUpdates,
  StorageBundle,
  StreamingPartSnapshot,
  TranscriptPageResult,
  WorkspaceStore,
} from '@/infrastructure/storage/contracts';

interface StoredMessage {
  message: Message;
  sequence: number;
}

interface StoredPart {
  part: Part;
  sessionId: string;
  insertionOrder: number;
}

function copy<T>(value: T): T {
  return structuredClone(value);
}

function compareParts(left: Part, right: Part): number {
  return left.createdAt - right.createdAt;
}

export function createInMemoryConversationStore(): ConversationStore {
  const sessions = new Map<string, Session>();
  const messages = new Map<string, StoredMessage>();
  const parts = new Map<string, StoredPart>();
  const nextSequence = new Map<string, number>();
  let nextPartInsertionOrder = 0;

  const getPartsByMessage = (messageId: string): Part[] => [...parts.values()]
    .filter(record => record.part.messageId === messageId)
    .map(record => copy(record.part))
    .sort(compareParts);

  const orderedMessages = (sessionId: string): StoredMessage[] => [...messages.values()]
    .filter(record => record.message.sessionId === sessionId)
    .sort((left, right) => left.sequence - right.sequence);

  const listMessagesWithParts = (sessionId: string): MessageWithParts[] => orderedMessages(sessionId)
    .map(record => ({
      message: copy(record.message),
      parts: getPartsByMessage(record.message.id),
    }));

  const store: ConversationStore = {
    async createSession(input) {
      const now = new Date().toISOString();
      const session = copy({
        ...input,
        tags: input.tags ?? [],
        createdAt: input.createdAt || now,
        updatedAt: input.updatedAt || now,
      }) as Session;
      if (sessions.has(session.id)) throw new Error(`Session already exists: ${session.id}`);
      sessions.set(session.id, session);
      return copy(session);
    },
    async getSession(id) {
      const session = sessions.get(id);
      return session ? copy(session) : null;
    },
    async updateSession(id, updates: SessionUpdates) {
      const current = sessions.get(id);
      if (!current) return null;
      const updated = copy({ ...current, ...updates, updatedAt: new Date().toISOString() }) as Session;
      sessions.set(id, updated);
      return copy(updated);
    },
    async getChildSessions(parentId) {
      return [...sessions.values()]
        .filter(session => session.parentId === parentId)
        .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
        .map(copy);
    },
    /** The memory store has no harness switches. */
    async getHandoffBrief() {
      return null;
    },
    async createMessage(message) {
      if (!sessions.has(message.sessionId)) throw new Error(`Session does not exist: ${message.sessionId}`);
      if (messages.has(message.id)) throw new Error(`Message already exists: ${message.id}`);
      const sequence = nextSequence.get(message.sessionId) ?? 1;
      nextSequence.set(message.sessionId, sequence + 1);
      messages.set(message.id, { message: copy(message), sequence });
      return copy(message);
    },
    async getMessage(id) {
      const record = messages.get(id);
      return record ? copy(record.message) : null;
    },
    async getMessageWithParts(messageId) {
      const record = messages.get(messageId);
      return record ? { message: copy(record.message), parts: getPartsByMessage(messageId) } : null;
    },
    async updateMessage(id, updates) {
      const current = messages.get(id);
      if (!current) return null;
      current.message = copy({ ...current.message, ...updates }) as Message;
      return copy(current.message);
    },
    async deleteMessage(messageId) {
      if (!messages.delete(messageId)) return false;
      for (const [id, record] of parts) {
        if (record.part.messageId === messageId) parts.delete(id);
      }
      return true;
    },
    async listMessagesWithParts(sessionId) { return listMessagesWithParts(sessionId); },
    async listLatestMessagesWithPartsPage(sessionId, limit = 50): Promise<TranscriptPageResult> {
      const effectiveLimit = Math.min(Math.max(limit, 1), 100);
      const ordered = orderedMessages(sessionId);
      const selected = ordered.slice(-effectiveLimit);
      return {
        messages: selected.map(record => ({
          message: copy(record.message),
          parts: getPartsByMessage(record.message.id),
        })),
        pagination: {
          hasOlder: ordered.length > selected.length,
          oldestSequence: selected[0]?.sequence ?? null,
          newestSequence: selected.at(-1)?.sequence ?? null,
          limit: effectiveLimit,
        },
      };
    },
    async buildEffectiveContextHistory(sessionId) {
      const ordered = orderedMessages(sessionId);
      let boundary: StoredMessage | undefined;
      for (let index = ordered.length - 1; index >= 0; index -= 1) {
        const candidate = ordered[index];
        const message = candidate.message;
        if (message.role !== 'assistant' || message.summary !== true || message.mode !== 'compaction' || !message.parentId) continue;
        const trigger = messages.get(message.parentId);
        if (!trigger || trigger.message.sessionId !== sessionId) continue;
        if (!getPartsByMessage(trigger.message.id).some(part => part.type === 'compaction')) continue;
        boundary = trigger;
        break;
      }
      const effective = boundary
        ? ordered.filter(record => record.sequence >= boundary.sequence)
        : ordered;
      return {
        messages: effective.map(record => ({
          message: copy(record.message),
          parts: getPartsByMessage(record.message.id),
        })),
        latestCompactionBoundary: boundary?.message.id ?? null,
        hasCompaction: Boolean(boundary),
      };
    },
    async createPart(part, sessionId) {
      const message = messages.get(part.messageId);
      if (!message || message.message.sessionId !== sessionId) throw new Error(`Message does not exist in session: ${part.messageId}`);
      if (parts.has(part.id)) throw new Error(`Part already exists: ${part.id}`);
      parts.set(part.id, {
        part: copy(part),
        sessionId,
        insertionOrder: nextPartInsertionOrder++,
      });
      return copy(part);
    },
    async getPart(id) {
      const record = parts.get(id);
      return record ? copy(record.part) : null;
    },
    async getPartsByMessage(messageId) {
      return getPartsByMessage(messageId);
    },
    async getPartsBySession(sessionId) {
      return [...parts.values()]
        .filter(record => record.sessionId === sessionId)
        .map(record => copy(record.part))
        .sort(compareParts);
    },
    async updatePart(id, updates) {
      const current = parts.get(id);
      if (!current) return null;
      current.part = copy({ ...current.part, ...updates }) as Part;
      return copy(current.part);
    },
    async persistStreamingPartSnapshots(snapshots: StreamingPartSnapshot[]) {
      let count = 0;
      for (const snapshot of snapshots) {
        const record = parts.get(snapshot.id);
        if (!record
          || record.part.messageId !== snapshot.messageId
          || record.sessionId !== snapshot.sessionId
          || record.part.type !== snapshot.type) continue;
        record.part = copy({ ...record.part, text: snapshot.text }) as Part;
        count += 1;
      }
      return count;
    },
    async transitionToolToRunningByCallId(sessionId, callId, childSessionId) {
      const candidates = [...parts.values()]
        .filter(record => record.sessionId === sessionId
          && record.part.type === 'tool'
          && record.part.callId === callId)
        .sort((left, right) => {
          const leftPart = left.part as ToolPart;
          const rightPart = right.part as ToolPart;
          return Number(rightPart.state.status === 'pending') - Number(leftPart.state.status === 'pending')
            || rightPart.createdAt - leftPart.createdAt
            || right.insertionOrder - left.insertionOrder;
        });
      const toolPart = candidates[0]?.part as ToolPart | undefined;
      if (!toolPart || toolPart.state.status !== 'pending') return null;
      return await store.updatePart(toolPart.id, {
        state: {
          status: 'running',
          input: toolPart.state.input,
          startedAt: Date.now(),
          ...(childSessionId ? { childSessionId } : {}),
        },
      }) as ToolPart;
    },
    async getToolPartByCallId(sessionId, callId) {
      const match = [...parts.values()]
        .filter(record => record.sessionId === sessionId && record.part.type === 'tool' && record.part.callId === callId)
        .sort((left, right) => right.part.createdAt - left.part.createdAt || right.insertionOrder - left.insertionOrder)[0];
      return match ? copy(match.part) as ToolPart : null;
    },
    async transitionToolToCompleted(partId, output) {
      const current = parts.get(partId)?.part;
      if (!current || current.type !== 'tool' || current.state.status !== 'running') return null;
      return await store.updatePart(partId, { state: { status: 'completed', input: current.state.input, output,
        startedAt: current.state.startedAt, completedAt: Date.now(),
        ...(current.state.childSessionId ? { childSessionId: current.state.childSessionId } : {}) } }) as ToolPart;
    },
    async transitionToolToError(partId, error) {
      const current = parts.get(partId)?.part;
      if (!current || current.type !== 'tool') return null;
      const now = Date.now();
      return await store.updatePart(partId, { state: { status: 'error', input: current.state.input, error,
        startedAt: current.state.status === 'running' ? current.state.startedAt : now, failedAt: now,
        ...('childSessionId' in current.state && current.state.childSessionId
          ? { childSessionId: current.state.childSessionId } : {}) } }) as ToolPart;
    },
    async transitionToolToInterrupted(partId, reason) {
      const current = parts.get(partId)?.part;
      if (!current || current.type !== 'tool') return null;
      const now = Date.now();
      return await store.updatePart(partId, {
        state: {
          status: 'interrupted',
          input: current.state.input,
          startedAt: current.state.status === 'running' ? current.state.startedAt : now,
          interruptedAt: now,
          reason,
          ...('childSessionId' in current.state && current.state.childSessionId
            ? { childSessionId: current.state.childSessionId }
            : {}),
        },
      }) as ToolPart;
    },
  };

  return store;
}

export function createInMemoryMessageQueueStore(options: { attachments?: AttachmentStore } = {}): MessageQueueStore {
  const records = new Map<string, QueuedMessage>();
  let id = 0;
  return {
    async addMessage(sessionId, content, attachments) {
      const position = Math.max(-1, ...[...records.values()]
        .filter(record => record.sessionId === sessionId)
        .map(record => record.position)) + 1;
      const enriched: Array<{ id: string; kind: string; filename?: string; mimeType?: string; accessKey?: string }> | undefined = attachments ? [] : undefined;
      if (attachments && enriched) {
        for (const attachment of attachments) {
          const record = await options.attachments?.get(sessionId, attachment.id);
          enriched.push(record ? {
            ...attachment,
            filename: record.filename,
            mimeType: record.mimeType,
            accessKey: record.accessKey,
          } : attachment);
        }
      }
      const message: QueuedMessage = {
        id: `queue-${++id}`,
        sessionId,
        content,
        position,
        createdAt: Date.now(),
        ...(enriched ? { attachments: enriched } : {}),
      };
      records.set(message.id, copy(message));
      return copy(message);
    },
    async peek(sessionId) {
      const message = [...records.values()]
        .filter(record => record.sessionId === sessionId)
        .sort((left, right) => left.position - right.position || left.id.localeCompare(right.id))[0];
      return message ? copy(message) : null;
    },
    async peekSteer(sessionId) {
      const message = [...records.values()]
        .filter(record => record.sessionId === sessionId && record.steer)
        .sort((left, right) => left.position - right.position || left.id.localeCompare(right.id))[0];
      return message ? copy(message) : null;
    },
    async listSteer(sessionId) {
      return [...records.values()]
        .filter(record => record.sessionId === sessionId && record.steer)
        .sort((left, right) => left.position - right.position || left.id.localeCompare(right.id))
        .map(copy);
    },
    async get(id) {
      const message = records.get(id);
      return message ? copy(message) : null;
    },
    async delete(idToDelete) {
      return records.delete(idToDelete);
    },
  };
}

export interface InMemoryAuxiliaryRecords {
  attachments?: AttachmentRecord[];
  workspaces?: Workspace[];
  responseFormats?: ResponseFormat[];
}

export function createInMemoryStorageBundle(records: InMemoryAuxiliaryRecords = {}): StorageBundle {
  const attachments = new Map(records.attachments?.map(record => [`${record.sessionId}:${record.id}`, copy(record)]));
  const workspaces = new Map(records.workspaces?.map(record => [record.id, copy(record)]));
  const responseFormats = new Map(records.responseFormats?.map(record => [record.id, copy(record)]));
  const attachmentStore: AttachmentStore = {
    get: async (sessionId, attachmentId) => copy(attachments.get(`${sessionId}:${attachmentId}`) ?? null),
    /** Keeps metadata only; there is no file behind an in-memory attachment. */
    create: async ({ data, ...input }) => {
      const record: AttachmentRecord = { ...input, id: crypto.randomUUID(), kind: input.mimeType.startsWith('image/')
        ? 'image' : 'file', sizeBytes: data.byteLength, absolutePath: '', createdAt: new Date().toISOString(),
      accessKey: crypto.randomUUID().replaceAll('-', '') };
      attachments.set(`${record.sessionId}:${record.id}`, record);
      return copy(record);
    },
  };
  const workspaceStore: WorkspaceStore = {
    get: async id => copy(workspaces.get(id) ?? null),
    getAutoApproveSeverity: async id => workspaces.get(id)?.settings.autoApproveSeverity ?? 'low',
  };
  const responseFormatStore: ResponseFormatStore = {
    get: async id => copy(responseFormats.get(id) ?? null),
  };
  const index: ConversationIndex = { syncMessage: async () => {} };
  const conversation = createInMemoryConversationStore();
  const queue = createInMemoryMessageQueueStore({ attachments: attachmentStore });
  const native = new Map<string, NativeRecord>();
  const nativeId = (target: NativeKey): string => `${target.harness}\u0000${target.kind}\u0000${target.key}`;

  async function passes(check: CommitCheck): Promise<boolean> {
    switch (check.check) {
      case 'native.equals': {
        const stored = native.get(nativeId(check.target));
        return !!stored && nativeValueMatches(stored.value, check.value);
      }
      case 'native.absent': return !native.has(nativeId(check.target));
      case 'session.messageIds': {
        const ids = (await conversation.listMessagesWithParts(check.sessionId)).map(entry => entry.message.id);
        return ids.length === check.ids.length && ids.every((id, index) => id === check.ids[index]);
      }
      case 'session.harness': {
        // SQLite defaults the column to 'prokop'; test sessions often omit it.
        const current = await conversation.getSession(check.sessionId);
        return !!current && (current.harness ?? 'prokop') === check.harness;
      }
      case 'queue.present': return !!await queue.get(check.id);
    }
  }

  async function apply(write: CommitWrite): Promise<unknown> {
    switch (write.op) {
      case 'session.create': return conversation.createSession(write.session);
      case 'session.update': {
        const current = await conversation.getSession(write.id);
        if (!current) return null;
        return conversation.updateSession(write.id, { ...write.updates, ...(write.metadataPatch
          ? { metadata: { ...(current.metadata ?? {}), ...write.metadataPatch } } : {}) } as SessionUpdates);
      }
      case 'message.create': return conversation.createMessage(write.message);
      case 'message.update': return conversation.updateMessage(write.id, write.updates as Partial<Message>);
      case 'message.delete': return await conversation.deleteMessage(write.id) || !!write.ifExists;
      case 'part.create': return conversation.createPart(write.part, write.sessionId);
      case 'part.update': return conversation.updatePart(write.id, write.updates);
      case 'queue.delete': return await queue.delete(write.id) || !!write.ifExists;
      case 'native.put': {
        const id = nativeId(write.record);
        if (write.record.lookup != null && [...native.entries()].some(([other, record]) => other !== id
          && record.harness === write.record.harness && record.kind === write.record.kind
          && record.lookup === write.record.lookup)) throw new Error('Native lookup already bound');
        native.set(id, copy(write.record));
        return true;
      }
      case 'native.delete': return native.delete(nativeId(write.target)) || !!write.ifExists;
    }
  }

  /** Checks first; writes apply in order. Not rolled back on a failed write (test store). */
  async function commit(request: CommitRequest): Promise<CommitResult> {
    for (const [index, check] of (request.checks ?? []).entries()) {
      if (!(await passes(check))) return { ok: false, failed: { kind: 'check', index } };
    }
    const results: unknown[] = [];
    for (const [index, write] of request.writes.entries()) {
      try {
        const result = await apply(write);
        if (result === null || result === false) throw new CommitFailure('write', index, `${write.op} matched no row`);
        results.push(result);
      } catch (error) {
        return { ok: false, failed: { kind: 'write', index, message: error instanceof Error ? error.message : String(error) } };
      }
    }
    return { ok: true, results };
  }

  return {
    conversation,
    toolOutputArtifacts: createInMemoryToolOutputArtifactStore(),
    queue,
    attachments: attachmentStore,
    workspaces: workspaceStore,
    responseFormats: responseFormatStore,
    index,
    native: {
      get: async <V>(target: NativeKey) => copy(native.get(nativeId(target)) ?? null) as NativeRecord<V> | null,
      find: async <V>(harness: NativeKey['harness'], kind: string, lookup: string) => copy([...native.values()]
        .find(record => record.harness === harness && record.kind === kind && record.lookup === lookup) ?? null) as NativeRecord<V> | null,
    },
    commit,
  };
}
