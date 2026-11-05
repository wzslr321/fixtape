# fixtape

Show the bug and the fix in one short film. Real clicks, checked results. Put it on the PR, in Slack, wherever.

https://github.com/user-attachments/assets/63221a17-5651-462c-aa8e-b02174076b00

We generate more code than we can read. A PR description tells me what you meant, not what the user saw. I'd rather have one boring format for every fix than guess where to look each time.

## Install

```sh
npx skills add wzslr321/fixtape
```

Claude Code and Codex. Then describe the bug to your agent.

It serves the base branch from a temporary worktree and your working tree as the fix, clicks the same thing on both, checks the result on each side, and hands you `film.mp4` under 10 MB with the receipts. Say the word and it posts the film to the pull request.

[Limits and what was verified](docs/verification.md) · [Scenario format](skills/fixtape/references/recording.md) · [MIT](LICENSE) · Rendering by [Revideo](https://github.com/midrender/revideo)
