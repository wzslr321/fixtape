# fixtape

Show the bug and the fix in one 20-second film. Real clicks, checked results, posted to the pull request.

![Placing the order charges $0.30000000000000004 before the fix and $0.30 after it.](docs/media/preview.gif)

[Watch the film](docs/media/film.mp4)

We generate more code than we can read. A PR description tells me what you meant, not what the user saw. I'd rather have one boring format for every fix than guess where to look each time.

## Install

```sh
npx skills add wzslr321/fixtape
```

Claude Code and Codex. Needs Node.js 22.20+, FFmpeg with `libx264` and `ffprobe`. Then ask your agent:

> Use fixtape to film this bug and the fix.

## Try it

```sh
node skills/fixtape/scripts/fixtape.mjs setup
node skills/fixtape/scripts/fixtape.mjs demo --out recordings/demo
node skills/fixtape/scripts/fixtape.mjs preview recordings/demo
```

## Your pull request

```sh
node skills/fixtape/scripts/fixtape.mjs record story.mjs --out recordings/fix \
  --base main --serve "npm run dev -- --port {port}" --pr 123
```

fixtape checks out `main` in a temporary worktree, starts your app twice, records the same action on both, and writes `film.mp4`: 1280 × 800, under 10 MB, plays on GitHub. `--pr` posts it to the pull request through `gh` (2.99+). Your agent writes `story.mjs`; the format is in [recording.md](skills/fixtape/references/recording.md).

[Limits and what was verified](docs/verification.md) · [MIT](LICENSE) · Rendering by [Revideo](https://github.com/midrender/revideo)
