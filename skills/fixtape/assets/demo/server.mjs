import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const files = new Map([
  ['/before/', ['index.html', 'text/html; charset=utf-8']],
  ['/after/', ['index.html', 'text/html; charset=utf-8']],
  ['/before/app.js', ['before.js', 'text/javascript; charset=utf-8']],
  ['/after/app.js', ['after.js', 'text/javascript; charset=utf-8']],
  ['/styles.css', ['styles.css', 'text/css; charset=utf-8']],
  ['/tasks.js', ['tasks.js', 'text/javascript; charset=utf-8']],
]);

export async function startDemo({ port = 0, host = '127.0.0.1' } = {}) {
  if (!['127.0.0.1', '::1'].includes(host)) throw new Error('Demo host must be a loopback address.');
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('Port must be an integer from 0 to 65535.');

  const server = createServer(async (request, response) => {
    const path = request.url?.split('?')[0];
    const asset = files.get(path);
    if (!asset || !['GET', 'HEAD'].includes(request.method)) {
      response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      response.end('Not found');
      return;
    }
    try {
      const body = await readFile(new URL(asset[0], import.meta.url));
      response.writeHead(200, { 'Content-Type': asset[1], 'Cache-Control': 'no-store' });
      response.end(request.method === 'HEAD' ? undefined : body);
    } catch {
      response.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      response.end('Demo asset unavailable');
    }
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, resolve);
  });
  const address = server.address();
  const hostname = host.includes(':') ? `[${host}]` : host;
  return {
    url: `http://${hostname}:${address.port}`,
    close: () => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())),
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  if (args.length && (args.length !== 2 || args[0] !== '--port' || !/^\d+$/.test(args[1]))) {
    console.error('Usage: node server.mjs [--port 3000]');
    process.exitCode = 1;
  } else {
    const demo = await startDemo({ port: args.length ? Number(args[1]) : 3000 });
    console.log(`Tasks demo: ${demo.url}/before/ and ${demo.url}/after/`);
    for (const signal of ['SIGINT', 'SIGTERM']) {
      process.once(signal, async () => { await demo.close(); process.exit(0); });
    }
  }
}
