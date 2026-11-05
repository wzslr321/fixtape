import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chromium } from 'playwright';
import { startDemo } from '../skills/fixtape/assets/demo/server.mjs';
import { createScenario } from '../skills/fixtape/assets/demo/scenario.mjs';

test('demo serves fixed assets and refuses unrelated paths', async (t) => {
  const demo = await startDemo();
  t.after(() => demo.close());
  for (const path of ['/before/', '/after/']) {
    const response = await fetch(`${demo.url}${path}`);
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type'), /^text\/html/);
  }
  const beforeCode = await fetch(`${demo.url}/before/app.js`).then((response) => response.text());
  const afterCode = await fetch(`${demo.url}/after/app.js`).then((response) => response.text());
  assert.notEqual(beforeCode, afterCode);
  for (const path of ['/server.mjs', '/scenario.mjs', '/missing', '/%2e%2e/package.json']) {
    assert.equal((await fetch(`${demo.url}${path}`)).status, 404);
  }
  assert.equal((await fetch(`${demo.url}/before/`, { method: 'POST' })).status, 404);
  await assert.rejects(startDemo({ host: '0.0.0.0' }), /loopback/);
});

test('completed task remains before, disappears after, and returns when the filter is cleared', async (t) => {
  const demo = await startDemo();
  t.after(() => demo.close());
  const browser = await chromium.launch({ headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const scenario = createScenario(demo.url);

  for (const side of ['before', 'after']) {
    await page.goto(scenario[side].url);
    await page.locator('#tasks li').first().waitFor();
    assert.equal(await page.locator('#tasks li').count(), 3);
    assert.equal(await page.locator('#tasks li.completed').count(), 1);
    await page.locator('#hide-completed').check();
    assert.equal(await page.locator('#hide-completed').isChecked(), true);
    assert.equal(await page.locator('#tasks li').count(), side === 'before' ? 3 : 2);
    assert.equal(await page.locator('#tasks li.completed').count(), side === 'before' ? 1 : 0);
    assert.deepEqual(await page.locator('#tasks li:not(.completed) .task-title').allTextContents(), [
      'Keep keyboard focus in the dialog',
      'Remember the selected theme',
    ]);
    await page.locator('#hide-completed').uncheck();
    assert.equal(await page.locator('#tasks li').count(), 3);
    assert.equal(await page.locator('#tasks li.completed').count(), 1);
  }
});
