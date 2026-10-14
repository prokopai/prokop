import { createOpenAiResponsesModel } from './ai-sdk';
import {
  CODEX_OAUTH_DUMMY_KEY, codexProviderDescriptor, createCodexFetch, type CodexCredentialSource,
} from './codex-access';
import type { ConnectableProvider, ModelFactoryOptions, ModelFactoryResult } from './types';

/** A Codex subscription model (OpenAI Responses API through the ChatGPT backend). */
export async function createCodexModel(options: ModelFactoryOptions, source: CodexCredentialSource): Promise<ModelFactoryResult> {
  return createOpenAiResponsesModel({
    modelId: options.modelId,
    apiKey: CODEX_OAUTH_DUMMY_KEY,
    fetch: await createCodexFetch(source),
    systemPrompt: options.systemPrompt,
    sessionId: options.sessionId,
  });
}

/**
 * The Codex provider where models run without the account store (the agent
 * process): credentials come from the host, which owns OAuth and refresh.
 */
export function createCodexModelProvider(source: CodexCredentialSource): ConnectableProvider {
  const hostOnly = async (): Promise<never> => {
    throw new Error('Codex accounts are managed by the host (Settings > LLM providers)');
  };
  return {
    descriptor: codexProviderDescriptor,
    getStatus: () => ({ provider: 'codex', connected: true }),
    connect: hostOnly,
    disconnect: hostOnly,
    onTokensReceived: hostOnly,
    createModel: options => createCodexModel(options, source),
  };
}
