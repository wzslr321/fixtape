import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { realpath, readFile } from 'node:fs/promises';
import path from 'node:path';

const exec = promisify(execFile);
const hash = value => createHash('sha256').update(value).digest('hex');

export async function sourceReceipt(source) {
  if (!source) return { kind: 'url-only', note: 'The served source revision was not verified.' };
  if (typeof source.root !== 'string' || !Array.isArray(source.files) || source.files.length === 0) {
    throw new Error('source needs a root directory and a nonempty files array.');
  }
  const root = await realpath(source.root);
  const files = [];
  for (const name of [...source.files].sort()) {
    if (typeof name !== 'string' || path.isAbsolute(name)) throw new Error('source.files must contain relative paths.');
    const file = await realpath(path.resolve(root, name));
    const relative = path.relative(root, file);
    if (path.isAbsolute(relative) || relative.startsWith(`..${path.sep}`) || relative === '..') throw new Error('Source files must stay inside source.root.');
    files.push({ path: relative.split(path.sep).join('/'), sha256: hash(await readFile(file)) });
  }
  const receipt = {
    kind: 'declared-local-source', files, digest: hash(JSON.stringify(files)),
    note: 'Files were hashed locally. Their association with the served URL is declared by the scenario.',
  };
  try {
    const { stdout: commit } = await exec('git', ['-C', root, 'rev-parse', 'HEAD']);
    const { stdout: status } = await exec('git', ['-C', root, 'status', '--porcelain']);
    const { stdout: diff } = await exec('git', ['-C', root, 'diff', '--no-ext-diff', 'HEAD'], { maxBuffer: 16 * 1024 * 1024 });
    receipt.git = { commit: commit.trim(), dirty: Boolean(status.trim()), trackedDiffSha256: hash(diff) };
  } catch (error) {
    if (error.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') throw error;
    receipt.git = null;
  }
  return receipt;
}
