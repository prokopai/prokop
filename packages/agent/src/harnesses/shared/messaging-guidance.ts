/**
 * The one messaging paragraph every harness adds to its system prompt when
 * `message_agent` is in the session's tool list. Claude Code and Codex also
 * have tools that list and message live sessions of their own kind; those
 * never reach the user's other agents, so the paragraph says so.
 */
export function messagingGuidance(howToCall: string, peerSessionTools: boolean): string {
  const peers = peerSessionTools
    ? ' Your own session-listing or peer-messaging tools see only live sessions of your own kind, never these agents; an agent with no session running is still reachable here.'
    : '';
  return `message_agent sends a message to another of the user's agents, named in the tool's description, which answers as itself in its own home with its own memory; the user can open that conversation. Use it to ask an agent something only it knows (its memory, its past work), or to hand it a request, a status, a result or an FYI; never for your own subagents. ${howToCall}. It returns at once; for a request or a question the answer arrives later as a new message in this session that starts with "[message from"; do not poll for it and do not send acknowledgement-only messages.${peers}`;
}

/** Prokop calls the tool directly from its tool list. */
export const PROKOP_MESSAGING_CALL = 'The tool is message_agent in your tool list';
