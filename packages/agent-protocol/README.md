# @prokopai/agent-protocol

JSON-RPC 2.0 protocol between the Prokop host and the agent process. Experiment: see `docs/plans/host-agent-split.md` (local, gitignored). Nothing uses it yet; `packages/server` is unchanged.

The protocol serializes ports that already exist in the server:

| File | Direction | Server port it mirrors |
|---|---|---|
| `src/host-to-agent.ts` | host to agent requests | `SessionExecutionPort`, `HeadlessSessionRunPort`, ask resolution, CLI probes |
| `src/agent-to-host.ts` | agent to host requests | `StorageBundle` (`store.*`), `InteractionHost` (`interaction.*`), MCP/domain tools, terminal manager |
| `src/commit.ts` | `store.commit` | the Claude/Codex SQLite transactions |
| `src/notifications.ts` | notifications | `RuntimeDelivery` / `ApplicationDeliveryPort` (`deliver`), notifications, `$/cancel` |
| `src/entities.ts` | shared payloads | SDK entities (opaque except identity keys), host records |

## Commands

```sh
bun run schema     # regenerate schema/agent-protocol.schema.json (the Go host generates structs from it)
bun run test       # fails if the schema file is stale
bun run typecheck
```

## Rules

- Every write the agent makes is a host request; the agent writes no database. The only agent-owned file is the Prokop todo list (`todos.db`).
- SDK entities pin only the keys the host reads; other fields pass through. Tighten a shape only when the host needs a field.
- Add a method by adding it to the table in its direction file, then run `bun run schema`.
