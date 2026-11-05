import { constants } from 'node:fs';
import { open, realpath } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';

const ALLOWED = new Set([
  'index.html',
  'film.mp4', 'film.jpg', 'film.json',
  ...['before', 'after'].flatMap(side => ['reel.mp4', 'raw.webm', 'poster.jpg', 'receipt.json'].map(file => `${side}/${file}`)),
  ...['before.mp4', 'after.mp4', 'before.jpg', 'after.jpg', 'film.mp4', 'film.jpg', 'film.json', 'preview.gif', 'recording-receipts.json'].map(file => `media/${file}`),
]);

const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8', '.mp4': 'video/mp4', '.webm': 'video/webm',
  '.jpg': 'image/jpeg', '.gif': 'image/gif', '.json': 'application/json; charset=utf-8',
};

async function openContained(root, relative) {
  const resolved = await realpath(path.join(root, relative));
  if (!resolved.startsWith(`${root}${path.sep}`)) throw new Error('File is outside the preview directory.');
  const file = await open(resolved, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stats = await file.stat();
    if (!stats.isFile()) throw new Error('Preview files must be regular files.');
    return { file, size: stats.size };
  } catch (error) {
    await file.close();
    throw error;
  }
}

function byteRange(value, size) {
  const match = /^bytes=(\d*)-(\d*)$/.exec(value.trim());
  if (!match || (!match[1] && !match[2]) || !size) return null;
  const first = match[1] ? Number(match[1]) : undefined;
  const last = match[2] ? Number(match[2]) : undefined;
  if ([first, last].some(number => number !== undefined && !Number.isSafeInteger(number))) return null;
  if (first === undefined) return last > 0 ? { start: Math.max(0, size - last), end: size - 1 } : null;
  if (first >= size || (last !== undefined && last < first)) return null;
  return { start: first, end: Math.min(last ?? size - 1, size - 1) };
}

/** Serve a saved reel locally, including byte ranges used by native video seeking. */
export async function startPreview(directory, { port = 0 } = {}) {
  if (typeof directory !== 'string' || !directory.trim()) throw new TypeError('A preview directory is required.');
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new TypeError('port must be an integer from 0 through 65535.');
  const root = await realpath(directory);
  try {
    const { file } = await openContained(root, 'index.html');
    await file.close();
  } catch {
    throw new Error('The preview directory must contain a regular index.html inside that directory.');
  }

  const server = createServer(async (request, response) => {
    const finish = (status, message, headers = {}) => {
      response.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8', 'Content-Length': Buffer.byteLength(message), ...headers });
      response.end(request.method === 'HEAD' ? undefined : message);
    };
    if (!['GET', 'HEAD'].includes(request.method)) return finish(405, 'Method not allowed.', { Allow: 'GET, HEAD' });
    let relative;
    try {
      const pathname = decodeURIComponent(request.url.split('?')[0]);
      relative = pathname === '/' ? 'index.html' : pathname.slice(1);
      if (!pathname.startsWith('/') || !ALLOWED.has(relative)) return finish(404, 'Not found.');
    } catch {
      return finish(404, 'Not found.');
    }

    let file;
    try {
      const opened = await openContained(root, relative);
      file = opened.file;
      const size = opened.size;
      const headers = { 'Content-Type': CONTENT_TYPES[path.extname(relative)], 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
      // HTTP Range modifies GET only; HEAD returns the full representation's headers.
      const requestedRange = request.method === 'GET' ? request.headers.range : undefined;
      const range = requestedRange === undefined ? undefined : byteRange(requestedRange, size);
      if (range === null) {
        response.writeHead(416, { ...headers, 'Content-Range': `bytes */${size}`, 'Content-Length': 0 });
        response.end();
        return;
      }
      const length = range ? range.end - range.start + 1 : size;
      response.writeHead(range ? 206 : 200, {
        ...headers, 'Content-Length': length,
        ...(range ? { 'Content-Range': `bytes ${range.start}-${range.end}/${size}` } : {}),
      });
      if (request.method === 'HEAD' || !length) response.end();
      else await pipeline(file.createReadStream({ ...(range ?? {}), autoClose: false }), response);
    } catch {
      if (!response.headersSent) finish(404, 'Not found.');
      else response.destroy();
    } finally {
      await file?.close();
    }
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });
  let closing;
  return {
    url: `http://127.0.0.1:${server.address().port}/`,
    close() {
      closing ??= new Promise((resolve, reject) => {
        server.close(error => error ? reject(error) : resolve());
        server.closeAllConnections();
      });
      return closing;
    },
  };
}
