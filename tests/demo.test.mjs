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

test('placing the order charges a floating-point total before and the exact cents after', async (t) => {
  const demo = await startDemo();
  t.after(() => demo.close());
  const browser = await chromium.launch({ headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const scenario = createScenario(demo.url);

  for (const side of ['before', 'after']) {
    await page.goto(scenario[side].url);
    await page.locator('#items li').first().waitFor();
    assert.deepEqual(await page.locator('#items .item-price').allTextContents(), ['$0.10', '$0.20']);
    assert.equal(await page.locator('#confirmation').isVisible(), false);
    await page.locator('#place-order').click();
    assert.equal(await page.locator('#confirmation').isVisible(), true);
    assert.equal(await page.locator('#charged').innerText(), side === 'before' ? '$0.30000000000000004' : '$0.30');
    assert.equal(await page.locator('#place-order').isDisabled(), true);
  }
});
