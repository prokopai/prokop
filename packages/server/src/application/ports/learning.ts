/**
 * Learning persistence port: reviewers, evidence queue, review runs, their
 * destinations and file changes. Implemented by
 * `infrastructure/sqlite/learning-repository.ts`.
 */

export interface LearningReviewerRecord {
  workspace_id: string;
  reviewer_id: string;
  activated_at: number;
  backfill_from: number;
  last_started_at: number | null;
}

export interface LearningEvidenceRecord {
  sequence: number;
  workspace_id: string;
  reviewer_id: string;
  session_id: string;
  message_id: string;
  completed_at: number;
  reviewed_at: number | null;
}

export interface LearningRunRecord {
  id: string;
  workspace_id: string;
  reviewer_id: string;
  status: 'running' | 'completed' | 'failed' | 'interrupted';
  started_at: number;
  finished_at: number | null;
  lease_until: number;
  error: string | null;
}

export interface LearningDestinationRecord {
  run_id: string;
  workspace_path: string;
  memory_directory: string;
  skills_directory: string;
}

export interface LearningChangeRecord {
  id: string;
  run_id: string;
  operation_id: string;
  relative_path: string;
  before_content: string | null;
  after_content: string | null;
  status: 'prepared' | 'applied' | 'conflict' | 'undone';
  created_at: number;
}

export type LearningRunResult = { success: true } | { success: false; error: string; interrupted?: boolean };

export interface LearningRepository {
  getRun(id: string): LearningRunRecord | null;
  reviewSessionId(runId: string): string | null;
  isRecovered(runId: string): boolean;
  recoveryCandidates(workspaceId: string): LearningRunRecord[];
  /** Retire old operations without writing files or consuming unfinished evidence. */
  completeRecovery(runId: string, now: number): void;
  sources(runId: string): Array<{ message_id: string; session_id: string }>;
  recordSource(runId: string, messageId: string): void;
  isResolved(runId: string): boolean;
  /** Explicit user acknowledgement retains files and consumes the batch, never retries its writes. */
  keepCurrent(runId: string, now: number): void;
  activeRun(workspaceId: string): LearningRunRecord | null;
  destination(runId: string): LearningDestinationRecord | null;
  bindDestination(input: LearningDestinationRecord): void;
  getReviewer(workspaceId: string, reviewerId: string): LearningReviewerRecord | null;
  pending(workspaceId: string, reviewerId: string, limit?: number, eligible?: (messageId: string) => boolean): LearningEvidenceRecord[];
  changes(runId: string): LearningChangeRecord[];
  blocked(workspaceId: string): boolean;
  discardPending(sequence: number): void;
  activate(workspaceId: string, reviewerId: string, now: number): LearningReviewerRecord;
  enqueue(workspaceId: string, reviewerId: string, sessionId: string, messageId: string, completedAt: number): boolean;
  claim(workspaceId: string, reviewerId: string, now: number, leaseMs: number, limit?: number,
    eligible?: (messageId: string) => boolean): LearningRunRecord | null;
  evidence(runId: string): LearningEvidenceRecord[];
  heartbeat(runId: string, now: number, leaseMs: number): boolean;
  finish(runId: string, now: number, result: LearningRunResult): boolean;
  /** Startup only, after proving no writer from this process is still running. */
  recover(now: number): number;
  listRuns(workspaceId: string, limit?: number): LearningRunRecord[];
  prepareChange(input: Omit<LearningChangeRecord, 'id' | 'status'>): LearningChangeRecord;
  hasUndoIntent(changeId: string): boolean;
  prepareUndo(changeId: string, now: number): boolean;
  finishUndo(changeId: string, success: boolean): boolean;
  transitionChange(id: string, from: LearningChangeRecord['status'], to: LearningChangeRecord['status']): boolean;
}
