// @ts-check
// Offline consumer repairs only. The downloaded Demo retains its own license.
import { lstat, readFile, realpath, open, rename, link, unlink } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { dirname, isAbsolute, join, parse, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

/** @typedef {{ sha256: string, bytes: number }} Fingerprint */
/** @typedef {{ before: string, after: string }} Replacement */
/** @typedef {{ before: Fingerprint, replacement?: Replacement, replacements?: Replacement[] }} RepairInput */
/** @typedef {RepairInput & { target: string, after: Fingerprint, upgrades?: RepairInput[] }} RepairFile */
/** @typedef {{ target: string, before: null, after: Fingerprint, content: string, replacement?: never, replacements?: never, upgrades?: never }} NewFile */
/** @typedef {RepairFile & { schemaVersion: number, id: string, files?: (RepairFile | NewFile)[] }} Repair */
/** @typedef {{ file: string, original: { stat: import('node:fs').Stats, bytes: Buffer } | null, beforeSha256: string | null, result: Buffer | null, receipt: { target: string, beforeSha256: string | null, afterSha256: string } }} PreparedFile */
/** @typedef {{ index: number, temporary: string, owned: boolean, identity: import('node:fs').Stats, sha256: string }} StagedFile */

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

/** A new bundled file may be absent, but its existing parents must be safe.
 * @param {string} path
 */
async function readOptionalOriginal(path) {
  await assertUnlinkedPath(dirname(path));
  try { await lstat(path); }
  catch (error) {
    if (/** @type {NodeJS.ErrnoException} */ (error).code === 'ENOENT') return null;
    throw error;
  }
  return readOriginal(path);
}

/** @param {Fingerprint} value */
function validFingerprint(value) {
  return value && /^[a-f0-9]{64}$/.test(value.sha256)
    && Number.isSafeInteger(value.bytes) && value.bytes > 0;
}

/** Only these bundled repairs are selectable; no custom patch/manifest CLI input.
 * @param {'electron' | 'android'} demo
 */
async function loadRepair(demo) {
  const expected = demo === 'electron'
    ? { id: 'electron-failed-tool-text', targets: ['renderer/renderer.js'], label: 'Electron' }
    : { id: 'android-public-demo-repairs', targets: [
      'sample/src/main/kotlin/com/tansr/sdk/sample/OrderAssistantActivity.kt',
      'sample/src/main/kotlin/com/tansr/sdk/sample/DemoMediaPreview.kt',
      'sample/src/main/kotlin/com/tansr/sdk/sample/DemoHistoryImages.kt',
    ], label: 'Android' };
  const manifestUrl = new URL(`../assets/demo-repairs/${demo}.json`, import.meta.url);
  /** @type {Repair} */
  const repair = JSON.parse(await readFile(manifestUrl, 'utf8'));
  const files = demo === 'electron' ? [repair] : repair.files;
  if (repair.schemaVersion !== 1 || repair.id !== expected.id
    || !Array.isArray(files) || files.length !== expected.targets.length
    || files.some((file, index) => file?.target !== expected.targets[index])) {
    throw new Error(`Invalid bundled ${expected.label} repair manifest.`);
  }
  return { id: repair.id, files: files.map(file => {
    if (file.before === null) {
      if (demo !== 'android' || file.target !== expected.targets[2]
        || !validFingerprint(file.after) || typeof file.content !== 'string' || !file.content
        || file.replacement !== undefined || file.replacements !== undefined || file.upgrades !== undefined) {
        throw new Error(`Invalid bundled ${expected.label} repair manifest.`);
      }
      const content = Buffer.from(file.content, 'utf8');
      if (content.length !== file.after.bytes || sha256(content) !== file.after.sha256) {
        throw new Error('New bundled file does not match the verified output; no files written.');
      }
      return { target: file.target, after: file.after, inputs: [], content };
    }
    if (file.target === expected.targets[2]) throw new Error(`Invalid bundled ${expected.label} repair manifest.`);
    if (!validFingerprint(file.after) || (file.upgrades !== undefined
      && (!Array.isArray(file.upgrades) || file.upgrades.length !== 2 || demo !== 'android'
        || file.target !== expected.targets[0]))) {
      throw new Error(`Invalid bundled ${expected.label} repair manifest.`);
    }
    const inputs = [file, ...(file.upgrades ?? [])].map(input => {
      const replacements = input.replacements ?? (input.replacement ? [input.replacement] : []);
      if (!validFingerprint(input.before)
        || (input.replacement !== undefined && input.replacements !== undefined)
        || !Array.isArray(replacements) || replacements.length === 0
        || replacements.some(replacement => typeof replacement?.before !== 'string' || !replacement.before
          || typeof replacement?.after !== 'string' || !replacement.after)) {
        throw new Error(`Invalid bundled ${expected.label} repair manifest.`);
      }
      return { before: input.before, replacements };
    });
    if (new Set(inputs.map(input => input.before.sha256)).size !== inputs.length
      || inputs.some(input => input.before.sha256 === file.after.sha256)) {
      throw new Error(`Invalid bundled ${expected.label} repair manifest.`);
    }
    return { target: file.target, after: file.after, inputs, content: null };
  }) };
}

/** Apply the exact public Demo repair. Keep the target closed while preparing it.
 * No network, dependency installation, config loading, or application launch.
 * @param {{demo: string, target: string}} options
 */
export async function prepareDemo({ demo, target }) {
  if (demo !== 'electron' && demo !== 'android') throw new Error('Only the verified electron and android Demo repairs are available.');
  if (typeof target !== 'string' || !isAbsolute(target)) throw new Error('Demo target must be an absolute directory.');
  const root = resolve(target);
  await assertUnlinkedPath(root);
  if (!(await lstat(root)).isDirectory()) throw new Error('Demo target must be a directory.');
  const repair = await loadRepair(demo);
  /** @type {PreparedFile[]} */
  const entries = [];
  // Validate every input and compute every output before creating even a temporary file.
  for (const fileRepair of repair.files) {
    const file = join(root, fileRepair.target);
    const original = fileRepair.content === null ? await readOriginal(file) : await readOptionalOriginal(file);
    const beforeSha256 = original ? sha256(original.bytes) : null;
    const alreadyPrepared = original !== null && beforeSha256 === fileRepair.after.sha256 && original.bytes.length === fileRepair.after.bytes;
    let result = original === null ? fileRepair.content : null;
    if (original && !alreadyPrepared) {
      const input = fileRepair.inputs.find(input => beforeSha256 === input.before.sha256 && original.bytes.length === input.before.bytes);
      if (!input) {
        throw new Error(`Unknown or user-modified ${demo === 'electron' ? 'renderer' : 'Android source'}; no files written. Keep user changes and review compatibility.`);
      }
      let text = original.bytes.toString('utf8');
      for (const replacement of input.replacements) {
        const pieces = text.split(replacement.before);
        if (pieces.length !== 2) throw new Error('Expected exactly one repair location; no files written.');
        text = pieces.join(replacement.after);
      }
      result = Buffer.from(text, 'utf8');
      if (result.length !== fileRepair.after.bytes || sha256(result) !== fileRepair.after.sha256) {
        throw new Error(`Prepared ${demo === 'electron' ? 'renderer' : 'Android source'} does not match the verified output; no files written.`);
      }
    }
    entries.push({ file, original, beforeSha256, result, receipt: {
      target: file, beforeSha256, afterSha256: fileRepair.after.sha256,
    } });
  }
  const receipt = demo === 'electron'
    ? { demo, repair: repair.id, ...entries[0].receipt }
    : { demo, repair: repair.id, files: entries.map(entry => ({ ...entry.receipt, changed: entry.result !== null })) };
  if (entries.every(entry => entry.result === null)) return { ...receipt, status: 'already-prepared', changed: false };
  /** @param {number} index */
  async function recheck(index) {
    const entry = entries[index];
    if (entry.original === null) {
      if (await readOptionalOriginal(entry.file) !== null) throw new Error('New repair target appeared during preparation; creation refused.');
      return;
    }
    const current = await readOriginal(entry.file);
    if (!sameFile(entry.original.stat, current.stat) || sha256(current.bytes) !== entry.beforeSha256) {
      throw new Error('Repair target changed during preparation; replacement refused.');
    }
  }
  /** @type {StagedFile[]} */
  const staged = [];
  /** Only remove this invocation's unchanged temporary file, including its
   * extra hard-link name after atomic creation. A changed name is preserved.
   * @param {StagedFile} item
   */
  async function removeOwnedTemporary(item) {
    await assertUnlinkedPath(dirname(item.temporary));
    const current = await lstat(item.temporary);
    if (current.isSymbolicLink() || !current.isFile()
      || current.dev !== item.identity.dev || current.ino !== item.identity.ino) {
      throw Object.assign(new Error('Temporary path identity changed; preserved.'), { code: 'OWNERSHIP_CHANGED' });
    }
    const bytes = await readFile(item.temporary);
    if (sha256(bytes) !== item.sha256 || !sameFile(current, await lstat(item.temporary))) {
      throw Object.assign(new Error('Temporary file content changed; preserved.'), { code: 'OWNERSHIP_CHANGED' });
    }
    await unlink(item.temporary);
    item.owned = false;
  }
  let replaced = 0;
  let failed = false;
  /** @type {unknown} */
  let failure;
  try {
    for (let index = 0; index < entries.length; index++) await recheck(index);
    // Each file gets an exclusive sibling, followed by a full-set recheck before any rename.
    for (let index = 0; index < entries.length; index++) {
      const entry = entries[index];
      if (entry.result === null) continue;
      await assertUnlinkedPath(entry.original ? entry.file : dirname(entry.file));
      const temporary = join(dirname(entry.file), `.tansr-repair-${randomUUID()}.tmp`);
      const handle = await open(temporary, 'wx', entry.original ? entry.original.stat.mode & 0o777 : 0o644);
      let identityKnown = false;
      let stagingFailed = false;
      /** @type {unknown} */
      let stagingFailure;
      try {
        const identity = await handle.stat();
        staged.push({ index, temporary, owned: true, identity, sha256: sha256(entry.result) });
        identityKnown = true;
        await handle.writeFile(entry.result);
        await handle.sync();
      } catch (error) {
        stagingFailed = true;
        stagingFailure = identityKnown ? error : new Error(`Cannot establish ownership of created temporary file: ${temporary}. Retained for inspection; do not remove an unverified path.`, { cause: error });
      } finally {
        try { await handle.close(); }
        catch (error) {
          stagingFailure = stagingFailed
            ? new Error(`${stagingFailure instanceof Error ? stagingFailure.message : 'Temporary staging failed.'} Closing its file handle also failed.`, { cause: new AggregateError([stagingFailure, error], 'Temporary staging and close failed.') })
            : error;
          stagingFailed = true;
        }
      }
      if (stagingFailed) throw stagingFailure;
    }
    for (let index = 0; index < entries.length; index++) await recheck(index);
    for (const item of staged) {
      await recheck(item.index);
      const entry = entries[item.index];
      if (entry.original === null) {
        // Publish atomically without overwrite: rename alone could replace a file
        // created after the absence check. Remove our temporary hard link at once.
        await link(item.temporary, entry.file);
        replaced++;
        await removeOwnedTemporary(item);
      } else {
        await rename(item.temporary, entry.file);
        item.owned = false;
        replaced++;
      }
    }
  } catch (error) {
    failed = true;
    failure = error;
  }
  // Cleanup must not overwrite the main failure or hide already published files.
  const cleanupFailures = [];
  for (const item of staged) if (item.owned) {
    try { await removeOwnedTemporary(item); }
    catch (error) { cleanupFailures.push({ path: item.temporary, error }); }
  }
  if (failed || cleanupFailures.length) {
    // Publication is atomic per file, not a cross-file transaction. Never roll back over user edits.
    const primary = replaced > 0
      ? new Error(`Repair stopped after replacing ${replaced} file(s); retain this directory and inspect it before retrying.`, { cause: failure })
      : failure;
    if (cleanupFailures.length) {
      const paths = cleanupFailures.map(({ path, error }) => {
        const code = /** @type {NodeJS.ErrnoException} */ (error)?.code;
        return `${path} (${typeof code === 'string' && /^[A-Z_]+$/.test(code) ? code : 'CLEANUP_ERROR'})`;
      }).join('; ');
      throw new Error(`${primary instanceof Error ? primary.message : 'Repair failed.'} Cleanup failed for retained temporary paths: ${paths}. Keep this directory. Resolve the I/O or ownership issue, verify the listed names and identities, then remove only the verified temporary names. A published target may share a temporary hard link; do not delete repaired targets.`, {
        cause: new AggregateError(cleanupFailures.map(({ error }) => error), 'Owned temporary cleanup failed.', { cause: primary }),
      });
    }
    throw primary;
  }
  return { ...receipt, status: 'prepared', changed: true };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === '--help') {
    console.log('Usage: node scripts/prepare-demo.mjs <electron|android> <absolute-extracted-demo-directory>\nOffline; only the selected verified repair set. Keep the Demo closed. All inputs and outputs are checked before writes; unknown content or linked paths are refused.');
  } else {
    try {
      if (args.length !== 2) throw new Error('Usage: node scripts/prepare-demo.mjs <electron|android> <absolute-extracted-demo-directory>');
      console.log(JSON.stringify(await prepareDemo({ demo: args[0], target: args[1] }), null, 2));
    } catch (error) {
      console.error(error instanceof Error ? error.message : 'Demo preparation failed.');
      process.exitCode = 1;
    }
  }
}
