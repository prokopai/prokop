import type { Meta, StoryObj } from '@storybook/react-vite';
import { AnthropicMark, OpenAIMark, ProkopMark } from './BrandMarks';
import * as Providers from './ProviderMarks';

/** Vendor and product marks drawn with `currentColor`, at the sizes the chrome uses them. */

const SIZES = ['size-3.5', 'size-4', 'size-5', 'size-6', 'size-8'] as const;

const meta = {
  title: 'Shared/BrandMarks',
  parameters: { layout: 'centered' },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: () => (
    <div className="grid grid-cols-[6rem_repeat(5,auto)] items-center gap-x-6 gap-y-4">
      <span className="text-xs text-muted-foreground">Prokop</span>
      {SIZES.map((size) => <ProkopMark key={size} className={size} />)}
      <span className="text-xs text-muted-foreground">OpenAI</span>
      {SIZES.map((size) => <OpenAIMark key={size} className={size} />)}
      <span className="text-xs text-muted-foreground">Anthropic</span>
      {SIZES.map((size) => <AnthropicMark key={size} className={size} />)}
      {Object.entries(Providers).map(([name, Mark]) => (
        <div key={name} className="contents">
          <span className="text-xs text-muted-foreground">{name.replace(/Mark$/, '')}</span>
          {SIZES.map((size) => <Mark key={size} className={size} />)}
        </div>
      ))}
    </div>
  ),
};

export const Muted: Story = {
  render: () => (
    <div className="flex items-center gap-4 text-muted-foreground">
      <ProkopMark className="size-5" />
      <OpenAIMark className="size-5" />
      <AnthropicMark className="size-5" />
    </div>
  ),
};
