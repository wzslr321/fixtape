import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { copyFile, lstat, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { freePort, prepareBase, serveCommand, startPair } from '../skills/fixtape/lib/pair.mjs';
import { exists } from '../skills/fixtape/lib/media.mjs';

const exec = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const demo = path.join(root, 'skills/fixtape/assets/demo');
const cli = path.join(root, 'skills/fixtape/scripts/fixtape.mjs');

const SERVER = `import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
const port = Number(process.argv[process.argv.indexOf('--port') + 1]);
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };
createServer(async (request, response) => {
  const name = request.url === '/' ? 'index.html' : request.url.slice(1).split('?')[0];
  try {
    const body = await readFile(path.join(process.cwd(), path.normalize(name)));
    response.writeHead(200, { 'Content-Type': types[path.extname(name)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    response.end(body);
  } catch { response.writeHead(404); response.end('Not found'); }
}).listen(port, '127.0.0.1');
`;

const STORY = `export default {
  title: 'Floating-point total at checkout',
  goal: 'Charge the customer the right amount.',
  path: '/',
  async run({ reel, side }) {
    await reel.step({ caption: 'Click “Place order”.', target: '#place-order', action: (button) => button.click() });
    await reel.observe({
      target: '.confirmation-text', read: 'text',
      equals: side === 'before' ? 'Order placed. Charged $0.30000000000000004.' : 'Order placed. Charged $0.30.',
      caption: side === 'before' ? 'Charged $0.30000000000000004.' : 'Charged $0.30.',
      outcome: side === 'before' ? 'problem' : 'fixed',
    });
  },
};
`;

async function git(repo, ...args) {
  const { stdout } = await exec('git', ['-C', repo, '-c', 'user.name=fixtape', '-c', 'user.email=fixtape@example.invalid', ...args]);
  return stdout.trim();
}

/** A Git checkout whose main branch serves the buggy app and whose working tree holds the fix. */
async function checkoutWithFix() {
  const repo = await mkdtemp(path.join(os.tmpdir(), 'fixtape-pair-'));
  for (const file of ['index.html', 'styles.css', 'order.js']) await copyFile(path.join(demo, file), path.join(repo, file));
  await copyFile(path.join(demo, 'before.js'), path.join(repo, 'app.js'));
  await writeFile(path.join(repo, 'serve.mjs'), SERVER);
  await writeFile(path.join(repo, 'story.mjs'), STORY);
  await git(repo, 'init', '-q', '-b', 'main');
  await git(repo, 'add', '-A');
  await git(repo, 'commit', '-q', '-m', 'Buggy checkout');
  await copyFile(path.join(demo, 'after.js'), path.join(repo, 'app.js'));
  return repo;
}

test('serve command needs a port placeholder and free ports are distinct', async () => {
  assert.equal(serveCommand('node serve.mjs --port {port}', 4321), 'node serve.mjs --port 4321');
  assert.throws(() => serveCommand('npm run dev', 1), /\{port\}/);
  const [a, b] = [await freePort(), await freePort()];
  assert.ok(Number.isInteger(a) && Number.isInteger(b) && a > 0 && b > 0);
});

test('base checkout shares node_modules only while the lockfile is unchanged', async (t) => {
  const repo = await checkoutWithFix();
  await writeFile(path.join(repo, 'package-lock.json'), '{"name":"app","lockfileVersion":3}\n');
  await git(repo, 'add', 'package-lock.json');
  await git(repo, 'commit', '-q', '-m', 'Lockfile');
  await mkdir(path.join(repo, 'node_modules/left-pad'), { recursive: true });
  const logDir = path.join(repo, 'logs');
  await mkdir(logDir);

  const shared = await prepareBase({ repo, base: 'main', logDir });
  t.after(() => shared.cleanup());
  assert.equal(shared.dependencies, 'shared-node-modules');
  assert.ok((await lstat(path.join(shared.dir, 'node_modules'))).isSymbolicLink());
  assert.equal(await readFile(path.join(shared.dir, 'app.js'), 'utf8'), await readFile(path.join(demo, 'before.js'), 'utf8'));
  await shared.cleanup();
  assert.equal(await exists(shared.dir), false);

  await writeFile(path.join(repo, 'package-lock.json'), '{"name":"app","lockfileVersion":3,"packages":{}}\n');
  await assert.rejects(prepareBase({ repo, base: 'main', logDir }), /--prepare/);
  await assert.rejects(prepareBase({ repo, base: 'no-such-branch', logDir }), /Cannot resolve --base/);

  const prepared = await prepareBase({ repo, base: 'main', prepare: 'echo prepared > prepared.txt', logDir });
  assert.equal(prepared.dependencies, 'prepared');
  assert.ok(await exists(path.join(prepared.dir, 'prepared.txt')));
  await prepared.cleanup();
  await assert.rejects(prepareBase({ repo, base: 'main', prepare: 'exit 3', logDir }), /exit 3/);
  assert.equal((await git(repo, 'worktree', 'list')).split('\n').length, 1);
});

test('pair serves the base commit and the working tree, then stops both and removes the worktree', async (t) => {
  const repo = await checkoutWithFix();
  const outDir = path.join(repo, 'out');
  await mkdir(outDir);
  const pair = await startPair({ repo, base: 'main', serve: 'node serve.mjs --port {port}', outDir });
  t.after(() => pair.stop());
  assert.notEqual(pair.before.port, pair.after.port);
  assert.equal(await fetch(`${pair.before.url}app.js`).then(r => r.text()), await readFile(path.join(demo, 'before.js'), 'utf8'));
  assert.equal(await fetch(`${pair.after.url}app.js`).then(r => r.text()), await readFile(path.join(demo, 'after.js'), 'utf8'));
  assert.equal(pair.before.checkout.role, 'base');
  assert.equal(pair.before.checkout.commit, await git(repo, 'rev-parse', 'main'));
  assert.deepEqual(pair.after.checkout, { role: 'head', commit: await git(repo, 'rev-parse', 'HEAD'), dirty: true });
  await pair.stop();
  await assert.rejects(fetch(`${pair.before.url}`, { signal: AbortSignal.timeout(1000) }));
  assert.equal((await git(repo, 'worktree', 'list')).split('\n').length, 1);
  await assert.rejects(startPair({ repo, base: 'main', serve: 'node serve.mjs --port {port}', urlPath: 'nope', outDir }), /scenario.path/);
  await assert.rejects(startPair({ repo, base: 'main', serve: 'exit 7', outDir }), /\{port\}/);
  await assert.rejects(startPair({ repo, base: 'main', serve: 'node -e "process.exit(7)" {port}', outDir }), /exited before answering/);
});

test('record --base --serve films a real fix from one checkout and keeps the checkout facts in the receipts', async () => {
  const repo = await checkoutWithFix();
  const outDir = path.join(repo, 'recording');
  const { stdout } = await exec(process.execPath, [
    cli, 'record', path.join(repo, 'story.mjs'), '--out', outDir, '--base', 'main', '--serve', 'node serve.mjs --port {port}', '--cwd', repo,
  ], { maxBuffer: 4 * 1024 * 1024, timeout: 240_000 });
  assert.match(stdout, /Preparing base main/);
  assert.match(stdout, /Film: \d+\.\ds/);
  assert.ok(await exists(path.join(outDir, 'film.mp4')));
  for (const side of ['before', 'after']) {
    const receipt = JSON.parse(await readFile(path.join(outDir, side, 'receipt.json'), 'utf8'));
    assert.equal(receipt.status, 'passed');
    assert.equal(receipt.serve.command, 'node serve.mjs --port {port}');
    assert.equal(receipt.checkout.role, side === 'before' ? 'base' : 'head');
    assert.equal(receipt.observations.at(-1).observed, side === 'before' ? 'Order placed. Charged $0.30000000000000004.' : 'Order placed. Charged $0.30.');
    assert.ok(await exists(path.join(outDir, 'logs', `${side}-server.log`)));
  }
  assert.equal((await git(repo, 'worktree', 'list')).split('\n').length, 1);
});
