## Proposals

- Add some more tools for the assistant, some specific to the assitants. View oh-my-opencode-slim for the pattern that
  opencode plugins use for implementing mcp servers into custom plugin-specific agents.
  - Git history tools
  - Chart creation tools
  - Documentation updating tools.

- Allow users to use /<agent-name> <note> to invoke the agent into responding directly to PRs (manual pr trigger).
  - only if the comment is made by the same user who is authenticated in teh local gh cli and the repo is watched
  - example: /hunter review this

- a chat button on each finding/all findings that allows you to ask the agent for followup about a specific finding. (Ask for clarification/review implementation)

- A ralph loop tool? that runs review agent -> implementation agent -> review agent until no findings, it runs in a git worktree until done and makes a pr when it finishes? These PRs should not trigger auto PR reviews.

- rename the application.
