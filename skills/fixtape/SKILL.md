---
name: fixtape
description: Record a browser bug and its fix in one sequential film, with camera focus, captions, real actions and checked results. Use for demonstrating visible changes in a web interface.
---

# Fixtape

Make the user's goal, action, and observed result understandable without a live explanation. Record both sides from genuine original and fixed implementations, using equivalent data, navigation, and viewport conditions.

Resolve this skill's directory from this file. Run its `scripts/fixtape.mjs` by that path, regardless of the project's working directory. Requirements are Node.js 22.20+, FFmpeg with `libx264`, and `ffprobe`. Run `setup` once to install the skill's dependencies and Chromium; use `doctor` to check an existing setup.

```sh
node <skill-directory>/scripts/fixtape.mjs setup
node <skill-directory>/scripts/fixtape.mjs doctor
```

1. Establish one visible problem, the action that exposes it, and the expected result on each side. Use real original and fixed sources; do not simulate the defect by changing the DOM, substituting screenshots, or varying only the annotation.
2. Read [recording.md](references/recording.md) when authoring the scenario. Use short captions in the user's chosen language, focused targets, real interactions, and a final asserted observation. Keep captions clear of the behavior they explain.
3. Record into a new or empty output directory. Paired recording captures clean footage and creates `film.mp4`, with before followed by after in one large frame. Keep each continuous action and result at its original speed; shorten only the opening. Aim for about 20 seconds, with a 25-second limit. Single-side recording produces an annotated clip.
4. Preserve each side's `raw.webm`, `reel.mp4` and `receipt.json`, plus the film's `film.json`. If capture, assertion, or rendering fails, report the failure and retained evidence. Do not label an incomplete pair as verified. Use `compose <output-directory>` to render an existing clean pair.
5. Run `preview <output-directory>`, open its loopback URL, and play and seek the film and source clips. Check the start, camera framing, actual action and readable final result. Obtain an independent comprehension review: can a viewer explain the goal, action and outcomes from the film alone? If no reviewer is available, report that check as unperformed. Fix demonstrated presentation problems and replay the affected export.
6. Lead the handoff with `film.mp4`, then the playback page and relevant evidence limits. Recording does not authorize publication, upload, or changes to a live environment beyond the user's task.

```sh
node <skill-directory>/scripts/fixtape.mjs record /absolute/path/to/story.mjs --out /absolute/path/to/new-output
```

For a self-contained first run, use `demo --out /absolute/path/to/new-output`.

The recorder supports regular main-document HTML elements, not iframe contents, canvas or SVG targets, or native OS interfaces. Observations come from the application DOM, never the annotation. Optional source hashes describe declared local files; they do not independently prove the revision served by a URL. Keep these distinctions visible in the handoff.
