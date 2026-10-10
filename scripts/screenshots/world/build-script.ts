/**
 * A session stopped at a command approval, in its own worktree: the agent
 * adds a build script and wants to run `rm -rf dist && bun build ...`. Only
 * the delete is flagged and highlighted for review; the ask is left open.
 */
import type { Story } from './types';

/** The command whose approval the scene shows. */
export const BUILD_COMMAND = 'rm -rf dist && bun build src/server.ts --outdir dist --target bun';

/** The turn up to the approval; the last step raises the ask. */
export const buildScript: Story = {
  title: 'Add a production build script',
  prompt: 'Add a `build` script that bundles the server into dist/ so we can deploy a single file.',
  worktree: 'build-script',
  until: 'ask',
  steps: [
    {
      type: 'tool-call',
      toolName: 'read-file',
      args: { path: 'package.json' },
      usage: { inputTokens: 12_880, outputTokens: 44 },
    },
    {
      type: 'tool-call',
      text: 'Adding a `build` script that clears `dist/` first, so stale chunks never ship.',
      toolName: 'edit',
      args: {
        path: 'package.json',
        revision: null,
        edits: [
          {
            oldString: '    "dev": "bun --watch src/server.ts",',
            newString: `    "dev": "bun --watch src/server.ts",\n    "build": "${BUILD_COMMAND}",`,
          },
        ],
      },
      usage: { inputTokens: 13_410, outputTokens: 132 },
    },
    {
      type: 'tool-call',
      text: 'Running it once to check the bundle.',
      toolName: 'shell',
      args: { command: BUILD_COMMAND },
      usage: { inputTokens: 13_920, outputTokens: 58 },
    },
  ],
};
