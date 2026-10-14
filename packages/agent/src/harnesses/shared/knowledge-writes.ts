/**
 * Where approved memory and skill writes run. Writes share a process-local
 * lock with learning and agent settings (`withKnowledgeMutationLock`), so
 * when the agent runs apart from the host, the host must apply them. Unset,
 * writes run in this process.
 */
export type KnowledgeWrite = (
  kind: 'memory' | 'skill',
  directory: string,
  input: Record<string, unknown>,
) => Promise<Record<string, unknown>>;

let delegate: KnowledgeWrite | null = null;

export function configureKnowledgeWrites(value: KnowledgeWrite | null): void {
  delegate = value;
}

/** The delegate for this call, or null to write locally (host-side callers pass `local`). */
export function knowledgeWriteDelegate(options?: { local?: boolean }): KnowledgeWrite | null {
  return options?.local ? null : delegate;
}
