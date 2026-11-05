import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { exists, fileHash } from './media.mjs';

const exec = promisify(execFile);
export const MIN_GH = '2.99.0';

export function parseGhVersion(output) {
  const match = /gh version (\d+\.\d+\.\d+)/.exec(output);
  if (!match) throw new Error('Cannot read the gh version.');
  return match[1];
}

export function atLeast(version, minimum) {
  const a = version.split('.').map(Number);
  const b = minimum.split('.').map(Number);
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i];
  return true;
}

export async function checkGh(env = process.env) {
  let stdout;
  try { ({ stdout } = await exec('gh', ['--version'], { env })); }
  catch { throw new Error('GitHub CLI (gh) is not installed. Install it, or drag film.mp4 into the PR comment yourself.'); }
  const version = parseGhVersion(stdout);
  if (!atLeast(version, MIN_GH)) {
    throw new Error(`gh ${version} cannot attach files; --pr needs gh ${MIN_GH} or newer. Update gh, or drag film.mp4 into the PR comment yourself.`);
  }
  return version;
}

export function commentBody({ film, before, after }) {
  const line = (label, receipt) => {
    const observation = receipt.observations.at(-1);
    return `${label}: ${observation.caption} Observed \`${observation.target}\` = \`${JSON.stringify(observation.observed)}\`.`;
  };
  return [
    `**${film.title}**`, film.goal, '',
    line('Before', before), line('After', after), '',
    `Recorded with fixtape. Film sha256 \`${film.export.sha256.slice(0, 12)}\`.`,
  ].join('\n') + '\n';
}

/** Post film.mp4 to a pull request as a comment, using gh --attach. */
export async function publishFilm(dir, { pr, repo, cwd = process.cwd(), env = process.env } = {}) {
  if (typeof pr !== 'string' || !pr.trim()) throw new Error('--pr needs a pull request number or URL.');
  const directory = path.resolve(dir);
  const filmPath = path.join(directory, 'film.mp4');
  const film = JSON.parse(await readFile(path.join(directory, 'film.json'), 'utf8'));
  if (film.status !== 'complete' || !await exists(filmPath) || await fileHash(filmPath) !== film.export?.sha256) {
    throw new Error('film.mp4 is missing or differs from film.json. Compose the film again before publishing.');
  }
  const receipts = {};
  for (const side of ['before', 'after']) {
    const receiptPath = path.join(directory, side, 'receipt.json');
    if (await fileHash(receiptPath) !== film.sources?.[side]?.receiptSha256) throw new Error(`${side}/receipt.json differs from the film's sources.`);
    receipts[side] = JSON.parse(await readFile(receiptPath, 'utf8'));
  }
  const gh = await checkGh(env);
  const body = commentBody({ film, before: receipts.before, after: receipts.after });
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'fixtape-publish-'));
  try {
    const bodyFile = path.join(temporary, 'comment.md');
    await writeFile(bodyFile, body);
    const args = ['pr', 'comment', pr, '--body-file', bodyFile, '--attach', filmPath, ...(repo ? ['--repo', repo] : [])];
    let stdout;
    try { ({ stdout } = await exec('gh', args, { cwd, env, maxBuffer: 1024 * 1024 })); }
    catch (error) { throw new Error(`gh pr comment failed: ${(error.stderr || error.message).trim()}`); }
    const receipt = {
      schemaVersion: 1, pr, repo: repo || null, url: /https?:\/\/\S+/.exec(stdout)?.[0] || null,
      gh, filmSha256: film.export.sha256, publishedAt: new Date().toISOString(), body,
    };
    await writeFile(path.join(directory, 'publish.json'), JSON.stringify(receipt, null, 2) + '\n');
    return receipt;
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}
