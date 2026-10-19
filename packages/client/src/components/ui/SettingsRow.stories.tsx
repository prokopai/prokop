import type { Meta, StoryObj } from '@storybook/react-vite';
import { SettingsRow, FormGrid } from './settings-row';
import { Switch } from './switch';
import { Input } from './input';
import { Textarea } from './textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './select';
import { Button } from './button';

/**
 * Label left, control right, 36px. On phones the control drops under the
 * label. `FormGrid` stacks rows for a dialog without the group box.
 */

const meta = {
  title: 'Primitives/SettingsRow',
  component: SettingsRow,
  parameters: { layout: 'padded' },
  decorators: [(Story) => <div className="w-[36rem] rounded-lg border border-border/50"><Story /></div>],
} satisfies Meta<typeof SettingsRow>;

export default meta;
type Story = StoryObj<typeof meta>;

export const WithSwitch: Story = {
  args: { label: 'Send notifications', htmlFor: 'r-switch', children: <Switch id="r-switch" defaultChecked /> },
};

export const WithDescription: Story = {
  args: {
    label: 'Permission mode',
    description: 'Use workspace default inherits from workspace settings.',
    children: (
      <Select defaultValue="default">
        <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="default">Use workspace default</SelectItem>
          <SelectItem value="auto">Auto approve</SelectItem>
        </SelectContent>
      </Select>
    ),
  },
};

export const Stacked: Story = {
  args: { label: 'Prompt', htmlFor: 'r-prompt', stacked: true, children: <Textarea id="r-prompt" placeholder="Check the build status and summarize any failures" /> },
};

export const Opens: Story = {
  args: { label: 'Keybinds', onClick: () => {}, children: '12 custom' },
};

export const LabelOnly: Story = {
  args: { label: 'Push notifications', description: 'System notifications require HTTPS.' },
};

export const Phone: Story = {
  args: { label: 'Name', htmlFor: 'r-name', children: <Input id="r-name" placeholder="Daily summary" /> },
  globals: { viewport: { value: 'phone' } },
};

export const Form: Story = {
  args: { label: 'unused' },
  render: () => (
    <div className="p-4">
      <FormGrid>
        <SettingsRow label="Name" htmlFor="f-name"><Input id="f-name" placeholder="Daily summary" className="sm:w-64" /></SettingsRow>
        <SettingsRow label="Prompt" htmlFor="f-prompt" stacked><Textarea id="f-prompt" placeholder="Check the build status and summarize any failures" /></SettingsRow>
        <SettingsRow label="Run every" htmlFor="f-every"><span className="flex items-center gap-2 text-sm"><Input id="f-every" type="number" defaultValue={120} className="w-20" /> minutes</span></SettingsRow>
        <SettingsRow label="Reuse session" htmlFor="f-reuse"><Switch id="f-reuse" /></SettingsRow>
      </FormGrid>
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="ghost">Cancel</Button>
        <Button size="lg">Create job</Button>
      </div>
    </div>
  ),
};
