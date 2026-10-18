// =============================================================================
// Settings mock data: permissions, MCP, providers, devices, usage, learning
// =============================================================================

import type {
  AccessStatus,
  CodexAccountUsage,
  HarnessUsageLimits,
  McpStatus,
  LearningRunDetail,
  LearningRunSummary,
  McpServerConfig,
  McpToolInfo,
  ModelsConfigResponse,
  NotificationConfig,
  PairedDevice,
  PendingAccessRequest,
  PermissionGrant,
  PromptInfo,
  ProviderAccountStatus,
  ProviderCredentialStatus,
  ProviderUsage,
  ResponseFormat,
  WorkspaceLearningSettings,
} from '@prokopai/sdk';
import type { AccessOverviewResponse, CreatePairingCodeResponse } from '@prokopai/sdk';
import type { RemoteAccessStatus } from '@prokopai/sdk';
import { mockId, mockIsoHoursAgo, mockIsoMinutesAgo, merge } from './mockHelpers';
import { createModelList } from './mockProvider';

// -----------------------------------------------------------------------------
// Permissions
// -----------------------------------------------------------------------------

export function createPermissionGrant(overrides: Partial<PermissionGrant> = {}): PermissionGrant {
  return merge<PermissionGrant>({
    id: mockId('grant'),
    workspaceId: 'ws-1',
    toolName: 'shell',
    resource: 'shell-command',
    action: 'execute',
    scope: 'workspace',
    matcher: 'shell-command',
    patterns: ['bun test'],
    allowed: true,
    grantedAt: mockIsoHoursAgo(5),
    expiresAt: null,
    grantedBy: 'daniel',
    revokedAt: null,
    revokedBy: null,
    metadata: null,
  } as PermissionGrant, overrides);
}

export function createPermissionGrantList(): PermissionGrant[] {
  return [
    createPermissionGrant(),
    createPermissionGrant({ toolName: 'write', resource: 'path', action: 'write', matcher: 'prefix', patterns: ['src/'], grantedAt: mockIsoHoursAgo(20) }),
    createPermissionGrant({ toolName: 'read-file', resource: 'file', action: 'read', matcher: 'glob', patterns: ['**/*.env'], allowed: false }),
    createPermissionGrant({ toolName: 'fetch', resource: 'network', action: 'request', matcher: 'prefix', patterns: ['https://api.github.com/'], scope: 'session', expiresAt: new Date(Date.now() + 3_600_000).toISOString() }),
    createPermissionGrant({ toolName: 'shell', resource: 'shell-command', action: 'execute', patterns: ['git push --force'], revokedAt: mockIsoHoursAgo(1), revokedBy: 'daniel' }),
  ];
}

// -----------------------------------------------------------------------------
// MCP
// -----------------------------------------------------------------------------

export const mcpConfigs = {
  filesystem: { type: 'local', command: ['npx', '-y', '@modelcontextprotocol/server-filesystem', '/home/user'], env: { LOG_LEVEL: 'info' }, enabled: true } satisfies McpServerConfig,
  linear: { type: 'remote', url: 'https://mcp.linear.app/sse', oauth: true, enabled: true } satisfies McpServerConfig,
  internal: { type: 'remote', url: 'https://mcp.internal.example.com/mcp', headers: { Authorization: 'Bearer ***' }, enabled: false } satisfies McpServerConfig,
  browser: { type: 'builtin', id: 'browser', enabled: true } satisfies McpServerConfig,
  visuals: { type: 'builtin', id: 'visuals', enabled: true, disabledTools: ['render_html'] } satisfies McpServerConfig,
} as const;

export interface McpStatusResponse {
  status: Record<string, { config: McpServerConfig | undefined; status: McpStatus }>;
}

export function createMcpStatus(overrides: Partial<McpStatusResponse['status']> = {}): McpStatusResponse {
  return {
    status: {
      'Prokop Browser': { config: mcpConfigs.browser, status: { status: 'connected' } },
      'Prokop Visuals': { config: mcpConfigs.visuals, status: { status: 'connected' } },
      filesystem: { config: mcpConfigs.filesystem, status: { status: 'connected' } },
      linear: { config: mcpConfigs.linear, status: { status: 'needs_auth' } },
      internal: { config: mcpConfigs.internal, status: { status: 'disabled' } },
      flaky: { config: { type: 'local', command: ['flaky-server'] }, status: { status: 'failed', error: 'spawn flaky-server ENOENT' } },
      ...overrides,
    },
  };
}

export function createMcpTools(): McpToolInfo[] {
  return [
    { name: 'read_file', description: 'Read a file from the allowed directories', enabled: true },
    { name: 'write_file', description: 'Write a file', enabled: true },
    { name: 'list_directory', description: 'List a directory', enabled: false },
  ];
}

// -----------------------------------------------------------------------------
// Providers and models
// -----------------------------------------------------------------------------

export function createModelsConfig(overrides: Partial<ModelsConfigResponse> = {}): ModelsConfigResponse {
  const models = createModelList();
  const providers = new Map<string, { id: string; name: string; models: typeof models }>();
  for (const model of models) {
    const entry = providers.get(model.providerId) ?? { id: model.providerId, name: model.providerName, models: [] };
    entry.models.push(model);
    providers.set(model.providerId, entry);
  }
  return merge<ModelsConfigResponse>({
    providers: [...providers.values()],
    defaultModel: models[0]?.id ?? '',
    defaultProvider: models[0]?.providerId ?? '',
    defaultVariant: null,
  }, overrides);
}

export function createProviderCredentials(): ProviderCredentialStatus[] {
  return [
    { provider: 'anthropic', configured: true },
    { provider: 'openai', configured: false },
    { provider: 'google', configured: true },
    { provider: 'openrouter', configured: false },
  ];
}

export function createOAuthProviders(): ProviderAccountStatus[] {
  return [
    {
      provider: 'codex', displayName: 'ChatGPT (Codex)', description: 'Use your ChatGPT subscription for Codex sessions.', authType: 'oauth', connectable: true, connected: true, connectedAt: mockIsoHoursAgo(40),
      accountId: 'acct-personal', activeAccountId: 'acct-personal',
      accounts: [
        { id: 'acct-personal', label: 'daniel@example.com', connectedAt: mockIsoHoursAgo(40), connectionId: 'conn-1', reauthRequired: false },
        { id: 'acct-work', label: 'daniel@work.example', connectedAt: mockIsoHoursAgo(200), connectionId: 'conn-2', reauthRequired: true },
      ],
    } as ProviderAccountStatus,
    { provider: 'gmail', displayName: 'Gmail', description: 'Read and draft mail for the mail tools.', authType: 'oauth', connectable: true, connected: false } as ProviderAccountStatus,
    { provider: 'github', displayName: 'GitHub', description: 'Pull requests and reviews.', authType: 'oauth', connectable: true, connected: true, connectedAt: mockIsoHoursAgo(300), reauthRequired: true, error: 'Token expired' } as ProviderAccountStatus,
  ];
}

export function createProviderUsage(overrides: Partial<ProviderUsage> = {}): ProviderUsage {
  return merge<ProviderUsage>({
    provider: 'deepseek',
    checkedAt: mockIsoMinutesAgo(3),
    plan: 'Pay as you go',
    windows: [
      { id: 'daily', label: 'Today', usedPercent: 42, resetsAt: new Date(Date.now() + 9 * 3_600_000).toISOString() },
      { id: 'monthly', label: 'This month', usedPercent: 71, resetsAt: new Date(Date.now() + 12 * 86_400_000).toISOString() },
    ],
    balances: [{ currency: 'USD', remaining: '12.40' }],
  }, overrides);
}

export function createCodexAccountUsage(overrides: Partial<CodexAccountUsage> = {}): CodexAccountUsage {
  return merge<CodexAccountUsage>({
    accountId: 'acct-personal',
    checkedAt: mockIsoMinutesAgo(2),
    plan: 'Plus',
    windows: [
      { id: 'five_hour', label: '5 hours', usedPercent: 18, resetsAt: new Date(Date.now() + 2.5 * 3_600_000).toISOString() },
      { id: 'weekly', label: 'Week', usedPercent: 63, resetsAt: new Date(Date.now() + 3 * 86_400_000).toISOString() },
    ],
  }, overrides);
}

export function createHarnessUsage(overrides: Partial<HarnessUsageLimits> = {}): HarnessUsageLimits {
  return merge<HarnessUsageLimits>({
    harness: 'claude-cli',
    checkedAt: mockIsoMinutesAgo(1),
    plan: 'Max',
    windows: [
      { id: 'five_hour', kind: 'session', label: '5 hours', usedPercent: 35, resetsAt: new Date(Date.now() + 1.2 * 3_600_000).toISOString() },
      { id: 'weekly', kind: 'weekly', label: 'Week', usedPercent: 80, resetsAt: new Date(Date.now() + 2 * 86_400_000).toISOString() },
    ],
  }, overrides);
}

// -----------------------------------------------------------------------------
// Devices, pairing, remote access, notifications
// -----------------------------------------------------------------------------

export function createAccessStatus(overrides: Partial<AccessStatus> = {}): AccessStatus {
  return merge<AccessStatus>({
    paired: true,
    access: 'local',
    admin: true,
    device: null,
    pairingMethods: ['code', 'approval'],
    addresses: ['http://192.168.1.20:8742', 'https://studio.tail1234.ts.net'],
  }, overrides);
}

export function createPairedDevice(overrides: Partial<PairedDevice> = {}): PairedDevice {
  return merge<PairedDevice>({
    id: mockId('device'),
    label: 'iPhone',
    deviceKind: 'phone' as PairedDevice['deviceKind'],
    createdAt: Date.now() - 20 * 86_400_000,
    lastSeenAt: Date.now() - 3_600_000,
    expiresAt: Date.now() + 340 * 86_400_000,
  }, overrides);
}

export function createAccessRequest(overrides: Partial<PendingAccessRequest> = {}): PendingAccessRequest {
  return merge<PendingAccessRequest>({
    id: mockId('request'),
    label: 'MacBook Air',
    deviceKind: 'desktop' as PendingAccessRequest['deviceKind'],
    matchCode: '4821',
    createdAt: Date.now() - 20_000,
    expiresAt: Date.now() + 280_000,
  }, overrides);
}

export function createAccessOverview(overrides: Partial<AccessOverviewResponse> = {}): AccessOverviewResponse {
  return merge<AccessOverviewResponse>({
    requests: [createAccessRequest()],
    devices: [
      createPairedDevice(),
      createPairedDevice({ label: 'Work laptop', deviceKind: 'desktop' as PairedDevice['deviceKind'], lastSeenAt: Date.now() - 9 * 86_400_000 }),
    ],
  }, overrides);
}

export function createPairingCode(overrides: Partial<CreatePairingCodeResponse> = {}): CreatePairingCodeResponse {
  return merge<CreatePairingCodeResponse>({
    code: '739 214',
    expiresAt: Date.now() + 10 * 60_000,
    links: ['http://192.168.1.20:8742/pair#code=739214', 'https://studio.tail1234.ts.net/pair#code=739214'],
  }, overrides);
}

export function createRemoteAccessStatus(overrides: Partial<RemoteAccessStatus> = {}): RemoteAccessStatus {
  return merge<RemoteAccessStatus>({
    listenOnNetwork: true,
    bindHost: '0.0.0.0',
    bindLockedByEnvironment: false,
    endpoint: { protocol: 'http', port: 8742 },
    addresses: [
      { url: 'http://192.168.1.20:8742', source: 'saved', kind: 'lan' as RemoteAccessStatus['addresses'][number]['kind'] },
      { url: 'https://prokop.example.com', source: 'environment', kind: 'proxy' as RemoteAccessStatus['addresses'][number]['kind'] },
    ],
    suggestions: [{ url: 'https://studio.tail1234.ts.net', kind: 'tailscale' as RemoteAccessStatus['suggestions'][number]['kind'] }],
    tailscale: { installed: true, running: true, dnsName: 'studio.tail1234.ts.net', serving: false, url: 'https://studio.tail1234.ts.net' },
  }, overrides);
}

export function createNotificationConfig(overrides: Partial<NotificationConfig> = {}): NotificationConfig {
  return merge<NotificationConfig>({ available: true, vapidPublicKey: 'BDemoPublicKey', permissionTimeoutMs: 30_000 }, overrides);
}

// -----------------------------------------------------------------------------
// Learning
// -----------------------------------------------------------------------------

export function createLearningSettings(overrides: Partial<WorkspaceLearningSettings> = {}): WorkspaceLearningSettings {
  return merge<WorkspaceLearningSettings>({
    enabled: true,
    reviewers: [
      { id: 'rev-1', preconfigId: 'preconfig-reviewer', instructions: 'Prefer concrete lessons over summaries.', modelOverride: null, cadence: null },
    ],
    improveSkills: true,
    instructions: 'Keep memory entries short.',
    sources: { mode: 'all' },
  }, overrides);
}

export function createLearningRun(overrides: Partial<LearningRunSummary> = {}): LearningRunSummary {
  return merge<LearningRunSummary>({
    id: mockId('run'),
    reviewerId: 'rev-1',
    status: 'completed',
    startedAt: Date.now() - 2 * 3_600_000,
    error: null,
    resolved: false,
  }, overrides);
}

export function createLearningRuns(): LearningRunSummary[] {
  return [
    createLearningRun({ id: 'run-1' }),
    createLearningRun({ id: 'run-2', status: 'failed', error: 'Provider returned 503', startedAt: Date.now() - 26 * 3_600_000 }),
    createLearningRun({ id: 'run-3', status: 'running', startedAt: Date.now() - 60_000 }),
    createLearningRun({ id: 'run-4', status: 'interrupted', recovered: true, startedAt: Date.now() - 3 * 86_400_000, resolved: true }),
  ];
}

export function createLearningRunDetail(overrides: Partial<LearningRunDetail> = {}): LearningRunDetail {
  return merge<LearningRunDetail>({
    run: createLearningRun({ id: 'run-1' }),
    sessionId: 'review-session',
    changes: [
      { id: 'c1', path: 'MEMORY.md', before: '- Old note', after: '- Old note\n- Tests: run the smallest target first' } as LearningRunDetail['changes'][number],
      { id: 'c2', path: 'skills/git-safety/SKILL.md', before: null, after: '# Git safety\n\nNever force push without a lease.' } as LearningRunDetail['changes'][number],
    ],
    sources: [
      { sessionId: 'sess-a', messageId: 'm1', title: 'Refactor the auth module' },
      { sessionId: 'sess-a', messageId: 'm2', title: 'Refactor the auth module' },
      { sessionId: 'sess-b', messageId: 'm3', title: null },
    ],
    revision: 'rev-7',
  }, overrides);
}

// -----------------------------------------------------------------------------
// Prompts and response formats
// -----------------------------------------------------------------------------

export function createPromptList(): PromptInfo[] {
  return [
    { name: 'review', description: 'Review the current diff for bugs', content: 'Review the current diff. List findings by severity.' },
    { name: 'explain', description: 'Explain the selected code', content: 'Explain what this code does and why.' },
    { name: 'tests', description: 'Write tests for the change', content: 'Write unit tests covering the change, including edge cases.' },
  ];
}

export function createResponseFormatList(): ResponseFormat[] {
  return [
    { id: 'fmt-review', name: 'Code review', description: 'Summary, severity and findings', schema: { type: 'object', properties: { summary: { type: 'string' }, severity: { type: 'string', enum: ['low', 'medium', 'high'] }, findings: { type: 'array', items: { type: 'object', properties: { file: { type: 'string' }, message: { type: 'string' } } } } }, required: ['summary'] }, createdAt: Date.now() - 86_400_000, updatedAt: Date.now() - 3_600_000 },
    { id: 'fmt-answer', name: 'Short answer', schema: { type: 'object', properties: { answer: { type: 'string' }, confidence: { type: 'number' } } }, createdAt: Date.now() - 5 * 86_400_000, updatedAt: Date.now() - 5 * 86_400_000 },
  ];
}
