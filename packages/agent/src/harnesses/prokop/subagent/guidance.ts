/** Subagent domain: self-delegation context guidance, added below the shared
 * delegation paragraph when the agent may delegate to itself. */
export function selfDelegationGuidance(preconfigId: string): string {
  return `SELF-DELEGATION:
- You may call delegate_task with subagent_type "${preconfigId}" to delegate work to a fresh instance of yourself.
- This permission applies only to the immediate child. Reusing "${preconfigId}" later in the same ancestry chain is blocked.`;
}
