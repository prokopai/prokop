import { useCallback, useState } from 'react';
import {
  hideUsageEntry, loadUsageLayout, moveUsageEntry, saveUsageLayout, showUsageEntry, type UsageLayout,
} from '@/lib/usageLayout';

/** The Usage panel's shown groups and their order, kept on this device. */
export function useUsageLayout() {
  const [layout, setLayout] = useState<UsageLayout>(loadUsageLayout);
  const update = useCallback((change: (current: UsageLayout) => UsageLayout) => {
    setLayout(current => {
      const next = change(current);
      if (next !== current) saveUsageLayout(next);
      return next;
    });
  }, []);
  const move = useCallback((visibleIds: string[], id: string, direction: 'up' | 'down') =>
    update(current => moveUsageEntry(current, visibleIds, id, direction)), [update]);
  const hide = useCallback((id: string) => update(current => hideUsageEntry(current, id)), [update]);
  const show = useCallback((id: string) => update(current => showUsageEntry(current, id)), [update]);
  return { layout, move, hide, show };
}
