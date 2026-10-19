import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Plus, X } from 'lucide-react';
import type { LearningCadence, LearningReviewer, Preconfig, Workspace, WorkspaceLearningSettings } from '@prokopai/sdk';
import { defaultLearningCadence } from '@prokopai/sdk';
import { useSdkClient } from '@/contexts/ServerClientContext';
import { LearningHistory } from './LearningHistory';
import { AgentModelPicker, type AgentModelSelection } from './AgentModelPicker';
import { DisclosureRow } from './DisclosureRow';
import { useServerDataStore } from '@/stores/serverDataStore';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { SettingsGroup } from '@/components/ui/settings-group';
import { SettingsRow } from '@/components/ui/settings-row';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { ErrorState } from '@/components/shared/States';
import { getWorkspaceDefaultPreconfigId } from '@/lib/workspacePreconfigs';
import { randomUUID } from '@/lib/randomId';

export interface LearningPanelProps {
  workspace: Workspace;
  preconfigs: Preconfig[];
  value: WorkspaceLearningSettings | undefined;
  allowPersonalLearning: boolean;
  onChange(value: WorkspaceLearningSettings): void;
  onPersonalLearningChange(value: boolean): void;
}

const CADENCE_FIELDS = [
  { key: 'idleMinutes', label: 'Quiet period', hint: 'Required idle time before a run.' },
  { key: 'minimumIntervalMinutes', label: 'Min interval', hint: 'Spaces runs apart.' },
  { key: 'maximumPendingMinutes', label: 'Max pending age', hint: 'Forces a run on unreviewed work.' },
] as const;

function formatMinutes(minutes: number): string {
  if (minutes % 1440 === 0) return `${minutes / 1440}d`;
  if (minutes % 60 === 0) return `${minutes / 60}h`;
  return `${minutes}m`;
}

/** Workspace learning as two groups: the switches, then one block of rows per learner. */
export function LearningPanel({ workspace, preconfigs, value, allowPersonalLearning, onChange: onSettingsChange, onPersonalLearningChange }: LearningPanelProps) {
  const client = useSdkClient();
  const [historyOpen, setHistoryOpen] = useState(false);
  const [previewPrompt, setPreviewPrompt] = useState<string | null>(null);
  const preview = useMutation({
    mutationFn: async (reviewerId: string) => {
      if (!client || !value?.enabled) throw new Error('Enable learning first');
      const result = await client.http.workspaces.previewLearning(workspace.id, value, reviewerId);
      return result.prompt;
    },
    onSuccess: prompt => setPreviewPrompt(prompt),
  });
  const onChange = (settings: WorkspaceLearningSettings) => { preview.reset(); setPreviewPrompt(null); onSettingsChange(settings); };
  const models = useServerDataStore(state => state.models);
  const initialId = getWorkspaceDefaultPreconfigId(workspace, preconfigs);

  /** A harness-pinned learner agent runs its reviews as headless turns on that
   * harness unless overridden; overrides may target any harness's models. */
  const pinnedHarness = (preconfig: Preconfig | undefined): 'codex-cli' | 'claude-cli' | null =>
    preconfig?.modelHarness === 'codex-cli' || preconfig?.modelHarness === 'claude-cli'
      ? preconfig.modelHarness
      : null;
  // Any learner can override its model to any harness, so the CLI catalogs
  // are fetched whenever reviewers exist.
  const hasReviewers = (value?.reviewers?.length ?? 0) > 0;
  const claudeCatalog = useQuery({
    queryKey: ['claude-catalog'],
    queryFn: () => client!.http.sessions.claudeCatalog(),
    enabled: !!client && hasReviewers,
    staleTime: 60_000,
    retry: false,
  });
  const codexCatalog = useQuery({
    queryKey: ['codex-catalog'],
    queryFn: () => client!.http.sessions.codexCatalog(),
    enabled: !!client && hasReviewers,
    staleTime: 60_000,
    retry: false,
  });
  const defaults = defaultLearningCadence('workspace');
  const settings: WorkspaceLearningSettings = value ?? {
    enabled: false,
    reviewers: [],
    improveSkills: workspace.settings.skills?.managementEnabled === true,
    instructions: '',
    sources: { mode: 'all' },
  };
  const createReviewer = (): LearningReviewer => ({ id: randomUUID(), preconfigId: initialId!, instructions: '', modelOverride: null, cadence: null });
  const update = (id: string, change: Partial<LearningReviewer>) =>
    onChange({ ...settings, reviewers: settings.reviewers.map(item => item.id === id ? { ...item, ...change } : item) });
  const updateCadence = (item: LearningReviewer, key: keyof LearningCadence, raw: string) => {
    const number = Number(raw);
    if (Number.isInteger(number) && number > 0 && number <= 10080) {
      update(item.id, { cadence: { ...defaults, ...item.cadence, [key]: number } });
    }
  };

  const learnerModelRows = (item: LearningReviewer) => {
    const preconfig = preconfigs.find(p => p.id === item.preconfigId);
    const pin = pinnedHarness(preconfig);
    const override = item.modelOverride;
    const effective: 'prokop' | 'codex-cli' | 'claude-cli'
      = override ? (override.harness ?? 'prokop') : (pin ?? 'prokop');
    const selection: AgentModelSelection = override
      ? {
          model: override.modelId,
          provider: override.harness ? '' : override.providerId,
          variant: override.variant ?? '',
          modelHarness: (override.harness ?? 'prokop') as AgentModelSelection['modelHarness'],
        }
      : { model: '', provider: '', variant: '', modelHarness: '' };
    const catalogModels = pin === 'codex-cli' ? codexCatalog.data?.models : claudeCatalog.data?.models;
    const agentDefault = pin
      ? `${pin === 'codex-cli' ? 'Codex CLI' : 'Claude CLI'} · ${catalogModels?.find(m => m.model === preconfig?.model)?.name ?? preconfig?.model ?? 'agent-pinned model'}`
      : models.find(m => m.id === preconfig?.model && m.providerId === preconfig?.provider)?.name
        ?? preconfig?.model ?? null;
    return (
      <>
        <SettingsRow className="pl-6" label="Model" description={!override && agentDefault ? `Agent default: ${agentDefault}` : undefined}>
          <div className="w-full sm:w-72">
            <AgentModelPicker
              models={models}
              codexModels={codexCatalog.data?.models ?? []}
              claudeModels={claudeCatalog.data?.models ?? []}
              value={selection}
              onChange={next => update(item.id, {
                modelOverride: next.modelHarness === '' ? null : {
                  providerId: next.modelHarness === 'prokop' ? next.provider : '',
                  modelId: next.model,
                  variant: next.variant || null,
                  ...(next.modelHarness !== 'prokop' ? { harness: next.modelHarness } : {}),
                },
              })}
              defaultLabel="Use agent default"
            />
          </div>
        </SettingsRow>
        {effective !== 'prokop' && (
          <SettingsRow className="pl-6" label={<span className="text-xs text-muted-foreground">Reviews run on {effective === 'codex-cli' ? 'Codex CLI' : 'Claude CLI'} with this model. Harness reviews can't be undone from history.</span>} />
        )}
      </>
    );
  };

  /** Focus and timing are rare tuning: collapsed by default, with the custom value recapped on the trigger. */
  const learnerTuning = (item: LearningReviewer) => {
    const cadence = { ...defaults, ...item.cadence };
    const timingSummary = CADENCE_FIELDS.map(field => formatMinutes(cadence[field.key])).join(' · ');
    return (
      <>
        <DisclosureRow className="pl-6" label="Learning focus" summary={item.instructions.trim() || null} defaultOpen={false}>
          <SettingsRow className="pl-9" label="Focus" htmlFor={`focus-${item.id}`} stacked>
            <Textarea id={`focus-${item.id}`} aria-label="Learning focus" value={item.instructions} maxLength={20_000}
              placeholder="Optional focus, e.g. 'prefer updating existing notes over creating new ones'"
              onChange={event => update(item.id, { instructions: event.target.value })} />
          </SettingsRow>
        </DisclosureRow>

        <DisclosureRow className="pl-6" label="Timing" summary={timingSummary} defaultOpen={false}>
          {CADENCE_FIELDS.map(field => (
            <SettingsRow key={field.key} className="pl-9" label={field.label} htmlFor={`cadence-${field.key}-${item.id}`} description={`${field.hint} Minutes.`}>
              <Input id={`cadence-${field.key}-${item.id}`} type="number" min={1} max={10080}
                value={cadence[field.key]}
                onChange={event => updateCadence(item, field.key, event.target.value)} className="w-24" />
            </SettingsRow>
          ))}
        </DisclosureRow>
      </>
    );
  };

  return (
    <>
      <SettingsGroup label="Learning" description="Studies conversations during quiet periods and maintains shared project knowledge. Enabling also turns on Memory. The first run covers the last seven days.">
        <SettingsRow label="Automatic learning" htmlFor="learning-enabled" description={initialId ? undefined : 'Pick a default agent in General first.'}>
          <span className="flex items-center gap-2">
            <Button variant="link" size="xs" className="h-auto p-0" aria-label="Learning history" onClick={() => setHistoryOpen(true)}>
              History
            </Button>
            <Switch
              id="learning-enabled"
              checked={settings.enabled}
              disabled={!initialId}
              onCheckedChange={enabled => onChange({ ...settings, enabled, reviewers: settings.reviewers.length ? settings.reviewers : [createReviewer()] })}
            />
          </span>
        </SettingsRow>
        <SettingsRow label="Use as personal learning source" htmlFor="personal-learning" description="Agents may learn from this workspace's conversations for their personal memory.">
          <Switch id="personal-learning" checked={allowPersonalLearning} onCheckedChange={onPersonalLearningChange} />
        </SettingsRow>
        {settings.enabled && (
          <>
            <SettingsRow label="Improve skills" htmlFor="learning-skills" description="Learning may also create and refine workspace skills. Turning this on also enables skill management.">
              <Switch id="learning-skills" checked={settings.improveSkills}
                onCheckedChange={improveSkills => onChange({ ...settings, improveSkills })} />
            </SettingsRow>
            <DisclosureRow label="Shared instructions" summary={settings.instructions.trim() || null} defaultOpen={false}>
              <SettingsRow className="pl-6" label="Instructions" description="Appended to every learner's prompt." htmlFor="learning-shared-instructions" stacked>
                <Textarea id="learning-shared-instructions" aria-label="Shared instructions" value={settings.instructions} maxLength={20_000}
                  placeholder="Optional guidance applied to all learners"
                  onChange={event => onChange({ ...settings, instructions: event.target.value })} />
              </SettingsRow>
            </DisclosureRow>
          </>
        )}
      </SettingsGroup>

      {settings.enabled && (
        <SettingsGroup label="Learners" description="Each learner studies eligible conversations and writes knowledge updates.">
          {settings.reviewers.map((item, index) => {
            const preconfig = preconfigs.find(p => p.id === item.preconfigId);
            return (
              <div key={item.id} className="contents">
                <SettingsRow label={<span className="font-medium">{`Learner ${index + 1}${preconfig ? ` · ${preconfig.name}` : ''}`}</span>}>
                  <span className="flex items-center gap-1">
                    <Button variant="link" size="xs" className="h-auto p-0" disabled={preview.isPending} onClick={() => preview.mutate(item.id)}>
                      Preview prompt
                    </Button>
                    {settings.reviewers.length > 1 && (
                      <Button variant="ghost" size="icon-xs" aria-label="Remove learner"
                        onClick={() => onChange({ ...settings, reviewers: settings.reviewers.filter(other => other.id !== item.id) })}>
                        <X />
                      </Button>
                    )}
                  </span>
                </SettingsRow>
                <SettingsRow className="pl-6" label="Agent" htmlFor={`reviewer-preconfig-${item.id}`}>
                  <Select value={item.preconfigId} onValueChange={preconfigId => update(item.id, { preconfigId })}>
                    <SelectTrigger id={`reviewer-preconfig-${item.id}`} aria-label="Learner agent" className="w-full sm:w-56">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        {preconfigs.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                </SettingsRow>
                {learnerModelRows(item)}
                {learnerTuning(item)}
              </div>
            );
          })}
          <SettingsRow label={<span className="text-xs text-muted-foreground">Up to 20 learners.</span>}>
            <Button variant="outline" size="xs" disabled={!initialId || settings.reviewers.length >= 20}
              onClick={() => onChange({ ...settings, reviewers: [...settings.reviewers, createReviewer()] })}>
              <Plus data-icon="inline-start" /> Add learner
            </Button>
          </SettingsRow>
        </SettingsGroup>
      )}

      {preview.error && <ErrorState>Preview failed: {preview.error.message}</ErrorState>}

      <Dialog open={historyOpen} onOpenChange={setHistoryOpen}>
        <DialogContent className="flex flex-col overflow-hidden sm:max-w-2xl sm:max-h-[85vh]">
          <DialogHeader className="shrink-0">
            <DialogTitle>History</DialogTitle>
            <DialogDescription>Learning runs and revision-checked undo.</DialogDescription>
          </DialogHeader>
          <div className="dialog-scrollbar min-h-0 flex-1 overflow-y-auto overscroll-contain">
            <LearningHistory workspaceId={workspace.id} />
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={previewPrompt !== null} onOpenChange={open => { if (!open) setPreviewPrompt(null); }}>
        <DialogContent className="flex flex-col overflow-hidden sm:max-w-2xl sm:max-h-[85vh]">
          <DialogHeader className="shrink-0">
            <DialogTitle>Prompt preview</DialogTitle>
            <DialogDescription>The exact prompt this learning run uses.</DialogDescription>
          </DialogHeader>
          <div className="dialog-scrollbar min-h-0 flex-1 overflow-y-auto overscroll-contain">
            <pre className="whitespace-pre-wrap break-words text-xs">{previewPrompt}</pre>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
