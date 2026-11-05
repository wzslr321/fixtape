import { readFile, mkdir, copyFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fileHash } from '../skills/fixtape/lib/media.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = process.argv[2];
if (!source || process.argv.length !== 3) throw new Error('Usage: node scripts/build-showcase.mjs <recording-directory>');
const destination = path.join(root, 'docs/media');
const receipts = {};
for (const side of ['before', 'after']) {
  const receipt = JSON.parse(await readFile(path.join(source, side, 'receipt.json'), 'utf8'));
  if (receipt.status !== 'passed' || receipt.exportStatus !== 'complete' || receipt.pacing?.scale !== 1) {
    throw new Error(`${side} is not a completed full-speed recording.`);
  }
  if (await fileHash(path.join(source, side, 'reel.mp4')) !== receipt.export.sha256) {
    throw new Error(`${side} MP4 differs from its recording receipt.`);
  }
  receipts[side] = receipt;
}
const film = JSON.parse(await readFile(path.join(source, 'film.json'), 'utf8'));
if (film.status !== 'complete' || film.export?.file !== 'film.mp4'
    || await fileHash(path.join(source, 'film.mp4')) !== film.export.sha256) {
  throw new Error('The film differs from its composition receipt or is incomplete.');
}
for (const side of ['before', 'after']) {
  if (film.sources?.[side]?.sha256 !== receipts[side].export.sha256
      || film.sources[side].receiptSha256 !== await fileHash(path.join(source, side, 'receipt.json'))) {
    throw new Error(`The film does not identify the supplied ${side} recording and receipt.`);
  }
}
await mkdir(destination, { recursive: true });
for (const file of ['film.mp4', 'film.jpg', 'film.json']) {
  await copyFile(path.join(source, file), path.join(destination, file));
}
for (const side of ['before', 'after']) {
  await copyFile(path.join(source, side, 'reel.mp4'), path.join(destination, `${side}.mp4`));
  await copyFile(path.join(source, side, 'poster.jpg'), path.join(destination, `${side}.jpg`));
}
await writeFile(path.join(destination, 'recording-receipts.json'), JSON.stringify(receipts, null, 2) + '\n');
console.log(`Showcase generated in ${destination}. Play and review the copied MP4s before sharing.`);
