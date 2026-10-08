import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm, rmdir, symlink, unlink, link, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname, relative, sep } from 'node:path';
import { execFileSync } from 'node:child_process';
import { gzipSync } from 'node:zlib';
import { buildInstaller, PAYLOAD_FILES, INSTALLER_FILES, repositoryRoot, BUILD_RECEIPT, payloadSourcePath } from '../scripts/build-installer.mjs';
import { checkInstallerPackage, auditTarball, readTarball } from '../scripts/check-installer-package.mjs';

const release = { schemaVersion: 1, packageName: '@tansr/skill', binName: 'tansr-skill', version: '0.1.0',
  node: '>=22.19', license: 'Apache-2.0', homepage: 'https://tansr.com/', repository: 'https://github.com/cpple/tansr-skill',
  skillVersion: '0.1.0', templateBaselines: [{ id: 'node', version: '1.0.0' }, { id: 'web', version: '0.1.0' }],
  runtimeBaselines: [{ id: 'serve', name: '@tansr/serve', version: '0.15.0' }, { id: 'sdk', name: '@tansr/sdk', version: '0.18.1' }] };

async function fixture(t) {
  const temporaryRoot = await realpath(tmpdir());
  const temporary = await mkdtemp(join(temporaryRoot, 'tansr-installer-package-'));
  t.after(async () => {
    const rel = relative(temporaryRoot, temporary);
    assert.ok(rel.startsWith('tansr-installer-package-') && !rel.includes(sep));
    await rm(temporary, { recursive: true, force: true });
  });
  const root = join(temporary, '中文 source with spaces');
  await mkdir(root);
  for (const path of PAYLOAD_FILES) {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), await readFile(join(repositoryRoot, path)));
  }
  await mkdir(join(root, 'installer'));
  for (const path of INSTALLER_FILES) await writeFile(join(root, path), 'export {};\n');
  await writeFile(join(root, 'installer/cli.mjs'), '#!/usr/bin/env node\nconsole.log("fixture-only");\n');
  await writeFile(join(root, 'release.json'), JSON.stringify(release));
  await writeFile(join(root, 'INSTALL.md'), '# Installer fixture\n');
  execFileSync('git', ['init', '--quiet'], { cwd: root });
  execFileSync('git', ['config', 'core.autocrlf', 'false'], { cwd: root });
  execFileSync('git', ['add', '--', ...PAYLOAD_FILES, ...INSTALLER_FILES, 'release.json', 'INSTALL.md'], { cwd: root });
  return { root, temporary, packageDir: join(root, 'dist/npm'), packDestination: join(temporary, 'packed') };
}

// Creates controlled hostile archives without relying on an extractor.
function tarball(entries) {
  const pieces = [];
  for (const entry of entries) {
    const header = Buffer.alloc(512);
    const path = entry.path;
    let name = path;
    let prefix = '';
    if (Buffer.byteLength(path) > 100) {
      const slash = path.lastIndexOf('/');
      prefix = path.slice(0, slash);
      name = path.slice(slash + 1);
    }
    header.write(name, 0, 100);
    const putOctal = (value, offset, length) => header.write(value.toString(8).padStart(length - 1, '0') + '\0', offset, length);
    putOctal(entry.mode ?? 0o644, 100, 8);
    putOctal(0, 108, 8); putOctal(0, 116, 8);
    putOctal(entry.bytes.length, 124, 12); putOctal(0, 136, 12);
    header.fill(32, 148, 156);
    header.write(entry.type ?? '0', 156, 1);
    header.write('ustar\0', 257, 6); header.write('00', 263, 2);
    header.write(prefix, 345, 155);
    putOctal(header.reduce((sum, byte) => sum + byte, 0), 148, 8);
    pieces.push(header, entry.bytes, Buffer.alloc((512 - entry.bytes.length % 512) % 512));
  }
  pieces.push(Buffer.alloc(1024));
  return gzipSync(Buffer.concat(pieces));
}

test('explicit tracked package builds, real npm pack preserves every payload byte and public metadata', async t => {
  const f = await fixture(t);
  await writeFile(join(f.root, 'assets/product-starter/.env'), 'synthetic-sensitive-fixture-only');
  await writeFile(join(f.root, 'assets/product-starter/internal-sdk.mjs'), 'tracked but never approved for publishing');
  execFileSync('git', ['add', '-f', 'assets/product-starter/.env', 'assets/product-starter/internal-sdk.mjs'], { cwd: f.root });
  await mkdir(join(f.root, 'assets/product-starter/node_modules/unknown'), { recursive: true });
  await writeFile(join(f.root, 'assets/product-starter/node_modules/unknown/package.json'), '{}');
  const built = await buildInstaller({ sourceRoot: f.root });
  assert.equal(built.payloadFiles, PAYLOAD_FILES.length);
  const result = await checkInstallerPackage(f);
  assert.equal(result.status, 'passed');
  assert.equal(result.runtimeDependencies, 0);
  const files = readTarball(await readFile(result.tarball));
  const pkg = JSON.parse(files.get('package.json').bytes);
  assert.equal(pkg.name, '@tansr/skill');
  assert.equal(pkg.private, undefined);
  assert.equal(pkg.scripts, undefined);
  assert.equal(files.has(BUILD_RECEIPT), false);
  assert.ok(![...files].some(([path, file]) => /node_modules|internal-sdk|\.env$|^doc\//.test(path) || file.bytes.includes('synthetic-sensitive-fixture-only')));
  for (const path of PAYLOAD_FILES) assert.ok(files.get(`skill/${payloadSourcePath(path)}`)?.bytes.equals(await readFile(join(f.root, path))), path);
  assert.equal(result.npmExtractionVerified, true);
  const second = await buildInstaller({ sourceRoot: f.root });
  assert.equal(second.manifestSha256, built.manifestSha256);
  const packedAgain = await checkInstallerPackage(f);
  assert.equal(packedAgain.integrity, result.integrity);
});

test('untracked required source and broken packaged reference fail before creating dist', async t => {
  const f = await fixture(t);
  execFileSync('git', ['rm', '--cached', '--', 'scripts/doctor.mjs'], { cwd: f.root });
  await assert.rejects(buildInstaller({ sourceRoot: f.root }), /Git-tracked/);
  await assert.rejects(readFile(join(f.packageDir, 'package.json')), { code: 'ENOENT' });
  execFileSync('git', ['add', '--', 'scripts/doctor.mjs'], { cwd: f.root });
  await writeFile(join(f.root, 'SKILL.md'), '# Skill\n[missing](references/unbundled.md)\n');
  await assert.rejects(buildInstaller({ sourceRoot: f.root }), /Missing packaged local reference/);
});

test('hard-linked source and linked source parent cannot be packaged', async t => {
  const f = await fixture(t);
  const source = join(f.root, 'assets/feedback-starter/feedback.json');
  const alias = join(f.temporary, 'source-alias.json');
  await link(source, alias);
  try { await assert.rejects(buildInstaller({ sourceRoot: f.root }), /linked package path|redirected package path/); }
  finally { await unlink(alias); }
  const external = join(f.temporary, 'external-assets');
  await mkdir(external);
  const path = join(f.root, 'agents');
  // This fixture owns these files. Keep the external target explicit for cleanup.
  await unlink(join(path, 'openai.yaml'));
  await rmdir(path);
  await writeFile(join(external, 'openai.yaml'), 'synthetic');
  await symlink(external, path, process.platform === 'win32' ? 'junction' : 'dir');
  try { await assert.rejects(buildInstaller({ sourceRoot: f.root }), /linked package path|redirected package path/); }
  finally { await unlink(path); }
  assert.equal(await readFile(join(external, 'openai.yaml'), 'utf8'), 'synthetic');
});

test('build preserves unknown existing output and modified generated content', async t => {
  const f = await fixture(t);
  await mkdir(f.packageDir, { recursive: true });
  await writeFile(join(f.packageDir, 'keep.txt'), 'user-owned');
  await assert.rejects(buildInstaller({ sourceRoot: f.root }), /not an owned/);
  assert.equal(await readFile(join(f.packageDir, 'keep.txt'), 'utf8'), 'user-owned');
  await unlink(join(f.packageDir, 'keep.txt'));
  await rmdir(f.packageDir);
  await buildInstaller({ sourceRoot: f.root });
  await mkdir(join(f.packageDir, 'user-empty-directory'));
  await assert.rejects(buildInstaller({ sourceRoot: f.root }), /Unexpected empty generated/);
  await rmdir(join(f.packageDir, 'user-empty-directory'));
  await writeFile(join(f.packageDir, 'skill/SKILL.md'), 'user modification');
  await assert.rejects(buildInstaller({ sourceRoot: f.root }), /modified/);
  assert.equal(await readFile(join(f.packageDir, 'skill/SKILL.md'), 'utf8'), 'user modification');
  await assert.rejects(buildInstaller({ sourceRoot: f.root, outputDir: f.root }), /child of the source dist/);
});

test('a credential value accidentally placed in a tracked env template blocks publication without echoing it', async t => {
  const f = await fixture(t);
  const synthetic = 'SYNTHETIC_DO_NOT_PUBLISH_123456789';
  await writeFile(join(f.root, 'assets/feedback-starter/.env.example'), `MODEL_API_KEY=${synthetic}\n`);
  await assert.rejects(buildInstaller({ sourceRoot: f.root }), error => {
    assert.match(error.message, /credential must be empty or a placeholder/);
    assert.equal(error.message.includes(synthetic), false);
    return true;
  });
  await assert.rejects(readFile(join(f.packageDir, 'package.json')), { code: 'ENOENT' });
});

test('new tracked installer modules cannot silently expand the public package', async t => {
  const f = await fixture(t);
  await writeFile(join(f.root, 'installer/internal.mjs'), 'export const internalOnly = true;\n');
  execFileSync('git', ['add', '--', 'installer/internal.mjs'], { cwd: f.root });
  await assert.rejects(buildInstaller({ sourceRoot: f.root }), /explicit public module list/);
  await assert.rejects(readFile(join(f.packageDir, 'package.json')), { code: 'ENOENT' });
});

test('release and shipped template/runtime versions must match the compatibility facts', async t => {
  const f = await fixture(t);
  await writeFile(join(f.root, 'release.json'), JSON.stringify({ ...release, skillVersion: '0.2.0' }));
  await assert.rejects(buildInstaller({ sourceRoot: f.root }), /skill version differs/);
  await writeFile(join(f.root, 'release.json'), JSON.stringify({ ...release, runtimeBaselines: [] }));
  await assert.rejects(buildInstaller({ sourceRoot: f.root }), /template\/runtime versions differ/);
  await writeFile(join(f.root, 'release.json'), JSON.stringify(release));
  const pkgPath = join(f.root, 'assets/product-starter/package.json');
  const pkg = JSON.parse(await readFile(pkgPath, 'utf8'));
  pkg.version = '0.2.0';
  await writeFile(pkgPath, JSON.stringify(pkg));
  await assert.rejects(buildInstaller({ sourceRoot: f.root }), /Template package differs/);
});

test('actual tarball auditor rejects corruption, undeclared secrets, scripts and missing hidden configuration', async t => {
  const f = await fixture(t);
  await buildInstaller({ sourceRoot: f.root });
  const packed = await checkInstallerPackage(f);
  const original = readTarball(await readFile(packed.tarball));
  async function hostile(name, change, pattern) {
    const entries = [...original].map(([path, file]) => ({ path: `package/${path}`, bytes: Buffer.from(file.bytes), mode: file.mode }));
    change(entries);
    const path = join(f.temporary, `${name}.tgz`);
    await writeFile(path, tarball(entries));
    await assert.rejects(auditTarball(path), pattern);
  }
  await hostile('changed', entries => { entries.find(file => file.path === 'package/skill/SKILL.md').bytes = Buffer.from('corrupt'); }, /integrity mismatch/);
  await hostile('hidden-missing', entries => { entries.splice(entries.findIndex(file => file.path.endsWith('/.env.example')), 1); }, /Missing packaged file/);
  await hostile('unexpected', entries => { entries.push({ path: 'package/skill/assets/private.env', bytes: Buffer.from('fixture'), mode: 0o644 }); }, /Unexpected packaged content/);
  await hostile('lifecycle', entries => {
    const entry = entries.find(file => file.path === 'package/package.json');
    const pkg = JSON.parse(entry.bytes); pkg.scripts = { postinstall: 'must-not-run' }; entry.bytes = Buffer.from(JSON.stringify(pkg));
  }, /Unexpected installer package field: scripts/);
});

test('read-only tar reader rejects traversal, duplicates, symlinks, hardlinks and truncation', () => {
  const content = Buffer.from('fixture');
  for (const path of ['package/../escape', 'package/C:/escape', 'package/a\\b', 'other/file', 'package/CON']) {
    assert.throws(() => readTarball(tarball([{ path, bytes: content }])), /Unsafe package path|outside package/);
  }
  for (const type of ['1', '2', '5']) assert.throws(() => readTarball(tarball([{ path: 'package/link', bytes: content, type }])), /non-regular/);
  assert.throws(() => readTarball(tarball([{ path: 'package/a', bytes: content }, { path: 'package/a', bytes: content }])), /Duplicate/);
  assert.throws(() => readTarball(Buffer.from('not gzip')));
});
