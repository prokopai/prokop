import type { ComponentType } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { PWAUpdateBanner } from './PWAUpdateBanner';
import { usePWAUpdateStore } from '@/pwa/updateStore';

/** The "update ready" banner over the app once a new service worker is waiting. */

function withUpdate(state: { needRefresh: boolean; dismissed?: boolean; isUpdating?: boolean }) {
  return function UpdateDecorator(Story: ComponentType) {
    usePWAUpdateStore.setState({ dismissed: false, isUpdating: false, ...state, updateServiceWorker: async () => { usePWAUpdateStore.setState({ isUpdating: true }); } } as never);
    return <Story />;
  };
}

const meta = {
  title: 'Shell/PWAUpdateBanner',
  component: PWAUpdateBanner,
  parameters: { layout: 'fullscreen' },
  decorators: [(Story) => <div className="h-screen bg-background"><Story /></div>],
} satisfies Meta<typeof PWAUpdateBanner>;

export default meta;
type Story = StoryObj<typeof meta>;

export const UpdateReady: Story = { decorators: [withUpdate({ needRefresh: true })] };
export const Restarting: Story = { decorators: [withUpdate({ needRefresh: true, isUpdating: true })] };
export const Dismissed: Story = { decorators: [withUpdate({ needRefresh: true, dismissed: true })] };
export const NoUpdate: Story = { decorators: [withUpdate({ needRefresh: false })] };
export const Phone: Story = { decorators: [withUpdate({ needRefresh: true })], globals: { viewport: { value: 'phone' } } };
