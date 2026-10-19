### Changed

- **Quieter checkboxes**: A checked box no longer fills with a bright block. It keeps its outline and shows the mark in the text color, so "Run commit hooks", "Run pre-push hooks" and a list of selected files sit calmly in the panel. A partly selected folder now shows a dash instead of a check.

- **Push destination as one field**: The remote picker and branch box in the push forms were two controls of different heights. They are now one field that reads like a path, `origin / main`. With a single remote the remote is a quiet prefix; with several it opens as a menu inside the same field. In the Branches push form, Review push sits on the same line.

- **Queued and steered messages lose their outline**: A message waiting for the turn, or marked to steer it, showed a pale ring around the bubble. The lighter fill and the Pending or Steering header already say it has not been sent, so the ring is gone.

### Fixed

- **Long background commands in Claude Code sessions finish and get answered**: When Claude Code left a command running in the background and the reply ended, the command was stopped after 10 minutes with a "Background command was stopped" note, and nothing happened until you sent another message. Background commands now run to the end (or until Claude Code's own time limit), and Claude continues on its own when they finish.

- **Dialogs and menus blur what is behind them in Chrome**: Dialogs, menus and pickers are meant to soften the page behind them, but in Chrome, Edge and other Chromium-based browsers the text underneath showed through sharp and only slightly dimmed. They now blur it in every browser, as they already did in Safari.
