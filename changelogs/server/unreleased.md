### Fixed

- **Approving a command after a minute no longer fails**: Time spent waiting for your approval counted against the tool's own time limit, so a shell command approved after more than a minute failed with "Tool execution timed out after 60000ms", and file reads or edits that asked for permission failed even sooner. A tool's time limit now pauses while it waits for your answer and covers only its own work. Approvals still expire after 30 minutes.

- **Sessions created through the API belong to their agent**: A session created with `POST /api/sessions` (or the SDK's `sessions.create`) as an agent was not recorded as that agent's session, unlike one started from the app. An agent's search across its own sessions in every workspace never found it. Such sessions now belong to the agent they start as, so that search includes them.

- **Refreshing the file tree updates open ignored folders**: Ignored folders such as build output load their contents when you open them, and Refresh did not load them again, so new files did not appear and deleted ones stayed until the client was reopened. Refresh now reloads every open ignored folder, adding new files and removing deleted ones.
