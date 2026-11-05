import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chmod, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { atLeast, checkGh, commentBody, parseGhVersion, publishFilm } from '../skills/fixtape/lib/publish.mjs';
import { fileHash } from '../skills/fixtape/lib/media.mjs';

async function fakeGh(version, logPath) {
  const bin = await mkdtemp(path.join(os.tmpdir(), 'fixtape-gh-'));
  const script = path.join(bin, 'gh');
  await writeFile(script, `#!/bin/sh
if [ "$1" = "--version" ]; then echo "gh version ${version} (2026-09-01)"; exit 0; fi
printf '%s\\n' "$@" > "${logPath}"
echo "https://github.com/acme/shop/pull/123#issuecomment-99"
`);
  await chmod(script, 0o755);
  return { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH}` };
}

async function recording() {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'fixtape-rec-'));
  await writeFile(path.join(dir, 'film.mp4'), 'not really a film');
  const receipts = {};
  for (const side of ['before', 'after']) {
    await mkdir(path.join(dir, side));
    const observed = side === 'before' ? 'Order placed. Charged $0.30000000000000004.' : 'Order placed. Charged $0.30.';
    const receipt = { observations: [{ target: '.confirmation-text', observed, caption: side === 'before' ? 'Charged $0.30000000000000004.' : 'Charged $0.30.' }] };
    await writeFile(path.join(dir, side, 'receipt.json'), JSON.stringify(receipt));
    receipts[side] = { receiptSha256: await fileHash(path.join(dir, side, 'receipt.json')) };
  }
  const film = { status: 'complete', title: 'Floating-point total at checkout', goal: 'Charge the customer the right amount.', export: { sha256: await fileHash(path.join(dir, 'film.mp4')) }, sources: receipts };
  await writeFile(path.join(dir, 'film.json'), JSON.stringify(film));
  return { dir, film };
}

test('gh version parsing and comparison', () => {
  assert.equal(parseGhVersion('gh version 2.99.0 (2026-09-01)\nhttps://github.com/cli/cli/releases/tag/v2.99.0'), '2.99.0');
  assert.throws(() => parseGhVersion('nope'), /gh version/);
  assert.equal(atLeast('2.99.0', '2.99.0'), true);
  assert.equal(atLeast('2.100.1', '2.99.0'), true);
  assert.equal(atLeast('3.0.0', '2.99.0'), true);
  assert.equal(atLeast('2.79.0', '2.99.0'), false);
});

test('comment body names both observed results without markup noise', async () => {
  const { film } = await recording();
  const before = { observations: [{ target: '#x', observed: 3, caption: 'Still three.' }] };
  const after = { observations: [{ target: '#x', observed: 2, caption: 'Two left.' }] };
  const body = commentBody({ film, before, after });
  assert.equal(body, `**Floating-point total at checkout**
Charge the customer the right amount.

Before: Still three. Observed \`#x\` = \`3\`.
After: Two left. Observed \`#x\` = \`2\`.

Recorded with fixtape. Film sha256 \`${film.export.sha256.slice(0, 12)}\`.
`);
});

test('publish refuses an old gh and posts with --attach on a new one', async () => {
  const { dir, film } = await recording();
  const logPath = path.join(dir, 'gh-args.txt');
  await assert.rejects(checkGh(await fakeGh('2.79.0', logPath)), /needs gh 2\.99\.0/);
  await assert.rejects(publishFilm(dir, { pr: '123', env: await fakeGh('2.79.0', logPath) }), /drag film\.mp4/);
  await assert.rejects(publishFilm(dir, { env: await fakeGh('2.99.0', logPath) }), /--pr/);

  const receipt = await publishFilm(dir, { pr: '123', repo: 'acme/shop', env: await fakeGh('2.99.0', logPath) });
  const args = (await readFile(logPath, 'utf8')).trim().split('\n');
  assert.deepEqual(args.slice(0, 3), ['pr', 'comment', '123']);
  assert.equal(args[3], '--body-file');
  assert.deepEqual(args.slice(5), ['--attach', path.join(dir, 'film.mp4'), '--repo', 'acme/shop']);
  assert.equal(receipt.url, 'https://github.com/acme/shop/pull/123#issuecomment-99');
  assert.equal(receipt.filmSha256, film.export.sha256);
  assert.match(receipt.body, /Before: Charged \$0\.30000000000000004\./);
  const saved = JSON.parse(await readFile(path.join(dir, 'publish.json'), 'utf8'));
  assert.equal(saved.pr, '123');
  assert.equal(saved.gh, '2.99.0');

  await writeFile(path.join(dir, 'film.mp4'), 'tampered');
  await assert.rejects(publishFilm(dir, { pr: '123', env: await fakeGh('2.99.0', logPath) }), /differs from film\.json/);
});
