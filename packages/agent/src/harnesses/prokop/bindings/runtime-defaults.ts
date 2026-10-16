import { fixedBuilderContextAssembler } from '#agent/harnesses/prokop/composition/plugins/legacy-system-message';
import { installMemoryToolFallback } from '#agent/harnesses/prokop/composition/plugins/memory-domain';
import { installSessionSearchToolFallback } from '#agent/harnesses/prokop/composition/plugins/session-search-domain';
import { installSkillsToolFallback } from '#agent/harnesses/prokop/composition/plugins/skills-domain';
import { installTaskToolFallback } from '#agent/harnesses/prokop/composition/plugins/subagent-domain';
import { installWorkflowToolFallback } from '#agent/harnesses/prokop/composition/plugins/workflow-domain';
import { setDefaultContextAssembler } from '#agent/harnesses/prokop/context/assembler';

/**
 * Process defaults of the Prokop runtime: the legacy fixed-builder context
 * assembler for unscoped calls (composed scopes seed their own) and the
 * domain tool fallbacks. The runtime host itself comes from the host side.
 * The task and workflow fallbacks load the AI SDK.
 */
export function configureProkopRuntimeDefaults(): void {
  setDefaultContextAssembler(fixedBuilderContextAssembler);
  installSessionSearchToolFallback();
  installTaskToolFallback();
  installWorkflowToolFallback();
  installMemoryToolFallback();
  installSkillsToolFallback();
}
