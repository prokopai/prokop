import type { AttachmentKind } from '@prokopai/sdk';

/** Largest accepted upload or tool-produced attachment. */
export const MAX_ATTACHMENT_SIZE = 20 * 1024 * 1024;

const ALLOWED_IMAGE_MIME_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
]);

export function determineKind(mimeType: string): AttachmentKind {
  if (mimeType.startsWith('image/')) {
    return 'image';
  }
  if (mimeType.startsWith('video/')) {
    return 'video';
  }
  return 'file';
}

/** Image types a model input may carry. */
export function validateImageMime(mimeType: string): boolean {
  return ALLOWED_IMAGE_MIME_TYPES.has(mimeType);
}
