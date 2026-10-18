import type { Meta, StoryObj } from '@storybook/react-vite';
import { MermaidDiagram } from './MermaidDiagram';

/**
 * Diagrams from agent output and pull request text. Mermaid loads on first
 * use (about 1 MB), so the first story shows the placeholder briefly.
 */

const flow = `flowchart LR
  client[Client] -->|WebSocket| server[Server]
  server --> engine[Agent engine]
  engine --> tools[Tools]
  tools --> engine
  server --> db[(SQLite)]`;

const sequence = `sequenceDiagram
  participant U as User
  participant C as Client
  participant S as Server
  U->>C: Send message
  C->>S: chat.send
  S-->>C: message.part (streaming)
  S-->>C: session.updated`;

function Source({ code }: { code: string }) {
  return <pre className="rounded-lg bg-muted/40 p-3 font-mono text-xs">{code}</pre>;
}

const meta = {
  title: 'Shared/MermaidDiagram',
  component: MermaidDiagram,
  parameters: {
    layout: 'padded',
    smoke: 'skip: Mermaid renders into a live SVG measuring layout, which happy-dom has no layout for',
  },
} satisfies Meta<typeof MermaidDiagram>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Flowchart: Story = {
  args: { code: flow, source: <Source code={flow} /> },
};

export const Sequence: Story = {
  args: { code: sequence, source: <Source code={sequence} /> },
};

export const InvalidSyntax: Story = {
  args: { code: 'graph TD\n  A --> ', source: <Source code={'graph TD\n  A --> '} /> },
};
