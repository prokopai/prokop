import { createContext } from 'react';

/**
 * Opens a file path linked in markdown, set where links belong to a session
 * (the transcript). Without it, file links stay plain links.
 */
export const MarkdownFileLinkContext = createContext<((path: string) => void) | undefined>(undefined);
