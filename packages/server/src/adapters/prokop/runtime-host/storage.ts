import { configureStorage } from '@prokopai/core/infrastructure/storage/runtime';
import type { StorageBundle } from '@prokopai/core/infrastructure/storage/contracts';
import {
  buildEffectiveContextHistory,
  createMessage,
  createPart,
  deleteMessage,
  getMessage,
  getMessageWithParts,
  getPart,
  getPartsByMessage,
  getPartsBySession,
  listLatestMessagesWithPartsPage,
  listMessagesWithParts,
  getToolPartByCallId,
  persistStreamingPartSnapshots,
  syncMessageFts,
  transitionToolToCompleted,
  transitionToolToError,
  transitionToolToInterrupted,
  transitionToolToRunningByCallId,
  updateMessage,
  updatePart,
} from '@/infrastructure/sqlite/message-store';
import {
  createSession,
  getChildSessions,
  getSession,
  updateSession,
} from '@/infrastructure/sqlite/session-store';
import {
  addMessageToQueue,
  deleteQueuedMessage,
  getNextQueuedMessage,
  getQueuedMessage,
  listSteerQueuedMessages,
} from '@/infrastructure/sqlite/queued-messages';
import { createAttachment, getAttachment } from '@/infrastructure/sqlite/attachments';
import { getResponseFormat } from '@/infrastructure/sqlite/response-formats';
import { getWorkspace } from '@/infrastructure/sqlite/workspaces';
import { prokopToolOutputArtifactStore } from '@/infrastructure/sqlite/tool-output-artifacts';
import { findHarnessState, getHarnessState } from '@/infrastructure/sqlite/harness-state';
import { commitSqlite } from '@/infrastructure/sqlite/storage-commit';
import { readHandoffBrief } from '@/infrastructure/sqlite/session-harness-switch';

export const prokopStorageBundle: StorageBundle = {
  conversation: {
    createSession: async (...args) => createSession(...args),
    createMessage: async (...args) => createMessage(...args),
    getMessage: async (...args) => getMessage(...args),
    getMessageWithParts: async (...args) => getMessageWithParts(...args),
    deleteMessage: async (...args) => deleteMessage(...args),
    updateMessage: async (id, updates) => updateMessage(id, updates, { syncFts: false }),
    getSession: async (...args) => getSession(...args),
    updateSession: async (...args) => updateSession(...args),
    transitionToolToInterrupted: async (...args) => transitionToolToInterrupted(...args),
    getPartsByMessage: async (...args) => getPartsByMessage(...args),
    createPart: async (part, sessionId) => createPart(part, sessionId, { syncFts: false }),
    updatePart: async (id, updates) => updatePart(id, updates, { syncFts: false }),
    getPart: async (...args) => getPart(...args),
    persistStreamingPartSnapshots: async (...args) => persistStreamingPartSnapshots(...args),
    transitionToolToRunningByCallId: async (...args) => transitionToolToRunningByCallId(...args),
    getChildSessions: async (...args) => getChildSessions(...args),
    getHandoffBrief: async (...args) => readHandoffBrief(...args),
    listMessagesWithParts: async (...args) => listMessagesWithParts(...args),
    listLatestMessagesWithPartsPage: async (...args) => listLatestMessagesWithPartsPage(...args),
    getPartsBySession: async (...args) => getPartsBySession(...args),
    buildEffectiveContextHistory: async (...args) => buildEffectiveContextHistory(...args),
    getToolPartByCallId: async (...args) => getToolPartByCallId(...args),
    transitionToolToCompleted: async (...args) => transitionToolToCompleted(...args),
    transitionToolToError: async (...args) => transitionToolToError(...args),
  },
  toolOutputArtifacts: prokopToolOutputArtifactStore,
  queue: {
    addMessage: async (...args) => addMessageToQueue(...args),
    delete: async (...args) => deleteQueuedMessage(...args),
    peek: async (...args) => getNextQueuedMessage(...args),
    peekSteer: async (sessionId) => listSteerQueuedMessages(sessionId)[0] ?? null,
    listSteer: async (...args) => listSteerQueuedMessages(...args),
    get: async (...args) => getQueuedMessage(...args),
  },
  attachments: {
    get: async (...args) => getAttachment(...args),
    create: ({ data, ...input }) => createAttachment({ ...input, sizeBytes: data.byteLength,
      data: data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer }),
  },
  workspaces: {
    get: async (...args) => getWorkspace(...args),
  },
  responseFormats: { get: async (...args) => getResponseFormat(...args) },
  index: { syncMessage: async (...args) => syncMessageFts(...args) },
  native: {
    get: async target => getHarnessState(target),
    find: async (harness, kind, lookup) => findHarnessState(harness, kind, lookup),
  },
  commit: async request => commitSqlite(request),
};

export function configureProkopStorage(): void {
  configureStorage(prokopStorageBundle);
}
