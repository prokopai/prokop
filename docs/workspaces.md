# Workspaces & Sessions

## Workspaces

A workspace is a directory the agent operates within. There are two types:

- **Physical workspace** - A real directory you choose on your machine. The agent can read and write files directly.
- **Virtual workspace** - An isolated empty directory auto-generated in `~/.prokopai/workspaces/<uuid>/`. Good for sandboxed experiments or when you don't want the agent touching real files.

### Creating a workspace

1. Open the client
2. Click **New Workspace** in the sidebar
3. Choose "Physical" and pick a directory, or "Virtual" for an isolated sandbox
4. Optionally add an `AGENTS.md` file in that directory for project-specific instructions

### Workspace instructions

Create an `AGENTS.md` file in the workspace root:

```markdown
# Project Rules
- This is a Next.js project
- Use the App Router, not Pages Router
- All components go in src/components/
```

The agent loads this automatically when you switch to the workspace.

### Global instructions

The file `~/.prokopai/AGENTS.md` contains instructions that apply to **all** workspaces. These are loaded first, then workspace-specific ones are appended.

### Permissions

Each workspace has its own permission state. When you approve a tool "always" in one workspace, it doesn't affect others.

### Worktrees

A Git workspace can have managed worktrees, each on an existing local branch, kept under `~/.prokopai/worktrees/`. Bind a session to a worktree to keep its changes apart from the main checkout and from other sessions. A worktree can be removed only when it is clean: no uncommitted changes and no untracked files. Ignored files do not count.

#### Setting up a new worktree

A fresh worktree has none of the ignored files the project needs to run (`.env`, `node_modules`, local config). Describe them once in `.prokop/worktree.json` at the repository root and every new worktree gets them on creation:

```json
{
  "ports": 10,
  "copy": [".env", "config/master.key"],
  "clone": ["node_modules"],
  "env": {
    "PORT": "{{port}}",
    "API_PORT": "{{port+1}}",
    "DATABASE_NAME": "app_{{key}}"
  },
  "envFile": ".env.worktree",
  "files": {
    ".env.local": "NEXT_PUBLIC_API=http://localhost:{{port+1}}\n"
  },
  "setup": ["bun install", "bun run db:create"],
  "teardown": ["bun run db:drop"]
}
```

Every key is optional. A missing file means nothing happens.

| Key | What it does |
|---|---|
| `copy` | Files copied from the main checkout. A file that does not exist there is skipped with a note. |
| `clone` | Directories cloned copy-on-write from the main checkout (APFS on macOS, Btrfs or XFS on Linux). Instant and no extra disk space. When the filesystem cannot clone, the entry is skipped with a note, never copied in full. |
| `env` | Variables written to `envFile`, one `KEY=value` per line. Values are templates. |
| `envFile` | Where `env` goes. Default `.env.worktree`. Only written when `env` has entries. |
| `files` | Files written from templates, keyed by path inside the worktree. |
| `ports` | Size of the port block reserved for the worktree, 1 to 20. Default 10 when any template uses `{{port}}`; no block is reserved otherwise. |
| `setup` | Commands run in order inside the worktree after creation, in the background. See below. |
| `teardown` | Commands run in order inside the worktree before it is removed. See below. |

Templates in `env` and `files` can use:

| Variable | Value |
|---|---|
| `{{port}}` | First port of the worktree's block. Blocks come from 20000 to 29999; each port is checked to be free when reserved, and the block stays with the worktree until it is purged. |
| `{{port+N}}` | A later port in the block. `N` must be below `ports`. |
| `{{name}}` | The worktree name as typed. |
| `{{slug}}` | The name as lowercase letters, digits and underscores. |
| `{{key}}` | The slug plus six characters of the worktree id. Unique, safe for database, schema and topic names. |
| `{{id}}` | The worktree id. |
| `{{path}}` | Absolute path of the worktree. |
| `{{rootPath}}` | Absolute path of the main checkout. |

Rules:

- **Every target must be ignored by Git** (`copy`, `clone`, `envFile`, `files`), otherwise the worktree would turn dirty and could not be removed. A target that is not ignored is refused with the path to add to `.gitignore`, and nothing is written for that worktree. The check runs inside the new worktree, so the rule has to be committed on the branch being checked out; an uncommitted `.gitignore` edit in the main checkout does not count.
- Paths are relative to the repository and cannot leave it.
- The file is read from the main checkout, not from the branch being checked out, and is validated before the worktree is created. A typo refuses creation with the line that is wrong.
- Checks run before writes. A refused worktree still exists, as Git created it, and can be removed.

#### Setup commands

`setup` commands run after the files are in place, through your login shell (so `bun`, `nvm` or `asdf` resolve as in a terminal), with `cwd` set to the worktree and stdin closed, so a command that prompts fails instead of hanging. Their environment is the server's minus its own variables (`PROKOPAI_*`), plus:

| Variable | Value |
|---|---|
| every `env` entry | rendered, the same values as in `envFile` |
| `PROKOP_WORKTREE_PORT` | first port of the block, only when one is reserved |
| `PROKOP_WORKTREE_NAME`, `PROKOP_WORKTREE_KEY` | as `{{name}}` and `{{key}}` |
| `PROKOP_WORKTREE_PATH`, `PROKOP_ROOT_PATH` | the worktree and the main checkout |

Commands come from the repository, so they run only once you approve the file's current contents for that repository. The first worktree reports `needs_approval`; approving runs the commands and remembers the file. A changed file asks again. The worktree is usable while commands run. Each command has 15 minutes; output goes to `worktree-setup/<worktree id>.log` in the server data directory, keeping the last 1 MB. A failing command reports its step and the last lines of output, and nothing after it runs.

Nothing reruns on its own. "Run setup" again repeats the file steps, keeping the port block, and the commands. A server restart during setup leaves the state `interrupted` until you run it again.

#### What the agent sees

A session bound to a worktree learns about its setup two ways, on every harness:

- **A marker file.** The worktree gets `.prokop/setup/state` (ignored through its own `.gitignore`, so the tree stays clean). Its first line is `pending` while commands wait for approval, `running` while they run, then `done`, or `failed` followed by the step and the last lines of output. A stopped or killed setup still ends as `failed`, so nothing waits forever.
- **A note at turn start** while the setup is pending, running, failed or interrupted, and none when it is ready: what the state is, that missing dependencies are expected, that the agent should wait or tell the user instead of installing on its own, and where the output is.

#### Removal and teardown

Removing a worktree first runs the usual checks (no running session, no attached terminal, nothing uncommitted); a refusal changes nothing. Then a running setup is stopped, and the approved `teardown` commands run in the worktree with the same environment, 5 minutes each. A failing teardown does not block removal: the worktree is removed and its last state carries a warning with the step and the last lines of output. Teardown commands that were never approved are skipped with a note. The port block stays reserved until the removed worktree is purged, which also deletes its log.

Each worktree reports a setup state (`none`, `needs_approval`, `running` with the current step, `ready`, `failed` with the reason, or `interrupted`) and its port block through the API (`POST .../worktrees/:id/setup/approve`, `POST .../setup/run`, `GET .../setup/log`) and the `worktree.updated` event.

## Workspace Capabilities

Capabilities are optional features you enable per workspace. All are off by default. Enable them through the client: **Settings > Workspace > Agent Tools**. Use the workspace selector to configure another workspace without changing your active conversation.

Each capability that lets the agent write files has a **permission risk level** controlling when the agent must ask before acting:

| Level | Behavior |
|-------|----------|
| **None** | Never asks. Runs automatically. |
| **Low** | Asks for low-risk operations. |
| **Medium** | Asks for medium-risk and below. |
| **High** | Asks for high-risk and below. |
| **Critical** | Asks before everything. Effectively always confirm. |

### Memory

Lets the agent persist facts, decisions, and preferences across sessions. Two files store this:

- **`.prokopai/USER.md`** - User preferences and communication expectations (limit: 1500 chars)
- **`.prokopai/MEMORY.md`** - Workspace facts, conventions, commands, non-obvious fixes (limit: 2500 chars)

The agent decides what's worth remembering and saves entries automatically. Both files are injected into the system prompt at the start of every session. Tell it "we use pnpm" once. Two weeks later, in a new session, it already knows.

To review or edit manually, open the files in `<workspace>/.prokopai/`.

### Skills

Lets the agent create, update, and patch its own `SKILL.md` files. Skills are reusable instruction sets stored at `.agents/skills/[name]/SKILL.md`. Each has a name, description, and markdown body.

The agent discovers skills by matching the task against the description. When a match is found, the skill's instructions are loaded. This is different from `AGENTS.md`, which is always loaded.

With agent-managed skills enabled, the agent notices patterns in your work and creates skill files encoding those workflows. Next time, it just does it. No prompt engineering. No configuration.

See [Concepts: Skills](#skills) below for the file format.

### Workflow

Enables the parallel workflow tool. The agent decomposes a complex task into independent subtasks, fans out concurrent subagents (max 5 at a time), and synthesizes the results into one answer.

This protects your context window. You see only the final synthesis, not all intermediate results. A full codebase audit that took minutes now takes seconds.

### Session Search

Lets the agent search past sessions in the current workspace. It can recall what was discussed, what was decided, and what tools were run. Three modes:

- **List** - Enumerate recent sessions with IDs and titles
- **Search** - Full-text search across all sessions in the workspace
- **Read** - Read messages surrounding a specific message (or the latest messages)

The `includeToolResults` setting controls whether tool output is included in search results.

## Skills

Skills are conditional instruction sets. Unlike `AGENTS.md` (always loaded), skills load only when the task matches their description.

### File format

```
<workspace>/.agents/skills/
  my-skill/
    SKILL.md
```

`SKILL.md` uses YAML frontmatter:

```markdown
---
name: code-review
description: Load when reviewing code for bugs, performance, or security issues
---

# Code Review Skill

## Procedure
1. Read the full diff before commenting
2. Check for edge cases in conditional logic
3. Verify error handling covers all catch blocks
4. Flag any hardcoded secrets or credentials
```

### Per-preconfig scoping

Preconfigs can limit which skills are available. Leave the skills field empty to use all skills, or pick specific ones.

## Sessions

A session is a single conversation thread within a workspace. Each session is an independent agent run with its own message history, model selection, and state.

### Starting a session

1. Select a workspace
2. Pick a **preconfig** (system prompt template), or start from scratch
3. Select a **model** and optionally a reasoning variant
4. Start chatting

### Session lifecycle

- **Active** - The agent is processing messages
- **Idle** - Waiting for your next message
- **Interrupted** - You cancelled the current generation

### Preconfigs

Preconfigs bundle everything that defines an agent's behavior: system prompt, tool set, default model, skills scoping, temperature, and subagent spawn rules.

Key properties:

| Field | Description |
|-------|-------------|
| **System Prompt** | Instructions that define the agent's role |
| **Tools** | Which tools this preconfig can use |
| **Model** | Default model (optional, inherits from session if unset) |
| **Temperature** | Creativity vs determinism (0.0 to 2.0) |
| **Skills** | Which skills to load (empty = all, or pick specific ones) |
| **Subagent rules** | Toggle whether this preconfig can spawn subagents, and which preconfigs it's allowed to spawn |

You can switch preconfigs **mid-session** without starting over. The conversation continues with the new behavior. A coder becomes a reviewer. A reviewer becomes a tester.

## Goal Mode

Goal mode turns a single message into an autonomous loop. Instead of doing one turn and stopping, the agent works until a completion condition is met.

### How it works

1. You switch the send mode from **Chat** to **Goal**
2. You define a completion condition (e.g., "all tests pass and lint is clean")
3. You set a maximum number of turns (default: 5)
4. The agent works a turn
5. A **separate evaluator** inspects real tool output: test results, lint output, file contents
6. If the condition is not met, the evaluator tells the agent what's still missing
7. The agent continues. Repeat until the condition is met or max turns is reached

The evaluator does **not** trust the agent saying "I'm done." It verifies from concrete evidence. The agent doesn't even know it's in a loop. It just receives continuation messages and keeps working.

### Cancellation

Press **Stop** at any time. The goal loop stops immediately. The goal state is marked as cancelled.

### Goal states

- **active** - The loop is running
- **met** - The evaluator confirmed the condition is satisfied
- **failed** - Max turns reached without meeting the condition
- **cancelled** - You stopped the loop

## Session Controls

### Fork

Branch a session at any message. Creates a new session with the same history up to that point, then diverges. Useful for exploring different approaches to a problem.

How it works:
1. Click the fork icon next to any message
2. A new session is created with the history up to that point
3. Continue the conversation in the new direction

### Revert

Undo to any previous point in a conversation. Later messages are discarded.

### Interrupt

Cancel a running generation. Interrupts cascade to subagents: if a subagent is running, interrupting the parent also interrupts the child.

### Compact

When a conversation approaches the model's context window limit, Prokop automatically compacts (summarizes) older messages while preserving recent context and tool results. This is transparent. You don't need to do anything. See [Configuration](./configuration.md#compaction) for tuning options.

### Queue

Send a message while the agent is still processing. The message is queued and delivered when the agent finishes its current step.

## Subagents

The agent can spawn subagents for complex, multi-step tasks. Subagents:

- Run in **isolated sessions** (separate message history)
- **Inherit** the parent's workspace context
- Are limited to **2 levels of depth** (subagent, then sub-subagent)
- Support **cascading interrupts** (interrupt parent, children stop too)
- Can be **resumed** later with full context (pass a `task_id`)
- Have **independent permissions** (a subagent can have different tool access than its parent)
- Can run **concurrently** (the agent can launch multiple at once)
- Can run **on another harness**: a subagent preconfig whose model is pinned to Claude Code or Codex runs there, in a child session owned by that harness, and returns its final answer the same way. The role's pinned model applies when the CLI knows it; otherwise the CLI default. Stopping the parent stops the child.
- Can **start top-level sessions in their own worktrees**: `isolation: "worktree"` on the task tool creates a new branch (named from the task, from the current branch or `baseBranch`) and a managed worktree with the repository's setup applied, and starts an ordinary session there, always async. The finish message names the branch, the worktree and the number of changed files; open that session to review and merge. Subagents never get their own worktree. The agent's **Worktree sessions** setting decides whether you are asked first (default), never asked, or it is refused. At most three launched sessions run from one conversation at a time (`DELEGATION_MAX_LAUNCHES`). Deleting a launched session keeps its branch and worktree; remove them in the Worktrees panel.
- **Ask you instead of being refused**: with Delegation targets set to "Ask me each time" (the default for new agents) or to specific harnesses, a target outside the allowed set becomes a question where you are, with Allow once, Allow for this agent, or Deny. Pinned roles never ask.
- Come with **`task_status` and `task_cancel`** on every harness: an explicit check on a running or finished task, and a stop that takes the task's own children with it.
- Are available **from Claude Code and Codex sessions** as `delegate_task`, `delegation_capabilities`, `task_status` and `task_cancel`, next to those CLIs' own subagents. The instructions tell the model to keep native subagents for same-harness work and use `delegate_task` for another harness, another model, or a role you defined. From a CLI session a delegated task returns at once by default.
- Can run **without the parent waiting**: `mode: "async"` on the task tool returns at once, and the result arrives in the parent session as a message when the child finishes. A wait that passes `timeoutMs` (ten minutes by default) or a child that stops for a question or approval returns the same way; the child continues and is never cancelled by a timeout. A child's question or approval appears on the session you are looking at, whatever harness the child runs on, and a child waiting for an answer wakes its parent with a note. A child interrupted by a server restart is reported to its parent once and not restarted.
- Can run on a **harness and model the agent picks**: every delegation names a role, which runs on its own harness and model or on the agent's when it sets none. The task tool's `target` overrides that for one task. The agent's **Delegation targets** setting says whether it may: any enabled harness, ask each time, roles only (never), or specific harnesses without asking. The `delegation_capabilities` tool shows roles, harnesses, a short model list each, and the limits. At most four subagents run under one session at a time (`DELEGATION_MAX_CHILDREN`); a child never gets a wider permission mode than its parent.

Subagents are automatic. The agent decides when to spawn them based on the complexity of the task.

### Parallel Workflows

When the Workflow capability is enabled, the agent has access to the `workflow` tool. This is different from spawning individual subagents:

| | Subagents (`task`) | Workflows (`workflow`) |
|---|---|---|
| **Execution** | Sequential or concurrent, agent decides | Decompose, fan out (max 5 concurrent), synthesize |
| **Context** | You see each subagent's results | You see only the final synthesis |
| **Best for** | Focused delegations, dependent subtasks | Large parallel tasks, research, bulk operations |

The workflow tool automatically decomposes the task, runs subagents in parallel, and synthesizes results. This protects your context window from intermediate results.

## MCP Integration

MCP (Model Context Protocol) is an open standard for connecting AI tools to external services. Prokop connects to any MCP server, giving the agent access to third-party APIs, databases, and services.

### Configuration

MCP servers are configured per-workspace in `.prokopai/mcp.json`:

```json
{
  "servers": {
    "my-local-server": {
      "type": "local",
      "command": "npx",
      "args": ["-y", "@some/mcp-server"],
      "env": { "API_KEY": "..." }
    },
    "my-remote-server": {
      "type": "remote",
      "url": "https://mcp.example.com/sse",
      "headers": { "Authorization": "Bearer ..." }
    }
  }
}
```

### Server types

- **Local (stdio)** - Spawns a child process. Configure with command, args, env vars, timeout.
- **Remote (HTTP/SSE)** - Connects over HTTP. Supports custom headers, OAuth, timeouts.

### OAuth

For remote servers requiring authentication, Prokop handles the full OAuth flow: opens a browser tab for login and approval, stores the token server-side. If client registration is needed first, Prokop handles that automatically.

### Status badges

Each MCP server shows a status badge in the client:

| Badge | Meaning |
|-------|---------|
| **Connected** | Server is running and tools are available |
| **Disabled** | Server is configured but disabled |
| **Failed** | Connection attempt failed |
| **Needs Auth** | OAuth authorization required |
| **Needs Registration** | OAuth client registration required |

MCP tools appear alongside built-in tools. The agent calls them identically. No adapters, no wrappers.

## Terminal Sessions

The client provides full PTY terminal sessions for you. The agent runs its commands through the `shell` tool instead: one process per command, with long-running commands left in the background and reported back when they finish.

- **Multi-tab** - Run multiple terminals side by side
- **Persistent** - Terminals survive across chat sessions
- **Visualized** - Terminal output appears as rendered blocks in chat

## Data Storage

Sessions, messages, and permissions are stored in SQLite at `~/.prokopai/data/agent.db` (or your custom `PROKOPAI_DATABASE_PATH`). Workspace data (files, project structure) remains in the workspace directory.

Memory files live in `<workspace>/.prokopai/USER.md` and `<workspace>/.prokopai/MEMORY.md`. Skill files live in `<workspace>/.agents/skills/`. MCP configuration lives in `<workspace>/.prokopai/mcp.json`.
