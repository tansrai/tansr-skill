// @ts-check
// Offline consumer repairs only. The downloaded Demo retains its own license.
import { lstat, readFile, realpath, open, rename, unlink } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { dirname, isAbsolute, join, parse, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

/** @typedef {{ sha256: string, bytes: number }} Fingerprint */
/** @typedef {{ schemaVersion: number, id: string, target: string, before: Fingerprint, after: Fingerprint, replacement: {before: string, after: string} }} Repair */
const manifestUrl = new URL('../assets/demo-repairs/electron.json', import.meta.url);

/** @param {Buffer} bytes */
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

/** @param {string} path */
const comparablePath = path => process.platform === 'win32' ? path.toLowerCase() : path;

/** Check every directory from the volume root, including the Demo root itself.
 * @param {string} path
 */
async function assertUnlinkedPath(path) {
  const volume = parse(path).root;
  let current = volume;
  const parts = relative(volume, path).split(sep).filter(Boolean);
  for (let index = -1; index < parts.length; index++) {
    if (index >= 0) current = join(current, parts[index]);
    const stat = await lstat(current);
    if (stat.isSymbolicLink()) throw new Error('Refusing symbolic link or junction in repair path.');
    if (index < parts.length - 1 && !stat.isDirectory()) throw new Error('Repair parent must be a directory.');
    if (comparablePath(await realpath(current)) !== comparablePath(current)) {
      throw new Error('Refusing redirected directory or file in repair path.');
    }
  }
}

/** @param {import('node:fs').Stats} a @param {import('node:fs').Stats} b */
function sameFile(a, b) {
  return a.dev === b.dev && a.ino === b.ino && a.size === b.size
    && a.mtimeMs === b.mtimeMs && a.ctimeMs === b.ctimeMs;
}

/** @param {string} path */
async function readOriginal(path) {
  await assertUnlinkedPath(path);
  const stat = await lstat(path);
  if (!stat.isFile() || stat.nlink !== 1) throw new Error('Repair target must be a regular, unlinked file.');
  const bytes = await readFile(path);
  const after = await lstat(path);
  if (after.isSymbolicLink() || !sameFile(stat, after)) throw new Error('Repair target changed while reading; no repair applied.');
  return { stat, bytes };
}

/** @param {Fingerprint} value */
function validFingerprint(value) {
  return value && /^[a-f0-9]{64}$/.test(value.sha256)
    && Number.isSafeInteger(value.bytes) && value.bytes > 0;
}

/** Only this bundled repair is selectable; no custom patch/manifest CLI input. */
async function loadRepair() {
  /** @type {Repair} */
  const repair = JSON.parse(await readFile(manifestUrl, 'utf8'));
  if (repair.schemaVersion !== 1 || repair.id !== 'electron-failed-tool-text'
    || repair.target !== 'renderer/renderer.js'
    || !validFingerprint(repair.before) || !validFingerprint(repair.after)
    || typeof repair.replacement?.before !== 'string' || !repair.replacement.before
    || typeof repair.replacement?.after !== 'string' || !repair.replacement.after) {
    throw new Error('Invalid bundled Electron repair manifest.');
  }
  return repair;
}

/** Apply the exact public Demo repair. Keep the target closed while preparing it.
 * No network, dependency installation, config loading, or application launch.
 * @param {{demo: string, target: string}} options
 */
export async function prepareDemo({ demo, target }) {
  if (demo !== 'electron') throw new Error('Only the verified electron Demo repair is available.');
  if (typeof target !== 'string' || !isAbsolute(target)) throw new Error('Demo target must be an absolute directory.');
  const root = resolve(target);
  await assertUnlinkedPath(root);
  if (!(await lstat(root)).isDirectory()) throw new Error('Demo target must be a directory.');
  const repair = await loadRepair();
  const file = join(root, repair.target);
  const original = await readOriginal(file);
  const beforeSha256 = sha256(original.bytes);
  const receipt = { demo, repair: repair.id, target: file, beforeSha256, afterSha256: repair.after.sha256 };
  if (beforeSha256 === repair.after.sha256 && original.bytes.length === repair.after.bytes) {
    return { ...receipt, status: 'already-prepared', changed: false };
  }
  if (beforeSha256 !== repair.before.sha256 || original.bytes.length !== repair.before.bytes) {
    throw new Error('Unknown or user-modified renderer; no files written. Keep user changes and review compatibility.');
  }
  const text = original.bytes.toString('utf8');
  const pieces = text.split(repair.replacement.before);
  if (pieces.length !== 2) throw new Error('Expected exactly one repair location; no files written.');
  const result = Buffer.from(pieces.join(repair.replacement.after), 'utf8');
  if (result.length !== repair.after.bytes || sha256(result) !== repair.after.sha256) {
    throw new Error('Prepared renderer does not match the verified output; no files written.');
  }

  // A sibling exclusive temporary file lets rename replace only this one file.
  // Recheck identity/content and every ancestor immediately before the rename.
  const temporary = join(dirname(file), `.tansr-repair-${randomUUID()}.tmp`);
  let temporaryOwned = false;
  try {
    await assertUnlinkedPath(file);
    const handle = await open(temporary, 'wx', original.stat.mode & 0o777);
    temporaryOwned = true;
    try { await handle.writeFile(result); await handle.sync(); }
    finally { await handle.close(); }
    const current = await readOriginal(file);
    if (!sameFile(original.stat, current.stat) || sha256(current.bytes) !== beforeSha256) {
      throw new Error('Repair target changed during preparation; replacement refused.');
    }
    await rename(temporary, file);
    temporaryOwned = false;
    return { ...receipt, status: 'prepared', changed: true };
  } finally {
    if (temporaryOwned) {
      await assertUnlinkedPath(dirname(temporary));
      await unlink(temporary);
    }
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === '--help') {
    console.log('Usage: node scripts/prepare-demo.mjs electron <absolute-extracted-electron-demo-directory>\nOffline; only the verified renderer repair. Keep the Demo closed. Unknown content or linked paths are refused.');
  } else {
    try {
      if (args.length !== 2) throw new Error('Usage: node scripts/prepare-demo.mjs electron <absolute-extracted-electron-demo-directory>');
      console.log(JSON.stringify(await prepareDemo({ demo: args[0], target: args[1] }), null, 2));
    } catch (error) {
      console.error(error instanceof Error ? error.message : 'Demo preparation failed.');
      process.exitCode = 1;
    }
  }
}
