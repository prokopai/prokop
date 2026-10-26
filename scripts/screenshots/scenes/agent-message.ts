/** The session that asked Reviewer a question and relayed its answer. */
import { openSession, type Scene } from '../scene';
import { AGENT_MESSAGE_READY } from '../world/agent-message';

export const agentMessage: Scene = {
  name: 'agent-message',
  open: (ctx, theme) => openSession(ctx, theme, ctx.world.agentMessage, AGENT_MESSAGE_READY),
};
