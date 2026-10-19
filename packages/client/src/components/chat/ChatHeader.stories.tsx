import type { Meta, StoryObj } from '@storybook/react-vite';
import { ChatHeader } from './ChatHeader';
import {
  createSession,
} from '../../../.storybook/mocks/mockSession';
import {
  createPreconfigList,
} from '../../../.storybook/mocks/mockPreconfig';
import {
  createModelList,
} from '../../../.storybook/mocks/mockProvider';
import {
  withSessionStore,
  withServerDataStore,
} from '../../../.storybook/mocks/storeDecorators';

const preconfigs = createPreconfigList();
const models = createModelList().map((m) => ({
  id: m.id,
  name: m.name,
  contextWindow: m.contextWindow,
  providerId: m.providerId,
  providerName: m.providerName,
}));
const defaultUsage = {
  promptTokens: 2500,
  completionTokens: 1800,
  totalTokens: 4300,
  cacheReadTokens: 1600,
  cacheWriteTokens: 200,
  noCacheTokens: 700,
};

const meta = {
  title: 'Chat/ChatHeader',
  component: ChatHeader,
  parameters: {
    layout: 'fullscreen',
  },
  decorators: [
    withSessionStore(),
    withServerDataStore(),
  ],
  args: {
    session: createSession({ title: 'Refactoring the auth module' }),
    preconfigs,
    models,
    usage: defaultUsage,
    modelName: 'Claude 3.5 Sonnet',
    onRename: () => {},
  },
} satisfies Meta<typeof ChatHeader>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const ArchivedSession: Story = {
  args: {
    session: createSession({ title: 'Old conversation', status: 'closed' }),
  },
};

export const UntitledSession: Story = {
  args: {
    session: createSession({ title: null }),
  },
};

export const LongTitle: Story = {
  args: {
    session: createSession({
      title: 'Very long session title that should truncate when it overflows the available space in the header area',
    }),
  },
};

export const Streaming: Story = {
  args: {
    isStreaming: true,
  },
};

export const NotStreaming: Story = {
  args: {
    isStreaming: false,
  },
};

export const WithCompacting: Story = {
  args: {
    onCompact: () => {},
    isCompacting: true,
  },
};

export const SubagentSession: Story = {
  args: {
    session: createSession({
      title: 'Subagent: Explore codebase',
      parentId: 'parent-sess-1',
    }),
    onNavigateBack: () => {},
  },
};

export const HighTokenUsage: Story = {
  args: {
    usage: {
      promptTokens: 85000,
      completionTokens: 32000,
      totalTokens: 117000,
      cacheReadTokens: 60000,
      cacheWriteTokens: 5000,
      noCacheTokens: 20000,
    },
  },
};

export const NearLimit: Story = {
  args: {
    usage: {
      promptTokens: 92000,
      completionTokens: 6000,
      totalTokens: 98000,
      cacheReadTokens: 80000,
      cacheWriteTokens: 2000,
      noCacheTokens: 10000,
    },
  },
};

export const CodexModel: Story = {
  args: {
    session: createSession({ title: 'Codex session', harness: 'codex-cli', selectedModel: 'gpt-5-codex' }),
  },
};

export const CodexModelUnknown: Story = {
  args: {
    session: createSession({ title: 'Older Codex session', harness: 'codex-cli', selectedModel: null }),
  },
};

export const MinimalHeader: Story = {
  args: {
    session: createSession({ title: 'Quick chat' }),
    usage: {
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      noCacheTokens: 0,
    },
  },
};
