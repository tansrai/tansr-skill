// @ts-check
import path from 'node:path';
import { constants } from 'node:fs';
import { lstat, realpath, mkdir, open, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { InstallerError, isFsError } from './errors.mjs';

/** @param {string} part */
export function validateSegment(part) {
  if (!part || part === '.' || part === '..' || /[\x00-\x1f\x7f<>:"/\\|?*]/u.test(part) || /[. ]$/.test(part) || /^(?:con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/iu.test(part)) {
    throw new InstallerError('UNSAFE_PATH', 'Invalid or non-portable path component', { component: part });
  }
}
/** @param {string} value */
export function portableKey(value) { return value.normalize('NFC').toLowerCase(); }
/** @param {unknown} value @returns {string} */
export function validateRelative(value) {
  if (typeof value !== 'string' || !value || value.includes('\\') || path.posix.isAbsolute(value)) throw new InstallerError('UNSAFE_PATH', 'Manifest path must be a relative forward-slash path');
  const parts = value.split('/'); parts.forEach(validateSegment);
  if (parts.some(p => /^\.env(?:\.|$)/i.test(p) && !/^\.env\.(?:example|sample|template)$/i.test(p))) throw new InstallerError('SENSITIVE_PATH', 'Credential environment files are not installer payloads', { path: value });
  return value;
}
/** @param {string} file */
export async function maybeStat(file) { try { return await lstat(file); } catch (error) { if (isFsError(error, 'ENOENT')) return null; throw error; } }
/** @param {string} file @param {import('node:fs').Stats|import('node:fs').BigIntStats} stat @param {boolean} [directory] */
export function assertNode(file, stat, directory = false) {
  if (stat.isSymbolicLink() || (directory ? !stat.isDirectory() : !stat.isFile()) || (!directory && stat.nlink !== 1 && stat.nlink !== 1n)) throw new InstallerError('UNSAFE_LINK', 'Links, hard-linked files and non-regular nodes are refused', { path: file });
}
/** BigInt file IDs avoid rounded NTFS inode numbers. @param {string} directory */
export async function directoryIdentity(directory){const s=await lstat(directory,{bigint:true});assertNode(directory,s,true);return{dev:String(s.dev),ino:String(s.ino),birthtimeNs:String(s.birthtimeNs)};}
/** @param {string} absolute @param {boolean} [create] */
export async function validateDirectoryChain(absolute, create = false) {
  if (!path.isAbsolute(absolute) || absolute.startsWith('\\\\')) throw new InstallerError('UNSAFE_PATH', 'An absolute local path is required', { path: absolute });
  const root = path.parse(absolute).root;
  const parts = absolute.slice(root.length).split(path.sep).filter(Boolean); parts.forEach(validateSegment);
  let cursor = root, missing = false;
  for (const part of parts) {
    cursor = path.join(cursor, part); let s = await maybeStat(cursor);
    if (!s && create) { try { await mkdir(cursor, { mode: 0o700 }); } catch (error) { if (!isFsError(error, 'EEXIST')) throw error; } s = await maybeStat(cursor); }
    if (!s) { missing = true; continue; }
    assertNode(cursor, s, true);
    const actual = await realpath(cursor);
    if ((process.platform === 'win32' ? actual.toLowerCase() : actual) !== (process.platform === 'win32' ? cursor.toLowerCase() : cursor)) throw new InstallerError('UNSAFE_LINK', 'Directory resolves through an alias', { path: cursor });
  }
  return !missing;
}
/** @param {string} targetPath */
export async function resolvePaths(targetPath) {
  if (typeof targetPath !== 'string' || !path.isAbsolute(targetPath)) throw new InstallerError('INVALID_TARGET', 'targetPath must be absolute');
  const rawParts = targetPath.slice(path.parse(targetPath).root.length).split(path.sep).filter(Boolean); rawParts.forEach(validateSegment);
  const target = path.normalize(targetPath);
  if (path.basename(target) !== 'tansr') throw new InstallerError('INVALID_TARGET', 'The target must be an independent directory named tansr', { targetPath: target });
  const parent = path.dirname(target), stateParent = path.dirname(parent);
  const key = createHash('sha256').update(process.platform === 'win32' ? target.toLowerCase() : target).digest('hex').slice(0,16);
  const state = path.join(stateParent, `.tansr-installer-state-${key}`), legacyState = path.join(parent, '.tansr-installer-state');
  if(stateParent===parent)throw new InstallerError('INVALID_TARGET','The target must have an ancestor outside its skill scan directory');
  await validateDirectoryChain(parent); const targetStat = await maybeStat(target); if (targetStat) assertNode(target, targetStat, true);
  const stateStat = await maybeStat(state); if (stateStat) assertNode(state, stateStat, true);
  const legacyStat = await maybeStat(legacyState); if (legacyStat) assertNode(legacyState, legacyStat, true);
  return { target, parent, state, stateParent, legacyState, stateLayout: /** @type {const} */ ('outside-skills-v2') };
}
/** Reads only a caller-approved managed file; never follows a symlink. @param {string} file */
export async function readRegular(file) {
  await validateDirectoryChain(path.dirname(file)); const before = await lstat(file,{bigint:true}); assertNode(file, before);
  const handle = await open(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const opened = await handle.stat({bigint:true}); assertNode(file, opened);
    if (opened.dev !== before.dev || opened.ino !== before.ino) throw new InstallerError('PATH_CHANGED', 'File identity changed while opening', { path: file });
    const bytes = await handle.readFile(); const after = await handle.stat({bigint:true}), current = await lstat(file,{bigint:true}); assertNode(file, current);
    if (after.size !== opened.size || after.mtimeNs !== opened.mtimeNs || after.ctimeNs !== opened.ctimeNs || current.ino !== opened.ino || current.dev !== opened.dev) throw new InstallerError('PATH_CHANGED', 'File changed while reading', { path: file });
    return { bytes, sha256: createHash('sha256').update(bytes).digest('hex'), mode: Number(opened.mode & 0o777n), stat: opened };
  } finally { await handle.close(); }
}
/** Lists names and node metadata only. Unknown files, including .env, are never read. @param {string} root */
export async function scanTree(root) {
  /** @type {Map<string, 'file'|'directory'>} */ const nodes = new Map();
  if (!(await maybeStat(root))) return nodes;
  await validateDirectoryChain(root);
  /** @param {string} directory @param {string} relative */
  async function walk(directory, relative) {
    const keys = new Set();
    for (const name of await readdir(directory)) {
      validateSegment(name); const key = portableKey(name);
      if (keys.has(key)) throw new InstallerError('CASE_COLLISION', 'Case or Unicode-equivalent paths collide', { path: directory }); keys.add(key);
      const file = path.join(directory, name), rel = relative ? `${relative}/${name}` : name, s = await lstat(file);
      assertNode(file, s, s.isDirectory()); nodes.set(rel, s.isDirectory() ? 'directory' : 'file');
      if (s.isDirectory()) await walk(file, rel);
    }
  }
  await walk(root, ''); return nodes;
}
