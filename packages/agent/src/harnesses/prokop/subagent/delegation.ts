/**
 * Where a delegated child runs: the role's pin, the model's explicit target,
 * or the parent's own harness and model, in that order, plus the refusals a
 * caller gets back as typed codes (docs/plans/cross-harness-delegation.md,
 * "Choosing the target"). Pure; the task tool validates the result against
 * the host (enabled, installed, catalog) and the running-children limit.
 */

import type { CodexModel, Preconfig, SessionHarness } from '@prokopai/sdk/types';

export type DelegationFailureCode =
  | 'harness_unavailable'
  | 'model_unavailable'
  | 'target_conflicts_with_role'
  | 'target_not_allowed'
  | 'subagent_not_allowed'
  | 'depth_exceeded'
  | 'concurrency_limit'
  | 'task_not_found'
  | 'invalid_request';

export interface DelegationTarget {
  harness?: SessionHarness;
  provider?: string;
  model?: string;
  variant?: string;
}

export interface ResolvedDelegationTarget {
  harness: SessionHarness;
  modelId: string | null;
  providerId: string | null;
  variant: string | null;
}

export type DelegationResolution =
  | { ok: true; target: ResolvedDelegationTarget; source: 'pin' | 'target' | 'inherited' }
  | { ok: false; code: DelegationFailureCode; error: string };

const HARNESSES: readonly SessionHarness[] = ['prokop', 'codex-cli', 'claude-cli'];

export function isSessionHarness(value: unknown): value is SessionHarness {
  return typeof value === 'string' && (HARNESSES as readonly string[]).includes(value);
}

/**
 * A role pins a harness when it names one, or a model (a model without a
 * harness is a Prokop model). The pin is the user's routing rule.
 */
export function rolePin(role: Pick<Preconfig, 'modelHarness' | 'model' | 'provider' | 'variant'>): {
  harness: SessionHarness | null;
  model: string | null;
  provider: string | null;
  variant: string | null;
} {
  const harness = role.modelHarness ?? (role.model ? 'prokop' : null);
  return { harness, model: role.model ?? null, provider: role.provider ?? null, variant: role.variant ?? null };
}

/** Whether a parent may name `harness` itself, with no role. */
export function freeTargetAllowed(targets: Preconfig['delegationTargets'], harness: SessionHarness): boolean {
  if (targets === undefined || targets === null || targets === 'any') return true;
  if (targets === 'none') return false;
  return targets.includes(harness);
}

export function resolveDelegationTarget(input: {
  role: Preconfig | null;
  target?: DelegationTarget;
  inherited: ResolvedDelegationTarget;
  parentPreconfig: Preconfig | null;
}): DelegationResolution {
  const { role, target, inherited, parentPreconfig } = input;
  const sameHarness = (harness: SessionHarness): ResolvedDelegationTarget | null =>
    harness === inherited.harness ? inherited : null;

  if (role) {
    const pin = rolePin(role);
    if (target) {
      const conflicts: string[] = [];
      if (pin.harness && target.harness && target.harness !== pin.harness) conflicts.push(`harness ${pin.harness}`);
      if (pin.model && target.model && target.model !== pin.model) conflicts.push(`model ${pin.model}`);
      if (pin.provider && target.provider && target.provider !== pin.provider) conflicts.push(`provider ${pin.provider}`);
      if (pin.variant && target.variant && target.variant !== pin.variant) conflicts.push(`variant ${pin.variant}`);
      if (conflicts.length) {
        return {
          ok: false,
          code: 'target_conflicts_with_role',
          error: `Role "${role.id}" is pinned to ${conflicts.join(', ')}; the target cannot change that. Drop the target or pick another role.`,
        };
      }
    }
    const harness = pin.harness ?? target?.harness ?? inherited.harness;
    const fallback = sameHarness(harness);
    const explicit = Boolean(target?.harness || target?.model || target?.provider || target?.variant);
    // A role's variant is its own (null when unset), never the parent's: the
    // in-process child always behaved that way.
    return {
      ok: true,
      source: pin.harness || pin.model ? 'pin' : explicit ? 'target' : 'inherited',
      target: {
        harness,
        modelId: pin.model ?? target?.model ?? fallback?.modelId ?? null,
        providerId: pin.provider ?? target?.provider ?? (pin.model || target?.model ? null : fallback?.providerId ?? null),
        variant: pin.variant ?? target?.variant ?? null,
      },
    };
  }

  if (!target || !(target.harness || target.model || target.provider || target.variant)) {
    return { ok: false, code: 'invalid_request', error: 'Name a subagent_type (a role) or a target harness or model.' };
  }
  const harness = target.harness ?? inherited.harness;
  if (!freeTargetAllowed(parentPreconfig?.delegationTargets, harness)) {
    const allowed = parentPreconfig?.delegationTargets;
    return {
      ok: false,
      code: 'target_not_allowed',
      error: allowed === 'none'
        ? 'This agent may delegate only to its roles (subagent_type), not to a harness or model of its own choosing.'
        : `This agent may delegate without a role only to: ${Array.isArray(allowed) ? allowed.join(', ') : 'any'}.`,
    };
  }
  const fallback = sameHarness(harness);
  return {
    ok: true,
    source: 'target',
    target: {
      harness,
      modelId: target.model ?? fallback?.modelId ?? null,
      providerId: target.provider ?? (target.model ? null : fallback?.providerId ?? null),
      variant: target.variant ?? (target.model ? null : fallback?.variant ?? null),
    },
  };
}

export interface DelegationCatalog {
  /** The Prokop catalog, flattened. */
  prokopModels(): Array<{ id: string; name: string; providerId: string }>;
  /** A CLI harness's catalog; rejects or returns [] when the CLI is not there. */
  harnessModels(harness: 'codex-cli' | 'claude-cli'): Promise<CodexModel[]>;
}

export interface DelegationHostView {
  harnessEnabled(harness: SessionHarness): boolean;
  harnessAvailable(harness: SessionHarness): boolean;
}

/** Enabled, installed, and a model the harness advertises (a null model is the harness default). */
export async function validateDelegationTarget(
  target: ResolvedDelegationTarget,
  host: DelegationHostView,
  catalog: DelegationCatalog,
): Promise<{ ok: true } | { ok: false; code: DelegationFailureCode; error: string }> {
  if (!host.harnessEnabled(target.harness)) {
    return { ok: false, code: 'harness_unavailable', error: `${harnessLabel(target.harness)} is disabled in settings.` };
  }
  if (!host.harnessAvailable(target.harness)) {
    return { ok: false, code: 'harness_unavailable', error: `${harnessLabel(target.harness)} is not installed on this machine.` };
  }
  if (target.modelId === null) return { ok: true };
  if (target.harness === 'prokop') {
    const models = catalog.prokopModels();
    const match = models.find((model) => model.id === target.modelId && (!target.providerId || model.providerId === target.providerId));
    if (!match) {
      return { ok: false, code: 'model_unavailable', error: `Model "${target.modelId}" is not configured${target.providerId ? ` for provider ${target.providerId}` : ''}.` };
    }
    return { ok: true };
  }
  let models: CodexModel[];
  try {
    models = await catalog.harnessModels(target.harness);
  } catch {
    return { ok: false, code: 'harness_unavailable', error: `${harnessLabel(target.harness)} did not answer; its model catalog is unavailable.` };
  }
  const entry = models.find((model) => model.model === target.modelId);
  if (!entry) return { ok: false, code: 'model_unavailable', error: `${harnessLabel(target.harness)} does not offer model "${target.modelId}".` };
  if (target.variant && !entry.supportedEfforts.includes(target.variant)) {
    return { ok: false, code: 'model_unavailable', error: `Model "${target.modelId}" supports efforts ${entry.supportedEfforts.join(', ')}, not "${target.variant}".` };
  }
  return { ok: true };
}

export function harnessLabel(harness: SessionHarness): string {
  return harness === 'codex-cli' ? 'Codex CLI' : harness === 'claude-cli' ? 'Claude CLI' : 'Prokop';
}

export interface DelegationCapabilities {
  roles: Array<{ id: string; name: string; description: string; pinned: { harness: SessionHarness; model: string | null } | null }>;
  harnesses: Array<{
    id: SessionHarness;
    enabled: boolean;
    available: boolean;
    current: boolean;
    models: Array<{ id: string; name: string; provider?: string; efforts?: string[] }>;
    omittedModels: number;
  }>;
  caller: { harness: SessionHarness; model: string | null; provider: string | null };
  freeTargets: 'any' | 'none' | SessionHarness[];
  limits: { depth: number; maxChildren: number };
  note: string;
}

const SHORT_LIST = 8;

/**
 * The small picture a model needs to choose: roles with their pins, each
 * harness with a short model list (pins and the caller's model first, then
 * the catalog order), and the limits. `search` widens the list to matching
 * models instead of dumping every catalog.
 */
export async function buildDelegationCapabilities(input: {
  roles: Preconfig[];
  caller: { harness: SessionHarness; model: string | null; provider: string | null };
  parentPreconfig: Preconfig | null;
  host: DelegationHostView;
  catalog: DelegationCatalog;
  limits: { depth: number; maxChildren: number };
  search?: string;
}): Promise<DelegationCapabilities> {
  const search = input.search?.trim().toLowerCase() ?? '';
  const pinnedModels = new Set(input.roles.map((role) => rolePin(role).model).filter((model): model is string => Boolean(model)));
  const prioritized = <T extends { id: string }>(models: T[]): { kept: T[]; omitted: number } => {
    const matches = search ? models.filter((model) => JSON.stringify(model).toLowerCase().includes(search)) : models;
    if (search) return { kept: matches, omitted: models.length - matches.length };
    const first = matches.filter((model) => pinnedModels.has(model.id) || model.id === input.caller.model);
    const rest = matches.filter((model) => !first.includes(model));
    const kept = [...first, ...rest.slice(0, Math.max(0, SHORT_LIST - first.length))];
    return { kept, omitted: matches.length - kept.length };
  };

  const harnesses: DelegationCapabilities['harnesses'] = [];
  for (const id of HARNESSES) {
    const enabled = input.host.harnessEnabled(id);
    const available = enabled && input.host.harnessAvailable(id);
    let models: Array<{ id: string; name: string; provider?: string; efforts?: string[] }> = [];
    if (available) {
      if (id === 'prokop') {
        models = input.catalog.prokopModels().map((model) => ({ id: model.id, name: model.name, provider: model.providerId }));
      } else {
        try {
          models = (await input.catalog.harnessModels(id)).map((model) => ({ id: model.model, name: model.name, efforts: model.supportedEfforts }));
        } catch {
          models = [];
        }
      }
    }
    const { kept, omitted } = prioritized(models);
    harnesses.push({ id, enabled, available, current: id === input.caller.harness, models: kept, omittedModels: omitted });
  }

  return {
    roles: input.roles.map((role) => {
      const pin = rolePin(role);
      return {
        id: role.id,
        name: role.name,
        description: role.description,
        pinned: pin.harness ? { harness: pin.harness, model: pin.model } : null,
      };
    }),
    harnesses,
    caller: input.caller,
    freeTargets: input.parentPreconfig?.delegationTargets ?? 'any',
    limits: input.limits,
    note: 'A role pinned to a harness or model always runs there; a target cannot change it. '
      + 'Without a role, the child uses your own role on the target you name, within freeTargets. '
      + 'Pass search to see models beyond the short lists.',
  };
}
