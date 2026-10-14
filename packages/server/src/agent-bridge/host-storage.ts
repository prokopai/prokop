import type { HostHandlers } from '@prokopai/agent-protocol';
import type { Session } from '@prokopai/sdk/types';
import type { StorageBundle } from '@/infrastructure/storage/contracts';

/**
 * Host side of the storage protocol: serves agent `store.*`, queue,
 * attachment, workspace and response-format requests from a host
 * `StorageBundle` (SQLite in production, in-memory in tests). Each handler is
 * a direct call, so the protocol adds no behavior of its own.
 *
 * Not served yet: `store.part.byCallId`, tool transitions to completed/error
 * and by part ID to running (Claude/Codex, step 1g), `store.commit` (1c).
 */
export function createStorageHostHandlers(bundle: StorageBundle): HostHandlers {
  const { conversation, queue } = bundle;
  return {
    'store.session.create': ({ session }) => conversation.createSession(session),
    'store.session.get': ({ id }) => conversation.getSession(id),
    'store.session.update': async ({ id, updates, metadataPatch }) => {
      if (!metadataPatch) return conversation.updateSession(id, updates);
      const current = await conversation.getSession(id);
      if (!current) return null;
      return conversation.updateSession(id, {
        ...updates,
        metadata: { ...(current.metadata ?? {}), ...metadataPatch },
      } as Partial<Session>);
    },
    'store.session.children': ({ parentId }) => conversation.getChildSessions(parentId),

    'store.message.create': ({ message }) => conversation.createMessage(message),
    'store.message.get': ({ id }) => conversation.getMessage(id),
    'store.message.getWithParts': ({ id }) => conversation.getMessageWithParts(id),
    'store.message.update': ({ id, updates }) => conversation.updateMessage(id, updates),
    'store.message.delete': async ({ id }) => ({ deleted: await conversation.deleteMessage(id) }),
    'store.message.list': ({ sessionId }) => conversation.listMessagesWithParts(sessionId),
    'store.message.page': ({ sessionId, limit }) => conversation.listLatestMessagesWithPartsPage(sessionId, limit),
    'store.history.effective': ({ sessionId }) => conversation.buildEffectiveContextHistory(sessionId),

    'store.part.create': ({ sessionId, part }) => conversation.createPart(part, sessionId),
    'store.part.get': ({ id }) => conversation.getPart(id),
    'store.part.update': ({ id, updates }) => conversation.updatePart(id, updates),
    'store.part.listByMessage': ({ messageId }) => conversation.getPartsByMessage(messageId),
    'store.part.listBySession': ({ sessionId }) => conversation.getPartsBySession(sessionId),
    'store.part.snapshot': async ({ snapshots }) => ({ count: await conversation.persistStreamingPartSnapshots(snapshots) }),
    'store.tool.transition': ({ target, to }) => {
      if (to.state === 'running' && 'callId' in target) {
        return conversation.transitionToolToRunningByCallId(target.sessionId, target.callId, to.childSessionId);
      }
      if (to.state === 'interrupted' && 'partId' in target) {
        return conversation.transitionToolToInterrupted(target.partId, to.reason);
      }
      throw new Error(`Tool transition to ${to.state} by ${'partId' in target ? 'part' : 'call'} ID is not served yet`);
    },
    'store.index.sync': async ({ messageId }) => {
      await bundle.index.syncMessage(messageId);
      return {};
    },
    'store.artifact.create': input => bundle.toolOutputArtifacts.create(input),
    'store.artifact.page': ({ sessionId, artifactId, offset, limit }) =>
      bundle.toolOutputArtifacts.getPage(sessionId, artifactId, offset, limit),

    'queue.peekSteer': ({ sessionId }) => queue.peekSteer(sessionId),
    'queue.add': ({ sessionId, content, attachments }) => queue.addMessage(sessionId, content, attachments),
    'queue.peek': ({ sessionId }) => queue.peek(sessionId),
    'queue.delete': async ({ id }) => ({ deleted: await queue.delete(id) }),
    'attachment.get': ({ sessionId, attachmentId }) => bundle.attachments.get(sessionId, attachmentId),
    'workspace.get': ({ id }) => bundle.workspaces.get(id),
    'responseFormat.get': ({ id }) => bundle.responseFormats.get(id),
  };
}
