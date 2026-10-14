export interface SandboxCallMessage {
  role: string;
  content: unknown;
}

export interface SandboxToolDefinition {
  name: string;
  description: string;
  inputSchema: unknown;
}

export interface LlmCallContext {
  callId: string;
  sessionId: string;
  depth: number;
  mode: 'stream' | 'generate';
  messages: SandboxCallMessage[];
  systemPrompt?: string;
  tools: SandboxToolDefinition[];
  modelId: string;
  providerId: string;
  timestamp: number;
  parentCallId?: string;
}

/** Token counts reported for a scripted step; defaults stay tiny when omitted. */
export interface SandboxUsage {
  inputTokens: number;
  outputTokens: number;
}

/**
 * Streams reasoning and text word by word with delays, so a recording shows
 * the reply being written. Without it, a response arrives at once.
 */
export interface SandboxPacing {
  /** Wait before the first chunk, like a model's time to first token. */
  initialDelayMs?: number;
  /** Wait between chunks. */
  chunkDelayMs: number;
}

export interface TextResponse {
  type: 'text';
  content: string;
  usage?: SandboxUsage;
  pacing?: SandboxPacing;
}

/** Optional reasoning and text stream before the tool calls, like a real model's progress note. */
interface ToolCallPreamble {
  reasoning?: string;
  text?: string;
  usage?: SandboxUsage;
  pacing?: SandboxPacing;
}

export interface ToolCallResponse extends ToolCallPreamble {
  type: 'tool-call';
  toolName: string;
  args: Record<string, unknown>;
  toolCallId?: string;
}

export interface MultiToolCallResponse extends ToolCallPreamble {
  type: 'multi-tool-call';
  calls: Array<{
    toolName: string;
    args: Record<string, unknown>;
    toolCallId?: string;
  }>;
}

export interface ErrorResponse {
  type: 'error';
  error: string;
  errorType?: 'rate_limit' | 'server' | 'timeout' | 'auth' | 'invalid_request';
}

export interface ReasoningResponse {
  type: 'reasoning';
  reasoning: string;
  text: string;
  usage?: SandboxUsage;
  pacing?: SandboxPacing;
}

export type SandboxResponse =
  | TextResponse
  | ToolCallResponse
  | MultiToolCallResponse
  | ErrorResponse
  | ReasoningResponse;

export interface AutoResponderRule {
  match: {
    mode?: 'stream' | 'generate';
    depth?: number | number[];
    sessionId?: string | string[];
    hasToolResults?: boolean;
  };
  response: SandboxResponse;
  maxUses?: number;
  label?: string;
}

export interface SandboxHistoryEntry {
  callId: string;
  context: LlmCallContext;
  response: SandboxResponse | null;
  respondedAt: number | null;
  completedAt: number | null;
}

export interface SandboxCallWaitingEvent {
  type: 'sandbox.call_waiting';
  context: LlmCallContext;
}

export interface SandboxRespondMessage {
  type: 'sandbox.respond';
  callId: string;
  response: SandboxResponse;
}

export interface SandboxCallCompletedEvent {
  type: 'sandbox.call_completed';
  callId: string;
}

export interface SandboxHistoryEvent {
  type: 'sandbox.history';
  entries: SandboxHistoryEntry[];
}

export type SandboxControlEvent =
  | SandboxCallWaitingEvent
  | SandboxCallCompletedEvent
  | SandboxHistoryEvent;
