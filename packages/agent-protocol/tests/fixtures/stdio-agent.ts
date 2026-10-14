/** A minimal agent over its own stdio: answers `title.native` and asks the host back. */
import { createAgentEndpoint } from '../../src/index';
import { createStreamChannel } from '../../src/stream';

const agent = createAgentEndpoint({
  channel: createStreamChannel({ readable: Bun.stdin.stream(), writer: { write: text => process.stdout.write(text) } }),
  handlers: {
    'title.native': async ({ sessionId }) => {
      const session = await agent.request('store.session.get', { id: sessionId });
      return { title: session ? `native ${String((session as { title?: string }).title)}` : null };
    },
    shutdown: () => {
      setTimeout(() => process.exit(0), 0);
      return {};
    },
  },
});
