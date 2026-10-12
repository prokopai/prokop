const URI_SCHEME = /^[a-z][a-z0-9+.-]*:/i;
const WINDOWS_DRIVE = /^[a-z]:[\\/]/i;
// `path:42`, `path:42:7` and `path:42-50`, as agents cite lines.
const LINE_SUFFIX = /:\d+(?::\d+|-\d+)?$/;

/**
 * The file a chat link points at, or null for web links and in-page anchors.
 * Agents link files by workspace-relative path, absolute path or `file://` URL,
 * sometimes with a line (`#L12`, `:12`), which the preview does not use.
 */
export function localFileLinkPath(href: string): string | null {
  let target = href.trim();
  if (target.startsWith('<') && target.endsWith('>')) target = target.slice(1, -1).trim();
  if (!target || target.startsWith('#') || target.startsWith('?') || target.startsWith('//')) return null;

  if (/^file:/i.test(target)) {
    try {
      target = new URL(target).pathname;
    } catch {
      return null;
    }
    // file:///C:/dir keeps a leading slash before the drive.
    if (/^\/[a-z]:\//i.test(target)) target = target.slice(1);
  } else if (URI_SCHEME.test(target) && !WINDOWS_DRIVE.test(target)) {
    return null;
  } else {
    target = target.replace(/[?#].*$/, '');
  }

  try {
    target = decodeURIComponent(target);
  } catch { /* Keep a path with a literal %. */ }
  target = target.replace(LINE_SUFFIX, '').replace(/^\.\/+/, '');
  return target && target !== '.' ? target : null;
}
