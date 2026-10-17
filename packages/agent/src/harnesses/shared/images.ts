import { lstatSync, realpathSync } from 'node:fs';
import { isAbsolute, relative, sep } from 'node:path';
import type { Session } from '@prokopai/sdk';
import { MAX_ATTACHMENT_SIZE, validateImageMime } from '@prokopai/core/domains/attachments';
import type { AttachmentRecord } from '@prokopai/core/infrastructure/storage/contracts';
import { getAttachment } from '@prokopai/core/infrastructure/storage/runtime';
import { getAttachmentDir } from '@prokopai/core/infrastructure/runtime/paths';

/**
 * Validate a turn's image attachments before any native prompt is submitted:
 * each must be this session's image, a supported type and size, and a regular
 * file inside the session's attachment directory whose size still matches.
 * Null when any reference fails or there are more than `maxCount`. Metadata
 * only; the absolute path is resolved to the real file.
 */
export async function resolveSessionImages(session: Session,
  references: Array<{ id: string; kind: string }>, maxCount = Infinity): Promise<AttachmentRecord[] | null> {
  if (references.length > maxCount) return null;
  const images: AttachmentRecord[] = [];
  const directory = getAttachmentDir(session.workspaceId, session.id);
  for (const reference of references) {
    if (reference?.kind !== 'image' || typeof reference.id !== 'string') return null;
    const image = await getAttachment(session.id, reference.id);
    if (!image || image.workspaceId !== session.workspaceId || image.kind !== 'image'
      || !validateImageMime(image.mimeType) || image.sizeBytes < 1 || image.sizeBytes > MAX_ATTACHMENT_SIZE) return null;
    try {
      const stat = lstatSync(image.absolutePath);
      const file = realpathSync(image.absolutePath);
      const offset = relative(realpathSync(directory), file);
      if (!offset || offset === '..' || offset.startsWith(`..${sep}`) || isAbsolute(offset)
        || !stat.isFile() || stat.isSymbolicLink() || stat.size !== image.sizeBytes) return null;
      images.push({ ...image, absolutePath: file });
    } catch { return null; }
  }
  return images;
}
