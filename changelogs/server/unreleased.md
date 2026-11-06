### Fixed

- **A delegated task waiting on your approval no longer shows as failed**: if the main session tried to continue a task while it was still waiting on an approval, the task was marked failed, even though it was still waiting. Approving then looked like it did nothing, and stopping it did not work. Now the main session is told the task is still running, and your approval lets it continue.
- **One notice per approval from a delegated task**: an approval that the main session had already been told about was sometimes announced again as a separate "needs an answer" message. That started an extra turn in the main session.
