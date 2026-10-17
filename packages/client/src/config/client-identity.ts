import type { ClientDescriptor } from '@prokopai/sdk';
import { storage, STORAGE_KEYS } from '@/lib/storage';
import { randomUUID } from '@/lib/randomId';

function generateClientId(): string {
  return randomUUID();
}

/** The one client id of this device: the socket registers with it and push subscriptions carry it. */
export async function getOrCreateClientId(): Promise<string> {
  const existing = await storage.get<string>(STORAGE_KEYS.CLIENT_ID);
  if (existing) return existing;

  const newId = generateClientId();
  await storage.set(STORAGE_KEYS.CLIENT_ID, newId);
  return newId;
}

function getDisplayName(): string {
  return 'Prokopai Web';
}

export async function resolveClientDescriptor(): Promise<ClientDescriptor> {
  const clientId = await getOrCreateClientId();

  return {
    clientId,
    clientType: 'web',
    displayName: getDisplayName(),
    interactionMode: 'human',
    capabilities: [],
  };
}
