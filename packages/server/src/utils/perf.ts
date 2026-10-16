import { readEnv } from '@prokopai/core/infrastructure/runtime/env-compat';

const PERF_DIAGNOSTICS_ENABLED =
  readEnv('PERF_DIAGNOSTICS') === 'true';

export function isPerfDiagnosticsEnabled(): boolean {
  return PERF_DIAGNOSTICS_ENABLED;
}
