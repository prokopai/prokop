import { useRef, useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn } from 'storybook/test';
import { ComposerEditor, type ComposerEditorHandle, type ComposerTrigger } from './ComposerEditor';
import { Button } from '@/components/ui/button';

/**
 * The TipTap editor inside the composer: plain text plus reference chips.
 * Type `@` to raise a file trigger and `/` for a prompt trigger (shown below
 * the editor; the autocomplete itself lives in PromptAutocomplete).
 */

interface Args {
  initial: string;
  placeholder: string;
  disabled: boolean;
  onChange: (value: string) => void;
  onTriggerChange: (trigger: ComposerTrigger | null) => void;
  onOpenFile: (reference: unknown) => void;
}

function Harness({ initial, placeholder, disabled, onChange, onTriggerChange, onOpenFile }: Args) {
  const [value, setValue] = useState(initial);
  const [trigger, setTrigger] = useState<ComposerTrigger | null>(null);
  const ref = useRef<ComposerEditorHandle>(null);
  return (
    <div className="flex w-[40rem] max-w-full flex-col gap-3">
      <div className="rounded-xl border bg-card p-3">
        <ComposerEditor
          ref={ref}
          value={value}
          onChange={(next) => { setValue(next); onChange(next); }}
          onTriggerChange={(next) => { setTrigger(next); onTriggerChange(next); }}
          onKeyDown={() => false}
          onOpenFile={onOpenFile}
          placeholder={placeholder}
          disabled={disabled}
        />
      </div>
      <div className="flex gap-2">
        <Button variant="outline" onClick={() => ref.current?.insertReference({ kind: 'file', path: 'src/index.ts' })}>Insert file chip</Button>
        <Button variant="outline" onClick={() => ref.current?.insertReference({ kind: 'file', path: 'src/components/', lineStart: undefined })}>Insert folder chip</Button>
        <Button variant="outline" onClick={() => ref.current?.insertReference({ kind: 'terminal', id: 'term-1', label: 'zsh', text: '$ bun test\n 12 pass' })}>Insert terminal chip</Button>
        <Button variant="ghost" onClick={() => ref.current?.focus()}>Focus</Button>
      </div>
      <pre className="rounded-md bg-muted/40 p-2 font-mono text-2xs text-muted-foreground">
        value: {JSON.stringify(value)}{'\n'}trigger: {JSON.stringify(trigger)}
      </pre>
    </div>
  );
}

const meta = {
  title: 'Chat/ComposerEditor',
  parameters: { layout: 'centered' },
  args: {
    initial: '',
    placeholder: 'Ask anything about your codebase…',
    disabled: false,
    onChange: fn(),
    onTriggerChange: fn(),
    onOpenFile: fn(),
  },
  render: (args) => <Harness {...args} />,
} satisfies Meta<Args>;

export default meta;
type Story = StoryObj<Args>;

export const Empty: Story = {};

export const WithText: Story = {
  args: { initial: 'Refactor the auth module and keep the public API.\n\nAdd tests for token refresh.' },
};

export const WithReferences: Story = {
  args: { initial: 'Look at [src/auth/session.ts](src/auth/session.ts#L42-L58) and [src/index.ts](src/index.ts), then explain the flow.' },
};

export const Disabled: Story = {
  args: { initial: 'Cannot edit while the session is observed.', disabled: true },
};
