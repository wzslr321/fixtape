import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, rm, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { exportVideo, fileHash } from '../skills/fixtape/lib/media.mjs';

const exec = promisify(execFile);

test('media export produces seekable H.264 and preserves raw evidence and existing exports', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'reel-media-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const raw = path.join(root, 'raw.webm');
  await exec('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=blue:s=1280x800:r=25', '-t', '6', '-c:v', 'libvpx-vp9', raw]);
  const rawHash = await fileHash(raw);
  const info = await exportVideo(raw, root);
  assert.equal(info.codec, 'h264');
  assert.equal(info.width, 1280);
  assert.equal(info.height, 800);
  assert.equal(info.pixelFormat, 'yuv420p');
  assert.ok(info.duration >= 5.9 && info.duration <= 6.1);
  assert.equal(await fileHash(raw), rawHash);
  const mp4 = await readFile(path.join(root, 'reel.mp4'));
  assert.ok(mp4.indexOf(Buffer.from('moov')) < mp4.indexOf(Buffer.from('mdat')));
  await assert.rejects(exportVideo(raw, root));
  assert.equal(await fileHash(path.join(root, 'reel.mp4')), info.sha256);
  const smallLimit = path.join(root, 'small-limit');
  await mkdir(smallLimit);
  await assert.rejects(exportVideo(raw, smallLimit, { maxBytes: 1 }), /limit/);
});
