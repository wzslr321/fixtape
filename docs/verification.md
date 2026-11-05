# What was verified, and the limits

Checked on 2026-11-05 on macOS (Apple Silicon), Node.js 24.8.0, Playwright 1.64.1, Revideo 0.11.0, FFmpeg 8.1.2.

| Check | Result |
| --- | --- |
| Test suite (`npm test`) | 95 passed, 0 failed, 85 s |
| Fresh machine path: `setup` with no Playwright cache | 18 s including the 99 MiB Chromium download |
| `demo` | 44 s; film 17.5 s, 1280 × 800, 30 fps, H.264, 4.3 MB |
| `record --base main --serve` on a real Git checkout | Base served from a temporary worktree, head from the working tree; worktree removed afterwards; receipts carry both commits (part of the suite) |
| `publish --pr` | Comment body and `gh pr comment --attach film.mp4` arguments checked against a stand-in `gh`; an older `gh` is refused with the manual fallback named. Not posted to a live pull request |
| Showcase in `docs/` | Rebuilt from an inspected recording; all three MP4s load and seek in Chromium through the preview server. |
| Frames of the film | Opening, click, and both results read at 640 px |

## Not verified

- Automatic skill selection inside Claude Code or Codex; the skill was exercised through its CLI.
- Windows. On Linux CI two things broke and were fixed from the logs: Chromium refused its sandbox on Ubuntu 24.04 runners (the render now launches with `--no-sandbox` on Linux only), and the recorded video started later than the page on the slow runner, so event times overran the media (the receipt now stores `videoLagMs` and the planner shifts by it). The run with both fixes had not finished when this was written.
- A live `publish --pr`: GitHub CLI 2.99 or newer was not available on the machine used.
- `--serve` with frameworks whose dev server writes into `node_modules` while two instances run. Sharing `node_modules` worked for the bundled static app; pass `--prepare` when in doubt.
- Phone-width playback. The film is landscape with large captions, not a vertical cut.

## Limits

- Regular main-document HTML elements only. No iframe contents, canvas or SVG targets, native apps, or mobile capture.
- DOM assertions do not prove every pixel is legible. Review each film at its intended size before sharing.
- Timestamps in the receipts are approximate video offsets; films are not performance measurements.
- Source hashes and recorded commits describe local files and checkouts, not what a remote URL served.
- Rendering uses the Playwright browser and system FFmpeg; setup disables dependency install scripts, including the renderer's telemetry hook, and the render process disables telemetry before loading Revideo.
