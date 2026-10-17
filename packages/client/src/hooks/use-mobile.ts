import * as React from 'react';
import { MOBILE_MEDIA_QUERY } from '@/lib/viewport';

/** Tracks a media query; the initial value is read synchronously to avoid a layout flash. */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = React.useState<boolean>(() => (
    typeof window !== 'undefined' && window.matchMedia(query).matches
  ));

  React.useEffect(() => {
    const mql = window.matchMedia(query);
    const onChange = () => setMatches(mql.matches);
    mql.addEventListener('change', onChange);
    onChange();
    return () => mql.removeEventListener('change', onChange);
  }, [query]);

  return matches;
}

export function useIsMobile(): boolean {
  return useMediaQuery(MOBILE_MEDIA_QUERY);
}
