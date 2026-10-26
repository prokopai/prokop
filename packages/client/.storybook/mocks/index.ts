// =============================================================================
// Mock Data Barrel Export — Storybook mock factories and presets
// =============================================================================

// --- Helpers ---
export {
  mockId,
  resetMockIds,
  mockNow,
  mockSecondsAgo,
  mockMinutesAgo,
  mockHoursAgo,
  mockIsoNow,
  mockIsoMinutesAgo,
  mockIsoHoursAgo,
  merge,
} from './mockHelpers';

// --- Workspace ---
export {
  createWorkspace,
  workspacePresets,
} from './mockWorkspace';

// --- Group chat ---
export {
  createAgentGroup,
  createAgentGroupMessage,
  createGroupToolPart,
  createGroupThread,
  GROUP_HANDOFF_TURN_ID,
  GROUP_MEMBERS,
} from './mockGroup';

// --- Session ---
export {
  createSession,
  sessionPresets,
  createSessionList,
  createSubagentSession,
} from './mockSession';

// --- Messages & Parts ---
export {
  createTextPart,
  createReasoningPart,
  createToolPart,
  createStepPart,
  createCompactionPart,
  createFilePart,
  createImagePart,
  createToolStatePending,
  createToolStateRunning,
  createToolStateCompleted,
  createToolStateError,
  createToolStateInterrupted,
  createUserMessage,
  createAssistantMessage,
  createSystemMessage,
  createUserMessageWithParts,
  createAssistantMessageWithParts,
  createReasonedAssistantMessageWithParts,
  createAssistantMessageWithRunningTool,
  createAssistantMessageWithCompletedTool,
  createAssistantMessageWithErrorTool,
  createAssistantMessageWithStep,
  createConversation,
  createTypicalConversation,
  createQueuedMessage,
} from './mockMessage';

// --- Tools ---
export {
  createToolDefinition,
  createToolResult,
  toolDefinitionPresets,
  createToolDefinitionList,
} from './mockTool';

// --- Visualizations ---
export {
  createDiffVisualization,
  createDiffsVisualization,
  createCodeVisualization,
  createFileListVisualization,
  createTableVisualization,
  createMarkdownVisualization,
  createShellOutputVisualization,
  createNoneVisualization,
  createTodoListVisualization,
  visualizationPresets,
} from './mockVisualization';

// --- Providers & Models ---
export {
  createModelWithStatus,
  createProviderStatus,
  createProviderDescriptor,
  providerPresets,
  modelPresets,
  createModelList,
  createProviderList,
} from './mockProvider';

// --- Preconfigs ---
export {
  createPreconfig,
  preconfigPresets,
  createPreconfigList,
} from './mockPreconfig';

// --- Permissions ---
export {
  createPermissionAsk,
  permissionPresets,
} from './mockPermission';

// --- File Tree ---
export {
  createFileEntry,
  createFileTreeNode,
  fileTreePresets,
  createFileEntryList,
} from './mockFileTree';
export type { FileTreeNode } from './mockFileTree';

// --- Worktrees ---
export {
  createWorktree,
  worktreePresets,
  createRef,
  refPresets,
  createRefList,
} from './mockWorktree';
export type { MockWorktreeOverrides, MockRefOverrides } from './mockWorktree';

// --- Git, files and pull requests ---
export {
  MOCK_ROOT,
  createGitRepository,
  createGitStatus,
  createGitStatusFile,
  gitStatusPresets,
  createBranch,
  createBranches,
  createHistory,
  createHistoryEntry,
  createCommitDetails,
  samplePatch,
  conflictedText,
  createRebaseState,
  rebasePresets,
  createRebaseConflict,
  projectPaths,
  createFileTreeResponse,
  filePreviewPresets,
  createEditableFile,
  createGitFileDiff,
  createPullRequestRepository,
  createPullRequestDiscovery,
  createPullRequestSummary,
  createPullRequestDetail,
  createPullRequestList,
  createPullRequestFiles,
} from './mockGit';

// --- Sidebar, overview, terminals ---
export {
  createSidebarSessions,
  groupByTag,
  createScheduledJob,
  scheduledJobPresets,
  createPinnedMessage,
  createAgent,
  createTerminalTab,
  createTerminalTabs,
  createAttentionSnapshot,
} from './mockSidebar';

// --- Settings ---
export {
  createPermissionGrant,
  createPermissionGrantList,
  mcpConfigs,
  createMcpStatus,
  createMcpTools,
  createModelsConfig,
  createProviderCredentials,
  createOAuthProviders,
  createProviderUsage,
  createCodexAccountUsage,
  createHarnessUsage,
  createAccessStatus,
  createPairedDevice,
  createAccessRequest,
  createAccessOverview,
  createPairingCode,
  createRemoteAccessStatus,
  createNotificationConfig,
  createLearningSettings,
  createLearningRun,
  createLearningRuns,
  createLearningRunDetail,
  createPromptList,
  createResponseFormatList,
} from './mockSettings';

// --- Markdown Content ---
export {
  simpleMarkdown,
  richMarkdown,
  inlineFormattingMarkdown,
  codeBlocksMarkdown,
  shortMarkdown,
  emptyMarkdown,
  generateLongMarkdown,
  markdownPresets,
} from './mockMarkdown';

// --- Store Decorators ---
export {
  withSessionStore,
  withServerDataStore,
  withUIStore,
  withConnectionStore,
  withSessionFilesStore,
  withAskStore,
  withCompletionStore,
  withAllStores,
} from './storeDecorators';
export type { AllStoresOverrides } from './storeDecorators';

// --- Store Cleanup ---
export { resetAllStores } from './storeCleanup';

// --- Store Hydration (imperative API) ---
export { hydrateStores, clearStores } from './storeHydration';
