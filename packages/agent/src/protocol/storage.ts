import type { AgentEndpoint, CommitWrite } from '@prokopai/agent-protocol';
import type { Session } from '@prokopai/sdk/types';
import type { NativeHarness, NativeKey, NativeRecord, StorageBundle } from '@prokopai/core/infrastructure/storage/contracts';

/**
 * Agent side of the storage protocol: a `StorageBundle` whose every call is a
 * host request. The Prokop engine uses it unchanged through `getStorage()`.
 *
 * `workspaces.getAutoApproveSeverity` is deliberately absent, as in the
 * production SQLite bundle; consumers treat it as inherited.
 */
export function createProtocolStorageBundle(
  endpoint: AgentEndpoint,
  options: {
    /** Sees every session the agent reads or writes; feeds agent-local caches for sync lookups. */
    observeSession?(session: Session): void;
  } = {},
): StorageBundle {
  const request = endpoint.request.bind(endpoint);
  const seen = <T extends Session | null>(session: T): T => {
    if (session) options.observeSession?.(session);
    return session;
  };
  return {
    conversation: {
      createSession: async session => seen(await request('store.session.create', { session: session as Session })),
      getSession: async id => seen(await request('store.session.get', { id })),
      updateSession: async (id, updates) => seen(await request('store.session.update', { id, updates })),
      getHandoffBrief: async sessionId => (await request('store.session.handoffBrief', { sessionId })).brief,
      getChildSessions: async (parentId) => {
        const children = await request('store.session.children', { parentId });
        children.forEach(seen);
        return children;
      },

      createMessage: message => request('store.message.create', { message }),
      getMessage: id => request('store.message.get', { id }),
      getMessageWithParts: id => request('store.message.getWithParts', { id }),
      updateMessage: (id, updates) => request('store.message.update', { id, updates }),
      deleteMessage: async id => (await request('store.message.delete', { id })).deleted,
      listMessagesWithParts: sessionId => request('store.message.list', { sessionId }),
      listLatestMessagesWithPartsPage: (sessionId, limit) => request('store.message.page', { sessionId, limit }),
      buildEffectiveContextHistory: sessionId => request('store.history.effective', { sessionId }),

      createPart: (part, sessionId) => request('store.part.create', { sessionId, part }),
      getPart: id => request('store.part.get', { id }),
      getPartsByMessage: messageId => request('store.part.listByMessage', { messageId }),
      getPartsBySession: sessionId => request('store.part.listBySession', { sessionId }),
      updatePart: (id, updates) => request('store.part.update', { id, updates }),
      persistStreamingPartSnapshots: async snapshots => (await request('store.part.snapshot', { snapshots })).count,
      transitionToolToRunningByCallId: (sessionId, callId, childSessionId) => request('store.tool.transition', {
        target: { sessionId, callId }, to: { state: 'running', childSessionId },
      }),
      transitionToolToInterrupted: (partId, reason) => request('store.tool.transition', {
        target: { partId }, to: { state: 'interrupted', reason },
      }),
      getToolPartByCallId: (sessionId, callId) => request('store.part.byCallId', { sessionId, callId }),
      transitionToolToCompleted: (partId, output) => request('store.tool.transition', {
        target: { partId }, to: { state: 'completed', output },
      }),
      transitionToolToError: (partId, error) => request('store.tool.transition', {
        target: { partId }, to: { state: 'error', error },
      }),
    },
    toolOutputArtifacts: {
      create: input => request('store.artifact.create', input),
      getPage: (sessionId, artifactId, offset, limit) => request('store.artifact.page', { sessionId, artifactId, offset, limit }),
    },
    queue: {
      addMessage: (sessionId, content, attachments) => request('queue.add', { sessionId, content, attachments }),
      peek: sessionId => request('queue.peek', { sessionId }),
      peekSteer: sessionId => request('queue.peekSteer', { sessionId }),
      listSteer: sessionId => request('queue.listSteer', { sessionId }),
      get: id => request('queue.get', { id }),
      delete: async id => (await request('queue.delete', { id })).deleted,
    },
    attachments: {
      get: (sessionId, attachmentId) => request('attachment.get', { sessionId, attachmentId }),
      create: ({ data, ...input }) => request('attachment.create', { ...input, sizeBytes: data.byteLength,
        dataBase64: Buffer.from(data).toString('base64') }),
    },
    workspaces: { get: id => request('workspace.get', { id }) },
    responseFormats: { get: id => request('responseFormat.get', { id }) },
    index: {
      syncMessage: async (messageId) => {
        await request('store.index.sync', { messageId });
      },
    },
    native: {
      get: async <V>(target: NativeKey) => await request('native.get', target) as NativeRecord<V> | null,
      find: async <V>(harness: NativeHarness, kind: string, lookup: string) =>
        await request('native.find', { harness, kind, lookup }) as NativeRecord<V> | null,
    },
    commit: async ({ checks, writes }) => {
      const result = await request('store.commit', { checks: checks ?? [], writes: writes as CommitWrite[] });
      if (result.ok) {
        for (const [index, write] of writes.entries()) {
          if (write.op === 'session.create' || write.op === 'session.update') seen(result.results[index] as Session | null);
        }
      }
      return result;
    },
  };
}
