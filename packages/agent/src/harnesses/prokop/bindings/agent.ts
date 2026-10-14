import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { RuntimeHost } from '@prokopai/core/infrastructure/runtime/host';
import { resolveWorkspaceMemoryDir, resolveWorkspaceSkillsDir } from '@prokopai/core/infrastructure/runtime/workspace-dirs';
import { prokopSandboxBindings } from './sandbox';
import { prokopTitleBindings } from './titles';
import { prokopToolPolicy } from './tool-policy';

/** Runtime-host parts the Prokop runtime provides itself, wherever it runs. */
export type ProkopAgentBindings = Pick<RuntimeHost, 'titles' | 'toolPolicy' | 'sandbox' | 'layout'>;

export const prokopAgentBindings = {
  titles: prokopTitleBindings,
  toolPolicy: prokopToolPolicy,
  sandbox: prokopSandboxBindings,
  layout: {
    workspaceMemoryDir: (workspacePath: string) => resolveWorkspaceMemoryDir(workspacePath),
    workspaceSkillsDir: (workspacePath: string) => resolveWorkspaceSkillsDir(workspacePath),
    agentSkillsDir: (agentDir: string) => join(agentDir, 'skills'),
    toolOutputTempRoot: () => join(tmpdir(), 'jean2'),
  },
} satisfies ProkopAgentBindings;
