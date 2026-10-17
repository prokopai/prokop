/**
 * Shared types and constants for UI components
 */

export const DRAFT_KEY_PREFIX = 'prokopai_draft_';
export const DRAFT_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export interface SavedDraft {
  text: string;
  updatedAt: number;
}

export function cleanupExpiredDrafts(): void {
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key || !key.startsWith(DRAFT_KEY_PREFIX)) {
        continue;
      }

      try {
        const value = localStorage.getItem(key);
        if (!value) {
          continue;
        }

        const draft: SavedDraft = JSON.parse(value);
        if (Date.now() - draft.updatedAt > DRAFT_TTL_MS) {
          localStorage.removeItem(key);
        }
      } catch {
        localStorage.removeItem(key);
      }
    }
  } catch {
    // localStorage not available
  }
}
