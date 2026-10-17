### Changed

- **Fewer approvals for paths in variables**: A command like `ROOT=/repo/build; rm -rf "$ROOT"` used to ask every time, because `$ROOT` was unknown. When the same command surely set the variable to a plain value, the path is now judged by that value. Variables from the environment, set inside `if`, loops or `( )`, after `||`, or changed by `read`, `unset`, `eval` and similar still count as unknown.

- **Faster workspace load**: The terminal, file editor, pull requests and rebase conflict editor now download the first time you open them instead of with every workspace. The first open can take a moment longer.
- **Lighter streaming replies**: While a reply streams, earlier messages and the prompt markers on the right no longer redraw with every update, and long conversations keep far fewer old messages loaded off screen. Replies use about a fifth less CPU while they stream.
- **Streaming text fades in word by word**: New words now fade in as they arrive instead of typing out letter by letter, so text shows up sooner. Long code blocks stream smoothly instead of stuttering, and replies use about a third less CPU while they stream. With reduced motion turned on, words appear without the fade.
- **Lighter code blocks while they stream**: A code block that is still being written only recolors its newest lines instead of the whole block on every update. Long code blocks now stream at full frame rate and use about half the CPU.

### Fixed

- **"Allow for this session" only allows what you approved**: In Prokop sessions, approving one command or file for the session or workspace also approved every later command or file of that tool, including commands that always need your approval, such as deleting your home folder. An approval now covers the exact command in the same folder, or the exact file. Commands that can only be allowed once can no longer be remembered. Approvals you saved before this update stop applying, so you will be asked once more.

- **Approvals no longer vanish when you reconnect**: Reopening the app or reconnecting expired every approval or question older than 5 minutes, although it should wait 30. The prompt disappeared while the session kept waiting, and nothing could answer it. Reconnecting now keeps each prompt until its own timeout.

- **Prokop approvals and questions wait 30 minutes**: In Prokop sessions they expired after 5 minutes. They now wait as long as Claude and Codex approvals.

- **No "finished" signal when a message joins a running reply**: Sending a message into a running turn played the finish sound, marked the chat as finished and stopped showing it as running, although the agent kept working. It now does that only when the turn really ends.

- **Notifications for questions**: When Claude or Prokop asks you a question, you now get a push notification ("Prokopai has a question for you") and the attention sound, like approvals. The setting is now called "Approvals and questions".

- **Claude approvals no longer expire after 10 minutes**: In Claude sessions, an approval left unanswered for 10 minutes was dropped by Claude while Jean2 still allowed up to 30 minutes, so the prompt vanished and the command failed. Claude now waits for your answer as long as the prompt is shown, like Codex.

- **Approval colors match the permission modes**: An approval for secrets such as `.env` or for a destructive command showed amber, the color of Extended, although only Full access runs it without asking. These approvals now show red, and outside-workspace approvals stay amber, so the color tells you which mode would allow it.

- **Commands behind a prefix are checked like any other**: A command written after `FOO=1`, `time`, `env`, `nohup`, `timeout`, `nice`, `command`, `exec`, `!`, `if`/`then`/`do`, `{ }`, `( )`, a `case` pattern or inside a function was judged by that prefix, so even `time rm -rf /` ran without asking in Full access. The command itself is now judged.

- **Removed workflow tool no longer listed**: The tools list still showed the workflow tool after it was removed, so it could be picked for an agent but never ran. It is no longer listed.

- **Overview keeps fresh session names and status**: A rename or status change that arrived while the overview was loading, or while it loaded more sessions, could be replaced by the older copy from that request until the next change. The newer state now stays.

- **Mermaid labels are no longer cut off**: Diagram labels drew in the code font while Mermaid sized their boxes for the regular font, so longer labels were clipped, for example "store.get(sl" instead of "store.get(slug)". Diagrams now draw in the same font they are sized for.
