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

const help = `Fixtape

  node scripts/fixtape.mjs setup
  node scripts/fixtape.mjs doctor
  node scripts/fixtape.mjs demo [--out recordings/demo]
  node scripts/fixtape.mjs record story.mjs --out recordings/fix [--side both|before|after]
  node scripts/fixtape.mjs compose recordings/fix
  node scripts/fixtape.mjs preview recordings/fix

Options: --headed (show the browser), --max-mb 10 (export size limit).
Output: film.mp4 with both sides, plus full source clips, receipts and index.html.
Existing recordings are never overwritten. See references/recording.md for scenarios.
`;

function parse(args) {
  const options = { side: 'both', headed: false, maxMb: 10 };
  const positional = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--headed') options.headed = true;
    else if (['--out', '--side', '--max-mb'].includes(arg)) {
      const value = args[++i];
      if (!value || value.startsWith('--')) throw new Error(`${arg} requires a value.`);
      options[{ '--out': 'out', '--side': 'side', '--max-mb': 'maxMb' }[arg]] = value;
    } else if (arg.startsWith('-')) throw new Error(`Unknown option: ${arg}`);
    else positional.push(arg);
  }
  options.maxMb = Number(options.maxMb);
  if (!['both', 'before', 'after'].includes(options.side)) throw new Error('--side must be both, before or after.');
  if (!Number.isFinite(options.maxMb) || options.maxMb <= 0) throw new Error('--max-mb must be a positive number.');
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
<title>${escape(title)} · Fixtape</title><style>
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

async function capture(scenario, options, scenarioFile) {
  await doctor();
  const { record } = await import('../lib/recorder.mjs');
  const outDir = path.resolve(options.out || `recordings/reel-${new Date().toISOString().replace(/[:.]/g, '-')}`);
  if (await exists(outDir) && (await readdir(outDir)).length) throw new Error(`Output directory is not empty: ${outDir}. Choose a new --out path.`);
  await mkdir(outDir, { recursive: true });
  const sides = options.side === 'both' ? ['before', 'after'] : [options.side];
  const completed = [];
  for (const side of sides) {
    const target = scenario[side];
    if (!target) throw new Error(`Scenario has no ${side} target.`);
    const source = await sourceReceipt(target.source);
    const sideDir = path.join(outDir, side);
    console.log(`Recording ${side}…`);
    const scenarioIdentity = { name: path.basename(scenarioFile), sha256: await fileHash(scenarioFile) };
    let recorded;
    try { recorded = await record({ scenario, side, outDir: sideDir, headless: !options.headed, presentation: options.side === 'both' ? 'clean' : 'annotated' }); }
    catch (error) {
      if (error.receipt) {
        Object.assign(error.receipt, { source, scenario: scenarioIdentity, exportStatus: 'not-attempted' });
        await writeFile(path.join(sideDir, 'receipt.json'), JSON.stringify(error.receipt, null, 2) + '\n');
      }
      throw error;
    }
    const { videoPath, receipt } = recorded;
    receipt.source = source;
    receipt.scenario = scenarioIdentity;
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
  await gallery(outDir, scenario.title, completed);
  if (options.side === 'both') await compose(outDir, options.maxMb);
  console.log(`Open ${path.join(outDir, 'index.html')}`);
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
    if (positional.length !== 1 || args.some(arg => ['--out', '--side', '--headed'].includes(arg))) throw new Error('compose needs one recording directory; only --max-mb is supported.');
    await doctor();
    await compose(path.resolve(positional[0]), options.maxMb);
  } else if (command === 'demo') {
    if (positional.length) throw new Error('demo takes only options.');
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
