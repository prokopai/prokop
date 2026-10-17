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

/** The client URL of an attachment's content; the key authorizes the read. */
export function attachmentContentUrl(sessionId: string, attachment: { id: string; accessKey: string }): string {
  return `/api/sessions/${sessionId}/attachments/${attachment.id}/content?key=${attachment.accessKey}`;
}

/** Session and attachment IDs from an attachment content URL, or null for any other URL. */
export function parseAttachmentContentUrl(url: string): { sessionId: string; attachmentId: string } | null {
  const match = url.split('?')[0]!.match(/^\/api\/sessions\/([^/]+)\/attachments\/([^/]+)\/content$/);
  return match ? { sessionId: match[1]!, attachmentId: match[2]! } : null;
}
