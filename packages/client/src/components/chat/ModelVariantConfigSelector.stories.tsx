import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn } from 'storybook/test';
import { ModelVariantConfigSelector } from './ModelVariantConfigSelector';
import { createModelList } from '../../../.storybook/mocks/mockProvider';
import { createPreconfigList } from '../../../.storybook/mocks/mockPreconfig';
import { withServerDataStore } from '../../../.storybook/mocks/storeDecorators';

/**
 * Model, reasoning variant and preconfig in one control. Claude Code and
 * Codex sessions show their own catalogs with effort levels.
 */

const models = createModelList().map((m) => ({
  id: m.id,
  name: m.name,
  contextWindow: m.contextWindow,
  providerId: m.providerId,
  providerName: m.providerName,
}));
const preconfigs = createPreconfigList();

const codexModels = [
  { model: 'gpt-5-codex', name: 'GPT-5 Codex', supportedEfforts: ['low', 'medium', 'high'], defaultEffort: 'medium', isDefault: true },
  { model: 'gpt-5', name: 'GPT-5', supportedEfforts: ['minimal', 'low', 'medium', 'high'], defaultEffort: 'medium', isDefault: false },
];
const claudeModels = [
  { model: 'claude-sonnet-4-5', name: 'Sonnet 4.5', supportedEfforts: ['low', 'medium', 'high'], defaultEffort: 'medium', isDefault: true },
  { model: 'claude-opus-4-1', name: 'Opus 4.1', supportedEfforts: ['low', 'medium', 'high', 'max'], defaultEffort: 'high', isDefault: false },
];

const meta = {
  title: 'Chat/ModelVariantConfigSelector',
  component: ModelVariantConfigSelector,
  parameters: { layout: 'centered' },
  decorators: [withServerDataStore()],
  args: {
    models,
    selectedModelId: models[0]?.id,
    selectedProviderId: models[0]?.providerId,
    onChangeModel: fn(),
    variants: { low: { providerOptions: {} }, medium: { providerOptions: {} }, high: { providerOptions: {} } },
    selectedVariant: 'medium',
    onChangeVariant: fn(),
    preconfigs,
    selectedPreconfigId: preconfigs[0]?.id,
    onChangePreconfig: fn(),
    onChangeClaude: fn(),
    onChangeCodex: fn(),
  },
} satisfies Meta<typeof ModelVariantConfigSelector>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const NoVariants: Story = {
  args: { variants: undefined, selectedVariant: null },
};

export const Compact: Story = {
  args: { compact: true },
};

export const IconOnly: Story = {
  args: { iconOnly: true },
};

export const PreconfigLocked: Story = {
  args: { lockPreconfig: true },
};

export const Disabled: Story = {
  args: { disabled: true },
};

export const UnknownModel: Story = {
  args: { selectedModelId: 'retired-model', fallbackModelName: 'retired-model (no longer available)' },
};

export const ClaudeSession: Story = {
  args: { claudeSession: true, claudeModels, claudeSelectedModel: 'claude-sonnet-4-5', claudeEffort: 'medium' },
};

export const CodexSession: Story = {
  args: { codexSession: true, codexModels, codexSelectedModel: 'gpt-5-codex', codexEffort: 'high' },
};

export const Phone: Story = {
  globals: { viewport: { value: 'phone' } },
};
