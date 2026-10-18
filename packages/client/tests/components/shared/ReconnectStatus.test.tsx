import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

const toastMock = vi.hoisted(() => Object.assign(vi.fn(), { dismiss: vi.fn() }));
vi.mock('sonner', () => ({ toast: toastMock }));

import { ReconnectStatus, RECONNECT_TOAST_ID } from '@/components/shell/ReconnectStatus';
import { useConnectionStore } from '@/stores/connectionStore';

type ToastOptions = { id: string; action: { label: string; onClick: (event: { preventDefault: () => void }) => void } };

function lastToast(): { message: string; options: ToastOptions } {
  const call = toastMock.mock.calls.at(-1);
  if (!call) throw new Error('no toast raised');
  return { message: call[0] as string, options: call[1] as ToastOptions };
}

beforeEach(() => {
  vi.useFakeTimers();
  toastMock.mockClear();
  toastMock.dismiss.mockClear();
  useConnectionStore.setState({ foregroundRecovery: false });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const props = { authError: null, nextRetryIn: 0, onRetry: vi.fn() };

test('brief disconnections never raise the notice', () => {
  const view = render(<ReconnectStatus {...props} />);
  act(() => vi.advanceTimersByTime(1499));
  expect(toastMock).not.toHaveBeenCalled();
  view.unmount();
  expect(vi.getTimerCount()).toBe(0);
});

test('the notice is one persistent toast that updates in place, and the countdown does not reset the delay', () => {
  const view = render(<ReconnectStatus {...props} />);
  act(() => vi.advanceTimersByTime(1000));
  view.rerender(<ReconnectStatus {...props} nextRetryIn={2} />);
  act(() => vi.advanceTimersByTime(500));
  expect(lastToast().message).toBe('Reconnecting in 2s...');
  expect(lastToast().options).toMatchObject({ id: RECONNECT_TOAST_ID, duration: Infinity, dismissible: false });
  view.rerender(<ReconnectStatus {...props} />);
  expect(lastToast().message).toBe('Reconnecting...');
  expect(toastMock.mock.calls.every((call) => (call[1] as ToastOptions).id === RECONNECT_TOAST_ID)).toBe(true);
});

test('a drop found on return to the foreground shows at once', () => {
  useConnectionStore.setState({ foregroundRecovery: true });
  render(<ReconnectStatus {...props} />);
  expect(lastToast().message).toBe('Reconnecting...');
});

test('server switch removes the previous notice and restarts the reveal delay', () => {
  const view = render(<ReconnectStatus key="a" {...props} />);
  act(() => vi.advanceTimersByTime(1500));
  expect(toastMock).toHaveBeenCalledTimes(1);
  view.rerender(<ReconnectStatus key="b" {...props} />);
  expect(toastMock.dismiss).toHaveBeenCalledWith(RECONNECT_TOAST_ID);
  act(() => vi.advanceTimersByTime(1499));
  expect(toastMock).toHaveBeenCalledTimes(1);
});

test('recovery removes the notice and the next disconnect has a fresh delay', () => {
  const view = render(<ReconnectStatus {...props} />);
  act(() => vi.advanceTimersByTime(1500));
  view.rerender(<></>);
  expect(toastMock.dismiss).toHaveBeenCalledWith(RECONNECT_TOAST_ID);
  toastMock.mockClear();
  view.rerender(<ReconnectStatus {...props} />);
  expect(toastMock).not.toHaveBeenCalled();
});

test('retry runs from the toast action and keeps the notice open', () => {
  const onRetry = vi.fn();
  render(<ReconnectStatus {...props} onRetry={onRetry} />);
  act(() => vi.advanceTimersByTime(1500));
  const event = { preventDefault: vi.fn() };
  lastToast().options.action.onClick(event);
  expect(onRetry).toHaveBeenCalledOnce();
  expect(event.preventDefault).toHaveBeenCalledOnce();
});
