import { Toaster } from 'sonner';
import { useTheme } from '@/components/providers/ThemeProvider';

export function ThemedToaster() {
  const { resolvedMode } = useTheme();

  return (
    <Toaster
      position="bottom-right"
      closeButton
      richColors
      theme={resolvedMode}
      toastOptions={{
        // The one surface for everything the app says on its own: attention
        // asks, finished sessions, update ready, reconnecting, action errors.
        // Sonner injects its stylesheet after ours, so the surface classes
        // need `!` to win over its attribute selectors.
        classNames: {
          toast: 'rounded-lg! border-0! bg-popover! text-popover-foreground! shadow-md! ring-1 ring-foreground/10',
          title: 'text-sm font-medium',
          description: 'text-sm! text-muted-foreground!',
          actionButton: 'rounded-md! bg-primary! text-primary-foreground!',
          cancelButton: 'rounded-md! bg-muted! text-foreground!',
          closeButton: 'border-border! bg-popover! text-muted-foreground!',
        },
      }}
    />
  );
}
