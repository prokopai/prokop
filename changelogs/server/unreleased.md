### Changed

- **The message box stands on its own**: The box where you type used to take the same gray as the conversation behind it, and clicking into it showed almost no change. It now has its own slightly lighter fill with a thin edge, and when you click into it the box lifts with a soft shadow instead of getting a thick outline. The edge itself never changes.

- **Corners in the conversation match**: The message box, the chips under it and the send control used to have their own corner shapes. They now use the same three as the rest of the conversation: the box matches your message bubbles, the chips and send control match every other button, and error boxes match the other blocks.

- **Agent and model are two chips in the session header**: The one control that held model, effort and agent behind three cells is now two chips at the right of the header, the same shape as the chips under the message box. The agent chip opens a list of agents with their descriptions and the model each one pins. The model chip opens one list: your recent picks on top, then one row per installed runtime (Prokop, Claude Code, Codex) that opens into its models, so long catalogs stay short, and an effort row at the bottom for the chosen model. Typing searches across runtimes, providers and models at once. On a phone the same lists open as a sheet from the bottom, and the chips show their icons with the current model still visible on the chip when there is room.

- **One corner shape per kind of thing, everywhere**: Dock tabs and terminal tabs share one shape, the Workspace and Overview switch in the title bar keeps its track with slightly rounder options, dialogs and the command palette take the same corners as the panels around them, and images in the conversation match the other blocks.

- **Installed app title bar matches the window**: The installed app's title bar used to take the old flat background color, a shade lighter than the field the panels sit on. It now takes the field's own color, so the bar and the window read as one surface.

- **Chips fold with the pane, not the window**: In a narrow session pane on a wide window, the checkout, permission and format chips under the message box now show just their icons, as they already did on a phone, instead of overflowing.

### Fixed

- **Phone views lost their background**: On a phone, Settings, the file explorer, the editor and the other side views showed the window's tinted backdrop behind their content and the explorer's ignored rows looked like stripes. Every view paints the plain background again, as the chat already did.
