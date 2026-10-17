# Tools

Tools give the agent the ability to interact with your filesystem, run commands, search the web, and more. Built-in tools ship inside the server binary and need no installation or updates. Bundled agent preconfigs enable a focused subset, and custom preconfigs can enable other built-ins. Anything beyond the built-ins comes from MCP servers.

## Built-in tools

A fresh `prokop init` can use the filesystem, shell, web fetch, task, question, and worktree tools immediately.

### File Tools

| Tool | Description |
|------|-------------|
| **read-file** | Read files or list directory contents |
| **file-to-markdown** | Convert files (PDF, Office, LibreOffice, ZIP) to Markdown |
| **write-file** | Create or overwrite files |
| **edit** | String replacements in existing files with fuzzy matching |
| **multiedit** | Multiple string replacements applied atomically |
| **apply-patch** | Apply unified diff patches to files |
| **glob** | Find files matching glob patterns |
| **grep** | Search file contents with regex |
| **ls** | List directory contents with tree formatting |

### Shell

| Tool | Description |
|------|-------------|
| **shell** | Execute shell commands in persistent sessions |

The shell tool enforces safety: dangerous commands (`rm`, `sudo`, `curl`), filesystem modifications, and operations outside the workspace require explicit permission.

### Web

| Tool | Description |
|------|-------------|
| **webfetch** | Fetch and convert web pages to readable text |

For web search, connect a search service in **Settings → MCP Servers** for access across workspaces, or in a workspace's MCP settings for that workspace only.

### Browser

Browser tools are built into the server but are not enabled by the bundled `prokop-code` or `explore` preconfigs. Add the tools you need to a custom preconfig. They require the **ProkopaiBrowser** extension, installed from the [Chrome Web Store](https://chromewebstore.google.com/detail/jean2browser/jpahdfmmfmmnacapmkchljmcijoedcpj) and connected to your Prokop server.

| Tool | Description |
|------|-------------|
| **browser_navigate** | Navigate the browser to a URL |
| **browser_read_active_tab** | Read a tab's title, URL, and visible text |
| **browser_tab_manage** | List, create, close, and switch between browser tabs |
| **browser_discover_elements** | Find interactive elements on a page |
| **browser_dom_action** | Click, type, and interact with page elements |
| **browser_screenshot** | Capture screenshots of a browser tab |

### Interaction

| Tool | Description |
|------|-------------|
| **question** | Ask the user structured questions (select, multi-select, text, confirm) |
| **todoread** | Read the current task list |
| **todowrite** | Update the task list |

## Capability Tools

These tools are built into the server and appear only when their corresponding workspace capability is enabled.

| Tool | Capability | Description |
|------|------------|-------------|
| **memory** | Memory | Save and manage persistent facts across sessions in `.prokopai/USER.md` and `.prokopai/MEMORY.md` |
| **session_search** | Session Search | Search past sessions by text, list recent sessions, or read context around a specific message |
| **workflow** | Workflow | Decompose a task into parallel subtasks, fan out concurrent subagents (max 5), and synthesize results |
| **skill_manage** | Skills | Create, update, patch, and delete SKILL.md files. Lets the agent program its own workflows |
| **skill** | (always available) | Load a specific skill's instructions on demand |

See [Workspaces & Sessions](./workspaces.md#workspace-capabilities) for how to enable capabilities.

## MCP Tools

When you connect an MCP server to a workspace, its tools appear alongside the built-in tools. The agent calls them identically. No adapters, no wrappers. MCP is the way to add a tool: there is no tool directory on disk.

MCP tools are configured per-workspace in `<workspace>/.prokopai/mcp.json`. See [Configuration](./configuration.md#mcp-configuration) for the config format.

## The Ask Protocol

Every tool gets a `ToolContext` with an `ask()` method. This is how tools request permissions, ask questions, or get user input. The client handles the UI. The tool just awaits a typed response.

### Permission asks

Tool calls that modify files, run commands, or access the network go through the permission system. The user can:

- **Approve once**: Allow this specific call
- **Approve always**: Auto-approve future calls with the same parameters
- **Deny**: Block this call

The permission state persists per workspace and per tool.

### Question asks

Tools can ask the user structured questions through `ctx.ask()`:

```typescript
const answer = await ctx.ask({
  type: 'question',
  question: {
    type: 'single_select',
    question: 'Which file should I use?',
    options: [
      { label: 'config.ts', value: 'config' },
      { label: 'settings.ts', value: 'settings' },
    ],
  },
});
```

The client renders the appropriate form (radio buttons, checkboxes, text input, etc.) and returns the answer.
