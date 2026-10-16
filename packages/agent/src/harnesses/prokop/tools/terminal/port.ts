/** A terminal session as the terminal tool sees it. */
export interface AgentTerminalInfo {
  id: string;
  title: string;
  cwd: string;
  status: string;
  exitCode?: number | null;
  origin?: 'user' | 'agent';
  lastActivityAt?: number;
}

export interface AgentTerminalCreateOptions {
  cwd: string;
  workspaceId: string;
  origin: 'user' | 'agent';
  agentEnv?: Record<string, string>;
  title?: string;
  ownerSessionId?: string;
}

/**
 * The host terminals the terminal tool drives. The host owns the PTYs; the
 * port wraps the terminal manager. Bootstrap installs one.
 */
export interface AgentTerminalPort {
  create(options: AgentTerminalCreateOptions): Promise<string | null>;
  get(id: string): Promise<AgentTerminalInfo | null>;
  executionCwd(id: string): Promise<string | null>;
  setCwd(id: string, cwd: string): Promise<boolean>;
  write(id: string, data: string): Promise<boolean>;
  read(id: string, fromOffset: number, maxBytes: number): Promise<{ text: string; nextOffset: number; totalBytes: number } | null>;
  list(workspacePath: string): Promise<AgentTerminalInfo[]>;
  destroy(id: string): Promise<void>;
}

let port: AgentTerminalPort | null = null;

export function configureAgentTerminals(value: AgentTerminalPort | null): void {
  port = value;
}

export function agentTerminals(): AgentTerminalPort {
  if (!port) throw new Error('Terminal access is not configured');
  return port;
}
