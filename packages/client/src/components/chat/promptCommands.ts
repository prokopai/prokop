import type { PromptInfo } from '@prokopai/sdk';

/**
 * Slash prompts in a composer: `/name rest` sends the prompt's content, with
 * `ARG` replaced by the rest or the rest appended on its own line. Shared by
 * the session composer and the group composer.
 */

export function expandPromptContent(prompt: PromptInfo, userText: string): string {
  if (userText) {
    if (prompt.content.includes('ARG')) {
      return prompt.content.replace('ARG', userText);
    }
    return `${prompt.content}\n${userText}`;
  }
  return prompt.content;
}

export function extractPromptCommand(input: string): { command: string; rest: string } | null {
  const trimmed = input.trimStart();
  if (!trimmed.startsWith('/')) return null;
  const spaceIndex = trimmed.indexOf(' ');
  if (spaceIndex === -1) {
    return { command: trimmed.slice(1), rest: '' };
  }
  return { command: trimmed.slice(1, spaceIndex), rest: trimmed.slice(spaceIndex + 1).trim() };
}

/** The text a composer sends for `input`: the expanded prompt when it starts with a known `/name`, else the input itself. */
export function expandPromptInput(input: string, prompts: readonly PromptInfo[]): string {
  const parsed = extractPromptCommand(input);
  const prompt = parsed && prompts.find((candidate) => candidate.name === parsed.command);
  return prompt ? expandPromptContent(prompt, parsed.rest) : input.trim();
}
