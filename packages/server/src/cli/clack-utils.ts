/**
 * Windows PowerShell does not translate \n to \r\n even in cooked mode,
 * unlike CMD. Any CLI output written with a bare \n then drifts rightward
 * line by line (the "staircase" effect) because PSReadLine never returns
 * the cursor to column 0.
 *
 * This module patches both process.stdout.write AND console.log to ensure
 * \r\n line endings on Windows. It is imported for its side effect only.
 */

if (process.platform === 'win32' && process.stdout.isTTY) {
  // Patch process.stdout.write for direct writes.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const _origStdoutWrite: (data: string | Uint8Array, ...args: any[]) => boolean =
    process.stdout.write.bind(process.stdout);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const patchedWrite = (data: string | Uint8Array, ...args: any[]): boolean => {
    if (typeof data === 'string') {
      data = data.replace(/(?<!\r)\n/g, '\r\n');
    }
    return _origStdoutWrite(data, ...args);
  };
  (process.stdout as unknown as { write: typeof patchedWrite }).write = patchedWrite;

  // Patch console.log. Bun's console.log writes directly to fd 1,
  // bypassing process.stdout.write entirely, so it is intercepted
  // separately to ensure \r\n line endings.
  const _origLog = console.log;
  (console as unknown as { log: typeof _origLog }).log = (...args: unknown[]): void => {
    const msg = args.map((a) => (typeof a === 'string' ? a : String(a))).join(' ');
    process.stdout.write(msg + '\n');
  };
}
