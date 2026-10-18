// =============================================================================
// Fake SDK client: answers `client.http.*` from mock data, logs everything else
// =============================================================================
//
// Components that own their data (settings panels, Git views, worktree lists)
// call the SDK through the real query hooks. Giving them this client instead
// of `null` renders their populated state; overriding one method renders
// loading, empty or error states through the same code path the app uses.
//
//   const client = createFakeSdkClient();
//   const slow = createFakeSdkClient({ latencyMs: 60_000 });          // loading
//   const empty = createFakeSdkClient({ http: { preconfigs: { list: async () => ({ preconfigs: [] }) } } });
//   const broken = createFakeSdkClient({ http: { preconfigs: { list: async () => { throw new Error('boom'); } } } });
//
// A method with no default and no override rejects with a descriptive error,
// so a story shows the gap instead of hanging on a pending query.
//
// The client is also a small event emitter: `emitClientEvent(client,
// 'permission.list', workspaceId, grants)` feeds components that listen to
// WebSocket events.

import type { ProkopaiClient } from '@prokopai/sdk';
import { action } from 'storybook/actions';
import {
  createWorkspace,
  createSession,
  createPreconfigList,
  createModelList,
  createToolDefinitionList,
  createWorktree,
  createRefList,
  createFileEntryList,
  createGitRepository,
  createGitStatus,
  createBranches,
  createHistory,
  createCommitDetails,
  createRebaseState,
  createRebaseConflict,
  createFileTreeResponse,
  filePreviewPresets,
  createEditableFile,
  createGitFileDiff,
  createPullRequestDiscovery,
  createPullRequestDetail,
  createPullRequestList,
  createPullRequestFiles,
  samplePatch,
  createMcpStatus,
  createMcpTools,
  createModelsConfig,
  createProviderCredentials,
  createOAuthProviders,
  createProviderUsage,
  createCodexAccountUsage,
  createHarnessUsage,
  createAccessStatus,
  createAccessOverview,
  createPairingCode,
  createRemoteAccessStatus,
  createNotificationConfig,
  createLearningRuns,
  createLearningRunDetail,
  createPromptList,
  createResponseFormatList,
} from '../mocks';

type AnyFunction = (...args: never[]) => unknown;
type MethodOverrides<T> = { [K in keyof T as T[K] extends AnyFunction ? K : never]?: T[K] };
type NestedOverrides<T> = {
  [K in keyof T]?: T[K] extends AnyFunction ? T[K] : T[K] extends object ? NestedOverrides<T[K]> : never;
};

export type FakeHttp = { [NS in keyof ProkopaiClient['http']]?: NS extends 'config' ? NestedOverrides<ProkopaiClient['http'][NS]> : MethodOverrides<ProkopaiClient['http'][NS]> };

type WsNamespaceName = 'sessions' | 'chat' | 'permissions' | 'queue' | 'providers' | 'control' | 'git' | 'files' | 'notifications' | 'terminal';

export interface FakeSdkClientOptions {
  /** Per-namespace method overrides, merged over the defaults below. */
  http?: FakeHttp;
  /** WebSocket namespace method overrides (`terminal.subscribeEvents`); everything else logs and returns nothing. */
  namespaces?: Partial<Record<WsNamespaceName, Record<string, AnyFunction>>>;
  /** Raw `httpClient.get` answers for the few components that bypass the REST namespaces. */
  rawGet?: (path: string, options?: unknown) => Promise<unknown>;
  /** Delay every default answer; use a large value to freeze loading states. */
  latencyMs?: number;
  /** Workspace the default answers belong to. */
  workspace?: ReturnType<typeof createWorkspace>;
}

type HandlerTable = { [key: string]: AnyFunction | HandlerTable };

function wait(ms: number): Promise<void> {
  return ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve();
}

/** Default answers for the calls panels make on mount. */
function createDefaultHttp(workspace: ReturnType<typeof createWorkspace>): HandlerTable {
  const session = createSession({ workspaceId: workspace.id, title: 'Storybook session' });
  const models = createModelList();
  const worktrees = [
    createWorktree({ workspaceId: workspace.id, name: 'feature-login', branch: 'feature/login' }),
    createWorktree({ workspaceId: workspace.id, name: 'fix-auth-flow', branch: 'fix/auth-flow', dirty: true, untrackedCount: 2 }),
  ];
  const codexModels = [
    { model: 'gpt-5-codex', name: 'GPT-5 Codex', supportedEfforts: ['low', 'medium', 'high'], defaultEffort: 'medium', isDefault: true },
    { model: 'gpt-5', name: 'GPT-5', supportedEfforts: ['minimal', 'low', 'medium', 'high'], defaultEffort: 'medium', isDefault: false },
  ];
  const claudeModels = [
    { model: 'claude-sonnet-4-5', name: 'Sonnet 4.5', supportedEfforts: ['low', 'medium', 'high'], defaultEffort: 'medium', isDefault: true },
    { model: 'claude-opus-4-1', name: 'Opus 4.1', supportedEfforts: ['low', 'medium', 'high', 'max'], defaultEffort: 'high', isDefault: false },
  ];
  return {
    workspaces: {
      list: async () => ({ workspaces: [workspace] }),
      get: async () => ({ workspace }),
      listWorktrees: async () => ({ worktrees }),
      listWorktreeRefs: async () => ({ refs: createRefList() }),
      listPinnedMessages: async () => ({ pinnedMessages: [] }),
      learningRuns: async () => ({ runs: createLearningRuns(), blocked: false }),
      learningRun: async (_id: string, runId: string) => createLearningRunDetail({ run: { ...createLearningRunDetail().run, id: runId } }),
      undoLearningChange: async () => ({ result: 'ok' }),
      previewLearning: async () => ({ prompt: 'You are the reviewer for this workspace.\n\nRead the recent sessions and record durable lessons in MEMORY.md.' }),
    },
    sessions: {
      list: async () => ({ sessions: [session] }),
      listByWorkspace: async () => ({ sessions: [session] }),
      listGrouped: async () => ({ sessions: { [workspace.id]: [session] } }),
      countsByWorkspace: async () => ({ counts: { active: 1, archived: 0, scheduled: 0 } }),
      listTags: async () => ({ tags: [] }),
      get: async () => ({ session }),
      harnesses: async () => ({
        harnesses: [
          { id: 'prokop', available: true, enabled: true },
          { id: 'claude-cli', available: true, enabled: true, version: '2.0.0', approvals: true },
          { id: 'codex-cli', available: false, enabled: false, version: null },
        ],
      }),
      harnessUsage: async (harness: string) => ({ usage: createHarnessUsage({ harness: harness as 'claude-cli' | 'codex-cli' }) }),
      claudeCatalog: async () => ({ models: claudeModels }),
      codexCatalog: async () => ({ models: codexModels }),
      claudeModels: async () => ({ models: claudeModels, selection: null }),
      codexModels: async () => ({ models: codexModels, selection: null }),
    },
    preconfigs: {
      list: async () => ({ preconfigs: createPreconfigList() }),
    },
    prompts: {
      list: async () => ({ prompts: createPromptList() }),
    },
    config: {
      models: {
        get: async () => createModelsConfig(),
      },
      prompts: {
        list: async () => ({ prompts: createPromptList() }),
      },
    },
    models: {
      list: async () => ({ models, defaultModel: models[0]?.id ?? '', defaultProvider: models[0]?.providerId ?? '' }),
    },
    providers: {
      list: async () => ({ providers: createOAuthProviders() }),
      listCredentials: async () => ({ providers: createProviderCredentials() }),
      usage: async (provider: string) => ({ usage: createProviderUsage({ provider: provider as 'deepseek' }) }),
      codexAccountUsage: async (accountId: string) => ({ usage: createCodexAccountUsage({ accountId }) }),
    },
    agents: {
      list: async () => ({ agents: [] }),
    },
    tools: {
      list: async () => ({ tools: createToolDefinitionList().map((tool) => ({ ...tool, source: 'builtin' as const })) }),
    },
    scheduler: {
      list: async () => ({ jobs: [] }),
    },
    responseFormats: {
      list: async () => ({ formats: createResponseFormatList() }),
    },
    mcp: {
      getStatus: async () => createMcpStatus(),
      getTools: async () => ({ tools: createMcpTools() }),
      save: async () => ({ success: true }),
      remove: async () => ({ success: true }),
      setToolEnabled: async () => ({ success: true }),
    },
    notifications: {
      getConfig: async () => createNotificationConfig(),
    },
    access: {
      status: async () => createAccessStatus(),
      overview: async () => createAccessOverview(),
      createPairingCode: async () => createPairingCode(),
      approve: async () => ({ success: true as const }),
      deny: async () => ({ success: true as const }),
      revokeDevice: async () => ({ success: true as const }),
    },
    remoteAccess: {
      status: async () => createRemoteAccessStatus(),
      setListenOnNetwork: async (listenOnNetwork: boolean) => createRemoteAccessStatus({ listenOnNetwork }),
      addAddress: async () => createRemoteAccessStatus(),
      removeAddress: async () => createRemoteAccessStatus(),
      setTailscale: async () => createRemoteAccessStatus(),
    },
    attachments: {
      getUrl: (sessionId: string, attachmentId: string, key: string) => (
        `/api/sessions/${encodeURIComponent(sessionId)}/attachments/${encodeURIComponent(attachmentId)}/content?key=${encodeURIComponent(key)}`
      ),
    },
    files: {
      tree: async () => createFileTreeResponse(),
      browse: async () => ({ files: createFileEntryList(), currentPath: '.', mode: 'browse' as const, git: { available: true } }),
      search: async (_workspaceId: string, query: string) => ({
        files: createFileEntryList().filter((file) => file.path.toLowerCase().includes(query.toLowerCase())),
        currentPath: '.',
        mode: 'search' as const,
      }),
      browseFs: async (path?: string) => ({
        files: ['Documents', 'Projects', 'Downloads', 'Pictures'].map((name) => ({ name, type: 'directory' as const, path: `${path ?? '/home/user'}/${name}` })),
        currentPath: path ?? '/home/user',
        mode: 'browse' as const,
        isRoot: (path ?? '/home/user') === '/',
      }),
      drives: async () => ({ drives: ['/'] }),
      parent: async (path: string) => {
        const parent = path.split('/').slice(0, -1).join('/') || '/';
        return { files: [{ name: path.split('/').pop() ?? '', type: 'directory' as const, path }], currentPath: parent, mode: 'browse' as const, isRoot: parent === '/' };
      },
      preview: async (_workspaceId: string, path: string) => {
        const preset = Object.values(filePreviewPresets).find((item) => item.path === path);
        if (!preset) throw Object.assign(new Error(`File not found: ${path}`), { statusCode: 404 });
        return preset;
      },
      readEditable: async (_workspaceId: string, path: string) => createEditableFile({ path, name: path.split('/').pop() ?? path }),
      save: async (_workspaceId: string, request: { path: string; content: string }) => ({ path: request.path, revision: `rev-${Date.now()}`, size: request.content.length, modifiedAt: new Date().toISOString() }),
      gitStatus: async () => createGitStatus(),
      gitDiff: async (_workspaceId: string, path: string) => createGitFileDiff({ path }),
      gitRepository: async () => createGitRepository(),
      gitBranches: async () => createBranches(),
      gitHistory: async () => createHistory(),
      gitCommitDetails: async () => createCommitDetails(),
      gitRebaseState: async () => createRebaseState(),
      gitRebaseConflict: async (_workspaceId: string, input: { path: string }) => createRebaseConflict({ path: input.path }),
      gitPushPreview: async () => ({ remoteHead: null }),
    },
    pullRequests: {
      discover: async () => createPullRequestDiscovery(),
      list: async () => createPullRequestList(),
      detail: async (_workspaceId: string, _scope: unknown, number: number) => createPullRequestDetail({ number }),
      files: async () => createPullRequestFiles(),
      patch: async () => ({ patch: samplePatch }),
    },
  };
}

function isTable(value: unknown): value is HandlerTable {
  return typeof value === 'object' && value !== null;
}

function mergeTables(base: HandlerTable, overrides: HandlerTable | undefined): HandlerTable {
  if (!overrides) return base;
  const merged: HandlerTable = { ...base };
  for (const [key, value] of Object.entries(overrides)) {
    const existing = merged[key];
    merged[key] = isTable(value) && isTable(existing) ? mergeTables(existing, value) : value;
  }
  return merged;
}

/**
 * Nested proxy: `http.files.tree(...)` and `http.config.models.get(...)` both
 * resolve through the handler table. Reads of unknown keys yield a callable
 * that rejects with the full path.
 */
function createPathProxy(table: HandlerTable | undefined, path: string[], latencyMs: number): unknown {
  const label = path.join('.');
  const handler = table;
  const callable = (...args: unknown[]) => {
    action(label)(...args);
    if (typeof handler !== 'function') {
      return Promise.reject(new Error(`fakeSdkClient: no handler for ${label}. Pass one in createFakeSdkClient({ http: { ... } }).`));
    }
    const call = handler as (...a: unknown[]) => unknown;
    // Synchronous SDK methods (attachments.getUrl) must stay synchronous.
    if (latencyMs <= 0) return call(...args);
    return wait(latencyMs).then(() => call(...args));
  };
  return new Proxy(callable, {
    get(_target, key: string | symbol) {
      if (typeof key === 'symbol' || key === 'then') return undefined;
      const next = isTable(table) ? table[key] : undefined;
      return createPathProxy(next as HandlerTable | undefined, [...path, key], latencyMs);
    },
    apply(_target, _thisArg, args: unknown[]) {
      return callable(...args);
    },
  });
}

/** WebSocket namespaces (sessions, chat, git, files, ...) log calls and return nothing unless overridden. */
function createLoggingNamespace(name: string, overrides: Record<string, AnyFunction> = {}): Record<string, AnyFunction> {
  return new Proxy({}, {
    get(_target, method: string) {
      if (method === 'then') return undefined;
      return (...args: unknown[]) => {
        action(`${name}.${method}`)(...args);
        const override = overrides[method];
        return override ? (override as (...a: unknown[]) => unknown)(...args) : undefined;
      };
    },
  }) as Record<string, AnyFunction>;
}

/**
 * The raw HTTP client a few components still call directly
 * (`sdkClient.httpClient.get('/workspaces/:id/files')`, `/info`). Answers the
 * known paths; anything else rejects with the path so the gap is visible.
 */
function createRawHttpClient(latencyMs: number, rawGet?: (path: string, options?: unknown) => Promise<unknown>) {
  return {
    get: async (path: string, requestOptions?: unknown) => {
      action('httpClient.get')(path, requestOptions);
      await wait(latencyMs);
      if (rawGet) return rawGet(path, requestOptions);
      if (/\/workspaces\/[^/]+\/files$/.test(path)) return { files: createFileEntryList() };
      if (path === '/info') return { version: '1.24.0', name: 'Prokop' };
      throw new Error(`fakeSdkClient: no handler for httpClient.get(${path}). Pass rawGet in createFakeSdkClient().`);
    },
  };
}

type Listener = (...args: unknown[]) => void;
const listenerMaps = new WeakMap<object, Map<string, Set<Listener>>>();

/** Fire an SDK event on a fake client (`permission.list`, `connected`, ...). */
export function emitClientEvent(client: ProkopaiClient, event: string, ...args: unknown[]): void {
  action(`event:${event}`)(...args);
  const listeners = listenerMaps.get(client)?.get(event);
  if (!listeners) return;
  for (const listener of [...listeners]) listener(...args);
}

export function createFakeSdkClient(options: FakeSdkClientOptions = {}): ProkopaiClient {
  const workspace = options.workspace ?? createWorkspace({ name: 'my-project', path: '/home/user/my-project' });
  const latencyMs = options.latencyMs ?? 0;
  const http = createPathProxy(mergeTables(createDefaultHttp(workspace), options.http as HandlerTable | undefined), ['http'], latencyMs) as ProkopaiClient['http'];
  const listeners = new Map<string, Set<Listener>>();
  const client = {
    http,
    httpClient: createRawHttpClient(latencyMs, options.rawGet),
    sessions: createLoggingNamespace('sessions', options.namespaces?.sessions),
    chat: createLoggingNamespace('chat', options.namespaces?.chat),
    permissions: createLoggingNamespace('permissions', options.namespaces?.permissions),
    queue: createLoggingNamespace('queue', options.namespaces?.queue),
    providers: createLoggingNamespace('providers', options.namespaces?.providers),
    control: createLoggingNamespace('control', options.namespaces?.control),
    git: createLoggingNamespace('git', options.namespaces?.git),
    files: createLoggingNamespace('files', options.namespaces?.files),
    notifications: createLoggingNamespace('notifications', options.namespaces?.notifications),
    terminal: createLoggingNamespace('terminal', options.namespaces?.terminal),
    state: 'connected',
    connected: true,
    connectionId: 'storybook-connection',
    on(event: string, listener: Listener) {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event)!.add(listener);
      return client;
    },
    off(event: string, listener: Listener) {
      listeners.get(event)?.delete(listener);
      return client;
    },
    once(event: string, listener: Listener) {
      const wrapped: Listener = (...args) => { listeners.get(event)?.delete(wrapped); listener(...args); };
      return client.on(event, wrapped);
    },
    emit(event: string, ...args: unknown[]) {
      emitClientEvent(client as unknown as ProkopaiClient, event, ...args);
      return true;
    },
    connect: async () => undefined,
    disconnect: () => undefined,
    send: (message: unknown) => action('send')(message),
  };
  listenerMaps.set(client, listeners);
  return client as unknown as ProkopaiClient;
}
