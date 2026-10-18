import type { Meta, StoryObj } from '@storybook/react-vite';
import { SuccessIndicator } from './SuccessIndicator';

const meta = {
  title: 'Visualizations/SuccessIndicator',
  component: SuccessIndicator,
  parameters: { layout: 'padded' },
} satisfies Meta<typeof SuccessIndicator>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const WithMessage: Story = {
  args: { message: 'Wrote 3 files to src/generated' },
};

export const LongMessage: Story = {
  args: { message: 'Installed 412 packages in 18.2s; 3 packages are looking for funding; run `npm fund` for details; audited 413 packages, found 0 vulnerabilities' },
};
