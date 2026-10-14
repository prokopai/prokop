import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { RuntimeHost } from '@prokopai/core/infrastructure/runtime/host';
import { fixedBuilderContextAssembler } from '@/harnesses/prokop/composition/plugins/legacy-system-message';
import { installMemoryToolFallback } from '@/harnesses/prokop/composition/plugins/memory-domain';
import { installSessionSearchToolFallback } from '@/harnesses/prokop/composition/plugins/session-search-domain';
import { installSkillsToolFallback } from '@/harnesses/prokop/composition/plugins/skills-domain';
import { installTaskToolFallback } from '@/harnesses/prokop/composition/plugins/subagent-domain';
import { installWorkflowToolFallback } from '@/harnesses/prokop/composition/plugins/workflow-domain';
import { setDefaultContextAssembler } from '@/harnesses/prokop/context/assembler';
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

/**
 * Process defaults of the Prokop runtime: the legacy fixed-builder context
 * assembler for unscoped calls (composed scopes seed their own) and the
 * domain tool fallbacks. The runtime host itself comes from the host side.
 */
export function configureProkopRuntimeDefaults(): void {
  setDefaultContextAssembler(fixedBuilderContextAssembler);
  installSessionSearchToolFallback();
  installTaskToolFallback();
  installWorkflowToolFallback();
  installMemoryToolFallback();
  installSkillsToolFallback();
}
