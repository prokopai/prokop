import { z } from 'zod';
import { AskAuthoritySchema, MessageEntity, ServerMessageEntity } from './entities';
import { named, notifications } from './registry';

/**
 * Who receives a delivered message. Mirrors `RuntimeAudience` and
 * `ApplicationDeliveryPort`; Prokop's `host` scope becomes `host.notify`.
 */
export const Audience = named('Audience', z.discriminatedUnion('scope', [
  z.object({ scope: z.literal('global'), excludeOrigin: z.string().optional() }),
  z.object({ scope: z.literal('session'), sessionId: z.string(), excludeOrigin: z.string().optional() }),
  z.object({ scope: z.literal('origin'), origin: z.string() }),
  z.object({ scope: z.literal('controller'), sessionId: z.string() }),
  z.object({ scope: z.literal('ask_targets'), sessionId: z.string(), authority: AskAuthoritySchema }),
]));
export type Audience = z.infer<typeof Audience>;

const Cancel = named('CancelParams', z.object({
  id: z.union([z.number().int(), z.string()]).describe('ID of the in-flight request to cancel.'),
}));

export const agentToHostNotifications = notifications({
  deliver: {
    description: 'Broadcast a client wire message. seq increases by one per deliver, so the host can detect gaps and keep part.append deltas in order.',
    params: z.object({
      seq: z.number().int().nonnegative(),
      audience: Audience,
      message: ServerMessageEntity,
    }),
  },
  'host.notify': {
    description: 'Side effects the host owns: push notifications and file-change notices.',
    params: z.discriminatedUnion('kind', [
      z.object({ kind: z.literal('turn.finished'), sessionId: z.string(), message: MessageEntity }),
      z.object({ kind: z.literal('permission.required'), requestId: z.string(), rootSessionId: z.string() }),
      z.object({ kind: z.literal('files.changed'), sessionId: z.string() }),
    ]),
  },
  '$/cancel': { description: 'Cancel an in-flight agent-to-host request (tool.call).', params: Cancel },
});

export const hostToAgentNotifications = notifications({
  '$/cancel': { description: 'Cancel an in-flight host-to-agent request.', params: Cancel },
});
