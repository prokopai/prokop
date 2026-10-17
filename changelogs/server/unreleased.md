### Changed

- **Fewer approvals for paths in variables**: A command like `ROOT=/repo/build; rm -rf "$ROOT"` used to ask every time, because `$ROOT` was unknown. When the same command surely set the variable to a plain value, the path is now judged by that value. Variables from the environment, set inside `if`, loops or `( )`, after `||`, or changed by `read`, `unset`, `eval` and similar still count as unknown.

- **Faster workspace load**: The terminal, file editor, pull requests and rebase conflict editor now download the first time you open them instead of with every workspace. The first open can take a moment longer.
- **Lighter streaming replies**: While a reply streams, earlier messages and the prompt markers on the right no longer redraw with every update, and long conversations keep far fewer old messages loaded off screen. Replies use about a fifth less CPU while they stream.
- **Streaming text fades in word by word**: New words now fade in as they arrive instead of typing out letter by letter, so text shows up sooner. Long code blocks stream smoothly instead of stuttering, and replies use about a third less CPU while they stream. With reduced motion turned on, words appear without the fade.
- **Lighter code blocks while they stream**: A code block that is still being written only recolors its newest lines instead of the whole block on every update. Long code blocks now stream at full frame rate and use about half the CPU.

### Fixed

- **No approval for reading Claude's own command output**: When Claude ran a command in the background, reading its output file (kept under `/tmp/claude-<user>`) asked for an outside-workspace approval, although Claude itself asked for that read. That folder is now readable without an approval when it is your own private folder; writing there still asks.

- **Notifications reach every device, and only when you are not already looking**: A push used to go only to the device that first opened the session, so a run started at the desk never buzzed your phone, and one started on the phone buzzed it even while you read the result at the desk. Every enabled device is now notified, and whichever device shows the finish, approval or question to you cancels the push for all of them. A focused window with nothing touched for two minutes (a locked screen, a display asleep) no longer counts as looking. Approvals and questions you already have on screen no longer push either.

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
