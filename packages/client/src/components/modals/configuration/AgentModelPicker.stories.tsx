import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn } from 'storybook/test';
import { AgentModelPicker, type AgentModelSelection } from './AgentModelPicker';
import { createModelList } from '../../../../.storybook/mocks/mockProvider';

/**
 * Model selection for an agent: Prokop catalog models, plus the Codex and
 * Claude CLI catalogs with their effort levels when those harnesses exist.
 */

const models = createModelList();
const codexModels = [
  { model: 'gpt-5-codex', name: 'GPT-5 Codex', supportedEfforts: ['low', 'medium', 'high'], defaultEffort: 'medium', isDefault: true },
  { model: 'gpt-5', name: 'GPT-5', supportedEfforts: ['minimal', 'low', 'medium', 'high'], defaultEffort: 'medium', isDefault: false },
];
const claudeModels = [
  { model: 'claude-sonnet-4-5', name: 'Sonnet 4.5', supportedEfforts: ['low', 'medium', 'high'], defaultEffort: 'medium', isDefault: true },
  { model: 'claude-opus-4-1', name: 'Opus 4.1', supportedEfforts: ['low', 'medium', 'high', 'max'], defaultEffort: 'high', isDefault: false },
];

interface Args { initial: AgentModelSelection; codex: boolean; claude: boolean; defaultLabel?: string; onChange: (next: AgentModelSelection) => void }

function Harness({ initial, codex, claude, defaultLabel, onChange }: Args) {
  const [value, setValue] = useState(initial);
  return (
    <div className="flex w-[30rem] flex-col gap-3">
      <AgentModelPicker models={models} codexModels={codex ? codexModels : []} claudeModels={claude ? claudeModels : []} value={value} onChange={(next) => { setValue(next); onChange(next); }} defaultLabel={defaultLabel} />
      <pre className="rounded-md bg-muted/40 p-2 font-mono text-2xs text-muted-foreground">{JSON.stringify(value)}</pre>
    </div>
  );
}

const meta = {
  title: 'Settings/AgentModelPicker',
  parameters: { layout: 'centered' },
  args: { initial: { model: '', provider: '', variant: '', modelHarness: '' }, codex: true, claude: true, onChange: fn() },
  render: (args) => <Harness {...args} />,
} satisfies Meta<Args>;

export default meta;
type Story = StoryObj<Args>;

export const ServerDefault: Story = {};

export const ProkopModel: Story = {
  args: { initial: { model: models[1]?.id ?? '', provider: models[1]?.providerId ?? '', variant: 'high', modelHarness: 'prokop' } },
};

export const ClaudeModel: Story = {
  args: { initial: { model: 'claude-opus-4-1', provider: '', variant: 'max', modelHarness: 'claude-cli' } },
};

export const CodexModel: Story = {
  args: { initial: { model: 'gpt-5-codex', provider: '', variant: 'high', modelHarness: 'codex-cli' } },
};

export const NoCliCatalogs: Story = {
  args: { codex: false, claude: false },
};

export const LearningLabel: Story = {
  args: { defaultLabel: 'Use agent default' },
};

export const Phone: Story = {
  globals: { viewport: { value: 'phone' } },
};
