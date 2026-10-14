import { basename, dirname, join, resolve } from 'node:path';
import { agentsRoot } from '@/domains/agents/home';
import { getDataDir } from '@/infrastructure/runtime/paths';
import { getLegacyProkopWorkspaceDir, getProkopaiWorkspaceDir } from '@/infrastructure/runtime/workspace-dirs';
import { listWorkspaces } from '@/infrastructure/sqlite/workspaces';

/**
 * Where an agent may ask the host to write memory or skills
 * (`knowledge.apply`): a known workspace's memory dir (`.prokopai`, or the
 * legacy `.jean2`) or skills dir (`.agents/skills`), or an agent home's
 * memory dir or skills dir. Anything else is refused, so a misbehaving agent
 * cannot direct host writes elsewhere.
 */
export function isKnowledgeDirectory(kind: 'memory' | 'skill', directory: string): boolean {
  const target = resolve(directory);
  const agents = resolve(agentsRoot(getDataDir()));
  if (kind === 'memory' && dirname(target) === agents) return true;
  if (kind === 'skill' && dirname(dirname(target)) === agents && basename(target) === 'skills') return true;
  return listWorkspaces().some((workspace) => {
    if (!workspace.path) return false;
    return kind === 'memory'
      ? target === resolve(getProkopaiWorkspaceDir(workspace.path)) || target === resolve(getLegacyProkopWorkspaceDir(workspace.path))
      : target === resolve(join(workspace.path, '.agents', 'skills'));
  });
}
