import type { AgentGroupMember, AgentGroupMessage } from '@prokopai/sdk';

/** One color per member, by position in the roster, so an author reads the same across the thread and the chips. */
const AUTHOR_COLORS = [
  'text-sky-600 dark:text-sky-400',
  'text-emerald-600 dark:text-emerald-400',
  'text-amber-600 dark:text-amber-400',
  'text-violet-600 dark:text-violet-400',
  'text-rose-600 dark:text-rose-400',
  'text-teal-600 dark:text-teal-400',
  'text-orange-600 dark:text-orange-400',
  'text-indigo-600 dark:text-indigo-400',
  'text-lime-600 dark:text-lime-400',
  'text-fuchsia-600 dark:text-fuchsia-400',
] as const;

function hash(value: string): number {
  let result = 0;
  for (const char of value) result = (result * 31 + char.charCodeAt(0)) >>> 0;
  return result;
}

export function authorColorClass(agentId: string, members: readonly AgentGroupMember[]): string {
  const index = members.findIndex((member) => member.agentId === agentId);
  return AUTHOR_COLORS[(index >= 0 ? index : hash(agentId)) % AUTHOR_COLORS.length];
}

/** A former member keeps its id as its name. */
export function memberName(agentId: string | null, members: readonly AgentGroupMember[]): string {
  if (!agentId) return '?';
  return members.find((member) => member.agentId === agentId)?.name ?? agentId;
}

/** The text of a group message as the composer or a notification would show it. */
export function groupMessagePlainText(message: AgentGroupMessage): string {
  return message.parts.filter((part) => part.type === 'text').map((part) => part.text).join('\n').trim();
}

export function formatGroupTime(iso: string, now = Date.now()): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const sameDay = new Date(now).toDateString() === date.toDateString();
  return sameDay
    ? date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : date.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}
