import { useId, useState } from 'react';
import type { ProkopaiClient, ModelWithStatus } from '@prokopai/sdk';
import { useCreateModel, useUpdateModel } from '@/hooks/queries';
import { Plus, Trash2, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { SettingsRow } from '@/components/ui/settings-row';
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

interface ModelFormData {
  id: string;
  name: string;
  contextWindow: number;
  maxOutputTokens?: number;
  variants?: Record<string, { providerOptions: Record<string, unknown> }>;
  capabilities?: {
    input?: { text?: boolean; image?: boolean; video?: boolean; file?: string[] };
    structuredOutput?: { mode: 'native' | 'prompt' };
  };
}

const emptyModelForm: ModelFormData = { id: '', name: '', contextWindow: 128000, maxOutputTokens: undefined };

function updateCapabilities(
  form: ModelFormData,
  field: 'text' | 'image' | 'video',
  value: boolean,
): ModelFormData {
  const input = { ...(form.capabilities?.input) };
  input[field] = value;
  const hasInputCaps = input.text || input.image || input.video || (Array.isArray(input.file) && input.file.length > 0);
  const hasOtherCaps = !!form.capabilities?.structuredOutput;
  return {
    ...form,
    capabilities: (hasInputCaps || hasOtherCaps)
      ? { ...(hasInputCaps ? { input } : {}), ...(form.capabilities?.structuredOutput ? { structuredOutput: form.capabilities.structuredOutput } : {}) }
      : undefined,
  };
}

function updateFileTypes(form: ModelFormData, raw: string): ModelFormData {
  const file = raw.trim() ? raw.split(',').map(s => s.trim()).filter(Boolean) : undefined;
  const input = { ...form.capabilities?.input, file };
  const hasInputCaps = input.text || input.image || input.video || (Array.isArray(input.file) && input.file.length > 0);
  const hasOtherCaps = !!form.capabilities?.structuredOutput;
  return {
    ...form,
    capabilities: (hasInputCaps || hasOtherCaps) ? { ...(hasInputCaps ? { input } : {}), ...form.capabilities?.structuredOutput ? { structuredOutput: form.capabilities.structuredOutput } : {} } : undefined,
  };
}

function updateStructuredOutputMode(form: ModelFormData, mode: 'native' | 'prompt' | 'none'): ModelFormData {
  const input = form.capabilities?.input;
  const hasInputCaps = input && (input.text || input.image || input.video || (Array.isArray(input.file) && input.file.length > 0));
  if (mode === 'none') {
    return {
      ...form,
      capabilities: hasInputCaps ? { input } : undefined,
    };
  }
  return {
    ...form,
    capabilities: {
      ...(hasInputCaps ? { input } : {}),
      structuredOutput: { mode },
    },
  };
}

interface ModelEditorFormProps {
  sdkClient: ProkopaiClient | null;
  providerId: string;
  providerName: string;
  /** null creates a new model. */
  model: ModelWithStatus | null;
  onDone: () => void;
}

/**
 * Create or edit one model: rows inside the provider's group, with Cancel and
 * Save in the last row.
 */
export function ModelEditorForm({ sdkClient, providerId, providerName, model, onDone }: ModelEditorFormProps) {
  const id = useId();
  const createModelMut = useCreateModel(sdkClient);
  const updateModelMut = useUpdateModel(sdkClient);
  const [form, setForm] = useState<ModelFormData>(model ? {
    id: model.id,
    name: model.name,
    contextWindow: model.contextWindow,
    maxOutputTokens: model.maxOutputTokens,
    variants: model.variants,
    capabilities: model.capabilities,
  } : emptyModelForm);
  const [variantJsonErrors, setVariantJsonErrors] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const addVariant = () => {
    const variants = { ...(form.variants || {}) };
    let key = 'new';
    let i = 1;
    while (variants[key]) {
      key = `new-${i++}`;
    }
    variants[key] = { providerOptions: {} };
    setForm(prev => ({ ...prev, variants }));
  };

  const removeVariant = (key: string) => {
    const variants = { ...(form.variants || {}) };
    delete variants[key];
    setForm(prev => ({
      ...prev,
      variants: Object.keys(variants).length > 0 ? variants : undefined,
    }));
  };

  const renameVariant = (oldKey: string, newKey: string) => {
    if (oldKey === newKey) return;
    const variants = { ...(form.variants || {}) };
    if (variants[newKey] && newKey !== oldKey) return;
    const entry = variants[oldKey];
    delete variants[oldKey];
    variants[newKey] = entry;
    setForm(prev => ({ ...prev, variants: Object.keys(variants).length > 0 ? variants : undefined }));
  };

  const updateVariantJson = (key: string, raw: string) => {
    try {
      const parsed = JSON.parse(raw);
      if (typeof parsed !== 'object' || Array.isArray(parsed)) {
        setVariantJsonErrors(prev => ({ ...prev, [key]: true }));
        return;
      }
      const variants = { ...(form.variants || {}) };
      variants[key] = { providerOptions: parsed };
      setForm(prev => ({ ...prev, variants }));
      setVariantJsonErrors(prev => ({ ...prev, [key]: false }));
    } catch {
      setVariantJsonErrors(prev => ({ ...prev, [key]: true }));
    }
  };

  const handleSave = async () => {
    if (!form.id.trim() || !form.name.trim()) return;
    setSaving(true);
    setError(null);
    try {
      if (!model) {
        await createModelMut.mutateAsync({
          providerId,
          body: {
            id: form.id.trim(),
            name: form.name.trim(),
            contextWindow: form.contextWindow,
            maxOutputTokens: form.maxOutputTokens,
            variants: form.variants,
            capabilities: form.capabilities,
          },
        });
      } else {
        await updateModelMut.mutateAsync({
          providerId,
          modelId: model.id,
          body: {
            name: form.name.trim(),
            contextWindow: form.contextWindow,
            maxOutputTokens: form.maxOutputTokens,
            variants: form.variants,
            capabilities: form.capabilities,
          },
        });
      }
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save model');
    } finally {
      setSaving(false);
    }
  };

  const capability = (field: 'text' | 'image' | 'video', label: string) => (
    <SettingsRow className="pl-6" label={label} htmlFor={`${id}-${field}`}>
      <Switch
        id={`${id}-${field}`}
        checked={form.capabilities?.input?.[field] ?? false}
        onCheckedChange={(checked) => setForm(prev => updateCapabilities(prev, field, checked))}
      />
    </SettingsRow>
  );

  return (
    <>
      <SettingsRow label={<span className="font-medium">{model ? `Edit ${model.name}` : `New model for ${providerName || providerId}`}</span>} />
      <SettingsRow className="pl-6" label="Model ID" htmlFor={`${id}-id`} description={model ? 'The ID cannot be changed.' : undefined}>
        <Input
          id={`${id}-id`}
          value={form.id}
          onChange={(e) => setForm(prev => ({ ...prev, id: e.target.value }))}
          disabled={!!model}
          placeholder="e.g., glm-5.3"
          className="font-mono sm:w-64"
        />
      </SettingsRow>
      <SettingsRow className="pl-6" label="Display name" htmlFor={`${id}-name`}>
        <Input
          id={`${id}-name`}
          value={form.name}
          onChange={(e) => setForm(prev => ({ ...prev, name: e.target.value }))}
          placeholder="e.g., GLM-5.3"
          className="sm:w-64"
        />
      </SettingsRow>
      <SettingsRow className="pl-6" label="Context window" htmlFor={`${id}-context`}>
        <Input
          id={`${id}-context`}
          type="number"
          value={form.contextWindow}
          onChange={(e) => setForm(prev => ({ ...prev, contextWindow: parseInt(e.target.value) || 0 }))}
          min={1}
          className="w-32"
        />
      </SettingsRow>
      <SettingsRow className="pl-6" label="Max output tokens" htmlFor={`${id}-max`}>
        <Input
          id={`${id}-max`}
          type="number"
          value={form.maxOutputTokens ?? ''}
          onChange={(e) => setForm(prev => ({
            ...prev,
            maxOutputTokens: e.target.value ? parseInt(e.target.value) : undefined,
          }))}
          min={1}
          placeholder="Optional"
          className="w-32"
        />
      </SettingsRow>
      {capability('text', 'Text input')}
      {capability('image', 'Image input')}
      {capability('video', 'Video input')}
      <SettingsRow className="pl-6" label="File types" description="MIME types, comma separated." htmlFor={`${id}-files`}>
        <Input
          id={`${id}-files`}
          value={form.capabilities?.input?.file?.join(', ') ?? ''}
          onChange={(e) => setForm(prev => updateFileTypes(prev, e.target.value))}
          placeholder="application/pdf, text/csv"
          className="font-mono text-xs sm:w-64"
        />
      </SettingsRow>
      <SettingsRow className="pl-6" label="Structured output" description="Prompt-based for providers that strip JSON schema (GLM, MiniMax). Native works for OpenAI-compatible APIs.">
        <Select
          value={form.capabilities?.structuredOutput?.mode ?? 'none'}
          onValueChange={(mode) => setForm(prev => updateStructuredOutputMode(prev, mode as 'native' | 'prompt' | 'none'))}
        >
          <SelectTrigger aria-label="Structured Output">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectItem value="none">Default (native)</SelectItem>
              <SelectItem value="native">Native (json_schema)</SelectItem>
              <SelectItem value="prompt">Prompt-based (schema in system prompt)</SelectItem>
            </SelectGroup>
          </SelectContent>
        </Select>
      </SettingsRow>
      <SettingsRow className="pl-6" label="Variants" description={form.variants && Object.keys(form.variants).length > 0 ? undefined : 'No variants configured.'}>
        <Button type="button" variant="outline" size="xs" onClick={addVariant}>
          <Plus data-icon="inline-start" />
          Add variant
        </Button>
      </SettingsRow>
      {form.variants && Object.entries(form.variants).map(([key, variant]) => (
        <SettingsRow key={key} className="pl-6" stacked label={
          <span className="flex items-center gap-2">
            <Input
              value={key}
              onChange={(e) => renameVariant(key, e.target.value)}
              placeholder="variant name"
              aria-label="Variant name"
              className="h-6 w-32 font-mono text-xs"
            />
            <Button type="button" size="icon-xs" variant="ghost" aria-label={`Remove variant ${key}`} onClick={() => removeVariant(key)}>
              <Trash2 />
            </Button>
          </span>
        }>
          <div className="flex w-full flex-col gap-1">
            <Textarea
              value={JSON.stringify(variant.providerOptions, null, 2)}
              onChange={(e) => updateVariantJson(key, e.target.value)}
              placeholder="{}"
              aria-label={`Provider options for ${key}`}
              className="min-h-16 font-mono text-xs"
              rows={3}
            />
            {variantJsonErrors[key] && (
              <p className="text-xs text-error">Invalid JSON</p>
            )}
          </div>
        </SettingsRow>
      ))}
      {error && <SettingsRow className="pl-6" label={<span className="text-xs text-error">{error}</span>} />}
      <SettingsRow className="pl-6" label={<span className="text-xs text-muted-foreground">{model ? 'Changes apply to new sessions.' : 'The model joins this provider in the catalog.'}</span>}>
        <span className="flex items-center gap-1">
          <Button variant="ghost" onClick={onDone}>Cancel</Button>
          <Button
            onClick={handleSave}
            disabled={saving || !form.id.trim() || !form.name.trim() || Object.values(variantJsonErrors).some(Boolean)}
          >
            {saving && <Loader2 className="animate-spin" data-icon="inline-start" />}
            Save
          </Button>
        </span>
      </SettingsRow>
    </>
  );
}
