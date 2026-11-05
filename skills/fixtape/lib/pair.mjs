import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, open, readFile, rm, symlink } from 'node:fs/promises';
import { createServer } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { exists } from './media.mjs';

const exec = promisify(execFile);
const LOCKFILES = ['package-lock.json', 'pnpm-lock.yaml', 'yarn.lock', 'bun.lock', 'bun.lockb', 'package.json'];

export function serveCommand(template, port) {
  if (typeof template !== 'string' || !template.includes('{port}')) {
    throw new Error('--serve needs {port} in the command, for example "npm run dev -- --port {port}".');
  }
  return template.replaceAll('{port}', String(port));
}

export function freePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(error => error ? reject(error) : resolve(port));
    });
  });
}

async function git(repo, args) {
  const { stdout } = await exec('git', ['-C', repo, ...args], { maxBuffer: 16 * 1024 * 1024 });
  return stdout.trim();
}

export async function headInfo(repo) {
  let root;
  try { root = await git(repo, ['rev-parse', '--show-toplevel']); }
  catch { throw new Error(`Not a Git checkout: ${repo}. Pass --cwd <checkout>, or record from two URLs you serve yourself.`); }
  return { root, commit: await git(root, ['rev-parse', 'HEAD']), dirty: Boolean(await git(root, ['status', '--porcelain'])) };
}

function run(command, cwd, stdio, extraEnv = {}) {
  return spawn(command, { cwd, shell: true, detached: process.platform !== 'win32', stdio, env: { ...process.env, ...extraEnv } });
}

async function stopChild(child) {
  if (child.exitCode !== null || child.signalCode) return;
  const exited = new Promise(resolve => child.once('exit', resolve));
  const kill = signal => {
    try {
      if (process.platform === 'win32') spawn('taskkill', ['/pid', String(child.pid), '/t', '/f'], { stdio: 'ignore' });
      else process.kill(-child.pid, signal);
    } catch {}
  };
  kill('SIGTERM');
  const timer = setTimeout(() => kill('SIGKILL'), 5000);
  await exited;
  clearTimeout(timer);
}

async function tail(logPath, lines = 15) {
  const text = await readFile(logPath, 'utf8').catch(() => '');
  const last = text.trim().split('\n').slice(-lines).join('\n');
  return last ? `\nServer output:\n${last}` : '';
}

export async function waitForServer(url, child, { timeoutMs = 60_000, logPath } = {}) {
  const deadline = Date.now() + timeoutMs;
  let exited = false;
  child.once('exit', () => { exited = true; });
  while (Date.now() < deadline) {
    if (exited) throw new Error(`The server exited before answering at ${url}.${await tail(logPath)}`);
    try {
      await fetch(url, { signal: AbortSignal.timeout(2000), redirect: 'manual' });
      return;
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 300));
  }
  throw new Error(`The server did not answer at ${url} within ${Math.round(timeoutMs / 1000)} s. Pass --ready-timeout to wait longer.${await tail(logPath)}`);
}

async function sameDependencies(a, b) {
  for (const name of LOCKFILES) {
    const [x, y] = await Promise.all([readFile(path.join(a, name)).catch(() => null), readFile(path.join(b, name)).catch(() => null)]);
    if (x || y) return Boolean(x && y && x.equals(y));
  }
  return true;
}

export async function prepareBase({ repo, base, prepare, logDir }) {
  let commit;
  try { commit = await git(repo, ['rev-parse', '--verify', '--quiet', `${base}^{commit}`]); }
  catch { throw new Error(`Cannot resolve --base ${base} in ${repo}. Pass an existing branch, tag or commit.`); }
  const dir = await mkdtemp(path.join(os.tmpdir(), 'fixtape-base-'));
  await git(repo, ['worktree', 'add', '--detach', dir, commit]);
  const cleanup = async () => {
    await git(repo, ['worktree', 'remove', '--force', dir]).catch(() => rm(dir, { recursive: true, force: true }));
    await git(repo, ['worktree', 'prune']).catch(() => {});
  };
  try {
    let dependencies = 'none';
    if (prepare) {
      const logPath = path.join(logDir, 'prepare.log');
      const log = await open(logPath, 'w');
      const child = run(prepare, dir, ['ignore', log.fd, log.fd]);
      const code = await new Promise(resolve => child.once('exit', resolve));
      await log.close();
      if (code !== 0) throw new Error(`--prepare failed in the base checkout (exit ${code}).${await tail(logPath)}`);
      dependencies = 'prepared';
    } else if (await exists(path.join(repo, 'node_modules'))) {
      if (!await sameDependencies(repo, dir)) {
        throw new Error('Dependencies differ between base and head, so node_modules cannot be shared. Pass --prepare "npm ci" or your own install command.');
      }
      await symlink(path.join(repo, 'node_modules'), path.join(dir, 'node_modules'), 'junction');
      dependencies = 'shared-node-modules';
    }
    return { dir, commit, dependencies, cleanup };
  } catch (error) {
    await cleanup();
    throw error;
  }
}

/** Serve the base commit and the current checkout on two local ports. */
export async function startPair({ repo, base = 'main', serve, prepare, urlPath = '/', outDir, readyTimeoutMs = 60_000, log = () => {} }) {
  if (typeof urlPath !== 'string' || !urlPath.startsWith('/')) throw new Error('scenario.path must start with "/".');
  serveCommand(serve, 0);
  const head = await headInfo(repo);
  const logDir = path.join(outDir, 'logs');
  await mkdir(logDir, { recursive: true });
  log(`Preparing base ${base}…`);
  const checkout = await prepareBase({ repo: head.root, base, prepare, logDir });
  const servers = [];
  const stop = async () => {
    for (const server of servers.reverse()) {
      await stopChild(server.child);
      await server.log.close();
    }
    servers.length = 0;
    await checkout.cleanup();
  };
  try {
    const sides = {};
    for (const [side, dir] of [['before', checkout.dir], ['after', head.root]]) {
      const port = await freePort();
      const logPath = path.join(logDir, `${side}-server.log`);
      const logFile = await open(logPath, 'w');
      log(`Starting the ${side} server on port ${port}…`);
      const child = run(serveCommand(serve, port), dir, ['ignore', logFile.fd, logFile.fd], { PORT: String(port) });
      servers.push({ child, log: logFile });
      const url = new URL(urlPath, `http://127.0.0.1:${port}`).href;
      await waitForServer(url, child, { timeoutMs: readyTimeoutMs, logPath });
      sides[side] = { url, port, command: serve };
    }
    sides.before.checkout = { role: 'base', ref: base, commit: checkout.commit, dependencies: checkout.dependencies };
    sides.after.checkout = { role: 'head', commit: head.commit, dirty: head.dirty };
    return { ...sides, stop };
  } catch (error) {
    await stop();
    throw error;
  }
}
