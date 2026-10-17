export function isWindows(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /Win/i.test(navigator.platform || navigator.userAgent);
}

/**
 * Extract the basename (filename) from a path, handling both / and \ separators.
 */
export function pathBasename(p: string): string {
  const idx = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'));
  return idx >= 0 ? p.slice(idx + 1) : p;
}
