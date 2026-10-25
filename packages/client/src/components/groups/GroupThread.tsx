import { useMemo, useState } from 'react';
import { formatHostEvent, type AgentGroupMember, type AgentGroupMessage, type AskResponse, type Message, type MessageWithParts } from '@prokopai/sdk';
import { AskQuestion } from '@/components/chat/AskQuestion';
import { VirtualizedTranscript, type DisplayItem } from '@/components/chat/VirtualizedTranscript';
import { EmptyState } from '@/components/shared/States';
import type { PendingAskRequest } from '@/stores/askStore';
import type { GroupLiveReply } from '@/hooks/useGroupMemberStatuses';
import { authorColorClass, groupMessagePlainText, memberName } from '@/lib/groupAuthors';
import { cn } from '@/lib/utils';

export interface GroupMemberAsk {
  member: AgentGroupMember;
  request: PendingAskRequest;
}

export interface GroupThreadProps {
  groupId: string;
  members: readonly AgentGroupMember[];
  messages: readonly AgentGroupMessage[];
  hasOlder?: boolean;
  loadingOlder?: boolean;
  onLoadOlder?: () => void;
  /** Replies members are writing right now, shown under the thread until the finished reply lands. */
  live?: readonly GroupLiveReply[];
  /** Approvals and questions of members, answered here since member sessions stay hidden. */
  asks?: readonly GroupMemberAsk[];
  onAskResponse?: (toolCallId: string, response: AskResponse, requestId?: string) => void;
  onOpenMemberSession?: (sessionId: string) => void;
  serverUrl?: string;
}

const NO_TOKENS = { prompt: 0, completion: 0 };

/**
 * The group thread as transcript rows, so it reads like a chat: the person's
 * posts as prompt bubbles, members' replies as assistant turns named after
 * the member, a handoff or a join as an event row.
 */
export function groupDisplayItems(groupId: string, messages: readonly AgentGroupMessage[], members: readonly AgentGroupMember[], live: readonly GroupLiveReply[]): DisplayItem[] {
  const items: DisplayItem[] = [];
  for (const message of messages) {
    const createdAt = new Date(message.createdAt).getTime() || 0;
    switch (message.authorKind) {
      case 'user':
        items.push({ message: { id: message.id, sessionId: groupId, role: 'user', createdAt }, parts: message.parts });
        break;
      case 'agent': {
        const sessionId = members.find((member) => member.agentId === message.authorAgentId)?.sessionId ?? groupId;
        items.push({
          message: { id: message.id, sessionId, role: 'assistant', status: 'completed', modelId: '', providerId: '', tokens: NO_TOKENS, cost: 0, createdAt },
          parts: message.parts,
          author: { name: memberName(message.authorAgentId, members), className: message.authorAgentId ? authorColorClass(message.authorAgentId, members) : undefined },
        });
        break;
      }
      case 'handoff':
      case 'system': {
        // An event row, like a task note: the label carries who, the body what.
        const text = groupMessagePlainText(message);
        const label = message.authorKind === 'handoff'
          ? `${memberName(message.authorAgentId, members)} → ${memberName(message.targetAgentId, members)}`
          : text;
        const note = formatHostEvent({
          kind: 'group', id: groupId, label, outcome: 'ok',
          ...(message.authorKind === 'handoff' ? { meta: 'handoff' } : {}),
          summary: message.authorKind === 'handoff' ? `[handoff ${label}]` : `[${text}]`,
        }, message.authorKind === 'handoff' ? text : '');
        items.push({ message: { id: message.id, sessionId: groupId, role: 'user', createdAt },
          parts: [{ id: `${message.id}-note`, messageId: message.id, createdAt, type: 'text', text: note }] });
        break;
      }
    }
  }
  for (const reply of live) {
    items.push({
      message: { ...reply.message, sessionId: reply.member.sessionId },
      parts: reply.parts,
      author: { name: reply.member.name, className: authorColorClass(reply.member.agentId, members) },
    });
  }
  return items;
}

export function GroupThread({ groupId, members, messages, hasOlder, loadingOlder, onLoadOlder, live = [], asks = [], onAskResponse, onOpenMemberSession, serverUrl }: GroupThreadProps) {
  const [autoFollow, setAutoFollow] = useState(true);
  const displayItems = useMemo(() => groupDisplayItems(groupId, messages, members, live), [groupId, messages, members, live]);
  const messagesWithParts = useMemo((): MessageWithParts[] => displayItems.map((item) => ({ message: item.message as Message, parts: item.parts })), [displayItems]);

  return (
    <>
      <div className="relative flex min-h-0 min-w-0 max-w-full flex-1 flex-col overflow-hidden">
        <VirtualizedTranscript
          displayItems={displayItems}
          messagesWithParts={messagesWithParts}
          sessionId={groupId}
          onNavigateToSubagent={onOpenMemberSession}
          autoFollow={autoFollow}
          onAutoScrollChange={setAutoFollow}
          hasOlder={hasOlder}
          isLoadingOlder={loadingOlder}
          onLoadOlder={onLoadOlder}
          serverUrl={serverUrl}
          emptyContent={<EmptyState variant="plain">Nothing has been said yet. Mention a member to start.</EmptyState>}
        />
      </div>
      {asks.length > 0 && (
        <div className="mx-auto w-full max-w-3xl shrink-0 px-4 py-3" data-testid="group-ask-dock">
          {asks.map(({ member, request }) => (
            <div key={request.requestId ?? request.toolCallId} className="flex flex-col gap-1" data-group-ask={member.agentId}>
              <div className={cn('text-xs font-medium', authorColorClass(member.agentId, members))}>{member.name} needs you</div>
              <AskQuestion request={request} onRespond={onAskResponse ?? (() => {})} />
            </div>
          ))}
        </div>
      )}
    </>
  );
}
