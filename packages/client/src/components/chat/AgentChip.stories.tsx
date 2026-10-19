import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn } from 'storybook/test';
import type { Preconfig } from '@prokopai/sdk';
import { AgentChip } from './AgentChip';
import { createPreconfig } from '../../../.storybook/mocks/mockPreconfig';

/** The agent chip under the composer: one searchable list with descriptions and pinned models. */

const preconfigs: Preconfig[] = [
  createPreconfig({ id: 'default', name: 'Default agent', description: 'General coding, all tools', isDefault: true }),
  createPreconfig({ id: 'reviewer', name: 'Reviewer', description: 'Read-only review', model: 'claude-3-opus', provider: 'anthropic', variant: 'high' }),
  createPreconfig({ id: 'planner', name: 'Planner', description: 'Writes plans in docs/plans' }),
  createPreconfig({ id: 'subagent', name: 'Explorer', description: 'Only spawned by others', mode: 'subagent' }),
];

function Demo(props: Partial<React.ComponentProps<typeof AgentChip>>) {
  const [selected, setSelected] = useState<string | null>(props.selectedId ?? 'default');
  return (
    <div className="@container/chips w-[40rem] max-w-full">
      <AgentChip
        preconfigs={preconfigs.filter((p) => p.mode !== 'subagent')}
        agentIds={['reviewer']}
        pinnedModelName={(p) => (p.model === 'claude-3-opus' ? 'Claude 3 Opus' : p.model)}
        onSelect={(id) => { setSelected(id); props.onSelect?.(id); }}
        {...props}
        selectedId={props.selectedId ?? selected}
      />
    </div>
  );
}

const meta = {
  title: 'Chat/AgentChip',
  component: AgentChip,
  parameters: { layout: 'centered' },
  args: { onSelect: fn() },
} as Meta<typeof AgentChip>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = { render: (args) => <Demo onSelect={args.onSelect} /> };

/** A promoted agent is selected: the chip takes the highlight tint. */
export const PromotedAgent: Story = { render: (args) => <Demo selectedId="reviewer" onSelect={args.onSelect} /> };

/** An agent-home workspace: the chip shows its agent with a lock and explains why. */
export const Locked: Story = { render: (args) => <Demo selectedId="reviewer" locked onSelect={args.onSelect} /> };

export const Disabled: Story = { render: (args) => <Demo disabled onSelect={args.onSelect} /> };

export const Phone: Story = {
  render: (args) => <Demo onSelect={args.onSelect} />,
  globals: { viewport: { value: 'phone' } },
};
