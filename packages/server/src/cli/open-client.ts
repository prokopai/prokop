import {
  getLocalHost,
  getLocalHttpEnabled,
  getPort,
  getTlsEnabled,
} from '@prokopai/core/infrastructure/runtime/environment';

export interface OpenClientResult {
  opened: boolean;
  url: string;
}

export function getClientUrl(): string {
  const port = getPort();
  if (getLocalHttpEnabled()) {
    return `http://${getLocalHost()}:${port}`;
  }
  return `${getTlsEnabled() ? 'https' : 'http'}://localhost:${port}`;
}

export async function waitForClient(url: string, timeoutMs = 10_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    try {
      await fetch(url, { signal: AbortSignal.timeout(500) });
      return true;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }

  return false;
}

export function openClient(): OpenClientResult {
  const url = getClientUrl();
  console.log(`Opening ${url} ...`);

  try {
    const command = process.platform === 'darwin'
      ? 'open'
      : process.platform === 'win32'
        ? 'cmd'
        : 'xdg-open';
    const args = process.platform === 'win32'
      ? ['/c', 'start', url]
      : [url];
    Bun.spawn([command, ...args], { detached: true, windowsHide: true });
    return { opened: true, url };
  } catch {
    console.log(`Could not open browser. Open manually: ${url}`);
    return { opened: false, url };
  }
}
