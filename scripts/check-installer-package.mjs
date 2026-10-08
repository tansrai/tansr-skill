// @ts-check
import { mkdtemp, readFile, writeFile, mkdir, rm, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname, resolve, relative, isAbsolute, sep, delimiter } from 'node:path';
import { existsSync, realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { execFileSync } from 'node:child_process';
import { repositoryRoot, inspectGeneratedPackage, validateRelativePath, validateRelease,
  readRegularFile, readPackageTree, assertUnlinkedPath, sha256, checkLocalReferences, checkPublicContent,
  PAYLOAD_FILES, INSTALLER_FILES, payloadSourcePath, checkReleaseBaselines } from './build-installer.mjs';

/** @typedef {{bytes: Buffer, mode: number}} TarFile */
/** @param {Buffer} field */
function string(field) { return field.toString('utf8').replace(/\0.*$/s, ''); }
/** @param {Buffer} field */
function octal(field) {
  const text = string(field).trim();
  if (!/^[0-7]+$/.test(text)) throw new Error('Invalid tar numeric field.');
  const value = Number.parseInt(text, 8);
  if (!Number.isSafeInteger(value) || value < 0) throw new Error('Oversized tar field.');
  return value;
}

/** Small, bounded read-only tar reader; never extracts or executes archive entries.
 * Links, duplicate paths, traversal, unknown entry types and malformed PAX fail closed.
 * @param {Buffer} archive @returns {Map<string, TarFile>}
 */
export function readTarball(archive) {
  const tar = gunzipSync(archive, { maxOutputLength: 32 * 1024 * 1024 });
  /** @type {Map<string, TarFile>} */ const files = new Map();
  /** @type {Record<string, string> | null} */ let pax = null;
  let offset = 0;
  let ended = false;
  while (offset + 512 <= tar.length) {
    const header = tar.subarray(offset, offset + 512);
    if (header.every(byte => byte === 0)) {
      if (offset + 1024 > tar.length || tar.subarray(offset).some(byte => byte !== 0)) throw new Error('Invalid tar termination.');
      ended = true;
      break;
    }
    const checksum = header.reduce((sum, byte, index) => sum + (index >= 148 && index < 156 ? 32 : byte), 0);
    if (octal(header.subarray(148, 156)) !== checksum) throw new Error('Tar header checksum mismatch.');
    const size = octal(header.subarray(124, 136));
    const mode = octal(header.subarray(100, 108));
    const type = string(header.subarray(156, 157)) || '0';
    const start = offset + 512;
    if (start + size > tar.length) throw new Error('Truncated tar body.');
    const content = tar.subarray(start, start + size);
    offset = start + Math.ceil(size / 512) * 512;
    if (type === 'x') {
      if (pax) throw new Error('Repeated PAX metadata.');
      pax = {};
      let index = 0;
      while (index < content.length) {
        const space = content.indexOf(32, index);
        const lengthText = content.subarray(index, space).toString('ascii');
        if (space < index || !/^[1-9]\d*$/.test(lengthText)) throw new Error('Invalid PAX record.');
        const length = Number(lengthText);
        if (!Number.isSafeInteger(length) || length <= space - index + 2 || index + length > content.length
          || content[index + length - 1] !== 10) throw new Error('Invalid PAX length.');
        const record = content.subarray(space + 1, index + length - 1).toString('utf8');
        const equal = record.indexOf('=');
        const key = record.slice(0, equal);
        if (equal < 1 || !['path', 'size', 'mtime', 'atime', 'ctime', 'uid', 'gid', 'uname', 'gname'].includes(key)
          || Object.hasOwn(pax, key)) throw new Error('Unsupported PAX field.');
        pax[key] = record.slice(equal + 1);
        index += length;
      }
      continue;
    }
    if (type !== '0' || string(header.subarray(157, 257))) throw new Error('Tar links and non-regular entries are forbidden.');
    const prefix = string(header.subarray(345, 500));
    const name = pax?.path ?? [prefix, string(header.subarray(0, 100))].filter(Boolean).join('/');
    if (pax?.size !== undefined && pax.size !== String(size)) throw new Error('Inconsistent PAX size.');
    pax = null;
    if (!name.startsWith('package/')) throw new Error('Tar file is outside package root.');
    const path = name.slice('package/'.length);
    validateRelativePath(path);
    if (files.has(path)) throw new Error('Duplicate tar path.');
    if ((mode & ~0o777) !== 0 || (mode & 0o022) !== 0) throw new Error('Unsafe tar mode.');
    files.set(path, { bytes: Buffer.from(content), mode });
  }
  if (!ended || pax || files.size === 0) throw new Error('Incomplete tar archive.');
  return files;
}

/** @param {Map<string, TarFile>} files */
export function validatePackedContent(files) {
  /** @param {string} path */
  function required(path) {
    const file = files.get(path);
    if (!file) throw new Error(`Missing packaged file: ${path}`);
    return file;
  }
  const release = validateRelease(JSON.parse(required('release.json').bytes.toString('utf8')));
  checkReleaseBaselines(release, files, 'skill/');
  const pkg = JSON.parse(required('package.json').bytes.toString('utf8'));
  if (pkg.name !== release.packageName || pkg.version !== release.version || pkg.private === true || pkg.type !== 'module'
    || pkg.license !== release.license || pkg.engines?.node !== release.node
    || pkg.homepage !== release.homepage || pkg.repository?.type !== 'git' || pkg.repository?.url !== release.repository
    || pkg.bin?.[release.binName] !== 'installer/cli.mjs' || Object.keys(pkg.bin).length !== 1
    || pkg.publishConfig?.access !== 'public' || !Array.isArray(pkg.files)) throw new Error('Packaged npm metadata mismatch.');
  // Even an empty scripts/dependency table is unnecessary in this zero-runtime-dependency installer.
  for (const key of ['scripts', 'dependencies', 'optionalDependencies', 'peerDependencies', 'devDependencies', 'bundledDependencies', 'bundleDependencies']) {
    if (Object.hasOwn(pkg, key)) throw new Error(`Unexpected installer package field: ${key}`);
  }
  // Windows cannot persist POSIX execute bits. npm installs bin links with
  // executable permissions; do not reject a Windows-produced 0644 tar entry.
  if (![0o644, 0o755].includes(required('installer/cli.mjs').mode) || !required('installer/cli.mjs').bytes.toString('utf8').startsWith('#!/usr/bin/env node\n')) {
    throw new Error('CLI must have a portable shebang and regular file mode.');
  }
  const manifest = JSON.parse(required('manifest.json').bytes.toString('utf8'));
  if (manifest.schemaVersion !== 1 || manifest.name !== 'tansr' || manifest.version !== release.version
    || !Array.isArray(manifest.files) || manifest.files.length !== PAYLOAD_FILES.length) throw new Error('Invalid payload manifest.');
  const expected = new Set(['package.json', 'release.json', 'README.md', 'LICENSE', 'NOTICE', 'LICENSES/Apache-2.0.txt', 'manifest.json', ...INSTALLER_FILES]);
  const payloadPaths = new Set(PAYLOAD_FILES);
  const physicalPaths = new Set();
  for (const entry of manifest.files) {
    validateRelativePath(entry.path);
    if (!payloadPaths.delete(entry.path) || !Number.isSafeInteger(entry.bytes) || entry.bytes < 0
      || !/^[a-f\d]{64}$/.test(entry.sha256) || ![0o644, 0o755].includes(entry.mode)) throw new Error('Invalid payload manifest entry.');
    const source = entry.source ?? entry.path;
    validateRelativePath(source);
    if (source !== payloadSourcePath(entry.path) || physicalPaths.has(source.toLowerCase())
      || (entry.source !== undefined && entry.source === entry.path)) throw new Error('Invalid payload source mapping.');
    physicalPaths.add(source.toLowerCase());
    const path = `skill/${source}`;
    const actual = required(path);
    if (actual.bytes.length !== entry.bytes || sha256(actual.bytes) !== entry.sha256 || actual.mode !== entry.mode) {
      throw new Error(`Payload integrity mismatch: ${entry.path}`);
    }
    expected.add(path);
  }
  for (const path of ['LICENSE', 'NOTICE', 'LICENSES/Apache-2.0.txt']) {
    if (!required(path).bytes.equals(required(`skill/${path}`).bytes)) throw new Error(`Root and payload license/notice differ: ${path}`);
  }
  if (files.size !== expected.size || [...files.keys()].some(path => !expected.has(path))) throw new Error('Unexpected packaged content.');
  const declared = new Set(pkg.files);
  if (declared.size !== pkg.files.length || declared.size !== files.size - 1
    || [...expected].some(path => path !== 'package.json' && !declared.has(path))) throw new Error('npm files list is not exact.');
  const resolvedReferences = checkLocalReferences(files);
  checkPublicContent(files);
  return { packageName: pkg.name, version: pkg.version, packageFiles: files.size, payloadFiles: manifest.files.length, resolvedReferences };
}

/** @param {string} tarball @param {{packageDir?: string}} [options] */
export async function auditTarball(tarball, options = {}) {
  const archive = await readRegularFile(tarball);
  const files = readTarball(archive);
  const result = validatePackedContent(files);
  if (options.packageDir) {
    const source = await inspectGeneratedPackage(options.packageDir);
    if (source.size !== files.size) throw new Error('Tarball file count differs from build.');
    for (const [path, original] of source) {
      if (!files.get(path)?.bytes.equals(original.bytes)) throw new Error(`Tarball differs from built file: ${path}`);
    }
  }
  return { status: 'passed', ...result, bytes: archive.length, sha256: sha256(archive),
    integrity: `sha512-${createHash('sha512').update(archive).digest('base64')}` };
}

/** Find npm's installed JS entrypoint without invoking a shell or user scripts.
 * @returns {string}
 */
function npmEntry() {
  const fromEnvironment = process.env.npm_execpath;
  if (fromEnvironment && /(?:^|[\\/])npm-cli\.js$/.test(fromEnvironment)) return fromEnvironment;
  for (const bin of [dirname(process.execPath), ...(process.env.PATH ?? '').split(delimiter)]) {
    const bundled = join(bin, 'node_modules', 'npm', 'bin', 'npm-cli.js');
    if (existsSync(bundled)) return bundled;
    const executable = join(bin, 'npm');
    if (existsSync(executable)) {
      const actual = realpathSync(executable);
      if (actual.endsWith('npm-cli.js')) return actual;
    }
  }
  throw new Error('Cannot find the installed npm CLI; install Node.js with npm.');
}

/** A real npm pack; all npm cache/config/temporary outputs live in os.tmpdir().
 * @param {{packageDir?: string, packDestination?: string}} [options]
 */
export async function checkInstallerPackage(options = {}) {
  const packageDir = resolve(options.packageDir ?? join(repositoryRoot, 'dist', 'npm'));
  const packageFiles = await inspectGeneratedPackage(packageDir);
  validatePackedContent(new Map([...packageFiles].map(([path, file]) => [path, { ...file, mode: path === 'installer/cli.mjs' ? 0o755 : 0o644 }])));
  // macOS's OS-provided /var path is itself a symlink. Canonicalize the
  // trusted temporary root once; continue rejecting links below that root.
  const temporaryRoot = await realpath(tmpdir());
  const temporary = await mkdtemp(join(temporaryRoot, 'tansr-package-check-'));
  try {
    const userConfig = join(temporary, 'user.npmrc');
    const globalConfig = join(temporary, 'global.npmrc');
    await writeFile(userConfig, '');
    await writeFile(globalConfig, '');
    const npmEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^npm_config_/i.test(key)));
    npmEnv.NPM_CONFIG_USERCONFIG = userConfig;
    npmEnv.NPM_CONFIG_GLOBALCONFIG = globalConfig;
    npmEnv.NPM_CONFIG_CACHE = join(temporary, 'npm-cache');
    const packed = execFileSync(process.execPath, [npmEntry(), 'pack', '--ignore-scripts', '--json', '--offline',
      '--pack-destination', temporary], { cwd: packageDir, env: npmEnv, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024, timeout: 120000 });
    const result = JSON.parse(packed);
    if (!Array.isArray(result) || result.length !== 1 || typeof result[0].filename !== 'string'
      || !/^[a-z0-9][a-z0-9.-]*\.tgz$/.test(result[0].filename)) throw new Error('Unexpected npm pack result.');
    const tarball = join(temporary, result[0].filename);
    const audit = await auditTarball(tarball, { packageDir });
    if (result[0].integrity !== audit.integrity) throw new Error('npm pack integrity mismatch.');
    const consumer = join(temporary, 'consumer');
    await mkdir(consumer);
    await writeFile(join(consumer, 'package.json'), '{"name":"tansr-package-audit","private":true}');
    execFileSync(process.execPath, [npmEntry(), 'install', tarball, '--ignore-scripts', '--offline', '--no-audit',
      '--no-fund', '--package-lock=false', '--save=false'], { cwd: consumer, env: npmEnv, encoding: 'utf8',
      maxBuffer: 4 * 1024 * 1024, timeout: 120000 });
    const installed = await readPackageTree(join(consumer, 'node_modules', '@tansr', 'skill'));
    if (installed.size !== packageFiles.size) throw new Error('npm extraction changed the package file count.');
    for (const [path, original] of packageFiles) {
      if (!installed.get(path)?.bytes.equals(original.bytes)) throw new Error(`npm extraction changed a required package file: ${path}`);
    }
    const destination = resolve(options.packDestination ?? join(repositoryRoot, 'dist', 'packages'));
    await assertUnlinkedPath(destination);
    await mkdir(destination, { recursive: true });
    const output = join(destination, result[0].filename);
    // No overwrites: an existing release artifact must have identical bytes.
    const bytes = await readFile(tarball);
    try { await writeFile(output, bytes, { flag: 'wx' }); }
    catch (error) {
      if (/** @type {NodeJS.ErrnoException} */ (error).code !== 'EEXIST') throw error;
      if (!(await readRegularFile(output)).equals(bytes)) throw new Error('Existing tarball differs; preserved. Choose a new pack destination.');
    }
    return { ...audit, tarball: output, npmScriptsExecuted: false, npmExtractionVerified: true, runtimeDependencies: 0 };
  } finally {
    const rel = relative(temporaryRoot, temporary);
    if (isAbsolute(rel) || rel.includes(sep) || !rel.startsWith('tansr-package-check-')) throw new Error('Unexpected package temporary directory; retained.');
    await assertUnlinkedPath(temporary);
    await rm(temporary, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    if (process.argv.length !== 2) throw new Error('Usage: node scripts/check-installer-package.mjs');
    console.log(JSON.stringify(await checkInstallerPackage(), null, 2));
  } catch (error) { console.error(error instanceof Error ? error.message : 'Package check failed.'); process.exitCode = 1; }
}
