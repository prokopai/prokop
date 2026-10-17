import { useCallback } from 'react';
import { playNotificationSound } from '@/lib/notificationSounds';

interface UseNotificationSoundReturn {
  playChatFinishSound: () => void;
  playPermissionSound: () => void;
}

/** Stable callbacks over the page-wide sound player (see `lib/notificationSounds`). */
export function useNotificationSound(): UseNotificationSoundReturn {
  const playChatFinishSound = useCallback(() => {
    playNotificationSound('chatFinish');
  }, []);

  const playPermissionSound = useCallback(() => {
    playNotificationSound('chatPermission');
  }, []);

  return { playChatFinishSound, playPermissionSound };
}
