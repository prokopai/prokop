/**
 * The one delegation paragraph every harness adds to its system prompt when
 * the delegation tools are present. Claude Code and Codex also have native
 * subagents; Prokop's subagent is delegation.
 */
export function delegationGuidance(howToCall: string, nativeSubagents: boolean): string {
  const native = nativeSubagents
    ? 'Your native subagents (your own Task or agent tool) are for same-harness, same-model fan-out whose output only you need. '
    : '';
  return `${native}delegate_task hands a task to a Prokop child session running a role the user defined (subagent_type), on that role's harness (prokop, codex-cli, claude-cli) and model or on ones you pick; the user sees the child as its own session and can open it. Use it for a role, for another harness or model, for work the user should be able to follow, or when asked. Call delegation_capabilities first to see the roles and what you may override. ${howToCall}. A delegated task returns at once by default and its result arrives later as a new message in this session that starts with "[task"; do not poll for it. task_status is for an explicit check, task_cancel stops a task, and mode "wait" blocks for the result when you need it in this turn.`;
}

/** Prokop calls the tools directly from its tool list. */
export const PROKOP_DELEGATION_CALL = 'The tools are delegate_task, delegation_capabilities, task_status and task_cancel in your tool list';
