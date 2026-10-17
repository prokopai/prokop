const MAX_FAILURE_CHARS = 300;

/** The error shown on a failed Claude tool row: Claude's own result text when
 *  it has one, so a hook error or a cancelled call reads as what it was,
 *  never as a generic failure. */
export function claudeToolFailure(output: unknown): string {
  const text = typeof output === 'string' ? output.trim() : '';
  if (!text) return 'Claude tool failed';
  const firstLine = text.split('\n', 1)[0]!.trim() || text;
  return firstLine.length > MAX_FAILURE_CHARS ? `${firstLine.slice(0, MAX_FAILURE_CHARS - 1)}…` : firstLine;
}
