import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn } from 'storybook/test';
import { ModelChip } from './ModelChip';
import type { ModelChoice, ModelGroup, ModelSelection } from '@/hooks/useSessionModelSelection';

/**
 * The model chip under the composer. One list: recent picks, one row per
 * harness that opens into its models, effort for the selected model.
 */

const claude: ModelChoice[] = [
  { harness: 'claude-cli', key: 'claude-sonnet-4-5', modelId: 'claude-sonnet-4-5', name: 'Sonnet 4.5', efforts: ['low', 'medium', 'high'], defaultEffort: 'medium' },
  { harness: 'claude-cli', key: 'claude-opus-4-1', modelId: 'claude-opus-4-1', name: 'Opus 4.1', efforts: ['minimal', 'low', 'medium', 'high', 'xhigh', 'max'], defaultEffort: 'high' },
  { harness: 'claude-cli', key: 'claude-haiku-4-5', modelId: 'claude-haiku-4-5', name: 'Haiku 4.5', efforts: ['low', 'medium', 'high'], defaultEffort: 'medium' },
];
const codex: ModelChoice[] = [
  { harness: 'codex-cli', key: 'gpt-5-codex', modelId: 'gpt-5-codex', name: 'GPT-5 Codex', efforts: ['low', 'medium', 'high'], defaultEffort: 'medium' },
  { harness: 'codex-cli', key: 'gpt-5', modelId: 'gpt-5', name: 'GPT-5', efforts: ['minimal', 'low', 'medium', 'high'], defaultEffort: 'medium' },
];
const prokop: ModelChoice[] = [
  { harness: 'prokop', key: 'anthropic:claude-3-5-sonnet', modelId: 'claude-3-5-sonnet', providerId: 'anthropic', providerName: 'Anthropic', name: 'Claude 3.5 Sonnet', efforts: ['low', 'medium', 'high'], defaultEffort: null },
  { harness: 'prokop', key: 'anthropic:claude-3-opus', modelId: 'claude-3-opus', providerId: 'anthropic', providerName: 'Anthropic', name: 'Claude 3 Opus', efforts: [], defaultEffort: null },
  { harness: 'prokop', key: 'openai:gpt-4o', modelId: 'gpt-4o', providerId: 'openai', providerName: 'OpenAI', name: 'GPT-4o', efforts: [], defaultEffort: null },
  { harness: 'prokop', key: 'google:gemini-2-flash', modelId: 'gemini-2-flash', providerId: 'google', providerName: 'Google AI', name: 'Gemini 2.0 Flash', efforts: [], defaultEffort: null },
];
const groups: ModelGroup[] = [
  { harness: 'claude-cli', label: 'Claude Code', models: claude },
  { harness: 'codex-cli', label: 'Codex', models: codex },
  { harness: 'prokop', label: 'Prokop', models: prokop },
];
const selection: ModelSelection = { ...claude[0], effort: 'medium' };

function Demo(props: Partial<React.ComponentProps<typeof ModelChip>>) {
  const [current, setCurrent] = useState<ModelSelection | null>(props.selection ?? selection);
  return (
    <div className="@container/chips w-[40rem] max-w-full">
      <ModelChip
        groups={groups}
        recent={[claude[0], codex[0]]}
        selection={current}
        onSelectModel={(choice) => { setCurrent({ ...choice, effort: choice.defaultEffort }); props.onSelectModel?.(choice); }}
        onSelectEffort={(effort) => { setCurrent((c) => c && { ...c, effort }); props.onSelectEffort?.(effort); }}
        {...props}
        {...(props.selection === undefined ? {} : {})}
      />
    </div>
  );
}

const meta = {
  title: 'Chat/ModelChip',
  component: ModelChip,
  parameters: { layout: 'centered' },
  args: { onSelectModel: fn(), onSelectEffort: fn() },
} as Meta<typeof ModelChip>;

export default meta;
type Story = StoryObj<typeof meta>;

/** A fresh session that can still switch harness: every installed harness is a row. */
export const Switchable: Story = { render: (args) => <Demo onSelectModel={args.onSelectModel} onSelectEffort={args.onSelectEffort} /> };

/** An established Claude session lists only its own harness. */
export const Established: Story = {
  render: (args) => <Demo canSwitchHarness={false} onSelectModel={args.onSelectModel} onSelectEffort={args.onSelectEffort} />,
};

/** The agent pinned this model; the chip says so and picking another overrides it. */
export const PinnedByAgent: Story = {
  render: (args) => <Demo pinnedBy="Reviewer" onSelectModel={args.onSelectModel} onSelectEffort={args.onSelectEffort} />,
};

/** The session's model is unknown to every catalog. */
export const UnknownModel: Story = {
  render: (args) => <Demo selection={null} fallbackName="retired-model" onSelectModel={args.onSelectModel} onSelectEffort={args.onSelectEffort} />,
};

export const Disabled: Story = {
  render: (args) => <Demo disabled onSelectModel={args.onSelectModel} onSelectEffort={args.onSelectEffort} />,
};

export const Phone: Story = {
  render: (args) => <Demo onSelectModel={args.onSelectModel} onSelectEffort={args.onSelectEffort} />,
  globals: { viewport: { value: 'phone' } },
};
