import { isSandboxActive } from '@prokopai/core/infrastructure/sandbox';
import type { RuntimeHost as ProkopCompatibilityBindings } from '@prokopai/core/infrastructure/runtime/host';

export const prokopSandboxBindings: ProkopCompatibilityBindings['sandbox'] = {
  isSandboxActive,
};
