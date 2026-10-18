import { useEffect } from 'react';
import { toast } from 'sonner';
import { usePWAUpdateStore } from '@/pwa/updateStore';

export const PWA_UPDATE_TOAST_ID = 'pwa-update';

/**
 * Announces a waiting service worker through the app toaster, like every
 * other notice the app raises on its own. Renders nothing itself.
 */
export function PWAUpdateToast() {
  const needRefresh = usePWAUpdateStore((state) => state.needRefresh);
  const dismissed = usePWAUpdateStore((state) => state.dismissed);
  const isUpdating = usePWAUpdateStore((state) => state.isUpdating);
  const dismiss = usePWAUpdateStore((state) => state.dismiss);
  const updateServiceWorker = usePWAUpdateStore((state) => state.updateServiceWorker);

  useEffect(() => {
    if (!needRefresh || dismissed) {
      toast.dismiss(PWA_UPDATE_TOAST_ID);
      return;
    }
    toast('Prokop update ready', {
      id: PWA_UPDATE_TOAST_ID,
      description: 'Restart Prokop to use the latest version.',
      duration: Infinity,
      dismissible: !isUpdating,
      onDismiss: dismiss,
      action: {
        label: isUpdating ? 'Restarting…' : 'Restart now',
        onClick: (event) => {
          // Keep the toast open until the new version takes over.
          event.preventDefault();
          void updateServiceWorker();
        },
      },
      cancel: isUpdating ? undefined : { label: 'Later', onClick: dismiss },
    });
  }, [needRefresh, dismissed, isUpdating, dismiss, updateServiceWorker]);

  return null;
}
