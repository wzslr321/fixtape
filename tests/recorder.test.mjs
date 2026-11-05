import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { createServer } from 'node:http';
import { mkdtemp, readFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { record } from '../skills/fixtape/lib/recorder.mjs';

let server;
let url;
let artifacts;
let sequence = 0;

const html = `<!doctype html><html><head><title>Recorder fixture</title><style>
  body{margin:0;font:24px Arial;background:#f8fafc;color:#111827}
  main{margin:120px auto;width:740px}button,input{font:inherit;padding:14px 22px}
  #status{margin-top:28px;padding:24px;background:white;border:1px solid #cbd5e1}
  #items{padding:20px;min-height:40px;background:#e2e8f0;list-style:none}
  #hidden{display:none}#offscreen{position:absolute;top:1200px}
  #clip{position:absolute;left:30px;top:500px;width:20px;height:30px;overflow:hidden}
  #clipped{display:block;width:200px;height:30px}
  #bottom{position:absolute;left:900px;top:670px;padding:16px}
  #large{position:fixed;inset:30px;background:white;display:none}
  .duplicate{position:absolute;top:540px;left:300px}.duplicate+ .duplicate{left:500px}
</style></head><body><main><h1>Order total</h1>
<button id="update">Update total</button><input id="value" value="0">
<div id="status">Waiting</div><ul id="items"><li>First</li></ul>
<div id="hidden">Hidden content</div><div id="offscreen">Offscreen content</div>
<div id="clip"><span id="clipped">Clipped content</span></div>
<button class="duplicate">One</button><button class="duplicate">Two</button>
<div id="bottom">Bottom target</div><div id="large">Large target</div>
</main><script>
document.querySelector('#update').addEventListener('click',()=>{
 document.querySelector('#status').textContent='Updated';
 document.querySelector('#value').value='42';
 const item=document.createElement('li');item.textContent='Second';document.querySelector('#items').append(item);
});
</script></body></html>`;

before(async () => {
  artifacts = await mkdtemp(path.join(tmpdir(), 'fixtape-recorder-'));
  server = createServer((_request, response) => { response.writeHead(200, { 'Content-Type': 'text/html' }); response.end(html); });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  url = `http://127.0.0.1:${server.address().port}/fixture`;
});

after(async () => { await new Promise(resolve => server.close(resolve)); });

function fixture(run) {
  return { title: 'Correct the displayed total', goal: 'Updating the order displays the new total.', before: { url }, after: { url }, run };
}

async function capture(run, options = {}) {
  const outDir = path.join(artifacts, String(++sequence));
  return record({ scenario: fixture(run), side: 'after', outDir, timingScale: 0.01, ...options });
}

async function click(reel) {
  await reel.step({ caption: 'Update the order total.', target: '#update', action: target => target.click() });
}

async function observe(reel, overrides = {}) {
  await reel.observe({ caption: 'The new total is visible.', target: '#status', read: 'text', equals: 'Updated', outcome: 'fixed', ...overrides });
}

async function rejectsWithEvidence(run, pattern) {
  let failure;
  try { await capture(run); } catch (error) { failure = error; }
  assert.ok(failure, 'recording must reject');
  assert.match(failure.message, pattern);
  assert.equal(failure.receipt.status, 'failed');
  assert.ok((await stat(failure.videoPath)).size > 100);
  const stored = JSON.parse(await readFile(path.join(path.dirname(failure.videoPath), 'receipt.json'), 'utf8'));
  assert.equal(stored.status, 'failed');
  assert.match(stored.error, pattern);
  return failure;
}

test('records a real action and verified terminal result with readable, non-overlapping pacing', async t => {
  const { videoPath, receipt } = await capture(async ({ page, reel }) => {
    await click(reel);
    await observe(reel);
    await page.screenshot({ path: path.join(artifacts, 'verified-terminal.png') });
  }, { timingScale: 1 });
  assert.equal(receipt.status, 'passed');
  assert.equal(receipt.actionCount, 1);
  assert.equal(receipt.observations[0].observed, 'Updated');
  assert.ok(receipt.events[0].endMs - receipt.events[0].startMs >= 3000);
  const action = receipt.events.find(event => event.kind === 'step');
  assert.ok(action.input.some(event => event.type === 'pointerdown' && event.withinTarget));
  assert.ok(action.actionStartMs - action.startMs >= 2500);
  const observation = receipt.observations[0];
  assert.ok(observation.endMs - observation.startMs >= 4200);
  for (const event of [action, observation]) {
    assert.equal(event.captionFontPx, 28);
    assert.match(event.captionFontFamily, /Arial/);
    const a = event.bounds;
    const b = event.panel;
    assert.ok(b.x >= 24 && b.y >= 24 && b.x + b.width <= 1256 && b.y + b.height <= 776);
    assert.ok(a.x + a.width < b.x || b.x + b.width < a.x || a.y + a.height < b.y || b.y + b.height < a.y);
  }
  assert.ok((await stat(videoPath)).size > 1000);
  t.diagnostic(`Real-browser artifacts: ${artifacts}`);
});

test('wrong observed value fails and preserves its actual value and raw recording', async () => {
  const failure = await rejectsWithEvidence(async ({ reel }) => { await click(reel); await observe(reel, { equals: 'Invented' }); }, /expected "Invented", observed "Updated"/);
  assert.deepEqual(failure.receipt.observations.map(({ observed, pass }) => ({ observed, pass })), [{ observed: 'Updated', pass: false }]);
});

test('clean capture hides only the annotation and retains real input and observations', async () => {
  const { receipt } = await capture(async ({ page, reel }) => {
    assert.equal(await page.locator('[data-fixtape]').evaluate(node => getComputedStyle(node).opacity), '0');
    assert.equal(await page.locator('#status').innerText(), 'Waiting');
    await click(reel);
    await observe(reel);
    assert.equal(await page.locator('#status').innerText(), 'Updated');
  }, { presentation: 'clean' });
  assert.equal(receipt.presentation, 'clean');
  assert.equal(receipt.status, 'passed');
  assert.equal(receipt.observations[0].observed, 'Updated');
  assert.ok(receipt.events.find(event => event.input)?.input.some(event => event.withinTarget));
});

test('rejects ambiguous, hidden, offscreen, and clipped targets', async t => {
  for (const [target, message] of [
    ['.duplicate', /exactly one element; matched 2/], ['#hidden', /hidden/],
    ['#offscreen', /outside the viewport/], ['#clipped', /clipped by its container/],
  ]) {
    await t.test(target, async () => {
      await rejectsWithEvidence(async ({ reel }) => reel.step({ target, caption: 'Inspect the real target.' }), message);
    });
  }
});

test('rejects the recording overlay as authored product evidence', async () => {
  await rejectsWithEvidence(async ({ reel }) => reel.step({ target: '[data-fixtape]', caption: 'This is not product content.' }), /cannot select the recording overlay/);
});

test('rounded containers and pill buttons remain usable recording targets', async () => {
  const { receipt } = await capture(async ({ page, reel }) => {
    await page.evaluate(() => {
      const status = document.querySelector('#status');
      const rounded = document.createElement('div');
      rounded.style.cssText = 'border-radius:32px;overflow:hidden;margin-top:28px';
      status.before(rounded);
      rounded.append(status);
      status.style.marginTop = '0';
      document.querySelector('#update').style.borderRadius = '9999px';
    });
    await reel.step({ target: '#status', caption: 'Inspect the current total.' });
    const label = await page.locator('[data-fixtape]').evaluate(host => host.shadowRoot.querySelector('.eyebrow').textContent);
    assert.equal(label, 'AFTER · FOCUS');
    await click(reel);
    await observe(reel);
  });
  assert.equal(receipt.status, 'passed');
});

test('an element covering the target still fails visibility checks', async () => {
  await rejectsWithEvidence(async ({ page, reel }) => {
    await click(reel);
    await page.evaluate(() => {
      const bounds = document.querySelector('#status').getBoundingClientRect();
      const cover = document.createElement('div');
      cover.style.cssText = `position:fixed;left:${bounds.x}px;top:${bounds.y}px;width:${bounds.width}px;height:${bounds.height}px;background:white`;
      document.body.append(cover);
    });
    await observe(reel);
  }, /covered by another element/);
});

test('action errors and empty actions cannot become successful recordings', async t => {
  await t.test('callback error', async () => {
    await rejectsWithEvidence(async ({ reel }) => reel.step({ caption: 'Try the action.', target: '#update', action: () => { throw new Error('Action failed deliberately'); } }), /Action failed deliberately/);
  });
  await t.test('no real input', async () => {
    await rejectsWithEvidence(async ({ reel }) => reel.step({ caption: 'Try the action.', target: '#update', action: async () => {} }), /no real pointer or keyboard input/);
  });
  await t.test('caught assertion', async () => {
    await rejectsWithEvidence(async ({ reel }) => {
      await click(reel);
      try { await observe(reel, { equals: 'Incorrect' }); } catch {}
      await observe(reel);
    }, /expected "Incorrect"/);
  });
});

test('requires an asserted observation and a real action', async t => {
  await t.test('missing observation', async () => { await rejectsWithEvidence(async ({ reel }) => click(reel), /requires at least one asserted observation/); });
  await t.test('missing action', async () => { await rejectsWithEvidence(async ({ reel }) => observe(reel, { equals: 'Waiting' }), /requires at least one real action/); });
});

test('reads values and counts from product DOM with an explicit count anchor', async () => {
  const { receipt } = await capture(async ({ reel }) => {
    await click(reel);
    await observe(reel, { target: '#value', read: 'value', equals: '42' });
    await observe(reel, { target: '#items li', anchor: '#items', read: 'count', equals: 2 });
  });
  assert.deepEqual(receipt.observations.map(({ observed }) => observed), ['42', 2]);
});

test('observations exclude hidden list items and display-none text children', async () => {
  const { receipt } = await capture(async ({ page, reel }) => {
    await click(reel);
    await page.evaluate(() => {
      const hiddenItem = document.createElement('li');
      hiddenItem.hidden = true;
      hiddenItem.textContent = 'Not visible';
      document.querySelector('#items').append(hiddenItem);
      const hiddenText = document.createElement('span');
      hiddenText.style.display = 'none';
      hiddenText.textContent = 'Not visible';
      document.querySelector('#status').append(hiddenText);
    });
    await observe(reel);
    await observe(reel, { target: '#items li', anchor: '#items', read: 'count', equals: 2 });
  });
  assert.deepEqual(receipt.observations.map(({ observed }) => observed), ['Updated', 2]);
});

test('text observations reject transparent descendants that innerText would include', async () => {
  await rejectsWithEvidence(async ({ page, reel }) => {
    await click(reel);
    await page.evaluate(() => {
      const hiddenText = document.createElement('span');
      hiddenText.style.opacity = '0';
      hiddenText.textContent = 'Invisible';
      document.querySelector('#status').append(hiddenText);
    });
    await observe(reel, { equals: 'UpdatedInvisible' });
  }, /contains transparent text/);
});

test('count evidence must remain inside its highlighted anchor', async t => {
  await t.test('unrelated anchor', async () => {
    await rejectsWithEvidence(async ({ reel }) => {
      await click(reel);
      await observe(reel, { target: '#items li', anchor: 'h1', read: 'count', equals: 2 });
    }, /Every count target must belong to its visible anchor/);
  });
  await t.test('descendant outside anchor bounds', async () => {
    await rejectsWithEvidence(async ({ page, reel }) => {
      await click(reel);
      await page.locator('#items li').first().evaluate(node => { node.style.cssText = 'position:fixed;top:650px;left:300px'; });
      await observe(reel, { target: '#items li', anchor: '#items', read: 'count', equals: 2 });
    }, /Every counted element must fit inside its visible anchor/);
  });
});

test('text observations reject clipped screen-reader-only descendants', async () => {
  await rejectsWithEvidence(async ({ page, reel }) => {
    await click(reel);
    await page.evaluate(() => {
      const hiddenText = document.createElement('span');
      hiddenText.style.cssText = 'position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap';
      hiddenText.textContent = 'Hidden secret';
      document.querySelector('#status').append(hiddenText);
    });
    await observe(reel, { equals: 'Updated\nHidden secret' });
  }, /contains clipped descendant text/);
});

test('moves a caption above a low target and rejects an impossible layout', async t => {
  await t.test('above low target', async () => {
    const { receipt } = await capture(async ({ reel }) => {
      await click(reel);
      await observe(reel, { target: '#bottom', equals: 'Bottom target' });
    });
    const observation = receipt.observations[0];
    assert.ok(observation.panel.y + observation.panel.height < observation.bounds.y);
  });
  await t.test('target leaves no caption room', async () => {
    await rejectsWithEvidence(async ({ page, reel }) => {
      await page.locator('#large').evaluate(node => { node.style.display = 'block'; });
      await reel.step({ caption: 'The caption must not cover the target.', target: '#large' });
    }, /cannot fit without covering the target/);
  });
});

test('validates observation modes and equality domains instead of coercing', async t => {
  for (const overrides of [{ read: 'html' }, { equals: 42 }, { read: 'count', equals: -1, anchor: '#items' }, { read: 'count', equals: 2 }]) {
    await t.test(JSON.stringify(overrides), async () => {
      await rejectsWithEvidence(async ({ reel }) => { await click(reel); await observe(reel, overrides); }, /must be|requires|require/);
    });
  }
});

test('receipt URL omits credentials, query values, and fragments', async () => {
  const scenario = fixture(async ({ reel }) => { await click(reel); await observe(reel); });
  scenario.after.url = `${url}?session=private-value#private-fragment`;
  const { receipt } = await capture(scenario.run, { scenario });
  assert.equal(receipt.url, url);
  assert.equal(receipt.videoPath, 'raw.webm');
  assert.doesNotMatch(JSON.stringify(receipt), /private-value|private-fragment/);
});

test('invalid side is rejected before creating a browser', async () => {
  await assert.rejects(capture(async () => {}, { side: 'other' }), /side must be before or after/);
});

test('refuses to overwrite an existing evidence directory', async () => {
  const outDir = await mkdtemp(path.join(artifacts, 'existing-'));
  await assert.rejects(capture(async () => {}, { outDir }), /Refusing to overwrite existing recording evidence/);
});

test('a terminal result that changes during its hold fails the recording', async () => {
  let failure;
  try {
    await capture(async ({ page, reel }) => {
      await click(reel);
      await page.evaluate(() => setTimeout(() => { document.querySelector('#status').textContent = 'Changed again'; }, 400));
      await observe(reel);
    }, { timingScale: 0.2 });
  } catch (error) { failure = error; }
  assert.ok(failure);
  assert.match(failure.message, /result changed while its verdict was visible/);
  assert.equal(failure.receipt.status, 'failed');
  assert.equal(failure.receipt.observations[0].observedAfterHold, 'Changed again');
  assert.equal(failure.receipt.observations[0].pass, false);
});
