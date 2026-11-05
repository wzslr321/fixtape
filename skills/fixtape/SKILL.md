---
name: fixtape
description: Film a web bug and its fix as one short before/after MP4 with real clicks, asserted results and source hashes, to post on a pull request or share anywhere. Use when a reviewer, teammate or PM should see what changed instead of reading the diff.
---

# fixtape

One film: the same action before the fix, then after it. Real input, a DOM assertion on each side, hashes in the receipts. A caption never replaces the check.

Resolve this skill's directory from this file and run `scripts/fixtape.mjs` by that path, whatever the project's working directory. Needs Node.js 22.20+, FFmpeg with `libx264` and `ffprobe`. Run `setup` once; `doctor` checks an existing setup.

```sh
node <skill-directory>/scripts/fixtape.mjs setup
node <skill-directory>/scripts/fixtape.mjs doctor
```

## Flow

1. Pick one visible difference: the action that exposes the bug and the result a viewer can read on each side. Use the real original and fixed code. Never fake the bug by editing the DOM, swapping screenshots or changing only the caption.
2. Write the scenario from [recording.md](references/recording.md): one orientation step, one real action, a final `reel.observe` with the expected text, value or count per side. Captions in the user's language, short enough for one line.
3. Choose how both versions run:
   - One checkout: `record story.mjs --out <new dir> --base main --serve "npm run dev -- --port {port}"`. fixtape checks out the base commit in a temporary worktree, starts both servers, records, then cleans up. Add `--prepare "npm ci"` when dependencies differ between base and head. Pass `--cwd` when the checkout is not the current directory.
   - Two URLs you serve yourself: put `before.url` and `after.url` in the scenario and omit `--serve`.
   - Nothing to serve yet: `demo --out <new dir>` records the bundled checkout app.
4. Record into a new or empty directory. A paired recording writes `film.mp4`, `film.json` and, per side, `raw.webm`, `reel.mp4`, `poster.jpg` and `receipt.json`. A failed assertion fails the recording: report it with the kept files, never as a verified pair. `compose <dir>` renders an existing clean pair again.
5. Run `preview <dir>` in the background (it blocks), open the loopback URL, play and seek the film. Check the opening, the framing, the actual click and the readable final result. Fix the scenario and record again when something is unclear.
6. Hand over `film.mp4` first. Then ask the user whether to post it. `publish <dir> --pr <number>` comments on the pull request with the film attached (needs `gh` 2.99+); `--pr <number>` on `record` does the same right after a successful film. Never post without the user's word.

## Limits

Regular main-document HTML elements only; no iframe contents, canvas, SVG or native apps. Observations come from the application's DOM, never from the overlay. Source hashes describe declared local files or the recorded Git commits, not what a URL served. The film is capped at 25 seconds, so keep one story per film.
