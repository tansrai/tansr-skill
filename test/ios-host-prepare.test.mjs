import test from 'node:test';
import assert from 'node:assert/strict';
import { copyFile, lstat, mkdir, mkdtemp, readFile, readdir, realpath, rm, symlink, unlink, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const asset = new URL('../assets/ios-app-host/', import.meta.url);
const digest = data => ({ bytes: Buffer.byteLength(data), sha256: createHash('sha256').update(data).digest('hex') });

async function fixture(t) {
  const temp = await realpath(tmpdir());
  const root = await mkdtemp(join(temp, 'tansr-ios-prepare-test-'));
  t.after(async () => {
    const checked = resolve(root);
    assert.equal(relative(temp, checked), basename(checked));
    assert.ok(basename(checked).startsWith('tansr-ios-prepare-test-'));
    await rm(checked, { recursive: true, force: true });
  });
  const helper = join(root, 'asset');
  const demo = join(root, 'iOS 示例');
  await mkdir(helper);
  await mkdir(demo);
  await copyFile(new URL('prepare.mjs', asset), join(helper, 'prepare.mjs'));
  const provenance = JSON.parse(await readFile(new URL('provenance.json', asset), 'utf8'));
  const repairs = JSON.parse(await readFile(new URL('demo-repairs.json', asset), 'utf8'));
  // Small synthetic public-tree input checks the filesystem contract. The real
  // ZIP and the three full public Swift files are covered by the archived rehearsal.
  const fakeZipHash = '1'.repeat(64);
  provenance.publicDemo.sha256 = fakeZipHash;
  repairs.sourceZipSha256 = fakeZipHash;
  for (const entry of provenance.hostFiles) {
    const target = join(helper, 'host', entry.path);
    await mkdir(dirname(target), { recursive: true });
    await copyFile(new URL(`host/${entry.path}`, asset), target);
  }
  const originals = new Map([
    ['LICENSE', 'Synthetic license retained\n'],
    ['SDK/tansr-sdk/SDK-RELEASE.json', JSON.stringify({ sdkVersion: provenance.sdk.version, releaseRevision: provenance.sdk.revision })],
    ['SDK/tansr-sdk/Artifacts/TansrCore.xcframework.zip', 'Synthetic binary fixture; never compiled\n'],
    ['README.md', 'Synthetic complete public tree fixture\n'],
  ]);
  for (const entry of repairs.files) {
    const before = `// Synthetic Swift patch fixture\n${entry.replacements.map(change => change.before).join('\n// Next exact source location\n')}\n`.replace(/\n/g, '\r\n');
    const after = entry.replacements.reduce((text, change) => text.replace(change.before, change.after), before.replace(/\r\n/g, '\n'));
    entry.before = digest(before);
    entry.after = digest(after);
    originals.set(entry.path, before);
  }
  for (const [path, data] of originals) {
    await mkdir(dirname(join(demo, path)), { recursive: true });
    await writeFile(join(demo, path), data);
  }
  const publicManifest = {
    schemaVersion: 1, sourceZipSha256: fakeZipHash,
    files: [...originals].map(([path, data]) => ({ path, ...digest(data) })),
  };
  for (const [name, data] of [['provenance.json', provenance], ['public-demo-files.json', publicManifest], ['demo-repairs.json', repairs]]) {
    await writeFile(join(helper, name), JSON.stringify(data));
  }
  const run = (args = ['--demo', demo]) => spawnSync(process.execPath, [join(helper, 'prepare.mjs'), ...args], { cwd: root, encoding: 'utf8', timeout: 10_000 });
  return { root, helper, demo, repairs, provenance, originals, run };
}

async function snapshot(root, prefix = '') {
  const result = {};
  for (const entry of await readdir(join(root, prefix), { withFileTypes: true })) {
    const name = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) Object.assign(result, await snapshot(root, name));
    else {
      assert.ok(entry.isFile());
      result[name] = digest(await readFile(join(root, name))).sha256;
    }
  }
  return result;
}

test('check is read-only; fresh host generation applies three exact CRLF file repairs and preserves SDK/license', async t => {
  const f = await fixture(t);
  const before = await snapshot(f.demo);
  const checked = f.run(['--demo', f.demo, '--check']);
  assert.equal(checked.status, 0, checked.stderr);
  assert.equal(JSON.parse(checked.stdout).repairFiles, 3);
  assert.deepEqual(await snapshot(f.demo), before);
  const prepared = f.run();
  assert.equal(prepared.status, 0, prepared.stderr);
  assert.equal(JSON.parse(prepared.stdout).consumerRepairs.length, 3);
  const after = await snapshot(f.demo);
  assert.deepEqual(Object.keys(before).filter(path => before[path] !== after[path]), f.repairs.files.map(({ path }) => path));
  for (const entry of f.repairs.files) {
    const data = await readFile(join(f.demo, entry.path));
    assert.deepEqual(digest(data), entry.after);
    assert.ok(!data.toString('utf8').includes('\r\n'));
  }
  assert.equal(Object.keys(after).length - Object.keys(before).length, f.provenance.hostFiles.length + 1);
  const receipt = JSON.parse(await readFile(join(f.demo, 'App', 'PREPARATION.json'), 'utf8'));
  assert.deepEqual(receipt.consumerRepairs, f.repairs.files.map(({ path, before, after }) => ({ path, before, after })));
  const repeated = f.run();
  assert.equal(repeated.status, 1);
  assert.match(repeated.stderr, /App already exists/);
  assert.deepEqual(await snapshot(f.demo), after);
});

for (const failure of ['modified Swift', 'missing Swift', 'modified SDK']) {
  test(`${failure} is refused with no App or other writes`, async t => {
    const f = await fixture(t);
    const file = join(f.demo, failure === 'modified SDK' ? 'SDK/tansr-sdk/Artifacts/TansrCore.xcframework.zip' : f.repairs.files[0].path);
    if (failure === 'missing Swift') await unlink(file);
    else await writeFile(file, 'Preserve this user modification\n');
    const before = await snapshot(f.demo);
    const result = f.run();
    assert.equal(result.status, 1);
    assert.match(result.stderr, /integrity mismatch|missing or extra/);
    assert.deepEqual(await snapshot(f.demo), before);
    await assert.rejects(lstat(join(f.demo, 'App')), { code: 'ENOENT' });
  });
}

test('invalid second output and a path escape fail before creating App or changing the first source', async t => {
  const f = await fixture(t);
  const before = await snapshot(f.demo);
  const broken = JSON.parse(JSON.stringify(f.repairs));
  broken.files[1].after.sha256 = '0'.repeat(64);
  await writeFile(join(f.helper, 'demo-repairs.json'), JSON.stringify(broken));
  const result = f.run();
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Repair output integrity mismatch/);
  assert.deepEqual(await snapshot(f.demo), before);
  broken.files[1].path = '../outside.swift';
  await writeFile(join(f.helper, 'demo-repairs.json'), JSON.stringify(broken));
  const escaped = f.run();
  assert.equal(escaped.status, 1);
  assert.match(escaped.stderr, /Invalid iOS consumer repair manifest/);
  assert.deepEqual(await snapshot(f.demo), before);
});

test('a later exact edit missing or ambiguous in ChatScreen refuses all three file writes', async t => {
  const f = await fixture(t);
  const before = await snapshot(f.demo);
  for (const text of ['This location does not exist in the pinned source', '\n']) {
    const broken = JSON.parse(JSON.stringify(f.repairs));
    const chat = broken.files.find(entry => entry.path.endsWith('/ChatScreen.swift'));
    assert.equal(chat.replacements.length, 3);
    chat.replacements[2].before = text;
    await writeFile(join(f.helper, 'demo-repairs.json'), JSON.stringify(broken));
    const result = f.run();
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Expected one exact repair location: Sources\/OrderAssistant\/ChatScreen.swift/);
    assert.deepEqual(await snapshot(f.demo), before);
    await assert.rejects(lstat(join(f.demo, 'App')), { code: 'ENOENT' });
  }
});

test('a bad final file output cannot partially apply already prepared earlier file repairs', async t => {
  const f = await fixture(t);
  const before = await snapshot(f.demo);
  const broken = JSON.parse(JSON.stringify(f.repairs));
  broken.files.at(-1).after.sha256 = '0'.repeat(64);
  await writeFile(join(f.helper, 'demo-repairs.json'), JSON.stringify(broken));
  const result = f.run();
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Repair output integrity mismatch/);
  assert.deepEqual(await snapshot(f.demo), before);
  await assert.rejects(lstat(join(f.demo, 'App')), { code: 'ENOENT' });
});

test('existing App and user contents are never overwritten', async t => {
  const f = await fixture(t);
  await mkdir(join(f.demo, 'App'));
  await writeFile(join(f.demo, 'App', 'notes.txt'), 'User work\n');
  const before = await snapshot(f.demo);
  const result = f.run();
  assert.equal(result.status, 1);
  assert.match(result.stderr, /App already exists/);
  assert.deepEqual(await snapshot(f.demo), before);
});

test('linked root, ancestor and source directory are refused without changing their targets', async t => {
  const f = await fixture(t);
  const before = await snapshot(f.demo);
  for (const kind of ['root', 'ancestor']) {
    const alias = join(f.root, `linked-${kind}`);
    await symlink(kind === 'root' ? f.demo : f.root, alias, process.platform === 'win32' ? 'junction' : 'dir');
    try {
      const target = kind === 'root' ? alias : join(alias, basename(f.demo));
      const result = f.run(['--demo', target]);
      assert.equal(result.status, 1);
      assert.match(result.stderr, /real directory/);
      assert.deepEqual(await snapshot(f.demo), before);
    } finally { await unlink(alias); }
  }
  const outside = join(f.root, 'outside');
  await mkdir(outside);
  await writeFile(join(outside, 'keep.txt'), 'User work\n');
  const linked = join(f.demo, 'linked-source');
  await symlink(outside, linked, process.platform === 'win32' ? 'junction' : 'dir');
  try {
    const result = f.run();
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Linked entry/);
    assert.equal(await readFile(join(outside, 'keep.txt'), 'utf8'), 'User work\n');
  } finally { await unlink(linked); }
  assert.deepEqual(await snapshot(f.demo), before);
});

test('relative target and damaged host assets fail before any public file changes', async t => {
  const f = await fixture(t);
  const before = await snapshot(f.demo);
  const relativeResult = f.run(['--demo', 'relative']);
  assert.equal(relativeResult.status, 1);
  assert.match(relativeResult.stderr, /absolute path/);
  await writeFile(join(f.helper, 'host', f.provenance.hostFiles[0].path), 'Unverified host content');
  const result = f.run();
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Host integrity mismatch/);
  assert.deepEqual(await snapshot(f.demo), before);
});
