import { installMemoryToolFallback } from '#agent/harnesses/prokop/composition/plugins/memory-domain';
import { installSessionSearchToolFallback } from '#agent/harnesses/prokop/composition/plugins/session-search-domain';
import { installSkillsToolFallback } from '#agent/harnesses/prokop/composition/plugins/skills-domain';

/**
 * The domain tool fallbacks the Claude Code and Codex drivers publish too
 * (memory, session search, agent skills; `shared/domain-tools.ts`). Light:
 * the agent process installs them at startup.
 */
export function configureSharedDomainToolDefaults(): void {
  installSessionSearchToolFallback();
  installMemoryToolFallback();
  installSkillsToolFallback();
}
