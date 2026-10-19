import type { Meta, StoryObj } from '@storybook/react-vite';
import { ProviderTile } from './ProviderTile';

/** Provider tiles at both sizes, known brands first, then the initial fallback. */

const PROVIDERS: Array<[string, string]> = [
  ['codex', 'Codex (ChatGPT)'],
  ['anthropic', 'Anthropic'],
  ['deepseek', 'DeepSeek'],
  ['zhipu-coding', 'Z.AI (Coding Plan)'],
  ['minimax', 'MiniMax'],
  ['google', 'Gemini'],
  ['openrouter', 'OpenRouter'],
  ['xai', 'xAI'],
  ['mistral', 'Mistral'],
  ['groq', 'Groq'],
  ['azure', 'Azure OpenAI'],
  ['github', 'GitHub Models'],
  ['moonshot', 'Kimi'],
  ['qwen', 'Qwen'],
  ['perplexity', 'Perplexity'],
  ['together', 'Together'],
  ['fireworks', 'Fireworks'],
  ['cerebras', 'Cerebras'],
  ['cohere', 'Cohere'],
  ['custom-1', 'Local gateway'],
];

const meta = {
  title: 'Shared/ProviderTile',
  component: ProviderTile,
  parameters: { layout: 'centered' },
} satisfies Meta<typeof ProviderTile>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: { provider: 'deepseek', name: 'DeepSeek' },
};

export const Small: Story = {
  args: { provider: 'minimax', name: 'MiniMax', size: 'sm' },
};

export const Unknown: Story = {
  args: { provider: 'custom-1', name: 'Local gateway' },
};

export const Catalog: Story = {
  args: { provider: 'deepseek', name: 'DeepSeek' },
  render: () => (
    <div className="grid grid-cols-[auto_auto_1fr] items-center gap-x-4 gap-y-2 text-sm">
      {PROVIDERS.map(([id, name]) => (
        <div key={id} className="contents">
          <ProviderTile provider={id} name={name} />
          <ProviderTile provider={id} name={name} size="sm" />
          <span>{name}</span>
        </div>
      ))}
    </div>
  ),
};
