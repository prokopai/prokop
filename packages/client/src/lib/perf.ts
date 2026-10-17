/**
 * Development-only performance instrumentation helper.
 *
 * Wraps performance.mark() and performance.measure() with:
 * - Low overhead in production (all calls are no-ops unless enabled).
 * - Tolerant of missing start marks (records what it can).
 * - No user content is ever logged (only mark names and durations).
 *
 * Enable from the devtools console with window.__jean2_perf_enable(), then
 * read the `jean2:` entries from performance.getEntriesByType('measure').
 */

const PREFIX = 'jean2:';
const STORAGE_KEY = '__jean2_perf_enabled';

let enabled = false;

if (typeof window !== 'undefined') {
  Object.defineProperty(window, '__jean2_perf_enable', {
    value: () => {
      enabled = true;
      try { localStorage.setItem(STORAGE_KEY, '1'); } catch { /* ignore */ }
      console.log('[perf] Instrumentation enabled for this session');
    },
    writable: false,
    configurable: false,
  });

  // Restore persisted preference (only in dev)
  try {
    if (localStorage.getItem(STORAGE_KEY) === '1' && import.meta.env?.DEV) {
      enabled = true;
    }
  } catch { /* ignore */ }
}

/**
 * Place a named mark at a lifecycle boundary.
 * Tolerates environments without performance API.
 */
export function mark(name: string): void {
  if (!enabled) return;
  try {
    performance.mark(PREFIX + name);
  } catch { /* ignore */ }
}

/**
 * Measure the duration between two marks.
 * Returns null when either mark is missing. Does not throw on failure.
 */
function measure(startName: string, endName: string): number | null {
  if (!enabled) return null;
  try {
    const fullStart = PREFIX + startName;
    const fullEnd = PREFIX + endName;
    const startEntries = performance.getEntriesByName(fullStart, 'mark');
    if (startEntries.length === 0) return null;
    const endEntries = performance.getEntriesByName(fullEnd, 'mark');
    if (endEntries.length === 0) return null;
    const duration = endEntries[0].startTime - startEntries[0].startTime;
    const measureName = `${startName}→${endName}`;
    try {
      performance.measure(`${PREFIX}${measureName}`, fullStart, fullEnd);
    } catch { /* ignore */ }
    return duration;
  } catch {
    return null;
  }
}

/**
 * Convenience: mark an end boundary and immediately measure from a start mark.
 * Returns the duration in ms or null if not measurable.
 */
export function markAndMeasure(startName: string, endName: string): number | null {
  mark(endName);
  return measure(startName, endName);
}
