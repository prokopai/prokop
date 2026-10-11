/**
 * The agent is told once, in linkshelf, how this user wants time handled in
 * tests, and saves it to its own memory, which follows it into every project.
 */
import type { Story } from './types';

/** Visible once the reply rendered. */
export const DATE_PREFERENCE_READY = 'comes with me to your other projects';

export const datePreference: Story = {
  title: 'No Date mocks in tests',
  prompt: "One thing for the future: don't mock Date in tests. Pass `now` in as a parameter instead. That's how I do it in every project.",
  steps: [
    {
      type: 'tool-call',
      toolName: 'agent_memory',
      args: {
        action: 'add',
        target: 'user',
        content: 'Tests: never mock Date or timers. Give time-dependent functions a `now = Date.now()` parameter and pass fixed times in tests. Applies to every project.',
      },
      usage: { inputTokens: 12_610, outputTokens: 74 },
    },
    {
      type: 'text',
      content: `Saved to my own memory, so it ${DATE_PREFERENCE_READY} too. From now on, time-dependent code takes a \`now\` parameter and tests pass fixed times instead of mocking \`Date\`.`,
      usage: { inputTokens: 12_790, outputTokens: 52 },
    },
  ],
};
