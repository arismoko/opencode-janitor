## Proposals

- Opencode allows for model variants "high, xhigh, low, etc" we must read the docs and implement support for this in our config.
- A copy all findings button and a per finding button that copies a single finding. Auto formats into json keys into xml tags and json values into markdown inside of the xml tags.
- Research mcp permission syntax, allow user customizable global or agent-specific permission extensions.

- Add some more tools for the assistant, some specific to the assitants. View oh-my-opencode-slim for the pattern that
  opencode plugins use for implementing mcp servers into custom plugin-specific agents.
  - Git history tools
  - Chart creation tools
  - Documentation updating tools.

- Upon failure to parse send a message to the agent's session saying their output was invalid allowing them to try again.

- pr triggered agents post their responses directly to the PR using a comment with a config feature to disable this feature.
- Implement a PR tab in the frontend so users can browse/merge pull requests, make comments, request reviews and responses to comments.
- The ability to stop, and resume sessions.
- Allow users to implement specific context into the agents session like review this folder, or "DO NOTHING JUST SAY HI :3"
- Allow users to use /<agent-name> <note> to invoke the agent into responding directly to PRs (manual pr trigger).
  - only if the comment is made by the same user who is authenticated in teh local gh cli and the repo is watched
  - example: /hunter review this

- a chat button on each finding/all findings that allows you to ask the agent for followup about a specific finding. (Ask for clarification/review implementation)
- a button on each finding that has the agent re-review to see if the change was effectively implemented??
