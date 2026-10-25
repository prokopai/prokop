/**
 * Who answers a group message. Routing is decided by code, never by a model:
 * mention chips from the composer, `@everyone`, `@Name` in the text, and
 * otherwise the group's default member. A message meant for nobody in
 * particular still wakes the default member, so nothing posted vanishes.
 */

export interface GroupRoutingMember {
  agentId: string;
  name: string;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** `@Name` or `@agent-id` as a whole word, case-insensitive; names may contain spaces. */
function mentions(text: string, member: GroupRoutingMember): boolean {
  for (const handle of new Set([member.name, member.agentId])) {
    if (!handle.trim()) continue;
    const pattern = new RegExp(String.raw`(^|[^\w@])@${escapeRegExp(handle)}(?![\w-])`, 'i');
    if (pattern.test(text)) return true;
  }
  return false;
}

const EVERYONE = /(^|[^\w@])@everyone(?![\w-])/i;

/**
 * The members a message names, in member order: mention chips (a chip for a
 * non-member is ignored), else `@everyone`, else `@Name` in the text. Empty
 * when the message names nobody.
 */
export function explicitGroupTargets(
  text: string,
  mentionChips: readonly string[],
  members: readonly GroupRoutingMember[],
): string[] {
  const ids = new Set(members.map((member) => member.agentId));
  const chips = mentionChips.filter((id) => ids.has(id));
  if (chips.length > 0) return members.filter((member) => chips.includes(member.agentId)).map((member) => member.agentId);
  if (EVERYONE.test(text)) return members.map((member) => member.agentId);
  return members.filter((member) => mentions(text, member)).map((member) => member.agentId);
}

/**
 * The member ids a message wakes: the explicit targets, or the default
 * member when it names nobody. An empty members list wakes nobody.
 */
export function resolveGroupTargets(
  text: string,
  mentionChips: readonly string[],
  members: readonly GroupRoutingMember[],
  defaultAgentId: string,
): string[] {
  if (members.length === 0) return [];
  const explicit = explicitGroupTargets(text, mentionChips, members);
  if (explicit.length > 0) return explicit;
  return [members.some((member) => member.agentId === defaultAgentId) ? defaultAgentId : members[0]!.agentId];
}
