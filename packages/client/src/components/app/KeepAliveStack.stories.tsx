import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { KeepAliveStack } from './KeepAliveStack';
import { Button } from '@/components/ui/button';

/**
 * Keeps the last few entries mounted but hidden, so switching back reuses
 * their state. Each panel counts its own mounts and keeps its counter.
 */

function Counter({ label, active }: { label: string; active: boolean }) {
  const [count, setCount] = useState(0);
  return (
    <div className={`flex h-40 flex-col items-center justify-center gap-2 rounded-xl border ${active ? 'bg-card' : 'bg-muted/30'}`}>
      <span className="text-sm">{label} {active ? '(active)' : '(retained, hidden)'}</span>
      <Button variant="outline" onClick={() => setCount((n) => n + 1)}>clicked {count}</Button>
    </div>
  );
}

function Demo({ limit }: { limit: number }) {
  const keys = ['app', 'infra', 'docs', 'scratch'];
  const [active, setActive] = useState<string | null>('app');
  return (
    <div className="flex w-[32rem] flex-col gap-3">
      <div className="flex gap-2">
        {keys.map((key) => <Button key={key} variant={active === key ? 'default' : 'outline'} onClick={() => setActive(key)}>{key}</Button>)}
        <Button variant="ghost" onClick={() => setActive(null)}>none</Button>
      </div>
      <KeepAliveStack active={active ? { key: active, value: active } : null} limit={limit}>
        {(value, isActive) => <Counter label={value} active={isActive} />}
      </KeepAliveStack>
      <p className="text-xs text-muted-foreground">Limit {limit}: older entries unmount and lose their count.</p>
    </div>
  );
}

const meta = {
  title: 'Workspace/KeepAliveStack',
  parameters: { layout: 'centered' },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = { render: () => <Demo limit={3} /> };
export const LimitOne: Story = { render: () => <Demo limit={1} /> };
