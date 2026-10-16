import type { RouterContext } from '@/transport/websocket/router-context';
import type { ConnectionId } from '@/transport/websocket/connection-id';
import { createWirePorts, requireWireApplication } from '@/transport/websocket/application';
import type {
  SessionControlClaimMessage,
  SessionControlReleaseMessage,
} from '@prokopai/sdk';

/**
 * Controller wire handlers. The claim/release state machine stays in the
 * transport control registry behind the control port; these handlers only
 * derive the wire ports and delegate the outcome delivery order to the
 * control application use cases.
 */
export function handleClaimMessage(
  ctx: RouterContext<ConnectionId>,
  ws: ConnectionId,
  msg: SessionControlClaimMessage,
): void {
  const wire = createWirePorts(ctx);
  requireWireApplication().control.claim(wire.delivery, ws, msg.sessionId);
}

export function handleReleaseMessage(
  ctx: RouterContext<ConnectionId>,
  ws: ConnectionId,
  msg: SessionControlReleaseMessage,
): void {
  const wire = createWirePorts(ctx);
  requireWireApplication().control.release(wire.delivery, ws, msg.sessionId);
}
