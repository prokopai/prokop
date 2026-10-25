import { useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ChevronRight, MoreHorizontal, Pencil, Trash2, Users } from 'lucide-react';
import { toast } from 'sonner';
import type { ProkopaiClient } from '@prokopai/sdk';
import { useWorkspaceViewVisible } from '@/components/app/WorkspaceViewHost';
import { ErrorState, LoadingState } from '@/components/shared/States';
import { Button } from '@/components/ui/button';
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog';
import { dockHeaderClassName } from '@/components/ui/dock-header';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useScopedServerData } from '@/contexts/HostScopeContext';
import { useOptionalSessionCommands } from '@/contexts/SessionCommandsContext';
import { SessionPaneRegistryContext } from '@/contexts/SessionPaneRegistryContext';
import { useServerUrl } from '@/contexts/ServerClientContext';
import {
  flattenGroupMessages,
  useDeleteGroup,
  useGroupMessagesQuery,
  useGroupQuery,
  usePostGroupMessage,
  useRemoveGroupMember,
  useUpdateGroup,
} from '@/hooks/queries/useGroupQueries';
import { ensureMemberSessionContent, useGroupLiveReplies, useGroupMemberStatuses } from '@/hooks/useGroupMemberStatuses';
import { authorColorClass } from '@/lib/groupAuthors';
import { useConnectionStore } from '@/stores/connectionStore';
import { cn } from '@/lib/utils';
import { useUIStore } from '@/stores/uiStore';
import { groupViewId } from '@/stores/workspaceViewStore';
import { GroupComposer, type GroupComposerHandle } from './GroupComposer';
import { GroupMemberChips } from './GroupMemberChips';
import { GroupThread, type GroupMemberAsk } from './GroupThread';

/** A group keeps at least this many members (the server refuses to go lower). */
const MIN_MEMBERS = 2;

export interface GroupViewProps {
  client: ProkopaiClient;
  serverId: string;
  groupId: string;
  /** The workspace the group lives in, shown before its name like a session's. */
  projectName?: string;
}

/**
 * One group chat in the center: the members and what they are doing, the
 * shared thread with replies as they are written, the members' pending
 * approvals, and the composer. While it is on screen this client watches the
 * member sessions, so their approvals and their streamed parts arrive here
 * instead of nowhere.
 */
export function GroupView({ client, serverId, groupId, projectName }: GroupViewProps) {
  const visible = useWorkspaceViewVisible();
  const serverUrl = useServerUrl();
  const connected = useConnectionStore((state) => state.connected);
  const commands = useOptionalSessionCommands();
  // The same prompts a session composer offers.
  const prompts = useScopedServerData((state) => state.prompts);
  const setShowGroupDialog = useUIStore((state) => state.setShowGroupDialog);
  const group = useGroupQuery(client, groupId);
  const thread = useGroupMessagesQuery(client, groupId);
  const messages = useMemo(() => flattenGroupMessages(thread.data), [thread.data]);
  const post = usePostGroupMessage(client, groupId);
  const update = useUpdateGroup(client);
  const removeMember = useRemoveGroupMember(client);
  const remove = useDeleteGroup(client);
  const states = useGroupMemberStatuses(client, serverId, group.data);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const members = group.data?.members ?? [];
  const live = useGroupLiveReplies(members);
  const memberSessionKey = members.map((member) => member.sessionId).join('\u0000');
  const composerRef = useRef<GroupComposerHandle | null>(null);
  const workingSessionIds = states.filter((state) => state.status === 'working').map((state) => state.member.sessionId);
  const stopAllRef = useRef<() => void>(() => {});
  stopAllRef.current = () => { for (const sessionId of workingSessionIds) commands?.handleInterruptSessionById(sessionId); };

  // The focus-input and stop shortcuts reach this pane under its view id, like a session pane under its session id.
  const registry = useContext(SessionPaneRegistryContext);
  useLayoutEffect(() => {
    if (!registry) return;
    const id = groupViewId(serverId, groupId);
    registry.register(id, {
      focusInput: () => composerRef.current?.focus(),
      stop: () => stopAllRef.current(),
      scrollToBottom: () => {},
      toggleAutoFollow: () => {},
    });
    return () => registry.unregister(id);
  }, [registry, serverId, groupId]);

  // Watching a member session makes this client its controller and a
  // participant without loading its transcript: pending approvals are synced
  // here and replies stream in as they are written. Again after a reconnect,
  // since the server forgets.
  useEffect(() => {
    if (!visible || !connected || !memberSessionKey) return;
    const sessionIds = memberSessionKey.split('\u0000');
    // Streamed messages are only kept for sessions with content in the store; open an empty entry first.
    ensureMemberSessionContent(sessionIds);
    for (const sessionId of sessionIds) client.sessions.watch(sessionId);
  }, [visible, connected, client, memberSessionKey]);

  const asks: GroupMemberAsk[] = useMemo(() => states.flatMap((state) => state.asks.map((request) => ({ member: state.member, request }))), [states]);
  const openMemberSession = commands ? (sessionId: string) => commands.resumeSession(sessionId) : undefined;
  const failed = (what: string) => (error: Error) => toast.error(what, { description: error.message });

  if (group.isPending) return <LoadingState label="Loading the group" />;
  if (group.isError || !group.data) {
    return <ErrorState onRetry={() => void group.refetch()}>{group.error?.message ?? 'This group is gone.'}</ErrorState>;
  }
  const current = group.data;

  return (
    // The same surface as a session pane, so the two read as one kind of thing side by side.
    <div className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-card">
      {/* One row on a wide pane. On a narrow one the members take a second row of their own, scrolling sideways, instead of wrapping over the thread. */}
      <div className={cn(dockHeaderClassName(), '@container/chips h-auto min-h-9 flex-wrap gap-x-2 gap-y-1 py-1')}>
        {projectName && (
          <span className="flex min-w-0 shrink items-center gap-1 text-sm text-muted-foreground" title={`Workspace: ${projectName}`}>
            <span className="max-w-[10rem] truncate">{projectName}</span>
            <ChevronRight aria-hidden className="size-3.5 shrink-0 text-muted-foreground/60" />
          </span>
        )}
        <Users className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        <h2 className="min-w-0 shrink truncate text-base font-semibold leading-none" title={current.name}>{current.name}</h2>
        <div className="flex min-w-0 flex-1 items-center py-0.5 @max-lg/chips:order-last @max-lg/chips:basis-full">
          <GroupMemberChips entries={states.map(({ member, status }) => ({
            member,
            status,
            isDefault: member.agentId === current.defaultAgentId,
            colorClass: authorColorClass(member.agentId, members),
            onOpenSession: openMemberSession ? () => openMemberSession(member.sessionId) : undefined,
            onStop: commands ? () => commands.handleInterruptSessionById(member.sessionId) : undefined,
            onMakeDefault: () => update.mutate({ groupId, updates: { defaultAgentId: member.agentId } }, { onError: failed('Could not change the default member') }),
            onRemove: members.length > MIN_MEMBERS
              ? () => removeMember.mutate({ groupId, agentId: member.agentId }, { onError: failed(`Could not remove ${member.name}`) })
              : undefined,
          }))} />
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-xs" className="ml-auto" aria-label="Group actions" title="Group actions"><MoreHorizontal /></Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-44">
            <DropdownMenuItem onClick={() => setShowGroupDialog(true, current)}>
              <Pencil className="size-4" />
              Edit group
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onClick={() => setConfirmDelete(true)}>
              <Trash2 className="size-4" />
              Delete group
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {thread.isError ? (
        <ErrorState onRetry={() => void thread.refetch()}>{thread.error.message}</ErrorState>
      ) : (
        <GroupThread
          groupId={groupId}
          serverUrl={serverUrl ?? undefined}
          members={members}
          messages={messages}
          hasOlder={thread.hasNextPage}
          loadingOlder={thread.isFetchingNextPage}
          onLoadOlder={() => void thread.fetchNextPage()}
          live={live}
          asks={asks}
          onAskResponse={commands?.handleAskResponse}
          onOpenMemberSession={openMemberSession}
        />
      )}
      <GroupComposer
        ref={composerRef}
        members={members}
        defaultAgentId={current.defaultAgentId}
        disabled={!connected}
        sending={post.isPending}
        working={workingSessionIds.length > 0}
        onStop={commands ? () => stopAllRef.current() : undefined}
        prompts={prompts}
        permissionMode={current.permissionMode}
        onPermissionModeChange={(permissionMode) => update.mutate({ groupId, updates: { permissionMode } }, { onError: failed('Could not change the permission mode') })}
        onSend={async (text, mentions) => {
          try {
            await post.mutateAsync({ text, ...(mentions.length > 0 ? { mentions } : {}) });
          } catch (error) {
            toast.error('Message not sent', { description: error instanceof Error ? error.message : String(error) });
            throw error;
          }
        }}
      />
      <ConfirmationDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="Delete this group?"
        description={`"${current.name}" and its ${members.length} member sessions go away. Running members are stopped.`}
        confirmLabel="Delete"
        variant="destructive"
        onConfirm={() => remove.mutate({ id: current.id, workspaceId: current.workspaceId }, { onError: failed('Could not delete the group') })}
      />
    </div>
  );
}
