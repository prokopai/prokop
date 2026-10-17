import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { useMobileSessionSelection } from '@/hooks/useMobileSessionSelection';
import { useWorkspaceViewStore } from '@/stores/workspaceViewStore';

const mocks = vi.hoisted(() => ({
  isMobile: true,
}));

vi.mock('@/hooks/use-mobile', () => ({
  useIsMobile: () => mocks.isMobile,
}));

describe('useMobileSessionSelection', () => {
  beforeEach(() => {
    mocks.isMobile = true;
    useWorkspaceViewStore.setState({ mobileSurface: 'sessions' });
  });

  test('keeps phone selection in the workspace shell and returns to Chat', () => {
    const resumeSession = vi.fn();
    const { result } = renderHook(() => useMobileSessionSelection(resumeSession));

    act(() => result.current('session-1', { targetMessageId: 'message-1' }));

    expect(resumeSession).toHaveBeenCalledWith('session-1', {
      targetMessageId: 'message-1',
      skipNavigation: true,
    });
    expect(useWorkspaceViewStore.getState().mobileSurface).toBe('chat');
  });

  test('preserves desktop navigation options', () => {
    mocks.isMobile = false;
    const resumeSession = vi.fn();
    const { result } = renderHook(() => useMobileSessionSelection(resumeSession));

    act(() => result.current('session-1'));

    expect(resumeSession).toHaveBeenCalledWith('session-1', undefined);
    expect(useWorkspaceViewStore.getState().mobileSurface).toBe('sessions');
  });
});
