import { readFile } from 'node:fs/promises';
import type { Session } from '@prokopai/sdk';
import type { AttachmentRecord as Attachment } from '@prokopai/core/infrastructure/storage/contracts';
import { resolveSessionImages } from '#agent/harnesses/shared/images';

export interface ClaudeImage extends Attachment {
  data: string;
}

/**
 * Validate ownership and the actual file before any native prompt can be
 * submitted, at most 10 images. Metadata only; `loadClaudeImages` reads the
 * bytes once the turn is claimed.
 */
export function resolveClaudeImages(session: Session,
  references: Array<{ id: string; kind: string }>): Promise<Attachment[] | null> {
  return resolveSessionImages(session, references, 10);
}

/** Reads validated images off the event loop; a file that changed size since validation fails the turn. */
export async function loadClaudeImages(images: Attachment[]): Promise<ClaudeImage[]> {
  return Promise.all(images.map(async (image) => {
    const data = await readFile(image.absolutePath);
    if (data.length !== image.sizeBytes) throw new Error('Claude image attachment is unavailable or unsupported');
    return { ...image, data: data.toString('base64') };
  }));
}
