#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { mkdir, writeFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { checkMediaTools, exists, exportVideo, fileHash } from '../lib/media.mjs';
import { sourceReceipt } from '../lib/provenance.mjs';

const skillDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);

const help = `fixtape

  node scripts/fixtape.mjs setup
  node scripts/fixtape.mjs doctor
  node scripts/fixtape.mjs demo --out recordings/demo
  node scripts/fixtape.mjs record story.mjs --out recordings/fix --base main --serve "npm run dev -- --port {port}"
  node scripts/fixtape.mjs record story.mjs --out recordings/fix          (scenario holds two URLs you serve yourself)
  node scripts/fixtape.mjs compose recordings/fix
  node scripts/fixtape.mjs preview recordings/fix
  node scripts/fixtape.mjs publish recordings/fix --pr 123

Record options:
  --base <ref>          Git ref of the version before the fix (default: main). Needs --serve.
  --serve <command>     Starts the app; {port} is replaced, PORT is set. Runs once for the base checkout and once for your working tree.
  --prepare <command>   Runs in the base checkout before --serve, for example "npm ci". Without it, node_modules is shared when the lockfile is unchanged.
  --cwd <dir>           The app's Git checkout (default: current directory).
  --ready-timeout <s>   How long to wait for each server (default: 60).
  --side both|before|after, --headed, --max-mb 10
  --pr <number|url>     After a successful film, post it to that pull request (gh 2.99+). Also: --repo owner/name.

Output: film.mp4 with both sides, full source clips, receipts and index.html.
Existing recordings are never overwritten. See references/recording.md for scenarios.
`;

const VALUE_FLAGS = {
  '--out': 'out', '--side': 'side', '--max-mb': 'maxMb', '--base': 'base', '--serve': 'serve', '--prepare': 'prepare',
  '--cwd': 'cwd', '--ready-timeout': 'readyTimeout', '--pr': 'pr', '--repo': 'repo',
};

function parse(args) {
  const options = { side: 'both', headed: false, maxMb: 10, readyTimeout: 60 };
  const positional = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--headed') options.headed = true;
    else if (VALUE_FLAGS[arg]) {
      const value = args[++i];
      if (value === undefined || value.startsWith('--')) throw new Error(`${arg} requires a value.`);
      options[VALUE_FLAGS[arg]] = value;
    } else if (arg.startsWith('-')) throw new Error(`Unknown option: ${arg}`);
    else positional.push(arg);
  }
  options.maxMb = Number(options.maxMb);
  options.readyTimeout = Number(options.readyTimeout);
  if (!['both', 'before', 'after'].includes(options.side)) throw new Error('--side must be both, before or after.');
  if (!Number.isFinite(options.maxMb) || options.maxMb <= 0) throw new Error('--max-mb must be a positive number.');
  if (!Number.isFinite(options.readyTimeout) || options.readyTimeout <= 0) throw new Error('--ready-timeout must be a positive number of seconds.');
  if (options.base && !options.serve) throw new Error('--base needs --serve. Without --serve the scenario holds the two URLs.');
  if (options.repo && !options.pr) throw new Error('--repo needs --pr.');
  return { options, positional };
}

function assertNode() {
  const [major, minor] = process.versions.node.split('.').map(Number);
  if (major < 22 || (major === 22 && minor < 20)) throw new Error('Use Node.js 22.20 or later.');
}

async function doctor() {
  assertNode();
  await checkMediaTools();
  let chromium;
  try { ({ chromium } = await import('playwright')); }
  catch { throw new Error('Playwright is not installed. Run: node scripts/fixtape.mjs setup'); }
  if (!await exists(chromium.executablePath())) throw new Error('Chromium is missing. Run: node scripts/fixtape.mjs setup');
  const browser = await chromium.launch({ headless: true });
  await browser.close();
  console.log('Ready: Node.js, Playwright Chromium, FFmpeg with H.264, and ffprobe.');
}

function run(command, args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: 'inherit', shell: false, env: { ...process.env, PUPPETEER_SKIP_DOWNLOAD: '1', DISABLE_TELEMETRY: 'true' } });
    child.on('error', reject);
    child.on('exit', (code, signal) => code === 0 ? resolve() : reject(new Error(`${command} stopped (${signal || code}).`)));
  });
}

async function setup() {
  assertNode();
  await checkMediaTools();
  if (process.platform === 'win32') {
    await run('cmd.exe', ['/d', '/s', '/c', 'npm ci --workspaces=false --ignore-scripts --no-audit --no-fund'], skillDir);
  } else {
    await run('npm', ['ci', '--workspaces=false', '--ignore-scripts', '--no-audit', '--no-fund'], skillDir);
  }
  const cli = path.join(path.dirname(require.resolve('playwright/package.json')), 'cli.js');
  const { chromium } = await import('playwright');
  if (!await exists(chromium.executablePath())) await run(process.execPath, [cli, 'install', 'chromium'], skillDir);
  await doctor();
}

function escape(value) {
  return String(value).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}

async function gallery(outDir, title, sides, film = false) {
  const cards = sides.map(side => `<article><h2>${side === 'before' ? 'Before' : 'After'} · full capture</h2>
<video aria-label="${side} full capture" controls preload="metadata" poster="${side}/poster.jpg" src="${side}/reel.mp4"></video>
<p><a href="${side}/reel.mp4">MP4</a> · <a href="${side}/receipt.json">Receipt</a> · <a href="${side}/raw.webm">Raw recording</a></p></article>`).join('\n');
  const primary = film ? `<section><video aria-label="Before and after film" controls preload="metadata" poster="film.jpg" src="film.mp4"></video><p><a href="film.mp4">Download film</a> · <a href="film.json">Edit receipt</a></p></section>` : '';
  await writeFile(path.join(outDir, 'index.html'), `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escape(title)} · fixtape</title><style>
body{margin:0;background:#fafafa;color:#18181b;font:16px system-ui,sans-serif;padding:32px}main{max-width:1280px;margin:auto}h1{font-size:28px;margin:0 0 24px}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(480px,100%),1fr));gap:24px}video{display:block;width:100%;background:#18181b;border:1px solid #e4e4e7;border-radius:8px}h2{font-size:16px;font-weight:500}a{color:inherit;text-underline-offset:3px}p{color:#52525b;line-height:1.6}section{margin-bottom:40px}
</style><main><h1>${escape(title)}</h1>${primary}<div class="grid">${cards}</div></main></html>`);
}

async function compose(outDir, maxMb) {
  const { composeFilm } = await import('../lib/film.mjs');
  console.log('Composing before and after…');
  const receipt = await composeFilm(outDir, { maxBytes: maxMb * 1_000_000 });
  await gallery(outDir, receipt.title || 'Before and after', ['before', 'after'], true);
  console.log(`Film: ${receipt.export.duration.toFixed(1)}s, ${(receipt.export.bytes / 1e6).toFixed(2)} MB`);
  return receipt;
}

async function publish(outDir, options) {
  const { publishFilm } = await import('../lib/publish.mjs');
  console.log(`Posting film.mp4 to pull request ${options.pr}…`);
  const receipt = await publishFilm(outDir, { pr: options.pr, repo: options.repo, cwd: path.resolve(options.cwd || '.') });
  console.log(receipt.url ? `Posted: ${receipt.url}` : 'Posted.');
  return receipt;
}

async function recordSides(scenario, options, scenarioFile, outDir, extra = {}) {
  const { record } = await import('../lib/recorder.mjs');
  const sides = options.side === 'both' ? ['before', 'after'] : [options.side];
  const completed = [];
  for (const side of sides) {
    const target = scenario[side];
    if (!target) throw new Error(`Scenario has no ${side} target.`);
    const source = await sourceReceipt(target.source);
    const sideDir = path.join(outDir, side);
    console.log(`Recording ${side}…`);
    const scenarioIdentity = { name: path.basename(scenarioFile), sha256: await fileHash(scenarioFile) };
    const annotate = receipt => Object.assign(receipt, { source, scenario: scenarioIdentity, ...(extra[side] || {}) });
    let recorded;
    try { recorded = await record({ scenario, side, outDir: sideDir, headless: !options.headed, presentation: options.side === 'both' ? 'clean' : 'annotated' }); }
    catch (error) {
      if (error.receipt) {
        annotate(error.receipt).exportStatus = 'not-attempted';
        await writeFile(path.join(sideDir, 'receipt.json'), JSON.stringify(error.receipt, null, 2) + '\n');
      }
      throw error;
    }
    const { videoPath, receipt } = recorded;
    annotate(receipt);
    try {
      if (receipt.pacing?.scale !== 1) throw new Error('Test-speed recordings cannot be exported.');
      const sourceAfter = await sourceReceipt(target.source);
      if (source.digest !== sourceAfter.digest || scenarioIdentity.sha256 !== await fileHash(scenarioFile)) {
        throw new Error('Source files changed during recording. Record again from a stable source.');
      }
      if (source.digest) receipt.source.stableDuringRecording = true;
      receipt.export = await exportVideo(videoPath, sideDir, { maxBytes: options.maxMb * 1_000_000 });
      receipt.exportStatus = 'complete';
      completed.push(side);
    } catch (error) {
      receipt.exportStatus = 'failed';
      receipt.exportError = error.message;
      throw error;
    } finally {
      await writeFile(path.join(sideDir, 'receipt.json'), JSON.stringify(receipt, null, 2) + '\n');
    }
    console.log(`${side}: ${receipt.export.duration.toFixed(1)}s, ${(receipt.export.bytes / 1e6).toFixed(2)} MB`);
  }
  return completed;
}

async function capture(scenario, options, scenarioFile) {
  await doctor();
  const outDir = path.resolve(options.out || `recordings/fixtape-${new Date().toISOString().replace(/[:.]/g, '-')}`);
  if (await exists(outDir) && (await readdir(outDir)).length) throw new Error(`Output directory is not empty: ${outDir}. Choose a new --out path.`);
  await mkdir(outDir, { recursive: true });
  let pair;
  let completed;
  try {
    const extra = {};
    if (options.serve) {
      if (scenario.before?.url || scenario.after?.url) throw new Error('The scenario declares URLs and --serve was given. Remove the URLs to let fixtape serve both versions, or drop --serve.');
      const { startPair } = await import('../lib/pair.mjs');
      pair = await startPair({
        repo: path.resolve(options.cwd || '.'), base: options.base || 'main', serve: options.serve, prepare: options.prepare,
        urlPath: scenario.path ?? '/', outDir, readyTimeoutMs: options.readyTimeout * 1000, log: message => console.log(message),
      });
      scenario = { ...scenario, before: { ...(scenario.before || {}), url: pair.before.url }, after: { ...(scenario.after || {}), url: pair.after.url } };
      for (const side of ['before', 'after']) extra[side] = { serve: { command: pair[side].command, port: pair[side].port }, checkout: pair[side].checkout };
    } else if (scenario.path !== undefined) {
      throw new Error('scenario.path only applies with --serve. Put the full URLs in before.url and after.url instead.');
    }
    completed = await recordSides(scenario, options, scenarioFile, outDir, extra);
  } finally {
    await pair?.stop();
  }
  await gallery(outDir, scenario.title, completed);
  if (options.side === 'both') await compose(outDir, options.maxMb);
  console.log(`Open ${path.join(outDir, 'index.html')}`);
  if (options.pr) {
    if (options.side !== 'both') throw new Error('--pr needs a paired recording; nothing was posted.');
    await publish(outDir, options);
  }
}

async function main() {
  const [command, ...args] = process.argv.slice(2);
  if (!command || ['help', '--help', '-h'].includes(command)) { console.log(help); return; }
  if (command === 'doctor' || command === 'setup') {
    if (args.length) throw new Error(`${command} takes no arguments.`);
    await (command === 'doctor' ? doctor() : setup());
    return;
  }
  const { options, positional } = parse(args);
  if (command === 'preview') {
    if (args.length !== 1 || positional.length !== 1) throw new Error('preview needs one recording directory and no options.');
    const { startPreview } = await import('../lib/preview.mjs');
    const server = await startPreview(path.resolve(positional[0]));
    console.log(`Open ${server.url}\nPress Ctrl+C to stop the local preview.`);
    for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, async () => { await server.close(); process.exit(0); });
  } else if (command === 'compose') {
    if (positional.length !== 1 || args.some(arg => arg.startsWith('--') && arg !== '--max-mb')) throw new Error('compose needs one recording directory; only --max-mb is supported.');
    await doctor();
    await compose(path.resolve(positional[0]), options.maxMb);
  } else if (command === 'publish') {
    if (positional.length !== 1 || !options.pr || args.some(arg => arg.startsWith('--') && !['--pr', '--repo', '--cwd'].includes(arg))) {
      throw new Error('publish needs one recording directory and --pr <number|url>; optional --repo owner/name and --cwd <checkout>.');
    }
    await publish(path.resolve(positional[0]), options);
  } else if (command === 'demo') {
    if (positional.length) throw new Error('demo takes only options.');
    if (options.serve || options.base || options.prepare) throw new Error('demo serves its own app; --serve, --base and --prepare do not apply.');
    const { startDemo } = await import('../assets/demo/server.mjs');
    const { createScenario } = await import('../assets/demo/scenario.mjs');
    const server = await startDemo();
    try {
      await capture(createScenario(server.url), options, path.join(skillDir, 'assets/demo/scenario.mjs'));
    } finally { await server.close(); }
  } else if (command === 'record') {
    if (positional.length !== 1) throw new Error('record needs one scenario.mjs path.');
    const scenarioFile = path.resolve(positional[0]);
    const { default: scenario } = await import(pathToFileURL(scenarioFile).href);
    await capture(scenario, options, scenarioFile);
  } else throw new Error(`Unknown command: ${command}\n${help}`);
}

main().catch(error => { console.error(`fixtape: ${error.message}`); process.exitCode = 1; });
