import type { Meta, StoryObj } from '@storybook/react-vite';
import { SettingsGroup } from './settings-group';
import { SettingsRow } from './settings-row';
import { Switch } from './switch';
import { SegmentedControl } from './segmented-control';
import { Input } from './input';

/** A labelled box of rows. The box is the only border; rows share hairlines. */

const meta = {
  title: 'Primitives/SettingsGroup',
  component: SettingsGroup,
  parameters: { layout: 'padded' },
  decorators: [(Story) => <div className="w-[36rem]"><Story /></div>],
} satisfies Meta<typeof SettingsGroup>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    label: 'Sounds',
    children: (
      <>
        <SettingsRow label="Chat completion" htmlFor="g-chat"><Switch id="g-chat" defaultChecked /></SettingsRow>
        <SettingsRow label="Approvals and questions" htmlFor="g-perm"><Switch id="g-perm" /></SettingsRow>
      </>
    ),
  },
};

export const WithDescription: Story = {
  args: {
    label: 'Workspaces',
    description: 'On this device, across servers.',
    children: (
      <SettingsRow label="Order">
        <SegmentedControl label="Order" value="newest" onChange={() => {}} options={[{ value: 'newest', label: 'Newest' }, { value: 'recent', label: 'Recent' }, { value: 'name', label: 'Name' }]} />
      </SettingsRow>
    ),
  },
};

export const Mixed: Story = {
  args: {
    label: 'Server',
    children: (
      <>
        <SettingsRow label="Name" htmlFor="g-name"><Input id="g-name" defaultValue="Production" className="sm:w-56" /></SettingsRow>
        <SettingsRow label="Port" htmlFor="g-port" description="Restart to apply."><Input id="g-port" type="number" defaultValue={8742} className="w-24" /></SettingsRow>
        <SettingsRow label="Devices" onClick={() => {}}>3 paired</SettingsRow>
      </>
    ),
  },
};

export const Unlabelled: Story = {
  args: {
    children: <SettingsRow label="Automatic updates" htmlFor="g-auto"><Switch id="g-auto" /></SettingsRow>,
  },
};
