import type { Meta, StoryObj } from '@storybook/react-vite';
import { SessionLearningMenu } from './SessionLearningMenu';
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';
import { createSession } from '../../../.storybook/mocks/mockSession';
import { withSessionStore } from '../../../.storybook/mocks/storeDecorators';
import { withSdkClient } from '../../../.storybook/harness';

/** The per-session learning toggle inside a session's menu. */

const included = createSession({ id: 'sess-included', title: 'Included session' });
const excluded = createSession({ id: 'sess-excluded', title: 'Excluded session', metadata: { learning: { excluded: true } } });

function Open({ sessionId }: { sessionId: string }) {
  return (
    <DropdownMenu open>
      <DropdownMenuTrigger asChild><Button variant="outline">Session menu</Button></DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <SessionLearningMenu sessionId={sessionId} />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

const meta = {
  title: 'Sessions/SessionLearningMenu',
  component: SessionLearningMenu,
  parameters: { layout: 'centered' },
  decorators: [withSessionStore({ sessions: [included, excluded] }), withSdkClient({ http: { sessions: { setLearning: async (id, settings) => ({ session: createSession({ id, metadata: { learning: settings } }) }) } } })],
  render: ({ sessionId }) => <Open sessionId={sessionId} />,
} satisfies Meta<typeof SessionLearningMenu>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Included: Story = { args: { sessionId: included.id } };
export const Excluded: Story = { args: { sessionId: excluded.id } };
export const UnknownSession: Story = { args: { sessionId: 'missing' } };
