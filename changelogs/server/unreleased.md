### Fixed

- **A member's reply in a group reads before the handoff it made**: When a member handed a stage to another member, the handoff line showed up first and the member's reply, with its own handoff row, landed below it once the turn ended. The reply now sits where the turn began, ahead of the handoff, both while it is being written and after it is finished, so nothing jumps when the turn ends. The member that received the handoff is still woken at once. `group_history` and the catch-up a woken member receives read in the same order.
