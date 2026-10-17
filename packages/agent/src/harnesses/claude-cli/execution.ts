import type { AssistantMessage, Session, TextPart, ToolPart } from '@prokopai/sdk';
import { forkSession, getSessionMessages, type SDKMessage, type SDKUserMessage, type Options, type SdkMcpToolDefinition } from '@anthropic-ai/claude-agent-sdk';
import type { SessionWirePorts } from '@prokopai/core/application/ports/delivery';
import { persistCliSessionRunning, withCliMessageQueue, type QueuedCliExecution, type QueuedTurnInput } from '#agent/harnesses/shared/message-queue';
import {
  deleteClaudeRollbackIntent, getClaudeBinding, getClaudeRollbackIntent, hasClaudeForkIntent, insertClaudeBinding,
  isClaudeNativeSessionBound, markClaudeBindingPending, releaseClaudeBinding, setClaudeRollbackPhase,
  startClaudeRollbackIntent,
} from './native-state';
import {
  createMessage, createPart, getHandoffBrief, getSession, getToolPartByCallId, listMessagesWithParts,
  transitionToolToCompleted, transitionToolToError, transitionToolToInterrupted, updateMessage, updatePart, updateSession,
} from '@prokopai/core/infrastructure/storage/runtime';
import { storeTransaction } from '@prokopai/core/infrastructure/storage/transaction';
import { getClaudeModelSelection } from './models';
import { claudeCliVersion } from './version';
import { StreamingTextWriter } from '#agent/harnesses/shared/streaming-text';
import { describeError, logHarness, StderrTail } from '#agent/harnesses/shared/diagnostics';
import { runClaudeTurn, type ClaudeSteerInput } from './sdk-turn';
import { commitSteer, pendingSteers, type DispatchedSteer } from '#agent/harnesses/shared/steering';
import { readClaudeGoalVerdict } from './goal-transcript';
import { runClaudeCompact } from './compact';
import { claudeApprovals, type ClaudeApprovals } from './approvals';
import { ClaudeChildTimelines } from './child-timelines';
import { loadClaudeImages, resolveClaudeImages, type ClaudeImage } from './images';
import type { ClaudeTurnUsage } from './usage';
import {
  applyClaudeRollback, groupClaudeTurns, groupLocalTurns, inheritedUserIds, matchClaudeHistoryPrefix,
  type ClaudeRollbackDependencies,
} from './rollback';
import { forkClaudeSession } from './fork';
import { claudeDeveloperInstructions, type ClaudeInstructionSources } from './instructions';
import { pinDefaultPreconfig, resolveTurnPreconfig } from '#agent/harnesses/shared/cli-instructions';
import { createClaudeMemoryTools, createClaudeSessionSearchTools, createClaudeSkillManageTools } from './dynamic-tools';
import { resolveCliWorkspaceRoot } from '#agent/harnesses/shared/cli-workspace';
import { notifyHarnessTurnFinished } from '#agent/harnesses/shared/notifications';
import { notifySessionFilesChanged } from '#agent/harnesses/shared/files-changed';
import { claudeToolInput, claudeToolName, claudeToolSummary, claudeToolVisualization } from '#agent/harnesses/shared/tool-viz';
import type { AgentSkillsDomainBridge, MemoryDomainBridge, SessionSearchDomainBridge } from '#agent/harnesses/shared/domain-tools';
import { ensureSessionTempDir, sessionTempInstructions } from '@prokopai/core/infrastructure/filesystem/session-temp';
import { HARNESS_SWITCH_EDIT_REASON, HARNESS_SWITCH_FORK_REASON } from '@prokopai/core/domains/sessions/harness-state';
import type { WorkspaceMcpToolsPort } from '@prokopai/core/application/ports/mcp-tools';
import { createClaudeWorkspaceMcp } from './mcp-tools';
import { announceUserTurn, createUserTurnParts, streamingAssistant } from '#agent/harnesses/shared/turn-records';
import { patchSessionMetadata } from '#agent/harnesses/shared/session-metadata';


export interface ClaudeExecutionDependencies extends ClaudeRollbackDependencies {
  start?: (prompt: string | AsyncIterable<SDKUserMessage>, options: Options) => AsyncIterable<SDKMessage>;
  approvals?: ClaudeApprovals;
  version?: () => string;
  readGoalVerdict?: typeof readClaudeGoalVerdict;
  instructions?: ClaudeInstructionSources;
  memoryTools?: MemoryDomainBridge;
  sessionSearch?: SessionSearchDomainBridge;
  agentSkills?: AgentSkillsDomainBridge;
  mcp?: WorkspaceMcpToolsPort;
}

interface ClaudeSteerRun {
  send(input: ClaudeSteerInput): boolean;
  session: Session;
  /** Handed to the CLI and not yet started, keyed by host user message id. */
  dispatched: Map<string, DispatchedSteer>;
  /** Serializes dispatch so concurrent wake-ups never send a row twice. */
  chain: Promise<void>;
}

export function createClaudeExecution(deps: ClaudeExecutionDependencies = {}): QueuedCliExecution {
  const active = new Map<string, AbortController>();
  const steerable = new Map<string, ClaudeSteerRun>();
  function dispatchSteers(sessionId: string): Promise<void> {
    const run = steerable.get(sessionId);
    if (!run) return Promise.resolve();
    run.chain = run.chain.then(async () => {
      for (const queued of await pendingSteers(sessionId, run.dispatched.values())) {
        // Unusable images stay queued; the drain reports them like any queued send.
        const images = await resolveClaudeImages(run.session, queued.attachments ?? []);
        if (!images) continue;
        let loaded: ClaudeImage[];
        try { loaded = await loadClaudeImages(images); } catch { continue; }
        if (steerable.get(sessionId) !== run) return;
        const steer: DispatchedSteer = { queued, userMessageId: crypto.randomUUID(),
          images: images.map(image => ({ id: image.id, accessKey: image.accessKey, mimeType: image.mimeType })) };
        run.dispatched.set(steer.userMessageId, steer);
        if (!run.send({ id: steer.userMessageId, text: queued.content, images: loaded })) {
          run.dispatched.delete(steer.userMessageId);
          return;
        }
        logHarness('claude-cli', 'steer dispatched', { sessionId, queueId: queued.id }, 'info');
      }
    }).catch((error: unknown) => {
      logHarness('claude-cli', 'steer dispatch failed', { sessionId, ...describeError(error) });
    });
    return run.chain;
  }
  const rollingBack = new Set<string>();
  const resubmitting = new Map<string, string>();
  const intent = (id: string): Promise<{ phase: string; target_message_id: string } | null> => getClaudeRollbackIntent(id);

  const recoveryHint = (pending: { phase: string }): string => pending.phase === 'ready'
    ? 'Claude edit was not sent; edit that message again to resend it'
    : 'Claude edit outcome is uncertain; edit the first message to start over';

  /** An applied edit whose resend never reached Claude is resent as is; its text may still change. */
  async function resumeEdit(sessionId: string, messageId: string, content: string): Promise<boolean> {
    const pending = await intent(sessionId);
    if (pending?.phase !== 'ready' || pending.target_message_id !== messageId) return false;
    const session = await getSession(sessionId);
    if (!session || session.harness !== 'claude-cli' || session.parentId || session.status !== 'active'
      || active.has(sessionId) || rollingBack.has(sessionId)) throw new Error('Claude session is unavailable or busy');
    if (!content.trim() || content !== content.trim() || content.length > 4000) {
      throw new Error('Claude edit requires nonempty text');
    }
    const target = (await listMessagesWithParts(sessionId)).at(-1);
    const part = target?.parts[0];
    if (target?.message.id !== messageId || target.message.role !== 'user' || part?.type !== 'text') {
      throw new Error('Claude edit target changed');
    }
    if (part.text !== content && !await updatePart(part.id, { text: content })) throw new Error('Claude edit text is unavailable');
    return true;
  }

  async function rollback(sessionId: string, operation: 'edit' | 'revert', targetId: string,
    content: string | null): Promise<import('@prokopai/core/application/ports/execution').RevertExecutionResult> {
    const session = await getSession(sessionId);
    if (!session || session.harness !== 'claude-cli' || session.parentId || session.status !== 'active'
      || active.has(sessionId) || rollingBack.has(sessionId)) throw new Error('Claude session is unavailable or busy');
    if (session.metadata?.claudeCompactPending || session.metadata?.claudeGoal
      || session.metadata?.claudeCompactedAt) throw new Error('Claude Goal or Compact history cannot be edited');
    if (session.harnessSwitches?.length) throw new Error(HARNESS_SWITCH_EDIT_REASON);
    if (operation === 'edit' && (!content?.trim() || content !== content.trim() || content.length > 4000)) {
      throw new Error('Claude edit requires nonempty text');
    }
    rollingBack.add(sessionId);
    try {
      // Apply is one transaction that also advances the intent. A fork-phase intent
      // therefore means the transcript and binding are untouched: drop it and start over.
      await deleteClaudeRollbackIntent(undefined, sessionId, 'fork');
      const { root } = await resolveCliWorkspaceRoot(session, 'Claude');
      const binding = await getClaudeBinding(sessionId);
      const local = await listMessagesWithParts(sessionId);
      const inherited = await inheritedUserIds(local);
      let localTurns;
      try { localTurns = groupLocalTurns(local); }
      catch { throw new Error('Invalid Claude history target'); }
      // Edit drops the edited prompt's turn and everything after it. Undo at the
      // first prompt drops everything; Undo at a reply keeps that reply's turn.
      const targetTurn = localTurns.findIndex(turn => turn.user.message.id === targetId
        || turn.reply?.message.id === targetId);
      const atUser = localTurns[targetTurn]?.user.message.id === targetId;
      const turnCount = operation === 'edit' && atUser ? targetTurn
        : operation === 'revert' && atUser && targetTurn === 0 ? 0
          : operation === 'revert' && !atUser ? targetTurn + 1 : -1;
      if (targetTurn < 0 || turnCount < 0 || turnCount >= localTurns.length) {
        throw new Error('Invalid Claude history target');
      }
      const firstRemoved = localTurns[turnCount]!.start;
      // Rolling back to the first message drops the native conversation entirely, so it
      // needs no native history and also clears a stuck turn or an unfinished edit.
      if (turnCount > 0) {
        if (await intent(sessionId)) throw new Error('Claude history change requires recovery; do not retry');
        if (!binding || binding.pending || binding.workspace_root !== root) {
          throw new Error('Claude native history is unavailable');
        }
      }
      // Only the kept turns must match native history. Discarded turns may hold
      // tool output or a stopped or failed reply and never block the rollback.
      const turns = turnCount === 0 || !binding ? [] : matchClaudeHistoryPrefix(localTurns,
        await (deps.readHistory ?? getSessionMessages)(binding.native_session_id, { dir: root }),
        binding.native_session_id, turnCount, inherited);
      const cutoffTurn = turnCount === 0 ? null : turns[turnCount - 1]!;
      if (cutoffTurn && cutoffTurn.assistantId === null) {
        throw new Error('Claude conversation history is not available for Edit or Undo');
      }
      const cutoff = cutoffTurn?.assistantId ?? null;
      // The intent survives a lost fork response. Do not issue this fork a second time.
      await startClaudeRollbackIntent(sessionId, operation, targetId);
      let forkedId: string | null = null;
      let inheritedUsers: Array<{ messageId: string; nativeId: string }> = [];
      if (cutoff && binding) {
        const forked = await (deps.forkHistory ?? forkSession)(binding.native_session_id,
          { dir: root, upToMessageId: cutoff });
        forkedId = forked.sessionId;
        if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(forkedId)
          || forkedId === binding.native_session_id || await isClaudeNativeSessionBound(forkedId)) {
          throw new Error('Claude fork identity is invalid');
        }
        const forkedHistory = await (deps.readHistory ?? getSessionMessages)(forkedId, { dir: root });
        let forkedTurns;
        try { forkedTurns = groupClaudeTurns(forkedHistory, forkedId); }
        catch { throw new Error('Claude fork history cannot be verified'); }
        if (forkedTurns.length !== turnCount || forkedTurns.some((turn, index) =>
          turn.length !== turns[index]!.length || turn.userText !== turns[index]!.userText
          || turn.answered !== turns[index]!.answered || turn.assistantText !== turns[index]!.assistantText)) {
          throw new Error('Claude fork history cannot be verified');
        }
        inheritedUsers = forkedTurns.map((turn, index) => ({
          messageId: localTurns[index]!.user.message.id, nativeId: turn.userId,
        }));
      }
      return await applyClaudeRollback({ sessionId, operation, targetId, content,
        originalNativeId: binding?.native_session_id ?? null, newNativeId: forkedId, firstRemoved, inheritedUsers });
    } catch (error) {
      // Apply never committed, so nothing changed: an orphan native fork file is harmless.
      await deleteClaudeRollbackIntent(undefined, sessionId, 'fork');
      throw error;
    } finally { rollingBack.delete(sessionId); }
  }
  return withCliMessageQueue({
    isSessionActive: id => active.has(id) || rollingBack.has(id),
    steer: async (_wire, sessionId) => dispatchSteers(sessionId),
    async interruptSession(id) {
      const controller = active.get(id);
      controller?.abort();
      (deps.approvals ?? claudeApprovals).cancelSession(id);
      return { sessionId: id, success: !!controller, cascadedTo: [], interruptedTools: [], rejectedAsks: [] };
    },
    async sendMessage<Origin>(wire: SessionWirePorts<Origin>, origin: Origin, sessionId: string,
      content: string, attachments?: Array<{ id: string; kind: string }>, responseFormatId?: string,
      goalCondition?: string, goalMaxTurns?: number, goalTokenBudget?: number,
      queued?: QueuedTurnInput, onTurnStarted?: () => Promise<void>): Promise<'drainable' | void> {
      const reject = (message: string): void => wire.delivery.send(origin,
        { type: 'error', code: 'invalid_session', message, sessionId });
      const session = await getSession(sessionId);
      if (!session || session.harness !== 'claude-cli' || session.parentId || session.status !== 'active') {
        return reject('Not an active Claude CLI session');
      }
      if ((!content.trim() && !attachments?.length) || responseFormatId
        || goalMaxTurns !== undefined || goalTokenBudget !== undefined) {
        return reject('Claude CLI supports text and image messages only');
      }
      if (goalCondition !== undefined && (goalCondition !== content || !content.trim()
        || content !== content.trim() || content.length > 4000 || /[\r\n]/.test(content)
        || attachments?.length)) return reject('Invalid Claude goal condition');
      const images = await resolveClaudeImages(session, attachments ?? []);
      if (!images) return reject('Claude image attachment is unavailable or unsupported');
      if (session.metadata?.claudeCompactPending) return reject('Claude compaction outcome is uncertain; do not send in this session');
      const priorGoal = session.metadata?.claudeGoal as { status?: string } | undefined;
      if (priorGoal?.status === 'active' || priorGoal?.status === 'uncertain') {
        return reject('Claude goal requires reconciliation; do not send in this session');
      }
      const resubmit = resubmitting.get(sessionId);
      if (rollingBack.has(sessionId) || active.has(sessionId)) return reject('Claude CLI turn already running');
      // Claimed before the first await so a concurrent send or rollback is refused.
      const controller = new AbortController();
      active.set(sessionId, controller);
      try {
        // No rollback is running, so a fork-phase intent is left from a crash before Apply: nothing changed.
        await deleteClaudeRollbackIntent(undefined, sessionId, 'fork');
        const pendingEdit = await intent(sessionId);
        if (pendingEdit && (pendingEdit.phase !== 'ready' || pendingEdit.target_message_id !== resubmit)
          || resubmit && !pendingEdit) {
          active.delete(sessionId);
          return reject(pendingEdit?.phase === 'ready' && !resubmit
            ? 'Claude edit was not sent; edit that message again to resend it'
            : 'Claude edit outcome is uncertain; edit the first message to start over');
        }
      } catch (error) {
        active.delete(sessionId);
        throw error;
      }
      let assistant: AssistantMessage | null = null;
      interface TextSegment { part: TextPart; text: string }
      // Text interleaves with tool calls: each tool-start closes the open
      // text segment so following text becomes a new part after the tool
      // rows instead of appending above them.
      const segments: TextSegment[] = [];
      let openSegment: TextSegment | null = null;
      // Parts sort by created_at; a monotonic clock keeps segments and tool
      // rows strictly ordered even when created in the same millisecond.
      let partClock = 0;
      const nextCreatedAt = (): number => {
        partClock = Math.max(Date.now(), partClock + 1);
        return partClock;
      };
      const openTools = new Set<string>();
      const openText = (): string => openSegment?.text ?? '';
      const streamText = new StreamingTextWriter();
      const settleOpenSegment = async (): Promise<void> => {
        if (!openSegment) return;
        const updated = await streamText.settle(openSegment.part.id);
        if (updated) wire.delivery.broadcastToSession(sessionId, { type: 'part.updated', sessionId, part: updated });
      };
      const approvals = deps.approvals ?? claudeApprovals;
      let children: ClaudeChildTimelines | null = null;
      let ownedNativeId: string | null = null;
      let drainable = false;
      let terminalResult = false;
      const startedAt = Date.now();
      const stderr = new StderrTail();
      const steers = new Map<string, DispatchedSteer>();
      let phase = 'setup';
      try {
        const imageData = await loadClaudeImages(images);
        const { workspace, root } = await resolveCliWorkspaceRoot(session, 'Claude');
        const workspaceMcpTools = deps.mcp ? await deps.mcp.tools(workspace.path, sessionId) : [];
        const workspaceMcp = deps.mcp ? createClaudeWorkspaceMcp(workspaceMcpTools, controller.signal, async () => {
          const current = await getSession(sessionId);
          return active.get(sessionId) === controller && current?.harness === 'claude-cli' && current.workspaceId === session.workspaceId
            && current.status === 'active' && current.workspaceRootId === session.workspaceRootId;
        }) : undefined;
        const version = (deps.version ?? claudeCliVersion)();
        const selection = await getClaudeModelSelection(sessionId);
        if (!selection) throw new Error('Choose a Claude model and effort before sending');
        // Mirror Codex's developer instructions: agent identity, workspace
        // context, and opted-in memory appended to Claude Code's own prompt.
        const tempDirectory = ensureSessionTempDir(sessionId);
        let developerInstructions: string | undefined;
        let dynamicTools: SdkMcpToolDefinition[] = [];
        const sources = deps.instructions;
        if (sources) {
          const { preconfigId, preconfig, agentDir } = await resolveTurnPreconfig(session, workspace, sources, 'Claude');
          if (deps.memoryTools) {
            // Per-turn registration mirrors Codex: workspace setting plus the selected agent home.
            dynamicTools = await createClaudeMemoryTools({ bridge: deps.memoryTools,
              sessionId, workspaceId: session.workspaceId, root, agentDir, preconfigId,
              signal: controller.signal });
          }
          if (deps.sessionSearch && workspace.settings.sessionSearch?.enabled === true) {
            // Same in-process server; gated on the workspace session-search setting.
            dynamicTools = [...dynamicTools, ...await createClaudeSessionSearchTools({
              bridge: deps.sessionSearch, sessionId, workspaceId: session.workspaceId,
              preconfigId, agentDir, signal: controller.signal })];
          }
          if (deps.agentSkills && agentDir) {
            // The agent's own skill directory is writable; no workspace setting or ask applies.
            dynamicTools = [...dynamicTools, ...await createClaudeSkillManageTools({
              bridge: deps.agentSkills, sessionId, workspaceId: session.workspaceId,
              preconfigId, agentDir, signal: controller.signal })];
          }
          developerInstructions = await claudeDeveloperInstructions(workspace, root, preconfig, {
            ...sources, getAgentDirectory: async () => agentDir,
          }, [...dynamicTools.map(item => item.name), ...workspaceMcpTools.map(tool => tool.name)]);
          await pinDefaultPreconfig(session, preconfigId, agentDir, wire.delivery);
        }
        const binding = await getClaudeBinding(sessionId);
        // A CLI upgrade does not block: the CLI resumes its own older sessions.
        if (binding && (binding.workspace_root !== root || binding.pending)) {
          logHarness('claude-cli', 'native binding blocks turn', { sessionId,
            pendingFromEarlierTurn: !!binding.pending, workspaceChanged: binding.workspace_root !== root });
          throw new Error('Claude turn requires reconciliation or its workspace changed; edit the first message to start over');
        }
        if (binding && binding.cli_version !== version) {
          logHarness('claude-cli', 'cli upgraded', { sessionId, from: binding.cli_version, to: version }, 'info');
        }
        controller.signal.throwIfAborted();
        if (queued && !await queued.isPending()) return 'drainable';
        const nativeId = binding?.native_session_id ?? crypto.randomUUID();
        phase = 'turn';
        logHarness('claude-cli', 'turn start', { sessionId, resume: !!binding, model: selection.model,
          effort: selection.effort, goal: goalCondition !== undefined, queued: !!queued, resubmit: !!resubmit }, 'info');
        const goalStartedAt = Date.now();
        children = new ClaudeChildTimelines(session, nativeId, wire.delivery);
        // Lock the native identity before writing to the process. A lost result never triggers replay.
        await storeTransaction(async (tx) => {
          if (binding) await markClaudeBindingPending(tx, sessionId, version);
          else insertClaudeBinding(tx, sessionId, nativeId, root, version, true);
          if (resubmit) await setClaudeRollbackPhase(tx, sessionId, 'sent', 'ready');
        });
        ownedNativeId = nativeId;
        if (goalCondition !== undefined) {
          const updated = await patchSessionMetadata(sessionId, {
            claudeGoal: { condition: goalCondition, status: 'active', iterations: 0 } });
          if (!updated) throw new Error('Claude goal state could not be saved');
          wire.delivery.broadcastToSession(sessionId, { type: 'session.updated', session: updated });
        }
        const user = resubmit ? (await listMessagesWithParts(sessionId)).find(entry => entry.message.id === resubmit)?.message
          : await createMessage({ id: crypto.randomUUID(), sessionId, role: 'user', createdAt: Date.now() });
        if (!user || user.role !== 'user') throw new Error('Claude edit message is unavailable');
        const userParts = await createUserTurnParts(sessionId, user.id, {
          text: content.trim() && !resubmit ? content : null, images,
          imageCreatedAt: index => Date.now() + index + 1 });
        await queued?.accepted();
        await onTurnStarted?.();
        announceUserTurn(wire, origin, sessionId, resubmit ? null : user, userParts);
        assistant = await createMessage(streamingAssistant(sessionId, {
          modelId: selection.model, providerId: 'claude-cli', agent: session.agentId })) as AssistantMessage;
        wire.delivery.broadcastToSession(sessionId, { type: 'message.created', message: assistant });
        let result: string | null = null;
        let goalActivated = false;
        let goalCleared = false;
        let usage: ClaudeTurnUsage | null = null;
        let contextUsage: { used: number; window: number } | null = null;
        const toolOwners = new Map<string, string>();
        const backgroundAgents = new Set<string>();
        const saveText = async (next: string, delta?: string): Promise<void> => {
          if (!assistant) return;
          if (!openSegment) {
            const part = await createPart({ id: crypto.randomUUID(), messageId: assistant.id, type: 'text',
              text: delta === undefined ? next : '', createdAt: nextCreatedAt() }, sessionId) as TextPart;
            wire.delivery.broadcastToSession(sessionId, { type: 'part.created', sessionId, part });
            openSegment = { part, text: delta === undefined ? next : '' };
            segments.push(openSegment);
          }
          if (delta !== undefined) {
            streamText.append(sessionId, openSegment.part, next);
            wire.delivery.broadcastToSession(sessionId, { type: 'part.append', sessionId,
              partId: openSegment.part.id, field: 'text', delta });
          } else if (openSegment.part.text !== next) {
            const updated = await streamText.settle(openSegment.part.id, next);
            if (updated) wire.delivery.broadcastToSession(sessionId, { type: 'part.updated', sessionId, part: updated });
          }
          openSegment = { part: { ...openSegment.part, text: next }, text: next };
        };
        const handoffBrief = await getHandoffBrief(sessionId);
        for await (const event of runClaudeTurn({ cwd: root, prompt: content, images: imageData,
          userMessageId: user.id, instructions: [developerInstructions, sessionTempInstructions(tempDirectory), handoffBrief].filter(Boolean).join('\n\n'), dynamicTools, workspaceMcp, tempDirectory,
          goalCondition, sessionId: nativeId, resume: !!binding,
          model: selection.model, effort: selection.effort,
          controller, canUseTool: approvals.request(sessionId, session.workspaceId, root, wire.delivery,
            controller.signal, id => children?.childSessionId(toolOwners.get(id) ?? '') ?? null),
          onToolOwner: (id, owner) => { if (owner) toolOwners.set(id, owner); },
          stderr: chunk => stderr.push(chunk),
          onSteerable: send => {
            steerable.set(sessionId, { send, session, dispatched: steers, chain: Promise.resolve() });
            // Steer rows queued before this turn started enter it right away.
            void dispatchSteers(sessionId);
          },
          start: deps.start })) {
          if (event.type === 'goal-state') {
            if (event.active) {
              if (goalCleared) throw new Error('Claude goal state changed after completion');
              goalActivated = true;
            } else {
              if (!goalActivated) throw new Error('Claude goal cleared without activation');
              goalCleared = true;
            }
            const previous = await getSession(sessionId);
            if (!previous) throw new Error('Claude goal session disappeared');
            const updated = await patchSessionMetadata(sessionId, {
              claudeGoal: { condition: goalCondition, status: 'active',
                iterations: event.iterations ?? ((previous.metadata?.claudeGoal as { iterations?: number } | undefined)?.iterations ?? 0) } });
            if (!updated) throw new Error('Claude goal state could not be saved');
            wire.delivery.broadcastToSession(sessionId, { type: 'session.updated', session: updated });
            continue;
          }
          if (event.type === 'steer-started') {
            const steer = steers.get(event.id);
            if (!steer) continue;
            steers.delete(event.id);
            // The steered message follows everything streamed so far; the rest of the turn answers it.
            await settleOpenSegment();
            openSegment = null;
            if (segments.length === 0 && result) {
              await saveText(result);
              await settleOpenSegment();
              openSegment = null;
            }
            const answered = await updateMessage(assistant.id, { status: 'completed', completedAt: Date.now() });
            if (answered) wire.delivery.broadcastToSession(sessionId, { type: 'message.updated', message: answered, continues: true });
            const steered = await commitSteer(wire.delivery, sessionId, steer);
            assistant = await createMessage(streamingAssistant(sessionId, {
              modelId: selection.model, providerId: 'claude-cli', agent: session.agentId,
              createdAt: Math.max(Date.now(), steered.createdAt + 1) })) as AssistantMessage;
            wire.delivery.broadcastToSession(sessionId, { type: 'message.created', message: assistant });
            segments.length = 0;
            // The answer to the steered message ends with its own result; usage stays cumulative.
            result = null;
            logHarness('claude-cli', 'steer started', { sessionId, queueId: steer.queued.id }, 'info');
            continue;
          }
          if (event.type === 'steer-cancelled') {
            // The row stays queued and drains after this turn. Keeping the record
            // stops a re-send in this turn and still records a late start.
            if (steers.has(event.id)) logHarness('claude-cli', 'steer dropped by CLI', { sessionId }, 'info');
            continue;
          }
          if (event.type === 'child-start') {
            if (event.background) backgroundAgents.add(event.id);
            continue;
          }
          if (event.type === 'child-finish') {
            backgroundAgents.delete(event.id);
            await children.finish(event.id, event.status);
            const part = await getToolPartByCallId(sessionId, `claude-tool:${nativeId}:${event.id}`);
            if (part && openTools.delete(part.id)) {
              const updated = event.status === 'completed'
                ? await transitionToolToCompleted(part.id, { _visualization: { type: 'none', message: 'Subagent task completed' } })
                : event.status === 'error' ? await transitionToolToError(part.id, 'Claude agent failed')
                  : await transitionToolToInterrupted(part.id, 'error');
              if (updated) wire.delivery.broadcastToSession(sessionId, { type: 'part.updated', sessionId, part: updated });
            }
            continue;
          }
          if (event.parentToolUseId) {
            await children.receive(event);
            continue;
          }
          if (event.type === 'compact-boundary') {
            const updated = await patchSessionMetadata(sessionId, {
              claudeCompactedAt: Date.now(), claudeCompaction: { trigger: event.trigger,
                preTokens: event.preTokens, postTokens: event.postTokens } });
            if (updated) wire.delivery.broadcastToSession(sessionId, { type: 'session.updated', session: updated });
          }
          if (event.type === 'text-delta' && event.text) {
            await saveText(openText() + event.text, event.text);
          }
          if (event.type === 'text-final') {
            const current = openText();
            if (event.streamed && !current.endsWith(event.streamed)) throw new Error('Claude text stream changed');
            const next = current.slice(0, current.length - event.streamed.length) + event.text;
            if (next || openSegment) await saveText(next);
          }
          if (event.type === 'tool-start') {
            await settleOpenSegment();
            openSegment = null;
            const callId = `claude-tool:${nativeId}:${event.id}`;
            if (await getToolPartByCallId(sessionId, callId)) throw new Error('Duplicate Claude tool identity');
            const input = claudeToolInput(event.input);
            const childId = event.name === 'Agent' ? await children.start(event.id) : null;
            const name = claudeToolName(event.name);
            const part: ToolPart = { id: crypto.randomUUID(), messageId: assistant.id, type: 'tool',
              callId, name, createdAt: nextCreatedAt(),
              state: { status: 'running', input, startedAt: Date.now(),
                ...(childId ? { childSessionId: childId } : {}) },
              presentation: { summary: claudeToolSummary(name, input), debugAvailable: false } };
            await createPart(part, sessionId);
            openTools.add(part.id);
            wire.delivery.broadcastToSession(sessionId, { type: 'part.created', sessionId, part });
          }
          if (event.type === 'tool-end') {
            const part = await getToolPartByCallId(sessionId, `claude-tool:${nativeId}:${event.id}`);
            if (!part || !openTools.has(part.id)) throw new Error('Unknown Claude tool result');
            if (part.name === 'subagent' && backgroundAgents.has(event.id) && !event.failed) {
              // The initial tool result only confirms that the agent was backgrounded.
              // Its task_notification is the terminal signal for the linked timeline.
              continue;
            }
            if (part.name === 'subagent') await children.finish(event.id, event.failed ? 'error' : 'completed');
            const updated = event.failed ? await transitionToolToError(part.id, 'Claude tool failed')
              : await transitionToolToCompleted(part.id, {
                _visualization: claudeToolVisualization(part.name, part.state.input,
                  typeof event.output === 'string' ? event.output : '', event.failed),
                preview: event.output });
            openTools.delete(part.id);
            if (updated) wire.delivery.broadcastToSession(sessionId, { type: 'part.updated', sessionId, part: updated });
          }
          if (event.type === 'result') {
            terminalResult = true;
            if (!event.success) throw new Error(event.error ? `Claude CLI turn failed: ${event.error}` : 'Claude CLI turn failed');
            // Later SDK turns can finish background work; they do not replace the user's reply.
            if (result === null) {
              result = event.text;
              usage = event.usage;
            }
          }
          if (event.type === 'context-usage' && result !== null) {
            contextUsage = { used: event.used, window: event.window };
          }
        }
        await settleOpenSegment();
        if (result === null) throw new Error('Claude CLI turn result is missing');
        if (goalCondition !== undefined && !controller.signal.aborted) {
          // CLI 2.1.274 persists evaluator verdicts as goal_status attachments, but
          // does not send active_goal through this SDK stream. Never use a reply as a verdict.
          const iterations = await (deps.readGoalVerdict ?? readClaudeGoalVerdict)({
            root, nativeId, condition: goalCondition, startedAt: goalStartedAt,
          });
          if (iterations === null) {
            console.warn('[claude-cli] goal outcome unconfirmed', { activated: goalActivated,
              cleared: goalCleared, resultSeen: result !== null, aborted: controller.signal.aborted });
            throw new Error('Claude goal outcome is uncertain');
          }
          const previous = await getSession(sessionId);
          if (!previous) throw new Error('Claude goal session disappeared');
          const updated = await patchSessionMetadata(sessionId, {
            claudeGoal: { condition: goalCondition, status: 'ended',
              iterations: iterations ?? (previous.metadata?.claudeGoal as { iterations?: number } | undefined)?.iterations ?? 0 } });
          if (!updated) throw new Error('Claude goal state could not be saved');
          wire.delivery.broadcastToSession(sessionId, { type: 'session.updated', session: updated });
        }
        if (controller.signal.aborted) throw new Error('Claude turn interrupted');
        if (segments.length === 0 && result) await saveText(result);
        await children.close('interrupted');
        const contextUpdated = await patchSessionMetadata(sessionId, { claudeContext: contextUsage });
        if (contextUpdated) wire.delivery.broadcastToSession(sessionId, { type: 'session.updated', session: contextUpdated });
        const completed = await updateMessage(assistant.id, { status: 'completed', completedAt: Date.now(),
          ...(usage ? { tokens: { prompt: usage.prompt + usage.cacheRead + usage.cacheWrite,
            completion: usage.completion }, cost: usage.cost } : {}) });
        if (completed) wire.delivery.broadcastToSession(sessionId, { type: 'message.updated', message: completed });
        if (usage) {
          // The meter reads `claudeUsage`; the session token fields are Prokop's context usage.
          const updated = await patchSessionMetadata(sessionId, {
            claudeUsage: { last: usage, contextWindow: usage.contextWindow },
          });
          if (updated) wire.delivery.broadcastToSession(sessionId, { type: 'session.updated', session: updated });
        }
        await storeTransaction(async (tx) => {
          await releaseClaudeBinding(tx, sessionId);
          if (resubmit) await deleteClaudeRollbackIntent(tx, sessionId);
        });
        await notifyHarnessTurnFinished(completed);
        drainable = true;
        logHarness('claude-cli', 'turn completed', { sessionId, durationMs: Date.now() - startedAt }, 'info');
      } catch (error) {
        logHarness('claude-cli', controller.signal.aborted ? 'turn interrupted' : 'turn failed', {
          sessionId, phase, durationMs: Date.now() - startedAt, aborted: controller.signal.aborted,
          assistantCreated: !!assistant, ...describeError(error),
          ...(controller.signal.aborted ? {} : { stderr: stderr.read() }),
        }, controller.signal.aborted ? 'info' : 'warn');
        await settleOpenSegment().catch(() => {});
        if (goalCondition !== undefined && assistant) {
          const previous = await getSession(sessionId);
          if (previous) {
            const updated = await patchSessionMetadata(sessionId, {
              claudeGoal: { condition: goalCondition, status: 'uncertain',
                iterations: (previous.metadata?.claudeGoal as { iterations?: number } | undefined)?.iterations ?? 0 } });
            if (updated) wire.delivery.broadcastToSession(sessionId, { type: 'session.updated', session: updated });
          }
        }
        if (assistant) {
          const updated = await updateMessage(assistant.id, { status: controller.signal.aborted ? 'interrupted' : 'error',
            ...(controller.signal.aborted ? {} : { error: error instanceof Error ? error.message : 'Claude CLI turn failed' }),
            completedAt: Date.now() });
          if (updated) wire.delivery.broadcastToSession(sessionId, { type: 'message.updated', message: updated });
          await notifyHarnessTurnFinished(updated);
        }
        if (!controller.signal.aborted) reject(error instanceof Error ? error.message : 'Claude CLI turn failed');
      } finally {
        await children?.close(controller.signal.aborted ? 'interrupted' : 'error');
        approvals.cancelSession(sessionId);
        for (const id of openTools) {
          const part = await transitionToolToInterrupted(id, 'error');
          if (part) wire.delivery.broadcastToSession(sessionId, { type: 'part.updated', sessionId, part });
        }
        // Explicit Stop or a terminal CLI result (usage limit, API error) ends this
        // turn, not the native conversation; an edit's resend is then delivered too.
        // Release only our own binding after stream/tool cleanup, never replay the
        // prompt or unlock uncertain goals or turns whose outcome the CLI never reported.
        if ((controller.signal.aborted || terminalResult) && ownedNativeId && goalCondition === undefined) {
          const owned = ownedNativeId;
          await storeTransaction(async (tx) => {
            await releaseClaudeBinding(tx, sessionId, owned);
            if (resubmit) await deleteClaudeRollbackIntent(tx, sessionId, 'sent');
          });
          if (controller.signal.aborted) drainable = true;
        }
        active.delete(sessionId);
        if (steerable.get(sessionId)?.dispatched === steers) steerable.delete(sessionId);
        if (resubmit) resubmitting.delete(sessionId);
      }
      if (drainable) return 'drainable';
    },
    async revert(input) {
      try {
        const result = await rollback(input.sessionId, 'revert', input.targetMessageId, null);
        await notifySessionFilesChanged(input.sessionId);
        return result;
      } catch (error) {
        const pending = await intent(input.sessionId);
        if (pending) throw new Error(recoveryHint(pending), { cause: error });
        const safe = new Set(['Claude session is unavailable or busy', 'Claude Goal or Compact history cannot be edited',
          'Claude native history is unavailable', 'Invalid Claude history target',
          'Claude conversation history is not available for Edit or Undo', HARNESS_SWITCH_EDIT_REASON]);
        throw new Error(error instanceof Error && safe.has(error.message)
          ? error.message : 'Claude conversation cannot be undone at this point', { cause: error });
      }
    },
    async fork(input) {
      try {
        const session = await getSession(input.sessionId);
        if (!session || session.harness !== 'claude-cli' || session.parentId || session.status !== 'active'
          || active.has(input.sessionId) || rollingBack.has(input.sessionId)) {
          throw new Error('Claude session is unavailable or busy');
        }
        const { root } = await resolveCliWorkspaceRoot(session, 'Claude');
        return await forkClaudeSession(input, { root,
          version: deps.version ?? claudeCliVersion,
          busy: id => active.has(id) || rollingBack.has(id),
          readHistory: deps.readHistory, forkHistory: deps.forkHistory });
      } catch (error) {
        if (await hasClaudeForkIntent(input.sessionId)) {
          throw new Error('Claude fork outcome is uncertain; do not retry in this session', { cause: error });
        }
        const safe = new Set(['Claude session is unavailable or busy', 'Claude workspace is unavailable',
          'Claude native history is unavailable', 'Claude Goal or Compact history cannot be forked',
          'Claude history requires recovery before fork', 'A Claude fork has an uncertain outcome; do not retry it',
          'Claude fork requires a completed assistant response or a user message', 'Claude fork of image history is not supported',
          'Claude conversation history is not available for fork', HARNESS_SWITCH_FORK_REASON]);
        throw new Error(error instanceof Error && safe.has(error.message)
          ? error.message : 'Claude conversation cannot be forked at this point', { cause: error });
      }
    },
    async editMessage(wire, origin, input) {
      try {
        if (!await resumeEdit(input.sessionId, input.messageId, input.content)) {
          await rollback(input.sessionId, 'edit', input.messageId, input.content);
        }
        wire.delivery.broadcastToSession(input.sessionId, { type: 'session.state', sessionId: input.sessionId,
          messages: (await listMessagesWithParts(input.sessionId)).slice(-50) });
        resubmitting.set(input.sessionId, input.messageId);
        await this.sendMessage(wire, origin, input.sessionId, input.content);
      } catch (error) {
        logHarness('claude-cli', 'edit failed', { sessionId: input.sessionId, ...describeError(error) });
        const pending = await intent(input.sessionId);
        wire.delivery.send(origin, { type: 'error', code: 'edit_error', sessionId: input.sessionId,
          message: pending ? recoveryHint(pending) : 'Claude conversation cannot be edited at this point' });
      } finally { resubmitting.delete(input.sessionId); }
    },
    async compact(sessionId, _reason, delivery) {
      const session = await getSession(sessionId);
      if (!session || session.harness !== 'claude-cli' || session.status !== 'active'
        || session.parentId || active.has(sessionId) || rollingBack.has(sessionId) || await intent(sessionId)) {
        return { ok: false, skipped: true, error: 'Claude session is unavailable or busy' };
      }
      if (session.metadata?.claudeCompactPending) {
        return { ok: false, skipped: true, error: 'Claude compaction outcome is uncertain; do not retry in this session' };
      }
      const goalStatus = (session.metadata?.claudeGoal as { status?: string } | undefined)?.status;
      if (goalStatus === 'active' || goalStatus === 'uncertain') {
        return { ok: false, skipped: true, error: 'Claude goal requires reconciliation before compaction' };
      }
      if (active.has(sessionId) || rollingBack.has(sessionId)) {
        return { ok: false, skipped: true, error: 'Claude session is unavailable or busy' };
      }
      const controller = new AbortController();
      active.set(sessionId, controller);
      let submitted = false;
      let confirmed = false;
      try {
        const { root } = await resolveCliWorkspaceRoot(session, 'Claude');
        const selection = await getClaudeModelSelection(sessionId);
        const binding = await getClaudeBinding(sessionId);
        if (!binding || binding.pending || binding.workspace_root !== root
          || !selection) return { ok: false, skipped: true, error: 'Claude turn requires reconciliation before compaction' };
        if (!deps.start && !Bun.which('claude')) {
          return { ok: false, skipped: true, error: 'Claude CLI is unavailable on this host' };
        }
        const pending = await patchSessionMetadata(sessionId, { claudeCompactPending: true });
        if (!pending) throw new Error('Claude compaction state could not be saved');
        delivery?.broadcastToSession(sessionId, { type: 'session.updated', session: pending });
        submitted = true;
        const timeout = setTimeout(() => controller.abort(), 120_000);
        let outcome: Awaited<ReturnType<typeof runClaudeCompact>>;
        try {
          outcome = await runClaudeCompact({ cwd: root, nativeId: binding.native_session_id,
            model: selection.model, effort: selection.effort, controller, start: deps.start });
        } finally { clearTimeout(timeout); }
        confirmed = outcome.confirmed;
        const latest = await getSession(sessionId);
        if (!latest) throw new Error('Claude session disappeared');
        const { claudeCompactPending: _pending, claudeContext: _context, ...metadata } = latest.metadata ?? {};
        const lastMessageId = (await listMessagesWithParts(sessionId)).at(-1)?.message.id ?? null;
        const updated = await updateSession(sessionId, { metadata: {
          ...metadata,
          ...(outcome.boundary ? { claudeCompactedAt: Date.now(),
            claudeCompactedAfterMessageId: lastMessageId,
            claudeCompaction: { trigger: 'manual', ...outcome.boundary } } : {}),
        } });
        if (!updated) throw new Error('Claude compaction state could not be saved');
        delivery?.broadcastToSession(sessionId, { type: 'session.updated', session: updated });
        if (!outcome.boundary) return { ok: false, skipped: true, error: 'Claude did not compact this conversation' };
        return { ok: true, result: { tokensUsed: { prompt: 0, completion: 0 } } };
      } catch (error) {
        // SDK error text can contain prompt data or credentials. Log only the state and error class.
        console.warn('[claude-cli] compact failed', { submitted, confirmed, aborted: controller.signal.aborted,
          errorType: error instanceof Error ? error.name : 'unknown' });
        if (!submitted || confirmed) {
          const latest = await getSession(sessionId);
          if (latest?.metadata?.claudeCompactPending) {
            const { claudeCompactPending: _pending, ...metadata } = latest.metadata;
            const updated = await updateSession(sessionId, { metadata });
            if (updated) delivery?.broadcastToSession(sessionId, { type: 'session.updated', session: updated });
          }
        }
        return { ok: false, error: submitted && !confirmed
          ? 'Claude compaction outcome is uncertain; do not retry or send in this session'
          : 'Claude compaction could not be completed' };
      } finally {
        active.delete(sessionId);
      }
    },
  }, 'claude-cli', persistCliSessionRunning);
}
