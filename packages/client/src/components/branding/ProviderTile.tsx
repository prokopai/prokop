import type { ComponentType } from 'react';
import { AnthropicMark, OpenAIMark, ProkopMark } from '@/components/branding/BrandMarks';
import {
  AzureMark, CerebrasMark, CohereMark, DeepSeekMark, FireworksMark, GeminiMark, GitHubMark, GroqMark,
  KimiMark, MiniMaxMark, MistralMark, OpenRouterMark, PerplexityMark, QwenMark, TogetherMark, XaiMark, ZaiMark,
} from '@/components/branding/ProviderMarks';
import { cn } from '@/lib/utils';

type Mark = ComponentType<{ className?: string }>;

interface Brand {
  Mark: Mark;
  /** Tile fill in oklch; the mark is drawn white on it. Omit for a neutral tile. */
  tint?: string;
  /** Match the provider id or its name (lower-cased) by this fragment. */
  match: string[];
}

/** Known providers in match order; the first fragment found in the id or name wins. */
const BRANDS: Brand[] = [
  // Azure first: "Azure OpenAI" is Azure, not OpenAI.
  { Mark: AzureMark, tint: 'oklch(0.57 0.17 250)', match: ['azure'] },
  { Mark: OpenAIMark, match: ['codex', 'openai', 'chatgpt', 'gpt'] },
  { Mark: AnthropicMark, tint: 'oklch(0.66 0.14 45)', match: ['anthropic', 'claude'] },
  { Mark: DeepSeekMark, tint: 'oklch(0.56 0.2 265)', match: ['deepseek'] },
  { Mark: ZaiMark, match: ['zhipu', 'z.ai', 'zai', 'glm'] },
  { Mark: MiniMaxMark, tint: 'oklch(0.6 0.22 15)', match: ['minimax'] },
  { Mark: GeminiMark, tint: 'oklch(0.58 0.17 262)', match: ['gemini', 'google', 'vertex'] },
  { Mark: OpenRouterMark, tint: 'oklch(0.58 0.2 285)', match: ['openrouter'] },
  { Mark: XaiMark, match: ['xai', 'grok'] },
  { Mark: MistralMark, tint: 'oklch(0.68 0.19 50)', match: ['mistral'] },
  { Mark: GroqMark, tint: 'oklch(0.63 0.21 30)', match: ['groq'] },
  { Mark: GitHubMark, match: ['github', 'copilot'] },
  { Mark: KimiMark, match: ['kimi', 'moonshot'] },
  { Mark: QwenMark, tint: 'oklch(0.56 0.2 290)', match: ['qwen', 'alibaba', 'dashscope'] },
  { Mark: PerplexityMark, tint: 'oklch(0.6 0.1 220)', match: ['perplexity'] },
  { Mark: TogetherMark, tint: 'oklch(0.58 0.19 265)', match: ['together'] },
  { Mark: FireworksMark, tint: 'oklch(0.6 0.2 300)', match: ['fireworks'] },
  { Mark: CerebrasMark, tint: 'oklch(0.63 0.2 30)', match: ['cerebras'] },
  { Mark: CohereMark, tint: 'oklch(0.6 0.15 320)', match: ['cohere'] },
  { Mark: ProkopMark, match: ['prokop'] },
];

/** The brand for a provider id or display name, or null for an unknown one. */
export function providerBrand(id: string, name?: string): Brand | null {
  const haystack = `${id} ${name ?? ''}`.toLowerCase();
  return BRANDS.find((brand) => brand.match.some((fragment) => haystack.includes(fragment))) ?? null;
}

interface ProviderTileProps {
  /** Provider id, such as `deepseek` or `zhipu-coding`. */
  provider: string;
  /** Display name; also searched for a brand, and its initial is the fallback. */
  name?: string;
  size?: 'sm' | 'md';
  className?: string;
}

/**
 * A rounded tile with the provider's mark, so a list of accounts or
 * providers can be scanned by shape and color before reading. Unknown
 * providers get a neutral tile with the name's initial. Decorative: the
 * name next to it is the accessible label.
 */
export function ProviderTile({ provider, name, size = 'md', className }: ProviderTileProps) {
  const brand = providerBrand(provider, name);
  const sizeClass = size === 'sm' ? 'size-5 rounded-sm [&_svg]:size-3' : 'size-6 rounded-md [&_svg]:size-3.5';
  const initial = (name ?? provider).trim().charAt(0).toUpperCase() || '?';
  return (
    <span
      aria-hidden="true"
      data-slot="provider-tile"
      className={cn(
        'flex shrink-0 items-center justify-center shadow-xs',
        brand?.tint ? 'text-white' : 'bg-foreground/10 text-foreground',
        sizeClass,
        className,
      )}
      style={brand?.tint ? { backgroundColor: brand.tint } : undefined}
    >
      {brand ? <brand.Mark /> : <span className={cn('font-semibold leading-none', size === 'sm' ? 'text-2xs' : 'text-xs')}>{initial}</span>}
    </span>
  );
}
