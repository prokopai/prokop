### Changed

- **Markdown previews show the HTML in the file**: READMEs that use HTML, such as centered `<p align="center">` blocks, `<h1 align="center">`, badge rows, `<img width>` and `<details>`, now look the way they do on GitHub in the file preview and the editor's Preview tab, instead of losing those parts. Images with relative paths like `docs/screenshot.webp` load from the workspace, and `<picture>` light and dark screenshots follow Prokop's theme. HTML is cleaned to GitHub's allowlist, so scripts, event handlers and inline styles never run. Agent replies in the conversation are unchanged.

### Fixed

- **Deleting a scheduled job deletes its runs**: Deleting a scheduled job left every session its runs created in the Scheduled list, with no job to manage them and no way to delete them. Deleting a job now also deletes those sessions, after a confirmation. Runs already left behind by a deleted job show under the job's name, marked "Job deleted", with a "Delete runs" action that removes them.

- **Claude Code questions wait for your answer**: When Claude asked a multiple-choice question with its AskUserQuestion tool, Prokop let the tool run with no answer, so Claude carried on without your choice. The question now shows as a question card in the conversation, like questions from Prokop agents, and Claude continues with the options you pick (one, or several for multi-select questions). It appears at every permission mode, including Full. Sessions with no controlling window, such as scheduled runs, refuse the question right away.

- **Approving a command after a minute no longer fails**: Time spent waiting for your approval counted against the tool's own time limit, so a shell command approved after more than a minute failed with "Tool execution timed out after 60000ms", and file reads or edits that asked for permission failed even sooner. A tool's time limit now pauses while it waits for your answer and covers only its own work. Approvals still expire after 30 minutes.

- **Sessions created through the API belong to their agent**: A session created with `POST /api/sessions` (or the SDK's `sessions.create`) as an agent was not recorded as that agent's session, unlike one started from the app. An agent's search across its own sessions in every workspace never found it. Such sessions now belong to the agent they start as, so that search includes them.

- **Refreshing the file tree updates open ignored folders**: Ignored folders such as build output load their contents when you open them, and Refresh did not load them again, so new files did not appear and deleted ones stayed until the client was reopened. Refresh now reloads every open ignored folder, adding new files and removing deleted ones.
