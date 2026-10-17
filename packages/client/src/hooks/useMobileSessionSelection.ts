import { useCallback } from 'react';
import { useIsMobile } from '@/hooks/use-mobile';
import { useWorkspaceViewStore } from '@/stores/workspaceViewStore';
import type { ResumeSessionOptions } from '@/stores/sessionStore';

export type ResumeSession = (
  sessionId: string,
  options?: ResumeSessionOptions,
) => void;

/**
 * Picking a session from the phone Sessions surface stays in the shell
 * (no route change) and returns to Chat. Desktop resumes with navigation.
 */
export function useMobileSessionSelection(
  resumeSession: ResumeSession,
): ResumeSession {
  const isMobile = useIsMobile();

  return useCallback((sessionId, options) => {
    resumeSession(
      sessionId,
      isMobile ? { ...options, skipNavigation: true } : options,
    );
    if (isMobile) useWorkspaceViewStore.getState().setMobileSurface('chat');
  }, [isMobile, resumeSession]);
}
