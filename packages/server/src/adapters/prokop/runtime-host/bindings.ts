import { configureRuntimeHost, type RuntimeHost } from '@/infrastructure/runtime/host';
import { configureProkopRuntimeDefaults, prokopAgentBindings } from '@/harnesses/prokop/bindings/agent';
import { prokopDeliveryBindings } from './delivery';
import { prokopInteractionBindings } from './interaction';
import { prokopWorkspaceBindings } from './workspace';

export type { RuntimeHost as ProkopCompatibilityBindings } from '@/infrastructure/runtime/host';

/**
 * The in-process runtime host: the Prokop runtime's own bindings plus the
 * host services (SQLite asks and grants, WebSocket delivery, worktree
 * resolution). The agent process builds the same shape over the agent
 * protocol instead (`bootstrap/agent-side.ts`).
 */
export const prokopCompatibilityBindings = {
  interaction: prokopInteractionBindings,
  delivery: prokopDeliveryBindings,
  titles: prokopAgentBindings.titles,
  workspace: prokopWorkspaceBindings,
  toolPolicy: prokopAgentBindings.toolPolicy,
  sandbox: prokopAgentBindings.sandbox,
  layout: prokopAgentBindings.layout,
} satisfies RuntimeHost;

export function configureProkopBindings(): void {
  configureProkopRuntimeDefaults();
  configureRuntimeHost(prokopCompatibilityBindings);
}
