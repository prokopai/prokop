import type { ComponentType } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { PWAUpdateToast } from './PWAUpdateToast';
import { ThemedToaster } from '@/components/providers/ThemedToaster';
import { usePWAUpdateStore } from '@/pwa/updateStore';

/** The "update ready" notice once a new service worker is waiting. It is a toast like every other notice the app raises on its own. */

function withUpdate(state: { needRefresh: boolean; dismissed?: boolean; isUpdating?: boolean }) {
  return function UpdateDecorator(Story: ComponentType) {
    usePWAUpdateStore.setState({ dismissed: false, isUpdating: false, ...state, updateServiceWorker: async () => { usePWAUpdateStore.setState({ isUpdating: true }); } } as never);
    return <Story />;
  };
}

const meta = {
  title: 'Shell/PWAUpdateToast',
  component: PWAUpdateToast,
  parameters: { layout: 'fullscreen', smoke: 'skip: sonner measures toast heights in a real browser' },
  // The toaster mounts first so it is subscribed when the notice fires.
  decorators: [(Story) => <div className="h-screen bg-background"><ThemedToaster /><Story /></div>],
} satisfies Meta<typeof PWAUpdateToast>;

export default meta;
type Story = StoryObj<typeof meta>;

export const UpdateReady: Story = { decorators: [withUpdate({ needRefresh: true })] };
export const Restarting: Story = { decorators: [withUpdate({ needRefresh: true, isUpdating: true })] };
export const Dismissed: Story = { decorators: [withUpdate({ needRefresh: true, dismissed: true })] };
export const NoUpdate: Story = { decorators: [withUpdate({ needRefresh: false })] };
export const Phone: Story = { decorators: [withUpdate({ needRefresh: true })], globals: { viewport: { value: 'phone' } } };
