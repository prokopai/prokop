import { configureRuntimeHost, type RuntimeHost } from '@prokopai/core/infrastructure/runtime/host';
import { configureProkopRuntimeDefaults, prokopAgentBindings } from '@prokopai/agent';
import { prokopDeliveryBindings } from './delivery';
import { prokopInteractionBindings } from './interaction';
import { prokopWorkspaceBindings } from './workspace';

export type { RuntimeHost as ProkopCompatibilityBindings } from '@prokopai/core/infrastructure/runtime/host';

/**
 * The in-process runtime host: the Prokop runtime's own bindings plus the
 * host services (SQLite asks and grants, WebSocket delivery, worktree
 * resolution).
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
