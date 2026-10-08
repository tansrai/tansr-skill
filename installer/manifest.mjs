// @ts-check
import path from 'node:path';
import { InstallerError } from './errors.mjs';
import { validateRelative, portableKey, readRegular, validateDirectoryChain, scanTree } from './paths.mjs';
/** @typedef {{path:string, source?:string, bytes:number, sha256:string, mode?:number}} FileEntry */
/** @typedef {{schemaVersion:1, name:'tansr', version:string, files:FileEntry[]}} Manifest */
/** @param {unknown} input @returns {Manifest} */
export function validateManifest(input) {
  if (!input || typeof input !== 'object') throw new InstallerError('INVALID_MANIFEST', 'Manifest must be an object');
  const m = /** @type {Record<string, unknown>} */ (input);
  if (m.schemaVersion !== 1 || m.name !== 'tansr' || typeof m.version !== 'string' || !/^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(m.version) || !Array.isArray(m.files) || m.files.length === 0 || m.files.length > 100000) throw new InstallerError('INVALID_MANIFEST', 'Unsupported manifest header or files');
  /** @type {FileEntry[]} */ const files = []; const seen = new Set(), sources = new Set();
  for (const value of m.files) {
    if (!value || typeof value !== 'object') throw new InstallerError('INVALID_MANIFEST', 'Invalid file entry');
    const p = validateRelative(value.path), key = portableKey(p), source = value.source === undefined ? undefined : validateRelative(value.source), sourceKey = portableKey(source ?? p);
    if (!Number.isSafeInteger(value.bytes) || value.bytes < 0 || typeof value.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(value.sha256) || (value.mode !== undefined && value.mode !== 0o644 && value.mode !== 0o755)) throw new InstallerError('INVALID_MANIFEST', 'Invalid file size, digest or mode', { path: p });
    if (seen.has(key) || sources.has(sourceKey)) throw new InstallerError('CASE_COLLISION', 'Duplicate or case-equivalent manifest paths or sources', { path: p }); seen.add(key); sources.add(sourceKey);
    files.push({ path: p, ...(source === undefined ? {} : {source}), bytes: value.bytes, sha256: value.sha256, ...(value.mode === undefined ? {} : { mode: value.mode }) });
  }
  for (const set of [seen,sources]) for (const key of set) { const parts = key.split('/'); parts.pop(); while (parts.length) { if (set.has(parts.join('/'))) throw new InstallerError('PATH_COLLISION', 'Manifest file is also a directory prefix', { path: key }); parts.pop(); } }
  for(const list of [files.map(f=>f.path),files.map(f=>f.source??f.path)]){const prefixes=new Map();for(const file of list){const parts=file.split('/');for(let i=1;i<=parts.length;i++){const prefix=parts.slice(0,i).join('/'),key=portableKey(prefix);if(prefixes.has(key)&&prefixes.get(key)!==prefix)throw new InstallerError('CASE_COLLISION','Directory prefix spelling differs',{path:prefix});prefixes.set(key,prefix);}}}
  return { schemaVersion: 1, name: 'tansr', version: m.version, files: files.sort((a,b) => a.path.localeCompare(b.path, 'en')) };
}
/** @param {unknown} input */
export async function loadManifest(input) { if(typeof input!=='string')return validateManifest(input);validateRelative(path.basename(input));const bytes=(await readRegular(path.resolve(input))).bytes;let value;try{value=JSON.parse(bytes.toString('utf8'));}catch{throw new InstallerError('INVALID_MANIFEST','Manifest JSON is malformed');}return validateManifest(value); }
/** @param {string} payloadRoot @param {Manifest} manifest */
export async function verifyPayload(payloadRoot, manifest) {
  if (!path.isAbsolute(payloadRoot)) throw new InstallerError('INVALID_PAYLOAD', 'payloadRoot must be absolute');
  await validateDirectoryChain(payloadRoot); await scanTree(payloadRoot);
  for (const entry of manifest.files) {
    const content = await readRegular(path.join(payloadRoot, entry.source ?? entry.path));
    if (content.bytes.length !== entry.bytes || content.sha256 !== entry.sha256) throw new InstallerError('PAYLOAD_INTEGRITY', 'Payload does not match manifest', { path: entry.path });
  }
  return manifest;
}
