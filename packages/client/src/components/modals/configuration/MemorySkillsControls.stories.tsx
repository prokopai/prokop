import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn } from 'storybook/test';
import { MemorySkillsControls } from './MemorySkillsControls';

/** Memory and skills toggles, worded per scope (workspace or agent home). */

const meta = {
  title: 'Settings/MemorySkillsControls',
  component: MemorySkillsControls,
  parameters: { layout: 'padded' },
  args: { scope: 'workspace', memoryEnabled: true, skillsEnabled: false, onChangeMemory: fn(), onChangeSkills: fn() },
  decorators: [(Story) => <div className="w-[32rem]"><Story /></div>],
} satisfies Meta<typeof MemorySkillsControls>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Workspace: Story = {};
export const AgentHome: Story = { args: { scope: 'agent', memoryEnabled: true, skillsEnabled: true } };
export const AllOff: Story = { args: { memoryEnabled: false, skillsEnabled: false } };
