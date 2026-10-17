/**
 * The one width below which the shell uses mobile surfaces instead of docks.
 * Matches Tailwind's `sm:` breakpoint; shell markup uses `sm:` for the same cut.
 */
const MOBILE_BREAKPOINT = 640;

export const MOBILE_MEDIA_QUERY = `(max-width: ${MOBILE_BREAKPOINT - 1}px)`;

/** Non-reactive read for event handlers; components use `useIsMobile`. */
export function isMobileViewport(): boolean {
  return typeof window !== 'undefined' && window.innerWidth < MOBILE_BREAKPOINT;
}
