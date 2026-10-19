import { useCallback, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { CodexModel, ModelWithStatus, Preconfig, ProkopaiClient, Session } from '@prokopai/sdk';
import { useHarnessesQuery, isHarnessEnabled } from '@/hooks/queries';
import { useScopedServerData } from '@/contexts/HostScopeContext';
import { useOptionalSessionCommands } from '@/contexts/SessionCommandsContext';
import { useSessionContentStore } from '@/stores/sessionContentStore';
import { useConnectionStore } from '@/stores/connectionStore';
import { useSessionControlStore } from '@/stores/sessionControlStore';
import { useClientIdentityStore } from '@/stores/clientIdentityStore';
import { useUIStore, type RecentModelRef } from '@/stores/uiStore';

export type ModelHarness = 'prokop' | 'claude-cli' | 'codex-cli';

/** One model a session can run, with the harness it runs under. */
export interface ModelChoice {
  harness: ModelHarness;
  /** Unique within the harness: `provider:model` for Prokop, the model id otherwise. */
  key: string;
  modelId: string;
  providerId?: string;
  providerName?: string;
  name: string;
  /** Effort levels (Claude, Codex) or variant keys (Prokop) this model accepts. */
  efforts: string[];
  defaultEffort: string | null;
}

export interface ModelGroup {
  harness: ModelHarness;
  label: string;
  models: ModelChoice[];
}

export interface ModelSelection extends ModelChoice {
  effort: string | null;
}

export const HARNESS_LABELS: Record<ModelHarness, string> = {
  prokop: 'Prokop',
  'claude-cli': 'Claude Code',
  'codex-cli': 'Codex',
};

function fromCodexModel(harness: 'claude-cli' | 'codex-cli', model: CodexModel): ModelChoice {
  return {
    harness,
    key: model.model,
    modelId: model.model,
    name: model.name,
    efforts: model.supportedEfforts,
    defaultEffort: model.defaultEffort ?? null,
  };
}

function fromProkopModel(model: ModelWithStatus): ModelChoice {
  return {
    harness: 'prokop',
    key: `${model.providerId}:${model.id}`,
    modelId: model.id,
    providerId: model.providerId,
    providerName: model.providerName,
    name: model.name,
    efforts: model.variants ? Object.keys(model.variants) : [],
    defaultEffort: null,
  };
}

interface Options {
  session: Session;
  sdkClient: ProkopaiClient | null;
  preconfigs: Preconfig[];
}

/**
 * Everything the model chip needs for one session: the models it can run
 * grouped by harness, what it runs now, the effort options for that model,
 * recent picks, and handlers that route a pick to the right server call.
 * Lifted from ChatHeader so the composer can own the control.
 */
export function useSessionModelSelection({ session, sdkClient, preconfigs }: Options) {
  const queryClient = useQueryClient();
  const commands = useOptionalSessionCommands();
  const models = useScopedServerData((s) => s.models);
  const defaultModel = useScopedServerData((s) => s.defaultModel);
  const workspace = useScopedServerData((s) => s.workspaces.find((w) => w.id === session.workspaceId));
  const queued = useSessionContentStore((s) => s.queuedMessages[session.id]);
  const storedModel = useSessionContentStore((s) => s.modelBySessionId[session.id]);
  const storedVariant = useSessionContentStore((s) => s.variantBySessionId[session.id]);
  const isStreaming = useConnectionStore((s) => s.streamingSessionIds.has(session.id)) || !!session.runningAt;
  const controlState = useSessionControlStore((s) => s.controlBySessionId[session.id]);
  const myClientId = useClientIdentityStore((s) => s.clientId);
  const isObserver = controlState?.status === 'controlled' && controlState.controllerClientId !== myClientId;
  const recentRefs = useUIStore((s) => s.recentModelsByWorkspace[session.workspaceId]);
  const pushRecentModel = useUIStore((s) => s.pushRecentModel);

  const codexSession = session.harness === 'codex-cli';
  const claudeSession = session.harness === 'claude-cli';
  // Any idle root session may change harness; after the first message the
  // server detaches the native thread and hands the new harness a brief.
  const canSwitchHarness = !session.parentId && session.status === 'active' && !session.runningAt
    && !isStreaming && !session.compacting && !queued?.length;
  const harnessesData = useHarnessesQuery(sdkClient).data;
  const harnessEnabled = (id: 'codex-cli' | 'claude-cli') =>
    isHarnessEnabled(harnessesData?.harnesses.find((h) => h.id === id));
  const catalogsAllowed = canSwitchHarness && !!workspace?.path;

  const claudeCatalog = useQuery({
    queryKey: ['claude-catalog', session.workspaceId],
    queryFn: () => sdkClient!.http.sessions.claudeCatalog(),
    enabled: !!sdkClient && catalogsAllowed && !claudeSession && harnessEnabled('claude-cli'),
    staleTime: 60_000,
    retry: false,
  });
  const claudeKey = useMemo(() => ['claude-models', session.id, session.selectedModel], [session.id, session.selectedModel]);
  const claudeSelection = useQuery({
    queryKey: claudeKey,
    queryFn: () => sdkClient!.http.sessions.claudeModels(session.id),
    enabled: !!sdkClient && claudeSession,
    staleTime: 60_000,
    retry: false,
  });
  const codexCatalog = useQuery({
    queryKey: ['codex-catalog', session.workspaceId],
    queryFn: () => sdkClient!.http.sessions.codexCatalog(),
    enabled: !!sdkClient && catalogsAllowed && !codexSession && harnessEnabled('codex-cli'),
    staleTime: 60_000,
    retry: false,
  });
  const codexKey = useMemo(() => ['codex-models', session.id, session.selectedModel], [session.id, session.selectedModel]);
  const codexSelection = useQuery({
    queryKey: codexKey,
    queryFn: () => sdkClient!.http.sessions.codexModels(session.id),
    enabled: !!sdkClient && codexSession,
    staleTime: 60_000,
    retry: false,
  });

  const claudeModels: CodexModel[] = claudeSession ? claudeSelection.data?.models ?? []
    : catalogsAllowed && harnessEnabled('claude-cli') ? claudeCatalog.data?.models ?? [] : [];
  const codexModels: CodexModel[] = codexSession ? codexSelection.data?.models ?? []
    : catalogsAllowed && harnessEnabled('codex-cli') ? codexCatalog.data?.models ?? [] : [];
  // A native session only lists Prokop models while it can still switch.
  const prokopModels = (codexSession || claudeSession) && !canSwitchHarness ? [] : models;

  const groups = useMemo<ModelGroup[]>(() => {
    const all: ModelGroup[] = [];
    if (prokopModels.length > 0) all.push({ harness: 'prokop', label: HARNESS_LABELS.prokop, models: prokopModels.map(fromProkopModel) });
    if (claudeModels.length > 0) all.push({ harness: 'claude-cli', label: HARNESS_LABELS['claude-cli'], models: claudeModels.map((m) => fromCodexModel('claude-cli', m)) });
    if (codexModels.length > 0) all.push({ harness: 'codex-cli', label: HARNESS_LABELS['codex-cli'], models: codexModels.map((m) => fromCodexModel('codex-cli', m)) });
    const current: ModelHarness = claudeSession ? 'claude-cli' : codexSession ? 'codex-cli' : 'prokop';
    return all.sort((a, b) => (a.harness === current ? -1 : b.harness === current ? 1 : 0));
  }, [prokopModels, claudeModels, codexModels, claudeSession, codexSession]);

  const selectedPreconfig = preconfigs.find((p) => p.id === session.preconfigId);
  const prokopModelId = storedModel ?? session.selectedModel ?? selectedPreconfig?.model ?? defaultModel;
  const prokopVariant = storedVariant !== undefined ? storedVariant : session.selectedVariant ?? null;

  const selection = useMemo<ModelSelection | null>(() => {
    if (claudeSession || codexSession) {
      const data = claudeSession ? claudeSelection.data : codexSelection.data;
      const list = claudeSession ? claudeModels : codexModels;
      const wanted = data?.selection?.model ?? session.selectedModel;
      const model = list.find((m) => m.model === wanted) ?? list.find((m) => m.isDefault);
      if (!model) {
        return wanted
          ? { harness: claudeSession ? 'claude-cli' : 'codex-cli', key: wanted, modelId: wanted, name: wanted, efforts: [], defaultEffort: null, effort: data?.selection?.effort ?? null }
          : null;
      }
      const choice = fromCodexModel(claudeSession ? 'claude-cli' : 'codex-cli', model);
      return { ...choice, effort: data?.selection?.effort ?? model.defaultEffort ?? null };
    }
    const model = session.selectedProvider
      ? models.find((m) => m.providerId === session.selectedProvider && m.id === prokopModelId)
      : models.find((m) => m.id === prokopModelId);
    if (!model) {
      return prokopModelId
        ? { harness: 'prokop', key: prokopModelId, modelId: prokopModelId, name: prokopModelId, efforts: [], defaultEffort: null, effort: prokopVariant }
        : null;
    }
    return { ...fromProkopModel(model), effort: prokopVariant };
  }, [claudeSession, codexSession, claudeSelection.data, codexSelection.data, claudeModels, codexModels, session.selectedModel, session.selectedProvider, models, prokopModelId, prokopVariant]);

  const recent = useMemo<ModelChoice[]>(() => {
    const byRef = (ref: RecentModelRef) => groups.find((g) => g.harness === ref.harness)?.models.find((m) => m.key === ref.key);
    return (recentRefs ?? []).map(byRef).filter((m): m is ModelChoice => !!m);
  }, [recentRefs, groups]);

  /** The agent that pins the current model, when the session runs it because of the agent. */
  const pinnedBy = selectedPreconfig?.model && !session.selectedModel && prokopModelId === selectedPreconfig.model
    ? selectedPreconfig.name
    : null;

  const disabled = session.status !== 'active' || !!session.parentId || isObserver
    || ((codexSession || claudeSession) && isStreaming);

  const setNative = useCallback(async (harness: 'claude-cli' | 'codex-cli', modelId: string, effort: string) => {
    if (!sdkClient) return;
    const established = harness === 'claude-cli' ? claudeSession : codexSession;
    if (!established) {
      sdkClient.sessions.selectHarnessModel(session.id, { harness, modelId, effort });
      return;
    }
    try {
      if (harness === 'claude-cli') {
        const response = await sdkClient.http.sessions.setClaudeModel(session.id, { model: modelId, effort });
        queryClient.setQueryData(claudeKey, (old: typeof claudeSelection.data) => old && { ...old, selection: response.selection });
      } else {
        const response = await sdkClient.http.sessions.setCodexModel(session.id, { model: modelId, effort });
        queryClient.setQueryData(codexKey, (old: typeof codexSelection.data) => old && { ...old, selection: response.selection });
      }
    } catch {
      toast.error(`Could not change the ${HARNESS_LABELS[harness]} model or effort. Check the host and try again.`);
    }
  }, [sdkClient, session.id, claudeSession, codexSession, queryClient, claudeKey, codexKey]);

  const setProkop = useCallback((modelId: string, providerId: string, variant?: string | null) => {
    if (codexSession || claudeSession) {
      sdkClient?.sessions.selectHarnessModel(session.id, { harness: 'prokop', modelId, providerId });
      return;
    }
    if (variant === undefined) {
      if (commands) commands.updateSessionModelForSession(session.id, modelId, providerId);
      else {
        const store = useSessionContentStore.getState();
        store.setModelForSession(session.id, modelId);
        store.setVariantForSession(session.id, null);
        sdkClient?.sessions.updateModel(session.id, { modelId, providerId });
      }
      return;
    }
    if (commands) commands.updateSessionVariantForSession(session.id, variant);
    else {
      sdkClient?.sessions.updateModel(session.id, { modelId, providerId, variant: variant ?? undefined });
      useSessionContentStore.getState().setVariantForSession(session.id, variant);
    }
  }, [codexSession, claudeSession, sdkClient, session.id, commands]);

  const selectModel = useCallback((choice: ModelChoice) => {
    if (disabled) return;
    pushRecentModel(session.workspaceId, { harness: choice.harness, key: choice.key });
    if (choice.harness === 'prokop') {
      setProkop(choice.modelId, choice.providerId ?? '');
      return;
    }
    // Re-picking the current model keeps its effort; a new model starts at its default.
    const keep = selection?.harness === choice.harness && selection.key === choice.key ? selection.effort : null;
    void setNative(choice.harness, choice.modelId, keep ?? choice.defaultEffort ?? '');
  }, [disabled, pushRecentModel, session.workspaceId, setProkop, setNative, selection]);

  const selectEffort = useCallback((effort: string) => {
    if (disabled || !selection) return;
    if (selection.harness === 'prokop') setProkop(selection.modelId, selection.providerId ?? '', effort);
    else void setNative(selection.harness, selection.modelId, effort);
  }, [disabled, selection, setProkop, setNative]);

  return { groups, selection, recent, canSwitchHarness, pinnedBy, disabled, selectModel, selectEffort };
}
