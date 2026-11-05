import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { mkdir, mkdtemp, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { startPreview } from '../skills/fixtape/lib/preview.mjs';

let directory;
let preview;
const media = Buffer.from('0123456789abcdefghijklmnopqrstuvwxyz');

before(async () => {
  directory = await mkdtemp(path.join(tmpdir(), 'fixtape-preview-'));
  await mkdir(path.join(directory, 'before'));
  await mkdir(path.join(directory, 'after'));
  await mkdir(path.join(directory, 'media'));
  await writeFile(path.join(directory, 'index.html'), '<!doctype html><title>Saved reel</title>');
  await writeFile(path.join(directory, 'before/reel.mp4'), media);
  await writeFile(path.join(directory, 'media/after.mp4'), media);
  for (const prefix of ['', 'media/']) {
    await writeFile(path.join(directory, `${prefix}film.mp4`), media);
    await writeFile(path.join(directory, `${prefix}film.jpg`), 'poster fixture');
    await writeFile(path.join(directory, `${prefix}film.json`), '{"status":"complete"}');
  }
  await writeFile(path.join(directory, 'before/raw.webm'), 'webm fixture');
  await writeFile(path.join(directory, 'before/receipt.json'), '{"status":"passed"}');
  await writeFile(path.join(directory, 'private.txt'), 'must not be served');
  const outside = await mkdtemp(path.join(tmpdir(), 'fixtape-preview-outside-'));
  await writeFile(path.join(outside, 'secret.mp4'), 'must not be served');
  await symlink(path.join(outside, 'secret.mp4'), path.join(directory, 'after/reel.mp4'));
  preview = await startPreview(directory);
});

after(async () => { await preview?.close(); });

test('serves the saved index and full media with usable MIME and range headers', async () => {
  assert.equal(new URL(preview.url).hostname, '127.0.0.1');
  const index = await fetch(preview.url);
  assert.equal(index.status, 200);
  assert.match(index.headers.get('content-type'), /text\/html/);
  assert.match(await index.text(), /Saved reel/);
  const response = await fetch(`${preview.url}before/reel.mp4`);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type'), 'video/mp4');
  assert.equal(response.headers.get('accept-ranges'), 'bytes');
  assert.equal(Number(response.headers.get('content-length')), media.length);
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), media);
});

test('streams exact single byte ranges, suffix ranges, and open-ended ranges', async t => {
  for (const [range, start, end] of [['bytes=4-9', 4, 9], ['bytes=-5', 31, 35], ['bytes=30-', 30, 35], ['bytes=30-999', 30, 35], ['bytes=-999', 0, 35]]) {
    await t.test(range, async () => {
      const response = await fetch(`${preview.url}before/reel.mp4`, { headers: { Range: range } });
      assert.equal(response.status, 206);
      assert.equal(response.headers.get('content-range'), `bytes ${start}-${end}/${media.length}`);
      assert.equal(Number(response.headers.get('content-length')), end - start + 1);
      assert.deepEqual(Buffer.from(await response.arrayBuffer()), media.subarray(start, end + 1));
    });
  }
});

test('HEAD returns full headers without a body, even when Range is present', async () => {
  const response = await fetch(`${preview.url}before/reel.mp4`, { method: 'HEAD', headers: { Range: 'bytes=4-9' } });
  assert.equal(response.status, 200);
  assert.equal(Number(response.headers.get('content-length')), media.length);
  assert.equal(response.headers.get('accept-ranges'), 'bytes');
  assert.equal(response.headers.get('content-range'), null);
  assert.equal((await response.arrayBuffer()).byteLength, 0);
});

test('rejects malformed, multiple, and unsatisfiable byte ranges', async t => {
  for (const range of ['bytes=99-', 'bytes=10-2', 'bytes=-0', 'bytes=-', 'bytes=0-1,4-5', 'bytes=abc', 'bytes=999999999999999999999-']) {
    await t.test(range, async () => {
      const response = await fetch(`${preview.url}before/reel.mp4`, { headers: { Range: range } });
      assert.equal(response.status, 416);
      assert.equal(response.headers.get('content-range'), `bytes */${media.length}`);
      assert.equal((await response.arrayBuffer()).byteLength, 0);
    });
  }
});

test('allows showcase media and generated receipts', async () => {
  const showcase = await fetch(`${preview.url}media/after.mp4`, { headers: { Range: 'bytes=1-2' } });
  assert.equal(showcase.status, 206);
  assert.equal(await showcase.text(), '12');
  const receipt = await fetch(`${preview.url}before/receipt.json`);
  assert.equal(receipt.status, 200);
  assert.match(receipt.headers.get('content-type'), /application\/json/);
  assert.deepEqual(await receipt.json(), { status: 'passed' });
});

test('serves the film, poster, and composition receipt from recording and showcase directories', async () => {
  for (const prefix of ['', 'media/']) {
    const film = await fetch(`${preview.url}${prefix}film.mp4`, { headers: { Range: 'bytes=2-5' } });
    assert.equal(film.status, 206);
    assert.equal(film.headers.get('content-type'), 'video/mp4');
    assert.equal(await film.text(), '2345');
    const poster = await fetch(`${preview.url}${prefix}film.jpg`);
    assert.equal(poster.status, 200);
    assert.equal(poster.headers.get('content-type'), 'image/jpeg');
    assert.equal(await poster.text(), 'poster fixture');
    const receipt = await fetch(`${preview.url}${prefix}film.json`);
    assert.equal(receipt.status, 200);
    assert.equal(receipt.headers.get('content-type'), 'application/json; charset=utf-8');
    assert.deepEqual(await receipt.json(), { status: 'complete' });
  }
});

test('does not expose unknown paths, directories, encoded traversal, or symlink escapes', async t => {
  for (const relative of ['private.txt', 'before/', 'before/missing.mp4', '%2e%2e%2fprivate.txt', 'after/reel.mp4', '%E0%A4%A']) {
    await t.test(relative, async () => {
      const response = await fetch(`${preview.url}${relative}`);
      assert.equal(response.status, 404);
      assert.equal(await response.text(), 'Not found.');
    });
  }
});

test('rejects methods other than GET and HEAD', async () => {
  const response = await fetch(preview.url, { method: 'POST' });
  assert.equal(response.status, 405);
  assert.equal(response.headers.get('allow'), 'GET, HEAD');
  await response.text();
});

test('requires a contained index and validates the port', async () => {
  const empty = await mkdtemp(path.join(tmpdir(), 'fixtape-preview-empty-'));
  await assert.rejects(startPreview(empty), /must contain a regular index.html/);
  await assert.rejects(startPreview(directory, { port: -1 }), /port must be an integer/);
  await assert.rejects(startPreview(directory, { port: 65536 }), /port must be an integer/);
  const another = await startPreview(directory);
  await another.close();
  await another.close();
});
