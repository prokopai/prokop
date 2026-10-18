import type { ComponentType } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { KeybindsPanel } from './KeybindsPanel';
import { useKeybindingStore } from '@/stores/keybindingStore';

/** Every app shortcut with its default and override; click one to record a new binding. */

function withOverrides(overrides: Record<string, string>) {
  return function OverridesDecorator(Story: ComponentType) {
    useKeybindingStore.setState({ overrides } as never);
    return <Story />;
  };
}

const meta = {
  title: 'Settings/KeybindsPanel',
  component: KeybindsPanel,
  parameters: { layout: 'padded' },
  decorators: [(Story) => <div className="h-[36rem] w-[36rem] overflow-auto rounded-xl border bg-background"><Story /></div>],
} satisfies Meta<typeof KeybindsPanel>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Defaults: Story = {
  decorators: [withOverrides({})],
};

export const WithOverrides: Story = {
  decorators: [withOverrides({ 'session.new': 'mod+shift+n', 'dock.toggleLeft': 'mod+1' })],
};
