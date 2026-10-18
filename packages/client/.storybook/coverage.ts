// =============================================================================
// Story coverage exceptions
// =============================================================================
//
// Every file under src/components/**/*.tsx must have a sibling *.stories.tsx,
// or an entry here. `tests/storybook/storyCoverage.test.ts` enforces both
// directions: an entry whose file gained a story, or whose file no longer
// exists, fails the test so this list cannot rot.
//
// Keys are paths relative to src/components. Values say why there is nothing
// to look at. Use one of:
//   provider       wraps the tree, renders children only
//   effect         side effects only (document title, unread counter)
//   covered-by:X   rendered inside X.stories.tsx in every state it has

export const storyCoverageExceptions: Record<string, string> = {
  'app/AttentionStreams.tsx': 'effect',
  'providers/PierreWorkerPoolProvider.tsx': 'provider',
  'providers/QueryProvider.tsx': 'provider',
  'providers/StoreHydrator.tsx': 'provider',
  'providers/ThemeProvider.tsx': 'provider',
  'providers/ThemedToaster.tsx': 'provider',
  'shell/UnreadTracker.tsx': 'effect',
  'shell/WindowTitle.tsx': 'effect',
};
