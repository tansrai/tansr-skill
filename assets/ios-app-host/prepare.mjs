#!/usr/bin/env node
import { createHash, randomUUID } from 'node:crypto';
import { closeSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, readdirSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, parse, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const assetRoot = dirname(fileURLToPath(import.meta.url));
const hash = (data) => createHash('sha256').update(data).digest('hex');
const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));

function fail(message) { throw new Error(message); }
function stat(path) {
  try { return lstatSync(path); } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}
function requireDirectory(path) {
  const item = stat(path);
  if (!item || item.isSymbolicLink() || !item.isDirectory()) fail(`Expected a real directory: ${path}`);
}
function requireDirectoryTree(path) {
  for (let current = path; ; current = dirname(current)) {
    requireDirectory(current);
    if (current === dirname(current)) break;
  }
}
function checkedPath(root, relative) {
  if (!relative || isAbsolute(relative) || relative.includes('\\') || relative.split('/').some((part) => !part || part === '.' || part === '..')) fail('Invalid manifest path');
  const target = resolve(root, ...relative.split('/'));
  if (!target.startsWith(root + sep)) fail('Path escaped selected directory');
  for (let parent = dirname(target); parent !== root; parent = dirname(parent)) requireDirectory(parent);
  const item = stat(target);
  if (!item || item.isSymbolicLink() || !item.isFile() || item.nlink !== 1) fail(`Expected an unlinked regular file: ${relative}`);
  return target;
}
function collect(root, current = root) {
  return readdirSync(current, { withFileTypes: true }).flatMap((entry) => {
    const path = join(current, entry.name);
    if (entry.isSymbolicLink()) fail(`Linked entry is not allowed: ${path}`);
    if (entry.isDirectory()) return collect(root, path);
    if (!entry.isFile()) fail(`Unsupported entry: ${path}`);
    return [path.slice(root.length + 1).split(sep).join('/')];
  }).sort();
}

function prepareRepairs(manifest, publicManifest, verified) {
  const paths = [
    'Sources/OrderAssistant/ChatScreen.swift',
    'Sources/OrderAssistant/ContinuousSpeechRun.swift',
    'Sources/OrderAssistant/SpeechSegmentsPanel.swift',
  ];
  if (manifest.schemaVersion !== 1 || manifest.sourceZipSha256 !== publicManifest.sourceZipSha256
    || manifest.normalizeLineEndings !== 'CRLF-to-LF'
    || JSON.stringify(manifest.files.map(({ path }) => path).sort()) !== JSON.stringify(paths)) fail('Invalid iOS consumer repair manifest');
  return manifest.files.map((entry) => {
    const original = verified.get(entry.path);
    if (!original || original.data.length !== entry.before.bytes || hash(original.data) !== entry.before.sha256) fail(`Repair source does not match pinned public file: ${entry.path}`);
    let text = original.data.toString('utf8').replace(/\r\n/g, '\n');
    if (!Array.isArray(entry.replacements) || entry.replacements.length === 0) fail('Invalid exact iOS replacements');
    for (const replacement of entry.replacements) {
      if (typeof replacement?.before !== 'string' || !replacement.before
        || typeof replacement?.after !== 'string' || !replacement.after) fail('Invalid exact iOS replacement');
      const parts = text.split(replacement.before);
      if (parts.length !== 2) fail(`Expected one exact repair location: ${entry.path}`);
      text = parts.join(replacement.after);
    }
    const data = Buffer.from(text, 'utf8');
    if (data.length !== entry.after.bytes || hash(data) !== entry.after.sha256) fail(`Repair output integrity mismatch: ${entry.path}`);
    return { ...entry, data, originalStat: original.stat };
  });
}

function applyPreparedRepair(demo, repair) {
  requireDirectoryTree(demo);
  const target = checkedPath(demo, repair.path);
  const current = lstatSync(target);
  if (current.dev !== repair.originalStat.dev || current.ino !== repair.originalStat.ino
    || current.mtimeMs !== repair.originalStat.mtimeMs || current.ctimeMs !== repair.originalStat.ctimeMs
    || hash(readFileSync(target)) !== repair.before.sha256) fail(`Public source changed during preparation: ${repair.path}`);
  const temporary = join(dirname(target), `.tansr-repair-${randomUUID()}.tmp`);
  const descriptor = openSync(temporary, 'wx', current.mode & 0o777);
  let temporaryOwned = true;
  try {
    try { writeFileSync(descriptor, repair.data); fsyncSync(descriptor); }
    finally { closeSync(descriptor); }
    requireDirectoryTree(demo);
    const rechecked = checkedPath(demo, repair.path);
    const latest = lstatSync(rechecked);
    if (latest.dev !== current.dev || latest.ino !== current.ino
      || latest.mtimeMs !== current.mtimeMs || latest.ctimeMs !== current.ctimeMs
      || hash(readFileSync(rechecked)) !== repair.before.sha256) fail(`Public source changed during preparation: ${repair.path}`);
    renameSync(temporary, target);
    temporaryOwned = false;
  } finally {
    if (temporaryOwned) {
      requireDirectoryTree(dirname(temporary));
      unlinkSync(temporary);
    }
  }
}

function main() {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === '--help') {
    console.log('Usage: node prepare.mjs --demo <absolute freshly extracted ios-demo directory> [--check]\nChecks the pinned public Demo and SDK 0.3.0, adds App/ and applies verified consumer repairs to three Swift files. --check writes nothing. No downloads, builds, login or model calls. Run before editing or configuring the Demo.');
    return;
  }
  if (args[0] !== '--demo' || !args[1] || ![2, 3].includes(args.length) || (args.length === 3 && args[2] !== '--check')) fail('Use --demo <absolute ios-demo directory> [--check]; see --help.');
  if (!isAbsolute(args[1])) fail('--demo must be an explicit absolute path');
  const demo = resolve(args[1]);
  if (demo === parse(demo).root) fail('Filesystem root cannot be a Demo directory');
  requireDirectoryTree(demo);
  const output = join(demo, 'App');
  if (stat(output)) fail('App already exists; refusing to overwrite or re-prepare this directory');
  const provenance = readJson(join(assetRoot, 'provenance.json'));
  const manifest = readJson(join(assetRoot, 'public-demo-files.json'));
  if (manifest.schemaVersion !== 1 || manifest.sourceZipSha256 !== provenance.publicDemo.sha256) fail('Inconsistent public source manifest');
  const expected = manifest.files.map(({ path }) => path).sort();
  const actual = collect(demo);
  // Finder may add .DS_Store while opening an otherwise unchanged extracted Demo.
  const comparable = actual.filter((path) => path.split('/').at(-1) !== '.DS_Store');
  if (JSON.stringify(comparable) !== JSON.stringify(expected)) fail('Directory is not the complete, fresh pinned public Demo; missing or extra files found');
  const verified = new Map();
  for (const entry of manifest.files) {
    const source = checkedPath(demo, entry.path);
    const data = readFileSync(source);
    if (data.length !== entry.bytes || hash(data) !== entry.sha256) fail(`Public Demo integrity mismatch: ${entry.path}`);
    verified.set(entry.path, { data, stat: lstatSync(source) });
  }
  const release = readJson(join(demo, 'SDK/tansr-sdk/SDK-RELEASE.json'));
  if (release.sdkVersion !== provenance.sdk.version || release.releaseRevision !== provenance.sdk.revision) fail('Expected formal SDK 0.3.0 and its fixed release revision');
  const host = join(assetRoot, 'host');
  requireDirectory(host);
  if (JSON.stringify(collect(host)) !== JSON.stringify(provenance.hostFiles.map(({ path }) => path).sort())) fail('Unexpected host asset files');
  const files = provenance.hostFiles.map((entry) => {
    const data = readFileSync(checkedPath(host, entry.path));
    if (data.length !== entry.bytes || hash(data) !== entry.sha256) fail(`Host integrity mismatch: ${entry.path}`);
    return { path: entry.path, data };
  });
  const repairs = prepareRepairs(readJson(join(assetRoot, 'demo-repairs.json')), manifest, verified);
  if (args[2] === '--check') {
    console.log(JSON.stringify({ checked: true, created: false, publicFiles: expected.length, repairFiles: repairs.length, sdkVersion: release.sdkVersion, appleBuild: 'not-run' }));
    return;
  }
  // Exclusive mkdir claims this output. A partial failed copy is preserved for inspection.
  mkdirSync(output);
  for (const file of files) {
    const target = join(output, ...file.path.split('/'));
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, file.data, { flag: 'wx' });
  }
  for (const repair of repairs) applyPreparedRepair(demo, repair);
  const consumerRepairs = repairs.map(({ path, before, after }) => ({ path, before, after }));
  writeFileSync(join(output, 'PREPARATION.json'), JSON.stringify({
    ...provenance, preparedAt: new Date().toISOString(), publicFilesVerified: expected.length,
    consumerRepairs,
    appleBuild: 'not-run', simulatorInteraction: 'not-run', signing: 'not-run',
  }, null, 2) + '\n', { flag: 'wx' });
  console.log(JSON.stringify({ prepared: true, project: join(output, 'OrderAssistant.xcodeproj'), scheme: 'OrderAssistant', sdkVersion: release.sdkVersion, consumerRepairs, appleBuild: 'not-run' }));
}

try { main(); } catch (error) {
  console.error(`iOS host preparation failed: ${error.message}`);
  process.exitCode = 1;
}
