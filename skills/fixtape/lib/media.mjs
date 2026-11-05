import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';

const exec = promisify(execFile);

export async function checkMediaTools() {
  for (const tool of ['ffmpeg', 'ffprobe']) {
    try { await exec(tool, ['-version']); }
    catch { throw new Error(`${tool} is missing. Install FFmpeg, then run doctor again.`); }
  }
  const { stdout } = await exec('ffmpeg', ['-hide_banner', '-encoders']);
  if (!/\blibx264\b/.test(stdout)) throw new Error('FFmpeg needs the libx264 encoder for browser-compatible MP4.');
}

export async function inspectVideo(file) {
  const { stdout } = await exec('ffprobe', [
    '-v', 'error', '-select_streams', 'v:0', '-show_entries',
    'stream=codec_name,width,height,pix_fmt:format=duration,size', '-of', 'json', file,
  ]);
  const data = JSON.parse(stdout);
  const stream = data.streams?.[0];
  if (!stream) throw new Error('No video stream found.');
  return {
    codec: stream.codec_name, width: stream.width, height: stream.height,
    pixelFormat: stream.pix_fmt, duration: Number(data.format.duration), bytes: Number(data.format.size),
  };
}

export async function exportVideo(videoPath, outDir, { maxBytes = 10_000_000 } = {}) {
  const file = path.join(outDir, 'reel.mp4');
  const poster = path.join(outDir, 'poster.jpg');
  if (await exists(file) || await exists(poster)) throw new Error('Refusing to overwrite an existing export. Choose an empty output directory.');
  if (!Number.isFinite(maxBytes) || maxBytes <= 0) throw new Error('Export size limit must be positive.');
  await exec('ffmpeg', [
    '-hide_banner', '-loglevel', 'error', '-n', '-i', videoPath,
    '-map', '0:v:0', '-an', '-c:v', 'libx264', '-preset', 'medium', '-crf', '21',
    '-pix_fmt', 'yuv420p', '-movflags', '+faststart', file,
  ], { maxBuffer: 1024 * 1024 });
  const info = await inspectVideo(file);
  if (info.codec !== 'h264' || info.pixelFormat !== 'yuv420p') throw new Error('Export is not browser-compatible H.264.');
  if (!Number.isFinite(info.duration) || info.duration < 5 || info.duration > 90) {
    throw new Error(`Recording is ${info.duration.toFixed(1)}s. Keep the story between 5 and 90 seconds.`);
  }
  if (info.bytes > maxBytes) throw new Error(`Export is ${(info.bytes / 1e6).toFixed(1)} MB; limit is ${maxBytes / 1e6} MB. Shorten the story or set --max-mb.`);
  await exec('ffmpeg', [
    '-hide_banner', '-loglevel', 'error', '-n', '-ss', String(Math.max(0, info.duration - 2)),
    '-i', file, '-frames:v', '1', '-q:v', '2', poster,
  ]);
  return { file: 'reel.mp4', poster: 'poster.jpg', ...info, sha256: await fileHash(file) };
}

export async function fileHash(file) {
  return createHash('sha256').update(await readFile(file)).digest('hex');
}

export async function exists(file) {
  try { await stat(file); return true; } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}
