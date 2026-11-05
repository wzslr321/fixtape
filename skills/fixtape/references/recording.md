# Author a recording scenario

Save an ES module with a default-exported scenario. Both URLs must be running before recording begins. Each side opens in a fresh Chromium context at 1280 × 800, so establish any required test state explicitly.

```js
export default {
  title: 'Hide completed tasks',
  goal: 'Keep only unfinished tasks in view.',
  before: { url: 'http://127.0.0.1:3000/before/' },
  after: { url: 'http://127.0.0.1:3000/after/' },

  async run({ page, reel, side }) {
    await reel.step({
      caption: 'Select “Hide completed”.',
      target: '#hide-completed',
      action: async (checkbox) => { await checkbox.check(); },
    });
    await reel.observe({
      target: '#tasks li',
      anchor: '#tasks',
      read: 'count',
      equals: side === 'before' ? 3 : 2,
      caption: side === 'before'
        ? 'The completed task stays visible. All 3 tasks remain.'
        : 'Only the 2 unfinished tasks remain.',
      outcome: side === 'before' ? 'problem' : 'fixed',
    });
  },
};
```

The example assumes three rendered rows, one completed, and a filter that removes the completed row after the fix. Adapt the selectors and expectations to the actual application. Keep the same interaction on both sides.

## Run it

Replace `<skill-directory>` with the directory containing `SKILL.md`:

```sh
node <skill-directory>/scripts/fixtape.mjs record /absolute/path/to/story.mjs --out /absolute/path/to/new-output
```

Options: `--side both|before|after` (default `both`), `--headed`, and `--max-mb 10` (maximum size of each MP4, default 10 MB). The output directory must be new or empty. Setup and runtime resolve dependencies relative to the installed skill, not the application project. Setup reuses Playwright Chromium for recording and film rendering, with Puppeteer's separate browser download disabled.

## One sequential film

Paired recording captures clean footage and creates `film.mp4`, `film.jpg` and `film.json`. The 1280 × 800 film presents before, then after, with one interface on screen, camera focus and captions. Aim for about 20 seconds; the renderer rejects films over 25 seconds. Each retained source sequence is continuous and plays at its original speed. Only lead-ins are shortened.

To render an existing clean pair:

```sh
node <skill-directory>/scripts/fixtape.mjs compose /absolute/path/to/output
```

The composer checks source MP4 hashes and recording receipts before rendering. It refuses existing film files. Annotated clips from single-side recording are retained as standalone evidence and are not inputs to the film renderer. The film receipt records source intervals and hashes; its timestamps are approximate, so inspect the actual export. The edit does not measure application performance.

## Scenario fields

| Field | Contract |
| --- | --- |
| `title` | Nonempty text, at most 100 characters. |
| `goal` | Nonempty text, at most 180 characters. |
| `before`, `after` | Each has an HTTP(S) `url`; optional `label` adds up to 60 characters of context. |
| `source` | Optional declaration on each side, described below. |
| `run({ page, reel, side })` | Async workflow; `page` is a Playwright Page and `side` is `before` or `after`. |

Await each reel operation sequentially. Every recording needs at least one real action through `reel.step` and must end with `reel.observe`.

### `reel.step({ caption, target, action? })`

`target` is a CSS selector matching exactly one visible, unobscured main-document HTML element. Its bounds and `caption` guide the film's camera and annotations. A standalone annotated recording displays them before calling `action(locator)`. The locator identifies the target. Use real Playwright input such as `click()`, `check()`, `fill()`, or `press()` within that element. An action with no real input, or input outside the focused target, fails.

Omit `action` for a short orientation scene. Captions may use any language and must be nonempty, at most 180 characters. Keep the target inside the viewport with room around it; clipped, covered, or edge-adjacent targets fail. The caption must fit without covering the target.

### `reel.observe({ target, read, equals, caption, outcome, anchor? })`

The recorder reads the application, compares the result using exact equality, and records the observed verdict. The film reveals the result after its recorded assertion; a standalone annotated clip displays it during capture. `outcome` must be `problem` for the before side and `fixed` for the after side. These labels do not determine whether the assertion passes.

| `read` | Observed value | `equals` |
| --- | --- | --- |
| `text` | Trimmed `innerText` of one visible element | String |
| `value` | Current value of one input, textarea, or select | String |
| `count` | Number of visible matching HTML elements in the viewport | Nonnegative integer |

For `count`, provide `anchor`: a CSS selector for one unique visible element containing every match. Visible matches must also fit inside its bounds, so the focus contains what is counted. The recorder excludes hidden, offscreen, clipped, and covered matches using its visibility checks. Occlusion checks sample the center and interior points; watching the video remains necessary. Iframe, canvas, SVG, or recording-overlay targets fail instead of being counted. `anchor` is not accepted for `text` or `value`.

Wait for the application to settle before observing when needed, using a specific application signal such as `await page.locator('#status').filter({ hasText: 'Saved' }).waitFor()`. An observed value must come from the application, not text added by the scenario or the recording overlay.

## Declare source files

Each side can declare its local source:

```js
before: {
  url: 'http://127.0.0.1:3000/',
  source: {
    root: '/absolute/path/to/original-checkout',
    files: ['src/tasks.js', 'src/index.html'],
  },
},
```

Use a separate source declaration for the fixed version. File paths must be relative to, and remain inside, `root`. The receipt stores file hashes and available Git information. The URL-to-source association is a declaration by the scenario, not independent proof of the revision served. Without a declaration, the receipt records URL-only provenance.

## Review the saved evidence

Keep `film.mp4`, `film.jpg` and `film.json`, plus each side's `raw.webm`, `reel.mp4`, `poster.jpg`, and `receipt.json`. The raw video is the original browser capture before MP4 encoding: clean for a paired film, annotated for a single-side run. Receipts contain actions, observed and expected values, timing, and source information where supplied. A failed capture may leave only partial artifacts and a failure receipt; do not present them as a successful recording.

Run `node <skill-directory>/scripts/fixtape.mjs preview <output-directory>` and open the printed loopback URL. The built-in server supports byte ranges, so the saved videos can be sought as well as played. Stop it with Ctrl+C after review.

Play and seek the film and source clips. Verify that a viewer can identify the goal, real action, and final difference without extra narration. Check camera framing and caption placement at the intended playback size. Obtain an independent viewer's review, or report that check as unperformed if none is available. Check the receipts against the clips, and disclose missing source or environment evidence. The CLI does not upload the artifacts.
