### Removed

- **The separate `terminal` tool for Prokop agents**: Agents no longer open their own terminal tabs in your terminal panel. The `shell` tool covers long-running commands now (see below), so there is nothing left for you to kill by hand after a run.

- **Tools loaded from a folder on disk**: Prokop no longer loads tool modules from `~/.prokopai/tools` or `PROKOPAI_TOOLS_PATH`, and `prokop init` no longer takes `--tools-path`. Tools come from the binary and from MCP servers. An existing tools folder is left in place and ignored.

### Changed

- **One `shell` tool for Prokop agents, with background commands**: Every command runs in its own process, so commands the agent starts side by side no longer wait on each other, and a dev server never blocks the next command. A command still running after the wait (60 seconds unless the agent asks for more) keeps running in the background; the agent gets its output so far and a message when it finishes, as a prompt in the conversation with the output attached as a terminal chip. The agent can read more of its output or stop it, and the full output of every command is kept in a file it can search. Background commands stop when the session is archived or deleted, when you undo or edit a message, and when the server stops. Commands now run with your shell (zsh, bash, dash, ksh or sh) instead of always `sh`. Interactive prompts are not supported; the agent is told to use non-interactive flags.

- **Claude Code background commands no longer hold the session**: When Claude leaves a command running in the background and replies, the reply now completes and the session is free right away, instead of showing as running for up to 10 minutes. The command keeps running in the same Claude process. When it finishes, its result appears as a note in the conversation with the output attached as a terminal chip, followed by Claude's own follow-up reply. A message you send in the meantime is answered by that same process. Stop ends the wait and keeps the completed reply. Undo and Edit of messages before such a note may be refused, because the note has no matching entry in Claude's own history.

- **Fewer approvals for paths in variables**: A command like `ROOT=/repo/build; rm -rf "$ROOT"` used to ask every time, because `$ROOT` was unknown. When the same command surely set the variable to a plain value, the path is now judged by that value. Variables from the environment, set inside `if`, loops or `( )`, after `||`, or changed by `read`, `unset`, `eval` and similar still count as unknown.

- **Faster workspace load**: The terminal, file editor, pull requests and rebase conflict editor now download the first time you open them instead of with every workspace. The first open can take a moment longer.
- **Lighter streaming replies**: While a reply streams, earlier messages and the prompt markers on the right no longer redraw with every update, and long conversations keep far fewer old messages loaded off screen. Replies use about a fifth less CPU while they stream.
- **Streaming text fades in word by word**: New words now fade in as they arrive instead of typing out letter by letter, so text shows up sooner. Long code blocks stream smoothly instead of stuttering, and replies use about a third less CPU while they stream. With reduced motion turned on, words appear without the fade.
- **Lighter code blocks while they stream**: A code block that is still being written only recolors its newest lines instead of the whole block on every update. Long code blocks now stream at full frame rate and use about half the CPU.

### Fixed

- **A command that leaves something running no longer hangs the agent**: Starting a server with `&` from the `shell` tool used to stall the agent until the 60 second limit, because the server kept the command's output open. The command now returns as soon as it exits, and whatever it left running keeps going in the background.

- **Scripts that count with `| xargs` are no longer marked critical**: A value captured from a pipeline, such as `total=$(grep ... | wc -l | xargs)`, was read as running a dangerous command through `xargs` and shown as critical. The captured command is now read as a whole, so a trailing `xargs` with nothing to run is harmless. As a result, a command hidden in a captured value, such as `X=$(rm -rf /)`, is now caught too.

- **awk, sed and grep patterns are not paths**: A quoted program or pattern that starts with a slash, such as `awk '/^Unused exports/{...}' file` or `sed -n '/^foo/p' file`, was treated as a file outside the workspace and asked for approval. The pattern is now recognized as such; the files after it are still checked.

- **No approval for reading Claude's own command output**: When Claude ran a command in the background, reading its output file (kept under `/tmp/claude-<user>`) asked for an outside-workspace approval, although Claude itself asked for that read. That folder is now readable without an approval when it is your own private folder; writing there still asks.

- **Notifications go to the device that controls the session, and only when you are not at one**: A push used to go only to the device that first opened the session, and for a while to every device, so the phone buzzed about work done at the desk. A session's push now goes only to the device that controls it; a session nobody controls, such as a scheduled run, still reaches every enabled device. Nothing is pushed while you are at any device: each device tells the server whether someone is there (window in front and input within the last two minutes), and that device signals locally instead, with the sound, the unread mark, or the approval itself. A locked screen or a display asleep behind a focused window no longer counts as being there.

- **Sounds play on time or not at all**: After a page load, the first finish or approval sound waited for your next click and then played, sometimes minutes later. Sounds are now ready after your first input on the page, and a sound that cannot play within three seconds is dropped instead of played late.

- **A finished session you did not have open now sounds and shows as unread**: A run finishing in a session that was not open as a tab gave no sound and no unread mark, and the push was skipped while Jean2 was in front. It now plays the finish sound and marks the session unread.

- **iPhone notifications no longer stop silently**: While the app was open in front, a push arrived without showing a banner. iOS counts those as silent pushes and drops the subscription after a few, after which nothing arrived until you re-enabled notifications. The banner is now always shown on iPhone and iPad, pushes ask for immediate delivery, and if the subscription is dropped anyway you get a message with a Re-enable button the next time you open the app.

- **Faster reconnect on a phone after the app was in the background**: Reopening the app, or tapping a notification, could leave it showing a stale screen for up to a minute and a half. The phone had cut the connection in the background, but it still looked open, so the app waited for the next missed heartbeat before reconnecting; a reconnect begun in the background could also block the one you needed for another ten seconds. Returning to the app now asks the server to answer within three seconds, reconnects at once if it does not, replaces any attempt left over from the background, and shows "Reconnecting" immediately instead of after a pause. Each reconnect also skips a separate authentication request, one less round trip on mobile data. Connections to other machines recover the same way.

- **The right dock no longer hovers over the chat on smaller windows**: On windows narrower than about 1280 px, opening Explorer, Changes, Branches or Worktrees showed a plain panel floating over the conversation, with a stray close row above its tabs and no way to resize it. The right dock is now the same card at every window size, and keeps its saved width. When the window is too narrow for both side docks beside the conversation, the dock you opened last stays and the other closes; opening it again swaps them back. Between 640 and 768 px the window also showed the phone header and no spacing around the docks; the desktop header and spacing now apply from 640 px up.

- **A Claude tool blocked by a Prokop error no longer looks like your refusal**: When the permission check for a Claude tool hit an error, Claude was told that you had declined the action, and the tool row only said "Claude tool failed". The check now fails with the actual error, and a failed Claude tool row shows the message Claude reported.

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
