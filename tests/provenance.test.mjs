import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, symlink, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { sourceReceipt } from '../skills/fixtape/lib/provenance.mjs';

test('source receipts distinguish observed files from unverified deployment identity', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'reel-source-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(path.join(root, 'app.js'), 'export const ready = false;');
  const before = await sourceReceipt({ root, files: ['app.js'] });
  await writeFile(path.join(root, 'app.js'), 'export const ready = true;');
  const after = await sourceReceipt({ root, files: ['app.js'] });
  assert.notEqual(before.digest, after.digest);
  assert.equal(before.kind, 'declared-local-source');
  assert.equal(before.files[0].path, 'app.js');
  assert.equal(before.git, null);
  assert.ok(!JSON.stringify(before).includes(root));
  assert.equal((await sourceReceipt()).kind, 'url-only');
});

test('source capture rejects files escaping its declared root, including symlinks', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'reel-boundary-'));
  const outside = await mkdtemp(path.join(os.tmpdir(), 'reel-outside-'));
  t.after(() => Promise.all([root, outside].map(dir => rm(dir, { recursive: true, force: true }))));
  await writeFile(path.join(outside, 'private.txt'), 'private fixture');
  await symlink(path.join(outside, 'private.txt'), path.join(root, 'link.txt'));
  await assert.rejects(sourceReceipt({ root, files: ['link.txt'] }), /inside source.root/);
  await assert.rejects(sourceReceipt({ root, files: [path.join(outside, 'private.txt')] }), /relative paths/);
  await assert.rejects(sourceReceipt({ root, files: [] }), /nonempty/);
});
