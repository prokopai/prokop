import {
  generateSessionTitle,
  hasManualSessionTitle,
  isDefaultSessionTitle,
} from '@prokopai/core/infrastructure/session-title';
import type { RuntimeHost as ProkopCompatibilityBindings } from '@prokopai/core/infrastructure/runtime/host';

export const prokopTitleBindings: ProkopCompatibilityBindings['titles'] = {
  isDefaultSessionTitle,
  hasManualSessionTitle,
  generateSessionTitle,
};
