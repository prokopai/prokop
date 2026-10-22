import type { LearningScope, Preconfig, SessionHarness } from '@prokopai/sdk';
import type { SessionWirePorts } from './delivery';

/**
 * Resolved child-run contract for headless (scheduled) execution. The
 * scheduled-job runner resolves session identity, preconfig, model, and
 * provider selection; the owning harness executes the child run inside its
 * own runtime scope. Infrastructure never reaches harness internals.
 */
export interface HeadlessSessionRunInput {
  harness: SessionHarness;
  parentSessionId: string;
  childSessionId: string;
  preconfig: Preconfig;
  prompt: string;
  workspacePath: string | undefined;
  workspaceId: string;
  modelId: string;
  providerId: string;
  resumeFromHistory: boolean;
  /** A learning review: the harness composes the restricted review scope and
   * its tools call back through `LearningReviewToolPort`. */
  learning?: LearningReviewSpec;
}

export interface LearningReviewSpec {
  scope: LearningScope;
  improveSkills: boolean;
  /** Offer `home_files` (agent scope only). */
  home: boolean;
  systemPrompt: string;
}

export interface HeadlessRunOptions {
  /** Aborts the run (learning review budget and shutdown); a delegated child is interrupted. */
  signal?: AbortSignal;
  /**
   * Keep the child's deliveries: clients see the session live, as they do a
   * Prokop subagent. The installed dispatcher turns this into `wire`.
   */
  visible?: boolean;
  /** The wire a visible run broadcasts through; supplied by the dispatcher. */
  wire?: SessionWirePorts<unknown>;
}

export interface HeadlessSessionRunResult {
  error?: string;
}

export interface HeadlessSessionRunPort {
  run(input: HeadlessSessionRunInput, options?: HeadlessRunOptions): Promise<HeadlessSessionRunResult>;
  /** Harnesses whose registrations provide headless runs; job creation
   * rejects harnesses outside this set. */
  supportedHarnesses(): SessionHarness[];
}

let current: HeadlessSessionRunPort | null = null;

/** Install (or clear with null) the headless dispatch port. Bootstrap
 * installs the harness-registry dispatcher after wiring registrations;
 * consumers without an installed port fail closed per run. */
export function installHeadlessExecutionPort(port: HeadlessSessionRunPort | null): void {
  current = port;
}

export function getHeadlessExecutionPort(): HeadlessSessionRunPort | null {
  return current;
}

type HeadlessSendMessage = <Origin>(
  wire: SessionWirePorts<Origin>,
  origin: Origin,
  sessionId: string,
  content: string,
) => Promise<void>;

/**
 * Run one headless agent turn over a harness sendMessage entry. Without a
 * wire every delivery sink is discarded (there is no client); a visible run
 * passes the dispatcher's wire so the session's clients follow the turn.
 * The returned promise settles when the turn completes. An error the harness
 * reports on the wire (a session that cannot start) becomes the result's
 * error; a thrown one too.
 */
export function runHeadlessTurn(
  sendMessage: HeadlessSendMessage,
  input: HeadlessSessionRunInput,
  options?: Pick<HeadlessRunOptions, 'wire'>,
): Promise<HeadlessSessionRunResult> {
  let reported: string | undefined;
  const base = options?.wire;
  const wire: SessionWirePorts<unknown> = {
    delivery: {
      send: (_origin, message) => {
        if (message.type === 'error') reported ??= message.message;
      },
      broadcast: (message, excludeOrigin) => base?.delivery.broadcast(message, excludeOrigin),
      broadcastToSession: (sessionId, message, excludeOrigin) => base?.delivery.broadcastToSession(sessionId, message, excludeOrigin),
      sendToController: (sessionId, message) => base?.delivery.sendToController(sessionId, message),
      sendToAskTargets: (sessionId, authority, message) => base?.delivery.sendToAskTargets(sessionId, authority, message),
    },
    actor: { attachOriginToSession: () => {} },
  };
  return sendMessage(wire, `headless:${input.childSessionId}`, input.childSessionId, input.prompt)
    .then((): HeadlessSessionRunResult => (reported ? { error: reported } : {}))
    .catch((error: unknown): HeadlessSessionRunResult => ({
      error: error instanceof Error ? error.message : 'Headless run failed',
    }));
}
