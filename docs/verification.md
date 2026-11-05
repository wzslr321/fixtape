# Version 0.1.0 verification

Local checks used macOS on Apple Silicon, Node.js 22.23.4, Playwright 1.64.1, Revideo 0.11.0 and FFmpeg 9.0.1.

| Check | Result |
| --- | --- |
| Complete recorder, demo, media, provenance, preview and renderer suite | 87 passed before the final camera repair |
| Affected renderer and compatibility suite after that repair | 19 passed, including an encoded film and pixel checks at the source edges |
| Skill format | Passed |
| Independent code review | Findings fixed; final camera boundaries and setup checked |
| Disposable Codex and Claude Code installations | 22 matching skill files in each, without links to the source checkout |
| Setup with dependency install scripts disabled | Both installations passed and reused existing Chromium |
| Bundled task-list demo | Real checkbox action; three tasks before, two after |
| Independent profile form | Two actions and asserted displayed values; 23.4-second film from the installed skill |
| Final showcase | 17.53 seconds, 1280 × 800, 30 fps, H.264/yuv420p, 4.34 MB |
| Saved players | Native Chrome playback and seeking; independent installed-film and source-clip playback, seeking and HTTP Range checks |
| Evidence preservation | Source hashes retained; overwrite rejected without changing the existing artifacts |
| Independent visual review | Goal, action and both results understood at 640 px; final crop and spotlight repairs checked |

The visual reviewer inspected timestamped frame sequences. Continuous playback was checked separately. The GIF follows the single film; full original captures remain linked below the film. Included source files implement the actual before and after behavior, and their hashes are recorded in the receipts.

Rendering uses the existing Playwright browser and system FFmpeg. Setup disables dependency install scripts, including the renderer dependency's telemetry identifier hook, and the render process disables telemetry before loading Revideo. No desktop editor is required.

## Coverage limits

- Installation and CLI execution were tested. Automatic skill selection inside each client was not tested.
- Existing Chromium worked. A separate fresh browser cache was killed by the host in an earlier setup probe, so this run does not establish completely fresh-machine setup.
- Windows and Linux were not executed locally. Linux CI is configured but has not run on GitHub.
- Remote installation, hosted players and social uploads remain untested while the repository is local.
- The full interface is small at phone-feed width. The film is a landscape comparison with readable main captions, not a dedicated vertical layout.
- DOM assertions cannot prove every pixel is legible. Review each saved film at its intended playback size. Timestamp offsets are approximate; these films are not performance measurements.
