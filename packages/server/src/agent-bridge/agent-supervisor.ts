import {
  createHostEndpoint, createStreamChannel,
  type AgentSide, type HostEndpoint, type HostHandlers, type HostToAgentParams, type NotificationHandlers,
} from '@prokopai/agent-protocol';

export interface AgentSupervisorOptions {
  /** The agent process command, e.g. `[bun, packages/agent/src/main.ts, --stdio]`. */
  command: string[];
  /** The child's environment, read at each spawn (`Bun.spawn` alone uses the env from process start). */
  env(): Record<string, string | undefined>;
  handlers: HostHandlers;
  notifications: NotificationHandlers<AgentSide>;
  /** Params of the first request each new process gets. */
  initialize(): HostToAgentParams<'initialize'>;
  /** Host-side view of agent work: turns in flight or sessions the agent reports active. */
  isBusy(): boolean;
  /** With no request in flight and not busy for this long, the process is shut down. */
  idleMs: number;
  /** After every exit. `expected` is false for a crash; the host runs its recovery then. */
  onExit(info: { code: number | null; expected: boolean }): void | Promise<void>;
}

export interface AgentSupervisor {
  /** Spawns and initializes the agent on the first request after it is gone. */
  readonly endpoint: HostEndpoint;
  /** Call when `isBusy()` may have changed, so the idle timer starts or stops. */
  activityChanged(): void;
  pid(): number | null;
  /** Shuts the running process down (`shutdown`, then end of stdin, then kill after 5 s). */
  stop(): Promise<void>;
}

interface Instance {
  child: ReturnType<typeof Bun.spawn<'pipe', 'pipe', 'inherit'>>;
  endpoint: HostEndpoint;
  ready: Promise<HostEndpoint>;
  stopping: boolean;
  /** Runs once, on channel close or process exit, whichever comes first. */
  exit(): Promise<void>;
}

/**
 * Host side of the agent process (host/agent split, Phase 2): spawn on
 * demand, one JSON-RPC connection over its stdio, idle exit, and an exit
 * callback for crash recovery. A crash fails every request in flight with
 * `ChannelClosed`; the next request starts a new process.
 */
export function createAgentSupervisor(options: AgentSupervisorOptions): AgentSupervisor {
  let current: Instance | null = null;
  let pending = 0;
  /** A process is exiting: the next one starts only after it is gone and the host recovered. */
  let exiting: Promise<void> | null = null;
  let idleTimer: ReturnType<typeof setTimeout> | null = null;

  const clearIdle = (): void => {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = null;
  };
  const scheduleIdle = (): void => {
    if (!current || pending > 0 || options.isBusy()) {
      clearIdle();
      return;
    }
    if (idleTimer) return;
    idleTimer = setTimeout(() => {
      idleTimer = null;
      if (pending === 0 && !options.isBusy()) void stop();
    }, options.idleMs);
  };

  function start(): Instance {
    const child = Bun.spawn(options.command, {
      stdin: 'pipe', stdout: 'pipe', stderr: 'inherit', windowsHide: true, env: options.env(),
    });
    const endpoint = createHostEndpoint({
      channel: createStreamChannel({
        readable: child.stdout,
        writer: child.stdin,
        onInvalidLine: line => console.warn('[agent] dropped a non-JSON line:', line.slice(0, 200)),
      }),
      handlers: options.handlers,
      notifications: options.notifications,
      onProtocolError: error => console.warn('[agent] protocol error:', error.message),
    });
    let exited: Promise<void> | null = null;
    const instance: Instance = {
      child, endpoint, stopping: false,
      ready: endpoint.request('initialize', options.initialize()).then(() => endpoint),
      exit: () => exited ??= (async () => {
        if (current === instance) {
          current = null;
          clearIdle();
        }
        endpoint.close(new Error('Agent process exited'));
        // After a crash the channel usually closes first: wait for the process, killing it if it lingers.
        if (await Promise.race([child.exited.then(() => true), Bun.sleep(5000).then(() => false)]) === false) child.kill();
        const code = await child.exited;
        if (!instance.stopping) console.error(`[agent] process ${child.pid} exited unexpectedly (code ${code})`);
        await options.onExit({ code, expected: instance.stopping });
      })(),
    };
    instance.ready.catch((error: unknown) => {
      console.error('[agent] initialize failed:', error instanceof Error ? error.message : error);
      instance.stopping = true;
      child.kill();
    });
    current = instance;
    console.info(`[agent] started process ${child.pid}`);
    const onGone = (): void => {
      const done = instance.exit();
      exiting = done;
      void done.catch(() => {}).finally(() => {
        if (exiting === done) exiting = null;
      });
    };
    void endpoint.closed.then(onGone);
    void child.exited.then(onGone);
    return instance;
  }

  async function stop(): Promise<void> {
    const instance = current;
    if (!instance) return;
    // Later requests start a new process while this one shuts down.
    current = null;
    instance.stopping = true;
    clearIdle();
    try {
      await instance.endpoint.request('shutdown', {}, { timeoutMs: 5000 });
    } catch {
      // Exiting anyway.
    }
    instance.endpoint.close(new Error('Agent process stopped'));
    await instance.exit();
  }

  const endpoint = {
    async request(method: string, params: unknown, requestOptions?: { signal?: AbortSignal; timeoutMs?: number }) {
      pending++;
      clearIdle();
      try {
        while (exiting) await exiting;
        const connected = await (current ?? start()).ready;
        return await (connected.request as (m: string, p: unknown, o?: unknown) => Promise<unknown>)(method, params, requestOptions);
      } finally {
        pending--;
        scheduleIdle();
      }
    },
    notify(method: string, params: unknown) {
      // Host notifications only concern a running agent.
      (current?.endpoint.notify as ((m: string, p: unknown) => void) | undefined)?.(method, params);
    },
    close() {
      void stop();
    },
    closed: new Promise<Error>(() => {}),
  } as unknown as HostEndpoint;

  return {
    endpoint,
    activityChanged: scheduleIdle,
    pid: () => current?.child.pid ?? null,
    stop,
  };
}
