import type { Meta, StoryObj } from '@storybook/react-vite';
import { PierreTreeHost } from './pierreTreeHost';

/**
 * The themed host every Pierre tree mounts into. The CSS variable overrides
 * map Pierre's tokens onto the app theme; this story shows the host with
 * plain rows so the surface, border and hover tokens can be checked without
 * the web component.
 */

const rows = ['src', 'src/auth', 'src/auth/session.ts', 'src/auth/refresh.ts', 'src/components', 'README.md', 'package.json'];

const meta = {
  title: 'Files & Git/PierreTreeHost',
  component: PierreTreeHost,
  parameters: { layout: 'fullscreen' },
  decorators: [(Story) => <div className="flex h-screen w-80 flex-col border-r bg-sidebar text-sidebar-foreground"><Story /></div>],
} satisfies Meta<typeof PierreTreeHost>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    children: (
      <ul className="p-1 text-sm">
        {rows.map((row) => (
          <li key={row} className="truncate rounded-md px-2 py-1 hover:bg-accent" style={{ paddingLeft: `${8 + row.split('/').length * 12}px` }}>
            {row.split('/').pop()}
          </li>
        ))}
      </ul>
    ),
  },
};
