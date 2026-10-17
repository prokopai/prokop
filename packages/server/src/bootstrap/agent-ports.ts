import { installHarnessNotificationPort, type HarnessNotificationPort } from '@prokopai/core/application/ports/harness-notifications';
import { agentRuntime } from './agent-runtime';
import { configureHarnessProbes } from '@prokopai/core/application/ports/harness-probes';
import { getProkopNotificationsApplication } from '@/adapters/prokop/notifications';
import { getWorkspaceTools } from '@/infrastructure/mcp/manager';
import { configureHarnessAsks } from '@prokopai/core/infrastructure/runtime/harness-asks';
import { localHarnessAsks } from './harness-asks';
import { installAgentAskPort } from '@prokopai/core/application/ports/agent-asks';
import { configureHarnessMcpTools } from '@prokopai/core/application/ports/mcp-tools';
import { installLearningReviewToolPort } from '@prokopai/core/application/ports/learning-review-tools';
import { learningReviewTools } from '@/application/learning/review-tools';

let worktreeListener: ((worktreeId: string) => void) | null = null;

/** The host's reaction to a harness reporting a worktree change. */
export function onHarnessWorktreeChanged(listener: (worktreeId: string) => void): void {
  worktreeListener = listener;
}

/** In-process harness push notifications. */
const localHarnessNotifications: HarnessNotificationPort = {
  notifyWorktreeChanged: worktreeId => worktreeListener?.(worktreeId),
  notifyTerminalMessage: (message: Parameters<HarnessNotificationPort['notifyTerminalMessage']>[0], sessionId: string) =>
    getProkopNotificationsApplication().notifyTerminalMessage(message, sessionId),
  notifyAnswerRequired: (requestId: string, rootSessionId: string) =>
    getProkopNotificationsApplication().notifyAnswerRequired(requestId, rootSessionId),
};

/**
 * Installs the agent-facing host ports: the harnesses run in this process,
 * so each port points at the host service directly. Call after
 * `configureProkopBindings()`, before the execution scope is composed.
 * Shell completion delivery needs the composed execution ports and is
 * installed by the application bootstrap instead.
 */
export function configureAgentPorts(): void {
  configureHarnessAsks(localHarnessAsks);
  configureHarnessMcpTools({ tools: getWorkspaceTools });
  const runtime = agentRuntime();
  installAgentAskPort(runtime.directAgentAsks);
  installLearningReviewToolPort(learningReviewTools);
  installHarnessNotificationPort(localHarnessNotifications);
  configureHarnessProbes(runtime.localHarnessProbes);
}
