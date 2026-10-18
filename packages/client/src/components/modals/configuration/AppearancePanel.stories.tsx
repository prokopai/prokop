import type { Meta, StoryObj } from '@storybook/react-vite';
import { AppearancePanel } from './AppearancePanel';
import { ThemeProvider } from '@/components/providers/ThemeProvider';
import { withUIStore } from '../../../../.storybook/mocks/storeDecorators';

/**
 * Theme mode and scheme, file open mode and follow-up mode. Changing the
 * theme here changes the whole Storybook document, same as in the app.
 */

const meta = {
  title: 'Settings/AppearancePanel',
  component: AppearancePanel,
  parameters: { layout: 'padded' },
  decorators: [withUIStore(), (Story) => <ThemeProvider storageKey="storybook-theme"><div className="w-[36rem] rounded-xl border bg-background"><Story /></div></ThemeProvider>],
} satisfies Meta<typeof AppearancePanel>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Phone: Story = {
  globals: { viewport: { value: 'phone' } },
};
