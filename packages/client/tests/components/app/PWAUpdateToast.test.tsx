import { act, render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const toastMock = vi.hoisted(() => Object.assign(vi.fn(), { dismiss: vi.fn() }));
vi.mock('sonner', () => ({ toast: toastMock }));

import { PWAUpdateToast, PWA_UPDATE_TOAST_ID } from '@/components/app/PWAUpdateToast';
import { usePWAUpdateStore } from '@/pwa/updateStore';

type ToastOptions = {
  action: { label: string; onClick: (event: { preventDefault: () => void }) => void };
  cancel?: { label: string; onClick: () => void };
  dismissible: boolean;
  onDismiss: () => void;
};

function lastToast(): { message: string; options: ToastOptions } {
  const call = toastMock.mock.calls.at(-1);
  if (!call) throw new Error('no toast raised');
  return { message: call[0] as string, options: call[1] as ToastOptions };
}

beforeEach(() => {
  toastMock.mockClear();
  toastMock.dismiss.mockClear();
  usePWAUpdateStore.setState({
    needRefresh: false,
    offlineReady: false,
    dismissed: false,
    isUpdating: false,
    serviceWorkerUpdater: null,
  });
});

describe('PWAUpdateToast', () => {
  it('raises one persistent toast when an update is ready and can be deferred until the next foreground check', () => {
    render(<PWAUpdateToast />);
    expect(toastMock).not.toHaveBeenCalled();

    act(() => usePWAUpdateStore.getState().markNeedRefresh());
    const { message, options } = lastToast();
    expect(message).toBe('Prokop update ready');
    expect(options).toMatchObject({ id: PWA_UPDATE_TOAST_ID, duration: Infinity, dismissible: true });
    expect(options.cancel?.label).toBe('Later');

    act(() => options.cancel!.onClick());
    expect(toastMock.dismiss).toHaveBeenCalledWith(PWA_UPDATE_TOAST_ID);

    toastMock.mockClear();
    act(() => usePWAUpdateStore.getState().showOnForeground());
    expect(lastToast().message).toBe('Prokop update ready');
  });

  it('closing the toast defers the update like Later does', () => {
    usePWAUpdateStore.getState().markNeedRefresh();
    render(<PWAUpdateToast />);
    act(() => lastToast().options.onDismiss());
    expect(usePWAUpdateStore.getState().dismissed).toBe(true);
  });

  it('restarts once and keeps the toast open without a way to defer while activation runs', () => {
    const updater = vi.fn().mockResolvedValue(undefined);
    usePWAUpdateStore.getState().setServiceWorkerUpdater(updater);
    usePWAUpdateStore.getState().markNeedRefresh();
    render(<PWAUpdateToast />);

    const event = { preventDefault: vi.fn() };
    act(() => lastToast().options.action.onClick(event));
    act(() => lastToast().options.action.onClick(event));

    expect(event.preventDefault).toHaveBeenCalled();
    expect(updater).toHaveBeenCalledTimes(1);
    expect(updater).toHaveBeenCalledWith(true);
    const { options } = lastToast();
    expect(options.action.label).toBe('Restarting…');
    expect(options.cancel).toBeUndefined();
    expect(options.dismissible).toBe(false);
  });
});
