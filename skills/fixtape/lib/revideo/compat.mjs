import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createRequire } from 'node:module';
const exec = promisify(execFile);
const require = createRequire(import.meta.url);

export function lavfiCapability(output) {
  // FFmpeg 9 adds a third device flag; fluent-ffmpeg 2.1.3 reads only two flags.
  const line = output.split(/\r?\n/).find(line => /^\s*D[ E][ d]?\s+lavfi\s/.test(line));
  return line ? { description: 'Libavfilter virtual input device', canDemux: true, canMux: false } : null;
}

export function repairFormatReader(fluent, capability) {
  if (!capability) throw new Error('System FFmpeg does not advertise the lavfi input required by Revideo.');
  const original = fluent.prototype.availableFormats;
  fluent.prototype.availableFormats = fluent.prototype.getAvailableFormats = function (callback) {
    return original.call(this, (error, formats) => {
      if (error) return callback(error);
      callback(null, { ...formats, lavfi: formats.lavfi || capability });
    });
  };
}

export async function prepareFfmpeg(ffmpegPath = 'ffmpeg') {
  const fluent = require('fluent-ffmpeg');
  if (require('fluent-ffmpeg/package.json').version !== '2.1.3') {
    throw new Error('Revideo compatibility expects pinned fluent-ffmpeg 2.1.3; rerun setup.');
  }
  const { stdout } = await exec(ffmpegPath, ['-hide_banner', '-formats']);
  repairFormatReader(fluent, lavfiCapability(stdout));
}
