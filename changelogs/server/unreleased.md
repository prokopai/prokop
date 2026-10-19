### Fixed

- **Long background commands in Claude Code sessions finish and get answered**: When Claude Code left a command running in the background and the reply ended, the command was stopped after 10 minutes with a "Background command was stopped" note, and nothing happened until you sent another message. Background commands now run to the end (or until Claude Code's own time limit), and Claude continues on its own when they finish.

- **Dialogs and menus blur what is behind them in Chrome**: Dialogs, menus and pickers are meant to soften the page behind them, but in Chrome, Edge and other Chromium-based browsers the text underneath showed through sharp and only slightly dimmed. They now blur it in every browser, as they already did in Safari.
