/**
 * Where a delegated child runs: the role's own harness and model (or the
 * parent's, when the role sets none), with the caller's `target` overriding
 * any of it when the parent's delegation targets allow, plus the refusals a
 * caller gets back as typed codes (docs/plans/cross-harness-delegation.md,
 * "Choosing the target"). Pure; the task tool validates the result against
 * the host (enabled, installed, catalog) and the running-children limit.
 */

import type { CodexModel, Preconfig, SessionHarness } from '@prokopai/sdk/types';

export type DelegationFailureCode =
  | 'harness_unavailable'
  | 'model_unavailable'
  | 'target_not_allowed'
  | 'launch_not_allowed'
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
  | {
    ok: true;
    target: ResolvedDelegationTarget;
    /** `role`: the role as configured. `target`: the caller changed its harness, model, provider or variant. */
    source: 'role' | 'target';
    /** The parent may not override the role on its own; the user has to agree. */
    needsApproval: boolean;
  }
  | { ok: false; code: DelegationFailureCode; error: string };

const HARNESSES: readonly SessionHarness[] = ['prokop', 'codex-cli', 'claude-cli'];

export function isSessionHarness(value: unknown): value is SessionHarness {
  return typeof value === 'string' && (HARNESSES as readonly string[]).includes(value);
}

/**
 * What a role runs on by default: the harness it names, or Prokop when it
 * names only a model; null harness means "where the parent runs". A target
 * on the task tool may override any of it.
 */
export function roleDefaults(role: Pick<Preconfig, 'modelHarness' | 'model' | 'provider' | 'variant'>): {
  harness: SessionHarness | null;
  model: string | null;
  provider: string | null;
  variant: string | null;
} {
  const harness = role.modelHarness ?? (role.model ? 'prokop' : null);
  return { harness, model: role.model ?? null, provider: role.provider ?? null, variant: role.variant ?? null };
}

/**
 * Whether a parent may override a role so the child runs on `harness`:
 * outright, after asking the user, or not at all. A stored null (agents from
 * before the setting existed) stays "any"; the editor gives new agents "ask".
 */
export function overridePolicy(targets: Preconfig['delegationTargets'], harness: SessionHarness): 'allow' | 'ask' | 'deny' {
  if (targets === undefined || targets === null || targets === 'any') return 'allow';
  if (targets === 'ask') return 'ask';
  if (targets === 'none') return 'deny';
  return targets.includes(harness) ? 'allow' : 'ask';
}

/**
 * The role's own harness and model, with the parent's model filling in on
 * the parent's harness; then the target over it. A role's model, provider
 * and variant belong to the role's harness, so a target that moves the
 * child to another harness drops them, and a target model drops the role's
 * variant. The parent's variant is never inherited: the in-process child
 * always behaved that way.
 */
export function resolveDelegationTarget(input: {
  role: Preconfig;
  target?: DelegationTarget;
  inherited: ResolvedDelegationTarget;
  parentPreconfig: Preconfig | null;
}): DelegationResolution {
  const { role, target, inherited, parentPreconfig } = input;
  const defaults = roleDefaults(role);
  const defaultHarness = defaults.harness ?? inherited.harness;

  const layered = (harness: SessionHarness): ResolvedDelegationTarget => {
    let modelId: string | null = null;
    let providerId: string | null = null;
    let variant: string | null = null;
    if (harness === inherited.harness) {
      modelId = inherited.modelId;
      providerId = inherited.providerId;
    }
    if (harness === defaultHarness) {
      if (defaults.model) {
        modelId = defaults.model;
        providerId = defaults.provider;
      }
      if (defaults.variant) variant = defaults.variant;
    }
    return { harness, modelId, providerId, variant };
  };

  const asConfigured = layered(defaultHarness);
  const resolved = layered(target?.harness ?? defaultHarness);
  if (target?.model && target.model !== resolved.modelId) {
    resolved.modelId = target.model;
    resolved.providerId = null;
    resolved.variant = null;
  }
  if (target?.provider) resolved.providerId = target.provider;
  if (target?.variant) resolved.variant = target.variant;

  const overridden = resolved.harness !== asConfigured.harness
    || resolved.modelId !== asConfigured.modelId
    || resolved.providerId !== asConfigured.providerId
    || resolved.variant !== asConfigured.variant;
  if (!overridden) return { ok: true, source: 'role', needsApproval: false, target: resolved };

  const policy = overridePolicy(parentPreconfig?.delegationTargets, resolved.harness);
  if (policy === 'deny') {
    return {
      ok: false,
      code: 'target_not_allowed',
      error: `This agent runs its roles as configured; it may not change the harness or model of role "${role.id}". Drop the target.`,
    };
  }
  return { ok: true, source: 'target', needsApproval: policy === 'ask', target: resolved };
}

/** A branch name from a task description: lowercase, dashes, at most 40 characters, never empty. */
export function launchBranchName(description: string): string {
  const slug = description
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/g, '');
  return slug || 'task';
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
  /** Each role with what it runs on by default; null defaults mean where the caller runs. */
  roles: Array<{ id: string; name: string; description: string; defaults: { harness: SessionHarness; model: string | null } | null }>;
  harnesses: Array<{
    id: SessionHarness;
    enabled: boolean;
    available: boolean;
    current: boolean;
    models: Array<{ id: string; name: string; provider?: string; efforts?: string[] }>;
    omittedModels: number;
  }>;
  caller: { harness: SessionHarness; model: string | null; provider: string | null };
  /** Whether a target may change a role's harness or model: freely, after asking the user, never, or freely for the listed harnesses. */
  overrides: 'any' | 'ask' | 'none' | SessionHarness[];
  /** Whether this agent may start top-level sessions (in a new worktree or the current checkout). */
  launches: 'ask' | 'allow' | 'never';
  limits: { depth: number; maxChildren: number; maxLaunches: number };
  note: string;
}

const SHORT_LIST = 8;

/**
 * The small picture a model needs to choose: roles with their defaults, each
 * harness with a short model list (role defaults and the caller's model
 * first, then the catalog order), and the limits. `search` widens the list
 * to matching models instead of dumping every catalog.
 */
export async function buildDelegationCapabilities(input: {
  roles: Preconfig[];
  caller: { harness: SessionHarness; model: string | null; provider: string | null };
  parentPreconfig: Preconfig | null;
  host: DelegationHostView;
  catalog: DelegationCatalog;
  limits: { depth: number; maxChildren: number; maxLaunches: number };
  search?: string;
}): Promise<DelegationCapabilities> {
  const search = input.search?.trim().toLowerCase() ?? '';
  const roleModels = new Set(input.roles.map((role) => roleDefaults(role).model).filter((model): model is string => Boolean(model)));
  const prioritized = <T extends { id: string }>(models: T[]): { kept: T[]; omitted: number } => {
    const matches = search ? models.filter((model) => JSON.stringify(model).toLowerCase().includes(search)) : models;
    if (search) return { kept: matches, omitted: models.length - matches.length };
    const first = matches.filter((model) => roleModels.has(model.id) || model.id === input.caller.model);
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
      const defaults = roleDefaults(role);
      return {
        id: role.id,
        name: role.name,
        description: role.description,
        defaults: defaults.harness ? { harness: defaults.harness, model: defaults.model } : null,
      };
    }),
    harnesses,
    caller: input.caller,
    overrides: input.parentPreconfig?.delegationTargets ?? 'any',
    launches: input.parentPreconfig?.launches ?? 'ask',
    limits: input.limits,
    note: 'Every delegation names a role (subagent_type); it runs on its defaults, or where you run when it has none. '
      + 'A target changes that harness, model, provider or variant for one task, within overrides '
      + '("ask" means the user is asked, "none" means roles run only as configured). '
      + 'isolation "worktree" starts a top-level session on its own branch and worktree instead of a subagent, "checkout" one in the current checkout; '
      + 'launches says whether either needs the user\'s approval. Pass search to see models beyond the short lists.',
  };
}
