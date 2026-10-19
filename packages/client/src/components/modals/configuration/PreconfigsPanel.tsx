import { useState, useEffect, type Dispatch, type SetStateAction } from 'react';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { ProkopaiClient } from '@prokopai/sdk';
import { defaultLearningCadence, parseAgentLearningSettings } from '@prokopai/sdk';
import { usePreconfigsQuery, useCreatePreconfig, useUpdatePreconfig, useDeletePreconfig, useToolsQuery, useAgentsQuery, useDemoteAgent } from '@/hooks/queries';
import { Plus, Copy, Trash2, Loader2, Star, Check, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { useServerDataStore } from '@/stores/serverDataStore';
import { LearningSourcePicker } from './LearningSourcePicker';
import { LearningHistory } from './LearningHistory';
import { AgentModelPicker } from './AgentModelPicker';
import { DisclosureRow } from './DisclosureRow';
import { MemorySkillsControls } from './MemorySkillsControls';
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { SettingsGroup } from '@/components/ui/settings-group';
import { SettingsRow } from '@/components/ui/settings-row';
import { EmptyState, ErrorState, LoadingState } from '@/components/shared/States';

/** An open agent editor. `id` is null for a new agent; `initial` detects unsaved edits. */
export interface AgentEditorDraft {
  id: string | null;
  form: PreconfigForm;
  initial: PreconfigForm;
}

interface PanelProps {
  sdkClient: ProkopaiClient | null;
  /** Lifted by the settings dialog so an open editor survives switching sections. */
  draft?: AgentEditorDraft | null;
  onDraftChange?: Dispatch<SetStateAction<AgentEditorDraft | null>>;
}

interface Preconfig {
  id: string;
  name: string;
  description: string;
  systemPrompt: string;
  tools: string[] | null;
  model: string | null;
  provider: string | null;
  variant?: string | null;
  modelHarness?: 'prokop' | 'codex-cli' | 'claude-cli' | null;
  settings: Record<string, unknown> | null;
  isDefault: boolean;
  mode?: 'primary' | 'subagent' | 'both';
  canSpawnSubagents?: boolean | string[] | null;
  allowSelfAsSubagent?: boolean;
  skills?: string[] | null;
  capabilities?: { memory?: boolean; skills?: boolean } | null;
}

const MODE_OPTIONS = [
  { value: 'primary', label: 'Primary' },
  { value: 'subagent', label: 'Subagent' },
  { value: 'both', label: 'Both' },
];

const LEARNING_DEFAULTS = defaultLearningCadence('agent');
const LEARNING_FIELDS = [
  { key: 'learningIdle', label: 'Quiet period', defaultValue: LEARNING_DEFAULTS.idleMinutes },
  { key: 'learningMinInterval', label: 'Min interval', defaultValue: LEARNING_DEFAULTS.minimumIntervalMinutes },
  { key: 'learningMaxPending', label: 'Max pending age', defaultValue: LEARNING_DEFAULTS.maximumPendingMinutes },
] as const;

function getDuplicateName(name: string, existingNames: string[]): string {
  const names = new Set(existingNames);
  const copyName = `${name} Copy`;
  if (!names.has(copyName)) return copyName;

  let copyNumber = 2;
  while (names.has(`${copyName} ${copyNumber}`)) {
    copyNumber += 1;
  }
  return `${copyName} ${copyNumber}`;
}

export interface PreconfigForm {
  name: string;
  description: string;
  systemPrompt: string;
  mode: 'primary' | 'subagent' | 'both';
  model: string;
  provider: string;
  variant: string;
  modelHarness: '' | 'prokop' | 'codex-cli' | 'claude-cli';
  tools: string[];
  temperature: string;
  canSpawnSubagentsMode: 'all' | 'none' | 'specific';
  canSpawnSubagentsList: string[];
  allowSelfAsSubagent: boolean;
  isDefault: boolean;
  capabilityMemory: boolean;
  capabilitySkills: boolean;
  learningEnabled: boolean;
  learningIdle: string;
  learningMinInterval: string;
  learningMaxPending: string;
  learningInstructions: string;
  learningSourcesMode: 'all' | 'selected';
  learningSourceIds: string[];
}

const emptyForm: PreconfigForm = {
  name: '',
  description: '',
  systemPrompt: '',
  mode: 'primary' as const,
  model: '',
  provider: '',
  variant: '',
  modelHarness: '',
  tools: [],
  temperature: '',
  canSpawnSubagentsMode: 'none',
  canSpawnSubagentsList: [],
  allowSelfAsSubagent: false,
  isDefault: false,
  capabilityMemory: true,
  capabilitySkills: true,
  learningEnabled: true,
  learningIdle: '',
  learningMinInterval: '',
  learningMaxPending: '',
  learningInstructions: '',
  learningSourcesMode: 'all' as const,
  learningSourceIds: [],
};

export function PreconfigsPanel({ sdkClient, draft: draftProp, onDraftChange }: PanelProps) {
  const { data: preconfigsData, isLoading: loading } = usePreconfigsQuery(sdkClient);
  const { data: toolsData } = useToolsQuery(sdkClient);
  const createPreconfigMut = useCreatePreconfig(sdkClient);
  const updatePreconfigMut = useUpdatePreconfig(sdkClient);
  const deletePreconfigMut = useDeletePreconfig(sdkClient);
  const preconfigs: Preconfig[] = (preconfigsData?.preconfigs ?? []) as Preconfig[];
  const [error, setError] = useState<string | null>(null);

  const [localDraft, setLocalDraft] = useState<AgentEditorDraft | null>(null);
  const draft = onDraftChange ? (draftProp ?? null) : localDraft;
  const setDraft = onDraftChange ?? setLocalDraft;
  const isCreating = draft !== null && draft.id === null;
  const editingPreconfig = draft?.id ? preconfigs.find(p => p.id === draft.id) ?? null : null;
  const form = draft?.form ?? emptyForm;
  const setForm = (next: PreconfigForm | ((prev: PreconfigForm) => PreconfigForm)) =>
    setDraft(current => current && { ...current, form: typeof next === 'function' ? next(current.form) : next });
  const isDirty = draft !== null && JSON.stringify(draft.form) !== JSON.stringify(draft.initial);
  /** Codex and Claude pins run on their own CLI, which ignores Prokop tools, subagents, and temperature. */
  const externalHarness = form.modelHarness === 'codex-cli' ? 'Codex CLI'
    : form.modelHarness === 'claude-cli' ? 'Claude CLI' : null;
  const [discardOpen, setDiscardOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [duplicatingId, setDuplicatingId] = useState<string | null>(null);
  const [availableTools, setAvailableTools] = useState<{ name: string; description: string }[]>([]);
  const [toolSearch, setToolSearch] = useState('');

  const agentsData = useAgentsQuery(sdkClient);
  const demoteMut = useDemoteAgent(sdkClient);
  const agentIds = new Set((agentsData.data?.agents ?? []).map(agent => agent.id));
  const isMaterialized = editingPreconfig ? agentIds.has(editingPreconfig.id) : false;
  const [demoteTarget, setDemoteTarget] = useState<string | null>(null);
  const [demoting, setDemoting] = useState(false);
  const [homeLoading, setHomeLoading] = useState(false);
  const [homeError, setHomeError] = useState<string | null>(null);
  const [homeSaving, setHomeSaving] = useState(false);
  const [homeDraft, setHomeDraft] = useState({ user: '', memory: '' });
  const [homeSkills, setHomeSkills] = useState<Array<{ name: string; description: string }>>([]);
  const [homeReload, setHomeReload] = useState(0);

  const models = useServerDataStore((s) => s.models);
  const workspaces = useServerDataStore((s) => s.workspaces);
  /** Agent learning runs record against the agent's home workspace; the history dialog reads from there. */
  const homeWorkspaceId = editingPreconfig
    ? workspaces.find(w => w.settings?.isAgentHome === true && w.settings?.agentId === editingPreconfig.id)?.id
    : undefined;

  // Harness catalogs for cross-harness model pins. A missing or unavailable
  // CLI yields an empty list and simply hides that picker group.
  const codexCatalog = useQuery({
    queryKey: ['codex-catalog'],
    queryFn: () => sdkClient!.http.sessions.codexCatalog(),
    enabled: !!sdkClient,
    staleTime: 60_000,
    retry: false,
  });
  const claudeCatalog = useQuery({
    queryKey: ['claude-catalog'],
    queryFn: () => sdkClient!.http.sessions.claudeCatalog(),
    enabled: !!sdkClient,
    staleTime: 60_000,
    retry: false,
  });
  const codexCatalogModels = codexCatalog.data?.models ?? [];
  const claudeCatalogModels = claudeCatalog.data?.models ?? [];


  const availableSubagents = preconfigs.filter(p => {
    const mode = p.mode ?? 'primary';
    const isSubagent = mode === 'subagent' || mode === 'both';
    const isNotSelf = !editingPreconfig || p.id !== editingPreconfig.id;
    return isSubagent && isNotSelf;
  });

  useEffect(() => {
    if (toolsData?.tools) {
      // Domain tools (memory, skills, search, scheduler, task)
      // are gated by workspace capability toggles, not preconfig tool
      // selection; selecting them here would do nothing.
      setAvailableTools(toolsData.tools.filter(tool => tool.source !== 'domain'));
    }
  }, [toolsData]);

  useEffect(() => {
    if (!editingPreconfig || !isMaterialized || !sdkClient) {
      setHomeDraft({ user: '', memory: '' });
      setHomeSkills([]);
      setHomeError(null);
      return;
    }
    let cancelled = false;
    setHomeLoading(true);
    setHomeError(null);
    Promise.all([
      sdkClient.http.agents.getMemory(editingPreconfig.id),
      sdkClient.http.agents.listSkills(editingPreconfig.id),
    ])
      .then(([memory, skills]) => {
        if (cancelled) return;
        setHomeDraft({ user: memory.user ?? '', memory: memory.memory ?? '' });
        setHomeSkills(skills.skills ?? []);
      })
      .catch((err: unknown) => {
        if (!cancelled) setHomeError(err instanceof Error ? err.message : 'Failed to load agent home');
      })
      .finally(() => {
        if (!cancelled) setHomeLoading(false);
      });
    return () => { cancelled = true; };
  }, [editingPreconfig?.id, isMaterialized, sdkClient, homeReload]);

  const handleCreate = () => {
    setDraft({ id: null, form: emptyForm, initial: emptyForm });
  };

  const handleEdit = (preconfig: Preconfig) => {
    const learning = parseAgentLearningSettings(preconfig.settings);
    const next: PreconfigForm = {
      name: preconfig.name,
      description: preconfig.description || '',
      systemPrompt: preconfig.systemPrompt || '',
      mode: preconfig.mode || 'primary',
      model: preconfig.model || '',
      provider: preconfig.provider || '',
      variant: preconfig.variant || '',
      modelHarness: preconfig.modelHarness ?? '',
      tools: preconfig.tools ?? [],
      temperature: preconfig.settings?.temperature != null
        ? String(preconfig.settings.temperature)
        : '',
      canSpawnSubagentsMode: preconfig.canSpawnSubagents === true ? 'all'
        : preconfig.canSpawnSubagents === false || preconfig.canSpawnSubagents === null || preconfig.canSpawnSubagents === undefined
          ? 'none'
          : 'specific',
      canSpawnSubagentsList: Array.isArray(preconfig.canSpawnSubagents) ? preconfig.canSpawnSubagents : [],
      allowSelfAsSubagent: preconfig.allowSelfAsSubagent ?? false,
      isDefault: preconfig.isDefault,
      capabilityMemory: preconfig.capabilities?.memory !== false,
      capabilitySkills: preconfig.capabilities?.skills !== false,
      learningEnabled: learning?.enabled ?? true,
      learningIdle: learning?.cadence ? String(learning.cadence.idleMinutes) : '',
      learningMinInterval: learning?.cadence ? String(learning.cadence.minimumIntervalMinutes) : '',
      learningMaxPending: learning?.cadence ? String(learning.cadence.maximumPendingMinutes) : '',
      learningInstructions: learning?.instructions ?? '',
      learningSourcesMode: learning?.sources.mode === 'selected' ? 'selected' : 'all',
      learningSourceIds: learning?.sources.mode === 'selected' ? learning.sources.workspaceIds : [],
    };
    setDraft({ id: preconfig.id, form: next, initial: next });
  };

  const handleSave = async () => {
    if (!form.name.trim()) return;
    setSaving(true);
    setError(null);
    try {
      // Preserve settings keys owned elsewhere (e.g. learning) instead of
      // replacing the whole bag with temperature only.
      const settings: Record<string, unknown> = { ...(editingPreconfig?.settings ?? {}) };
      if (form.temperature.trim()) {
        const temp = parseFloat(form.temperature);
        if (isNaN(temp) || temp < 0.1 || temp > 0.9) {
          setError('Temperature must be between 0.1 and 0.9');
          setSaving(false);
          return;
        }
        settings.temperature = temp;
      } else {
        delete settings.temperature;
      }

      if (form.mode !== 'subagent') {
        const idle = form.learningIdle.trim();
        const minInterval = form.learningMinInterval.trim();
        const maxPending = form.learningMaxPending.trim();
        let cadence: { idleMinutes: number; minimumIntervalMinutes: number; maximumPendingMinutes: number } | null = null;
        if (idle || minInterval || maxPending) {
          cadence = {
            idleMinutes: idle ? Number(idle) : LEARNING_DEFAULTS.idleMinutes,
            minimumIntervalMinutes: minInterval ? Number(minInterval) : LEARNING_DEFAULTS.minimumIntervalMinutes,
            maximumPendingMinutes: maxPending ? Number(maxPending) : LEARNING_DEFAULTS.maximumPendingMinutes,
          };
          if (![idle, minInterval, maxPending].every(value => !value || /^\d+$/.test(value))
            || !Object.values(cadence).every(value => Number.isInteger(value) && value >= 1 && value <= 10080)
            || cadence.maximumPendingMinutes < cadence.minimumIntervalMinutes) {
            setError('Learning timing must be whole minutes from 1 to 10080, with max pending age at least the minimum interval. Empty fields use defaults.');
            setSaving(false);
            return;
          }
        }
        settings.learning = {
          enabled: form.learningEnabled,
          cadence,
          instructions: form.learningInstructions,
          sources: form.learningSourcesMode === 'all'
            ? { mode: 'all' }
            : { mode: 'selected', workspaceIds: form.learningSourceIds },
        };
      }

      let canSpawnSubagents: boolean | string[] | null = null;
      if (form.canSpawnSubagentsMode === 'all') {
        canSpawnSubagents = true;
      } else if (form.canSpawnSubagentsMode === 'specific') {
        canSpawnSubagents = form.canSpawnSubagentsList.length > 0 ? form.canSpawnSubagentsList : [];
      } else {
        canSpawnSubagents = false;
      }

      const body: Record<string, unknown> = {
        name: form.name.trim(),
        description: form.description.trim(),
        systemPrompt: form.systemPrompt,
        mode: form.mode,
        model: form.model.trim() || null,
        provider: form.provider.trim() || null,
        variant: form.variant.trim() || null,
        modelHarness: form.modelHarness || null,
        tools: form.tools.length > 0 ? form.tools : null,
        settings: Object.keys(settings).length > 0 ? settings : null,
        canSpawnSubagents,
        allowSelfAsSubagent: form.allowSelfAsSubagent,
        skills: null,
        ...(form.mode !== 'subagent'
          ? { capabilities: { memory: form.capabilityMemory, skills: form.capabilitySkills } }
          : {}),
        isDefault: form.isDefault,
        format: 'md',
      };

      if (isCreating) {
        await createPreconfigMut.mutateAsync(body);
      } else if (editingPreconfig) {
        await updatePreconfigMut.mutateAsync({ id: editingPreconfig.id, body });
      }
      setDraft(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save agent');
    } finally {
      setSaving(false);
    }
  };

  const handleDuplicate = async (preconfig: Preconfig) => {
    if (duplicatingId !== null) return;

    const name = getDuplicateName(preconfig.name, preconfigs.map(({ name }) => name));
    setDuplicatingId(preconfig.id);
    setError(null);
    try {
      await createPreconfigMut.mutateAsync({
        name,
        description: preconfig.description,
        systemPrompt: preconfig.systemPrompt,
        mode: preconfig.mode,
        model: preconfig.model,
        provider: preconfig.provider,
        variant: preconfig.variant,
        modelHarness: preconfig.modelHarness ?? null,
        tools: preconfig.tools,
        settings: preconfig.settings,
        canSpawnSubagents: preconfig.canSpawnSubagents ?? false,
        allowSelfAsSubagent: preconfig.allowSelfAsSubagent ?? false,
        skills: null,
        capabilities: preconfig.capabilities ?? null,
        format: 'md',
      });
      toast.success(`Duplicated agent as ${name}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to duplicate agent';
      setError(message);
      toast.error('Failed to duplicate agent', { description: message });
    } finally {
      setDuplicatingId(null);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await deletePreconfigMut.mutateAsync(deleteTarget);
      setDeleteTarget(null);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to delete agent';
      setError(message);
      toast.error('Failed to delete agent', { description: message });
    } finally {
      setDeleting(false);
    }
  };

  const handleSaveHomeMemory = async () => {
    if (!editingPreconfig || !sdkClient) return;
    setHomeSaving(true);
    setHomeError(null);
    try {
      await sdkClient.http.agents.updateMemory(editingPreconfig.id, { target: 'user', content: homeDraft.user });
      await sdkClient.http.agents.updateMemory(editingPreconfig.id, { target: 'memory', content: homeDraft.memory });
      toast.success('Agent memory saved');
    } catch (err) {
      setHomeError(err instanceof Error ? err.message : 'Failed to save agent memory');
    } finally {
      setHomeSaving(false);
    }
  };

  const handleDemote = async () => {
    if (!demoteTarget) return;
    setDemoting(true);
    try {
      await demoteMut.mutateAsync(demoteTarget);
      setDemoteTarget(null);
      toast.success('Removed agent home and memory');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to remove agent home';
      toast.error('Failed to remove agent home', { description: message });
    } finally {
      setDemoting(false);
    }
  };

  const handleCancel = () => {
    if (isDirty) setDiscardOpen(true);
    else setDraft(null);
  };

  if (isCreating || editingPreconfig) {
    const nested = 'pl-6';
    return (
      <div className="flex flex-col gap-3 p-3 sm:p-4">
        {error && <ErrorState>{error}</ErrorState>}

        <div key={isCreating ? 'new' : (editingPreconfig?.id ?? 'edit')} className="flex flex-col gap-3">
          <SettingsGroup label={isCreating ? 'New agent' : 'Edit agent'}>
            <SettingsRow label="Name" htmlFor="agent-name">
              <Input
                id="agent-name"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="My Agent"
                className="sm:w-64"
              />
            </SettingsRow>
            <SettingsRow label="Description" htmlFor="agent-description">
              <Input
                id="agent-description"
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                placeholder="Description..."
                className="sm:w-80"
              />
            </SettingsRow>
            <SettingsRow label="Mode" description="Subagents can be spawned by other agents; primary agents start sessions.">
              <Select value={form.mode} onValueChange={(mode) => setForm({ ...form, mode: mode as PreconfigForm['mode'] })}>
                <SelectTrigger className="w-36" aria-label="Mode">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {MODE_OPTIONS.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </SettingsRow>
            <SettingsRow label="Default agent" htmlFor="agent-default" description="New sessions start with this agent; only one can be the default.">
              <Switch
                id="agent-default"
                checked={form.isDefault}
                onCheckedChange={(checked) => setForm({ ...form, isDefault: checked })}
              />
            </SettingsRow>
            <SettingsRow label="Model" description={externalHarness ? undefined : 'The provider follows the model.'}>
              <div className="w-full sm:w-72">
                <AgentModelPicker
                  models={models}
                  codexModels={codexCatalogModels}
                  claudeModels={claudeCatalogModels}
                  value={{
                    model: form.model,
                    provider: form.provider,
                    variant: form.variant,
                    modelHarness: form.modelHarness,
                  }}
                  onChange={(next) => setForm(prev => ({ ...prev, ...next }))}
                />
              </div>
            </SettingsRow>
            <DisclosureRow label="System Prompt" summary={form.systemPrompt.trim() ? 'Custom' : 'None'} defaultOpen={false}>
              <SettingsRow className={nested} label="Prompt" htmlFor="agent-system-prompt" stacked>
                <Textarea
                  id="agent-system-prompt"
                  value={form.systemPrompt}
                  onChange={(e) => setForm({ ...form, systemPrompt: e.target.value })}
                  className="min-h-48 text-sm"
                  placeholder="System prompt content..."
                />
              </SettingsRow>
            </DisclosureRow>
          </SettingsGroup>

          {form.mode !== 'subagent' && (
            <SettingsGroup description="Personal memory, skills, and learning across workspaces.">
              <DisclosureRow
                label="Memory & Learning"
                summary={
                  [
                    form.capabilityMemory && 'memory',
                    form.capabilitySkills && 'skills',
                    form.learningEnabled && 'learning',
                  ]
                    .filter(Boolean)
                    .join(' · ') || 'All off'
                }
                defaultOpen={false}
              >
                <MemorySkillsControls scope="agent" className={nested}
                  memoryEnabled={form.capabilityMemory} skillsEnabled={form.capabilitySkills}
                  onChangeMemory={capabilityMemory => setForm({ ...form, capabilityMemory })}
                  onChangeSkills={capabilitySkills => setForm({ ...form, capabilitySkills })} />
                <SettingsRow
                  className={nested}
                  label="Automatic learning"
                  htmlFor="agent-learning-enabled"
                  description="Reviews this agent's sessions when idle and saves durable lessons to its personal memory."
                >
                  <span className="flex items-center gap-2">
                    {homeWorkspaceId && (
                      <Button variant="link" size="xs" className="h-auto p-0" aria-label="Learning history" onClick={() => setHistoryOpen(true)}>
                        History
                      </Button>
                    )}
                    <Switch
                      id="agent-learning-enabled"
                      checked={form.learningEnabled}
                      onCheckedChange={(checked) => setForm({ ...form, learningEnabled: checked })}
                    />
                  </span>
                </SettingsRow>
                {form.learningEnabled && (
                  <>
                    {externalHarness && (
                      <SettingsRow className={nested} label={<span className="text-xs text-muted-foreground">Reviews run on {externalHarness} (from the agent's model pin) with that harness's own tools; harness reviews can't be undone from history.</span>} />
                    )}
                    <DisclosureRow label="Timing" defaultOpen={false} className={nested}
                      summary={LEARNING_FIELDS.some(field => form[field.key].trim()) ? 'Customized' : 'Defaults'}>
                      {LEARNING_FIELDS.map(field => (
                        <SettingsRow key={field.key} className="pl-9" label={field.label} htmlFor={field.key} description={`Minutes. Empty uses the default of ${field.defaultValue}.`}>
                          <Input
                            id={field.key}
                            type="number"
                            min={1}
                            max={10080}
                            value={form[field.key]}
                            onChange={(e) => setForm({ ...form, [field.key]: e.target.value })}
                            placeholder={String(field.defaultValue)}
                            className="w-24"
                          />
                        </SettingsRow>
                      ))}
                    </DisclosureRow>
                    <DisclosureRow label="Learning focus" summary={form.learningInstructions.trim() || null} defaultOpen={false} className={nested}>
                      <SettingsRow className="pl-9" label="Focus" htmlFor="agent-learning-focus" stacked>
                        <Textarea
                          id="agent-learning-focus"
                          aria-label="Learning focus"
                          value={form.learningInstructions}
                          onChange={(e) => setForm({ ...form, learningInstructions: e.target.value })}
                          placeholder="What this agent should focus on when learning..."
                        />
                      </SettingsRow>
                    </DisclosureRow>
                    <SettingsRow className={nested} label="Sources" description="Which workspaces feed this agent's learning.">
                      <Select
                        value={form.learningSourcesMode}
                        onValueChange={(mode) => setForm({ ...form, learningSourcesMode: mode as PreconfigForm['learningSourcesMode'] })}
                      >
                        <SelectTrigger className="w-48" aria-label="Learning sources">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectGroup>
                            <SelectItem value="all">All workspaces</SelectItem>
                            <SelectItem value="selected">Selected workspaces</SelectItem>
                          </SelectGroup>
                        </SelectContent>
                      </Select>
                    </SettingsRow>
                    {form.learningSourcesMode === 'selected' && (
                      <SettingsRow className={nested} label="Selected workspaces" stacked>
                        <LearningSourcePicker
                          workspaces={workspaces}
                          selectedIds={form.learningSourceIds}
                          onChange={(ids) => setForm({ ...form, learningSourceIds: ids })}
                        />
                      </SettingsRow>
                    )}
                  </>
                )}
              </DisclosureRow>
            </SettingsGroup>
          )}

          {editingPreconfig && isMaterialized && (
            <SettingsGroup description="Memory and skills stored in this agent's home directory.">
              <DisclosureRow label="Personal files" summary={`${homeSkills.length} skill${homeSkills.length === 1 ? '' : 's'}`} defaultOpen={false}>
                {homeError && <SettingsRow className={nested} label={<span className="text-xs text-error">{homeError}</span>} />}
                {homeLoading ? (
                  <SettingsRow className={nested} label={<Loader2 className="size-3.5 animate-spin text-muted-foreground" />} />
                ) : (
                  <>
                    <SettingsRow className={nested} label="User preferences" description="USER.md" htmlFor="agent-home-user" stacked>
                      <Textarea
                        id="agent-home-user"
                        value={homeDraft.user}
                        onChange={(e) => setHomeDraft({ ...homeDraft, user: e.target.value })}
                        className="min-h-20 font-mono text-xs"
                      />
                    </SettingsRow>
                    <SettingsRow className={nested} label="Memory" description="MEMORY.md" htmlFor="agent-home-memory" stacked>
                      <Textarea
                        id="agent-home-memory"
                        value={homeDraft.memory}
                        onChange={(e) => setHomeDraft({ ...homeDraft, memory: e.target.value })}
                        className="min-h-28 font-mono text-xs"
                      />
                    </SettingsRow>
                    <SettingsRow className={nested} label={<span className="text-xs text-muted-foreground">Saved apart from the agent definition.</span>}>
                      <span className="flex items-center gap-1">
                        <Button variant="ghost" size="icon-xs" onClick={() => setHomeReload(n => n + 1)} title="Reload home data" aria-label="Reload home data">
                          <RefreshCw />
                        </Button>
                        <Button variant="outline" onClick={handleSaveHomeMemory} disabled={homeSaving}>
                          {homeSaving && <Loader2 className="animate-spin" data-icon="inline-start" />}
                          Save memory
                        </Button>
                      </span>
                    </SettingsRow>
                    {homeSkills.map((skill) => (
                      <SettingsRow key={skill.name} className={nested} label={<span className="font-mono text-xs">{skill.name}</span>} description={skill.description || undefined} />
                    ))}
                    <SettingsRow className={nested} label="Personal skills" description={`${homeSkills.length} read-only; the agent manages them at runtime.`}>
                      <Button variant="destructive" onClick={() => setDemoteTarget(editingPreconfig.id)}>
                        <Trash2 data-icon="inline-start" />
                        Remove personal files
                      </Button>
                    </SettingsRow>
                  </>
                )}
              </DisclosureRow>
            </SettingsGroup>
          )}

          <SettingsGroup description={externalHarness
            ? `This agent runs on ${externalHarness}, which uses its own tools, subagents, and sampling. These settings apply only if you switch it to a Prokop model.`
            : 'Applies only when this agent runs on the Prokop harness. Codex and Claude sessions use their own tools, agents, and sampling settings.'}>
            <DisclosureRow
              label="Prokop Runtime"
              summary={externalHarness ? `Not used by ${externalHarness}` : [
                `${form.tools.length} tool${form.tools.length === 1 ? '' : 's'}`,
                form.canSpawnSubagentsMode === 'all' ? 'subagents: all'
                  : form.canSpawnSubagentsMode === 'specific'
                    ? `${form.canSpawnSubagentsList.length} subagent${form.canSpawnSubagentsList.length === 1 ? '' : 's'}` : null,
                form.temperature.trim() ? `temp ${form.temperature.trim()}` : null,
              ].filter(Boolean).join(' · ')}
              defaultOpen={false}
            >
              <div className={cn('contents', externalHarness && '[&>*]:opacity-60')}>
                <SettingsRow className={nested} label="Tools" htmlFor="agent-tool-search" description="Only the selected tools are available. With none selected, this agent has no tools from this list.">
                  <Input
                    id="agent-tool-search"
                    value={toolSearch}
                    onChange={(e) => setToolSearch(e.target.value)}
                    placeholder="Search tools..."
                    className="sm:w-56"
                  />
                </SettingsRow>
                <SettingsRow className={nested} label="Tool list" stacked>
                  <div className="dialog-scrollbar max-h-[200px] w-full divide-y divide-border/50 overflow-y-auto rounded-md border border-border/50">
                    {[...availableTools]
                      .sort((a, b) => a.name.localeCompare(b.name))
                      .filter(tool =>
                        !toolSearch.trim()
                        || tool.name.toLowerCase().includes(toolSearch.toLowerCase())
                        || tool.description?.toLowerCase().includes(toolSearch.toLowerCase())
                      )
                      .map(tool => {
                        const selected = form.tools.includes(tool.name);
                        return (
                          <button
                            key={tool.name}
                            type="button"
                            aria-pressed={selected}
                            onClick={() => setForm(prev => ({
                              ...prev,
                              tools: selected
                                ? prev.tools.filter(t => t !== tool.name)
                                : [...prev.tools, tool.name],
                            }))}
                            className={cn(
                              'flex min-h-7 w-full items-center justify-between gap-2 px-2.5 py-1 text-left transition-colors hover:bg-muted',
                              selected && 'bg-highlight/10',
                            )}
                          >
                            <span className="flex min-w-0 flex-col">
                              <span className="truncate font-mono text-xs">{tool.name}</span>
                              {tool.description && (
                                <span className="truncate text-xs text-muted-foreground">{tool.description}</span>
                              )}
                            </span>
                            <span className={cn(
                              'flex size-4 shrink-0 items-center justify-center rounded-sm border',
                              selected ? 'border-highlight bg-highlight text-highlight-foreground' : 'border-muted-foreground/30',
                            )}>
                              {selected && <Check className="size-3" />}
                            </span>
                          </button>
                        );
                      })}
                  </div>
                </SettingsRow>

                <SettingsRow className={nested} label="Subagents">
                  <Select
                    value={form.canSpawnSubagentsMode}
                    onValueChange={(mode) => setForm({ ...form, canSpawnSubagentsMode: mode as PreconfigForm['canSpawnSubagentsMode'] })}
                  >
                    <SelectTrigger className="w-64" aria-label="Subagents">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        <SelectItem value="none">None: cannot spawn subagents</SelectItem>
                        <SelectItem value="all">All available subagents</SelectItem>
                        <SelectItem value="specific">Specific subagents</SelectItem>
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                </SettingsRow>
                {form.canSpawnSubagentsMode === 'specific' && (
                  <SettingsRow className={nested} label="Allowed subagents" description={availableSubagents.length === 0 ? 'No subagent-mode agents available yet.' : undefined} stacked>
                    {availableSubagents.length > 0 && (
                      <div className="flex flex-wrap gap-1.5">
                        {availableSubagents.map(subagent => {
                          const selected = form.canSpawnSubagentsList.includes(subagent.id);
                          return (
                            <button
                              key={subagent.id}
                              type="button"
                              aria-pressed={selected}
                              onClick={() => {
                                setForm(prev => ({
                                  ...prev,
                                  canSpawnSubagentsList: selected
                                    ? prev.canSpawnSubagentsList.filter(s => s !== subagent.id)
                                    : [...prev.canSpawnSubagentsList, subagent.id],
                                }));
                              }}
                              className={cn(
                                'inline-flex h-6 items-center gap-1 rounded-sm border px-2 text-xs transition-colors',
                                selected
                                  ? 'border-highlight bg-highlight/10 text-foreground'
                                  : 'border-border/50 bg-transparent text-muted-foreground hover:bg-muted hover:text-foreground',
                              )}
                              title={subagent.description || subagent.id}
                            >
                              {selected && <Check className="size-2.5" />}
                              {subagent.name}
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </SettingsRow>
                )}
                <SettingsRow
                  className={nested}
                  label="Allow self as subagent"
                  htmlFor="allow-self-as-subagent"
                  description={form.canSpawnSubagentsMode === 'none' ? 'Enable subagent spawning first.'
                    : form.mode === 'primary' ? 'No effect while the mode is Primary.'
                      : 'Delegates once to a new copy of itself; the copy cannot delegate again.'}
                >
                  <Switch
                    id="allow-self-as-subagent"
                    checked={form.allowSelfAsSubagent}
                    disabled={form.canSpawnSubagentsMode === 'none'}
                    onCheckedChange={(checked) => setForm({ ...form, allowSelfAsSubagent: checked })}
                  />
                </SettingsRow>
                <SettingsRow className={nested} label="Temperature" htmlFor="agent-temperature" description="0.1 to 0.9; empty uses the server default. Not applied to GPT models on the Codex provider.">
                  <Input
                    id="agent-temperature"
                    type="number"
                    value={form.temperature}
                    onChange={(e) => setForm({ ...form, temperature: e.target.value })}
                    placeholder="0.2"
                    min="0.1"
                    max="0.9"
                    step="0.1"
                    className="w-24 font-mono"
                  />
                </SettingsRow>
              </div>
            </DisclosureRow>
          </SettingsGroup>
        </div>

        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={handleCancel} aria-label="Back to agents">Cancel</Button>
          <Button onClick={handleSave} disabled={saving || !form.name.trim()}>
            {saving && <Loader2 className="animate-spin" data-icon="inline-start" />}
            Save
          </Button>
        </div>

        {homeWorkspaceId && (
          <Dialog open={historyOpen} onOpenChange={setHistoryOpen}>
            <DialogContent className="flex flex-col overflow-hidden sm:max-w-2xl sm:max-h-[85vh]">
              <DialogHeader className="shrink-0">
                <DialogTitle>History</DialogTitle>
                <DialogDescription>Learning runs and revision-checked undo.</DialogDescription>
              </DialogHeader>
              <div className="dialog-scrollbar min-h-0 flex-1 overflow-y-auto overscroll-contain">
                <LearningHistory workspaceId={homeWorkspaceId} />
              </div>
            </DialogContent>
          </Dialog>
        )}

        <ConfirmationDialog
          open={discardOpen}
          onOpenChange={setDiscardOpen}
          title="Discard changes?"
          description="Your edits to this agent have not been saved."
          confirmLabel="Discard"
          variant="destructive"
          onConfirm={() => {
            setDiscardOpen(false);
            setDraft(null);
          }}
        />
      </div>
    );
  }

  if (loading) return <LoadingState />;

  /** The model an agent is pinned to, as people scan for it in the list. */
  const modelLabel = (preconfig: Preconfig): string => {
    if (!preconfig.model) return 'Server default';
    if (preconfig.modelHarness === 'codex-cli' || preconfig.modelHarness === 'claude-cli') {
      const catalog = preconfig.modelHarness === 'codex-cli' ? codexCatalogModels : claudeCatalogModels;
      const name = catalog.find(m => m.model === preconfig.model)?.name ?? preconfig.model;
      return `${preconfig.modelHarness === 'codex-cli' ? 'Codex' : 'Claude'} · ${name}`;
    }
    return models.find(m => m.id === preconfig.model)?.name ?? preconfig.model;
  };

  return (
    <div className="flex flex-col gap-4 p-3 sm:p-4">
      <SettingsGroup label="Agents" description="A role a session runs as: prompt, model, tools and memory.">
        <SettingsRow label={`${preconfigs.length} agent${preconfigs.length !== 1 ? 's' : ''}`}>
          <Button variant="outline" onClick={handleCreate}>
            <Plus data-icon="inline-start" />
            New agent
          </Button>
        </SettingsRow>
        {preconfigs.map((preconfig) => (
          <SettingsRow
            key={preconfig.id}
            onClick={() => handleEdit(preconfig)}
            label={
              <span className="flex items-center gap-2">
                <span className="truncate">{preconfig.name}</span>
                {preconfig.isDefault && (
                  <Badge variant="outline" className="gap-0.5"><Star className="size-2.5" />Default</Badge>
                )}
                {preconfig.mode && preconfig.mode !== 'primary' && (
                  <Badge variant="secondary">{preconfig.mode === 'subagent' ? 'Subagent' : 'Primary + subagent'}</Badge>
                )}
              </span>
            }
            description={preconfig.description || undefined}
          >
            <span className="truncate">{modelLabel(preconfig)}</span>
            <Button
              size="icon-xs"
              variant="ghost"
              onClick={() => handleDuplicate(preconfig)}
              disabled={duplicatingId !== null}
              aria-label={`Duplicate agent ${preconfig.name}`}
              title="Duplicate agent"
            >
              {duplicatingId === preconfig.id ? <Loader2 className="animate-spin" /> : <Copy />}
            </Button>
            {preconfig.isDefault ? <span className="size-6" aria-hidden /> : (
              <Button
                size="icon-xs"
                variant="ghost"
                onClick={() => setDeleteTarget(preconfig.id)}
                aria-label={`Delete agent ${preconfig.name}`}
                title="Delete agent"
              >
                <Trash2 />
              </Button>
            )}
          </SettingsRow>
        ))}
      </SettingsGroup>

      {error && <ErrorState>{error}</ErrorState>}
      {preconfigs.length === 0 && <EmptyState variant="plain">No agents yet. Add one to give sessions a role.</EmptyState>}

      <ConfirmationDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}
        title="Delete Agent"
        description="Are you sure you want to delete this agent? This cannot be undone."
        confirmLabel="Delete"
        variant="destructive"
        onConfirm={handleDelete}
        loading={deleting}
        closeOnConfirm={false}
      />

      <ConfirmationDialog
        open={demoteTarget !== null}
        onOpenChange={(open) => { if (!open) setDemoteTarget(null); }}
        title="Remove personal files"
        description="This removes the agent directory and its home workspace. Sessions created in the home workspace will be deleted. The agent definition is preserved."
        confirmLabel="Remove"
        variant="destructive"
        onConfirm={handleDemote}
        loading={demoting}
        closeOnConfirm={false}
      />
    </div>
  );
}
