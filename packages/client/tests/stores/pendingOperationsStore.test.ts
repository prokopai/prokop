import { beforeEach, describe, expect, test, vi } from 'vitest';

const { mockToastError } = vi.hoisted(() => ({
  mockToastError: vi.fn(),
}));

vi.mock('sonner', () => ({
  toast: { error: mockToastError },
}));

import { usePendingOperationsStore } from '@/stores/pendingOperationsStore';

describe('pendingOperationsStore', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    usePendingOperationsStore.setState({ operations: [] });
    mockToastError.mockClear();
  });

  test('times out an operation when the server does not acknowledge it', () => {
    vi.spyOn(Date, 'now').mockReturnValue(100_000);
    usePendingOperationsStore.getState().startOperation({
      type: 'fork',
      sessionId: 'session-1',
      startedAt: 39_999,
    });

    usePendingOperationsStore.getState().cleanupStaleOperations();

    expect(mockToastError).toHaveBeenCalledWith('Fork timed out', {
      description: 'The server did not respond in time.',
    });
    expect(usePendingOperationsStore.getState().operations).toEqual([]);
  });

  test('gives an unacknowledged compaction a longer window than other operations', () => {
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(100_000);
    usePendingOperationsStore.getState().startOperation({
      type: 'compact',
      sessionId: 'session-1',
      startedAt: 0,
    });

    usePendingOperationsStore.getState().cleanupStaleOperations();
    expect(mockToastError).not.toHaveBeenCalled();
    expect(usePendingOperationsStore.getState().operations).toHaveLength(1);

    nowSpy.mockReturnValue(150_001);
    usePendingOperationsStore.getState().cleanupStaleOperations();
    expect(mockToastError).toHaveBeenCalledWith('Compact timed out', {
      description: 'The server did not respond in time.',
    });
    expect(usePendingOperationsStore.getState().operations).toEqual([]);
  });

  test('keeps an acknowledged compaction pending after 60 seconds', () => {
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(40_000);
    usePendingOperationsStore.getState().startOperation({
      type: 'compact',
      sessionId: 'session-1',
      startedAt: 0,
    });
    usePendingOperationsStore.getState().acknowledgeOperation('session-1', 'compact');

    nowSpy.mockReturnValue(100_000);
    usePendingOperationsStore.getState().cleanupStaleOperations();

    expect(mockToastError).not.toHaveBeenCalled();
    expect(usePendingOperationsStore.getState().operations).toEqual([
      expect.objectContaining({
        type: 'compact',
        sessionId: 'session-1',
        acknowledgedAt: 40_000,
      }),
    ]);
  });
});
