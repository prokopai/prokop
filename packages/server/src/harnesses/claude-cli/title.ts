import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { getClaudeBinding } from './native-state';
import { claudeTranscriptPath } from './transcript';

const MAX_TRANSCRIPT_BYTES = 64 * 1024 * 1024;

/**
 * The title Claude Code generated for its own session: the latest
 * `ai-title` entry in the CLI transcript. Prokop pays no model call for it.
 * Forks made by the SDK carry a copied `custom-title` ("... (fork)") instead,
 * which is not a topic title, so only `ai-title` counts.
 */
export async function readClaudeAiTitle(input: { root: string; nativeId: string }): Promise<string | null> {
  const path = claudeTranscriptPath(input.root, input.nativeId);
  if (!path) return null;
  let title: string | null = null;
  let bytes = 0;
  const stream = createReadStream(path, { encoding: 'utf8' });
  const lines = createInterface({ input: stream, crlfDelay: Infinity });
  try {
    for await (const line of lines) {
      bytes += Buffer.byteLength(line, 'utf8') + 1;
      if (bytes > MAX_TRANSCRIPT_BYTES) break;
      if (!line.includes('"ai-title"')) continue;
      let entry: { type?: unknown; sessionId?: unknown; aiTitle?: unknown };
      try { entry = JSON.parse(line) as typeof entry; } catch { continue; }
      if (entry.type !== 'ai-title' || entry.sessionId !== input.nativeId || typeof entry.aiTitle !== 'string') continue;
      const candidate = entry.aiTitle.replace(/\s+/g, ' ').trim().slice(0, 100).trim();
      if (candidate) title = candidate;
    }
  } catch { return title; }
  finally { lines.close(); stream.destroy(); }
  return title;
}

/** Claude Code's own title for a Prokop session bound to a native Claude session. */
export async function readClaudeSessionTitle(sessionId: string): Promise<string | null> {
  const binding = await getClaudeBinding(sessionId);
  return binding ? readClaudeAiTitle({ root: binding.workspace_root, nativeId: binding.native_session_id }) : null;
}
