import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn } from 'storybook/test';
import { AppSidebar } from './AppSidebar';
import { SessionMenuButton } from './SessionMenuButton';
import { SidebarGroup, SidebarGroupContent, SidebarGroupLabel, SidebarMenu } from '@/components/ui/sidebar';
import { createSidebarSessions } from '../../../.storybook/mocks/mockSidebar';

/**
 * The scrollable session list container: owns keyboard navigation between
 * rows (arrows, Home, End, Escape back to the composer). Content is passed in.
 */

const { sessions, childrenMap, derived } = createSidebarSessions('ws-1');
const current = sessions[0]!;

function Rows({ currentSessionId }: { currentSessionId: string | null }) {
  return (
    <SidebarGroup>
      <SidebarGroupLabel>Sessions</SidebarGroupLabel>
      <SidebarGroupContent>
        <SidebarMenu>
          {sessions.filter((session) => !session.parentId && session.status !== 'closed').map((session) => (
            <SessionMenuButton
              key={session.id}
              session={session}
              childrenMap={childrenMap}
              sessionDerivedValues={derived}
              isActive={session.id === currentSessionId}
              currentSessionId={currentSessionId}
              onResumeSession={fn()}
              onCloseSession={fn()}
              onReopenSession={fn()}
              onDeleteSession={fn()}
              onRename={fn()}
            />
          ))}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}

const meta: Meta<typeof AppSidebar> = {
  title: 'Sessions/AppSidebar',
  component: AppSidebar,
  parameters: { layout: 'fullscreen' },
  args: { currentSessionId: current.id, onEscape: fn(), children: <Rows currentSessionId={current.id} /> },
  decorators: [(Story) => <div className="flex h-screen w-80 flex-col border-r bg-sidebar text-sidebar-foreground"><Story /></div>],
};

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const WithHeader: Story = {
  args: { header: <div className="px-3 py-2 text-sm font-medium">my-project</div> },
};

export const NoCurrentSession: Story = {
  args: { currentSessionId: null, children: <Rows currentSessionId={null} /> },
};

export const Empty: Story = {
  args: { children: <div className="px-4 py-8 text-center text-xs text-muted-foreground">No sessions yet.</div> },
};
