import test from 'node:test';
import assert from 'node:assert/strict';
import { copyFile, link, lstat, mkdir, mkdtemp, readFile, readdir, realpath, rm, rmdir, symlink, unlink, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const scriptUrl = new URL('../scripts/prepare-demo.mjs', import.meta.url);
const repairs = Object.fromEntries(await Promise.all(['electron', 'android'].map(async demo => [
  demo, JSON.parse(await readFile(new URL(`../assets/demo-repairs/${demo}.json`, import.meta.url), 'utf8')),
])));
const digest = bytes => ({ sha256: createHash('sha256').update(bytes).digest('hex'), bytes: Buffer.byteLength(bytes) });

// The engine is exercised through its actual CLI with a small synthetic,
// independently hashed manifest. The official whole-file preimage is verified
// separately by the public-ZIP consumption rehearsal, not bundled into tests.
async function fixture(t, demoName = 'electron') {
  const group = repairs[demoName];
  const repair = group.files?.[0] ?? group;
  const temp = await realpath(tmpdir());
  const root = await mkdtemp(join(temp, 'tansr-prepare-demo-test-'));
  t.after(async () => {
    const checked = resolve(root);
    assert.equal(relative(temp, checked), basename(checked));
    assert.ok(basename(checked).startsWith('tansr-prepare-demo-test-'));
    await rm(checked, { recursive: true, force: true });
  });
  const skill = join(root, 'skill');
  const demo = join(root, '公开 demo');
  await mkdir(join(skill, 'scripts'), { recursive: true });
  await mkdir(join(skill, 'assets', 'demo-repairs'), { recursive: true });
  const file = join(demo, repair.target);
  await mkdir(dirname(file), { recursive: true });
  const script = join(skill, 'scripts', 'prepare-demo.mjs');
  await copyFile(scriptUrl, script);
  const replacements = repair.replacements ?? [repair.replacement];
  let before = demoName === 'electron'
    ? `// Synthetic test renderer\nfunction render(part, card, el) {\n${repair.replacement.before}  return card;\n}\n`
    : '// Synthetic Android source\r\nimport android.os.Bundle\r\nimport androidx.compose.foundation.layout.padding\r\nimport androidx.lifecycle.Lifecycle\r\nimport androidx.lifecycle.LifecycleEventObserver\r\n        super.onCreate(savedInstanceState)\r\n                Surface(modifier = Modifier.fillMaxSize()) {\r\n                    Column {\r\n';
  let after = before;
  for (const replacement of replacements) {
    if (!after.includes(replacement.before)) {
      const location = `// Next synthetic source location\r\n${replacement.before}\r\n`;
      before += location;
      after += location;
    }
    after = after.replace(replacement.before, replacement.after);
  }
  const manifest = JSON.parse(JSON.stringify(group));
  manifest.source = { description: 'Synthetic offline test fixture; not the public Demo' };
  const primaryManifest = manifest.files?.[0] ?? manifest;
  primaryManifest.before = digest(before);
  primaryManifest.after = digest(after);
  const knownInputs = [];
  for (const upgrade of primaryManifest.upgrades ?? []) {
    const priorEdits = replacements.slice(0, replacements.length - upgrade.replacements.length);
    const known = priorEdits.reduce((text, replacement) => text.replace(replacement.before, replacement.after), before);
    assert.equal(upgrade.replacements.reduce((text, replacement) => text.replace(replacement.before, replacement.after), known), after);
    upgrade.before = digest(known);
    knownInputs.push(known);
  }
  const files = [{ file, target: repair.target, before, after, knownInputs }];
  for (const extra of manifest.files?.slice(1) ?? []) {
    if (extra.before === null) {
      extra.content = '// Synthetic history adapter, not Android product code\n';
      extra.after = digest(extra.content);
      files.push({ file: join(demo, extra.target), target: extra.target, before: null, after: extra.content });
      continue;
    }
    const before = `// Synthetic second Android source\r\n${extra.replacements.map(({ before }) => before).join('\r\n// Next exact source location\r\n')}\r\n`;
    const after = extra.replacements.reduce((text, replacement) => text.replace(replacement.before, replacement.after), before);
    extra.before = digest(before);
    extra.after = digest(after);
    const file = join(demo, extra.target);
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, before);
    files.push({ file, target: extra.target, before, after });
  }
  const manifestPath = join(skill, 'assets', 'demo-repairs', `${demoName}.json`);
  await writeFile(manifestPath, JSON.stringify(manifest));
  await writeFile(file, before);
  await writeFile(join(demo, 'package-lock.json'), '{"locked":"synthetic"}\n');
  await writeFile(join(demo, 'LICENSE'), 'Synthetic license to preserve\n');
  await writeFile(join(demo, 'user-draft.txt'), 'Unrelated user work\n');
  const run = (args = [demoName, demo]) => spawnSync(process.execPath, [script, ...args], {
    cwd: root, encoding: 'utf8', timeout: 10_000,
  });
  return { root, skill, demo, file, manifestPath, manifest, before, after, files, run };
}

async function snapshot(root, prefix = '') {
  const result = {};
  for (const entry of await readdir(join(root, prefix), { withFileTypes: true })) {
    const name = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) Object.assign(result, await snapshot(root, name));
    else {
      assert.ok(entry.isFile(), 'snapshot only reads known regular fixture files');
      result[name] = digest(await readFile(join(root, name))).sha256;
    }
  }
  return result;
}

// Keep engine fault tests independent of the real Kotlin adapter contents.
async function historyFixture(t) {
  const f = await fixture(t, 'android');
  return { ...f, added: f.files[2] };
}

function assertIdentity(actual, expected) {
  for (const key of ['ino', 'mtimeMs', 'ctimeMs']) assert.equal(actual[key], expected[key], key);
}

test('offline CLI repairs exactly the pinned renderer and is byte/metadata idempotent', async t => {
  const f = await fixture(t);
  const before = await snapshot(f.demo);
  const result = f.run();
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).status, 'prepared');
  assert.equal(await readFile(f.file, 'utf8'), f.after);
  const after = await snapshot(f.demo);
  assert.deepEqual(Object.keys(after).filter(name => after[name] !== before[name]), ['renderer/renderer.js']);
  assert.deepEqual(Object.keys(after), Object.keys(before));
  const stat = await lstat(f.file);
  const repeat = f.run();
  assert.equal(repeat.status, 0, repeat.stderr);
  assert.equal(JSON.parse(repeat.stdout).status, 'already-prepared');
  assert.equal(JSON.parse(repeat.stdout).changed, false);
  const repeatedStat = await lstat(f.file);
  assert.equal(repeatedStat.ino, stat.ino);
  assert.equal(repeatedStat.mtimeMs, stat.mtimeMs);
  assert.equal(repeatedStat.ctimeMs, stat.ctimeMs);
  assert.deepEqual(await snapshot(f.demo), after);
});

test('unknown and user-modified inputs are refused with no directory writes', async t => {
  const f = await fixture(t);
  for (const text of ['unrecognized renderer\n', `${f.before}// User edit\n`, `${f.after}// User edit\n`]) {
    await writeFile(f.file, text);
    const before = await snapshot(f.demo);
    const stat = await lstat(f.file);
    const directoryStat = await lstat(join(f.demo, 'renderer'));
    const result = f.run();
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Unknown or user-modified/);
    assert.deepEqual(await snapshot(f.demo), before);
    assert.equal((await lstat(f.file)).mtimeMs, stat.mtimeMs);
    assert.equal((await lstat(join(f.demo, 'renderer'))).mtimeMs, directoryStat.mtimeMs);
  }
});

for (const location of ['ancestor', 'demo-root', 'renderer-directory']) {
  test(`linked ${location} is refused before writing through its target`, async t => {
    const f = await fixture(t);
    const alias = join(f.root, 'linked');
    let destination;
    let target;
    if (location === 'ancestor') { destination = f.root; target = join(alias, basename(f.demo)); }
    else if (location === 'demo-root') { destination = f.demo; target = alias; }
    else {
      destination = join(f.demo, 'renderer');
      target = join(f.root, 'linked-renderer-demo');
      await mkdir(target);
    }
    const linked = location === 'renderer-directory' ? join(target, 'renderer') : alias;
    await symlink(destination, linked, process.platform === 'win32' ? 'junction' : 'dir');
    try {
      const before = await snapshot(f.demo);
      const result = f.run(['electron', target]);
      assert.equal(result.status, 1);
      assert.match(result.stderr, /link|junction|redirected/);
      assert.deepEqual(await snapshot(f.demo), before);
    } finally { await unlink(linked); }
  });
}

test('multiply linked renderer is refused and both names retain their bytes', async t => {
  const f = await fixture(t);
  const other = join(f.root, 'kept-renderer.js');
  await link(f.file, other);
  const result = f.run();
  assert.equal(result.status, 1);
  assert.match(result.stderr, /regular, unlinked/);
  assert.equal(await readFile(f.file, 'utf8'), f.before);
  assert.equal(await readFile(other, 'utf8'), f.before);
  assert.deepEqual(await readdir(join(f.demo, 'renderer')), ['renderer.js']);
});

test('manifest path escape, duplicate patch, and wrong output digest fail before any target writes', async t => {
  const f = await fixture(t);
  const initial = await snapshot(f.demo);
  const escaped = { ...f.manifest, target: '../user-draft.txt' };
  await writeFile(f.manifestPath, JSON.stringify(escaped));
  assert.match(f.run().stderr, /Invalid bundled/);
  assert.deepEqual(await snapshot(f.demo), initial);
  const badOutput = JSON.parse(JSON.stringify(f.manifest));
  badOutput.after.sha256 = '0'.repeat(64);
  await writeFile(f.manifestPath, JSON.stringify(badOutput));
  const wrong = f.run();
  assert.equal(wrong.status, 1);
  assert.match(wrong.stderr, /verified output/);
  assert.deepEqual(await snapshot(f.demo), initial);
  const duplicatedText = f.before + f.before;
  await writeFile(f.file, duplicatedText);
  const duplicated = JSON.parse(JSON.stringify(f.manifest));
  duplicated.before = digest(duplicatedText);
  await writeFile(f.manifestPath, JSON.stringify(duplicated));
  const before = await snapshot(f.demo);
  const duplicateResult = f.run();
  assert.equal(duplicateResult.status, 1);
  assert.match(duplicateResult.stderr, /exactly one repair location/);
  assert.deepEqual(await snapshot(f.demo), before);
});

test('relative path, unavailable Demo, extra flags and help never mutate the target', async t => {
  const f = await fixture(t);
  const before = await snapshot(f.demo);
  for (const args of [['electron', `.${sep}relative`], ['ios', f.demo], ['electron', f.demo, '--force']]) {
    const result = f.run(args);
    assert.equal(result.status, 1, result.stdout);
    assert.deepEqual(await snapshot(f.demo), before);
  }
  const help = f.run(['--help']);
  assert.equal(help.status, 0);
  assert.match(help.stdout, /Offline/);
  assert.deepEqual(await snapshot(f.demo), before);
});

test('Android applies all three exact files, preserves declared line endings and repeats without writes', async t => {
  const f = await fixture(t, 'android');
  const before = await snapshot(f.demo);
  const result = f.run();
  assert.equal(result.status, 0, result.stderr);
  const receipt = JSON.parse(result.stdout);
  assert.equal(receipt.demo, 'android');
  assert.equal(receipt.status, 'prepared');
  assert.equal(receipt.files.length, 3);
  for (const [index, file] of f.files.entries()) {
    assert.equal(receipt.files[index].afterSha256, digest(file.after).sha256);
    const bytes = await readFile(file.file);
    assert.equal(bytes.toString('utf8'), file.after);
    if (file.before !== null) assert.equal(bytes.toString('utf8').replaceAll('\r\n', '').includes('\n'), false);
    else assert.equal(bytes.toString('utf8').includes('\r'), false);
  }
  assert.equal((await readFile(f.file, 'utf8')).split('import androidx.lifecycle.LifecycleEventObserver\r\n').length, 2);
  const after = await snapshot(f.demo);
  assert.deepEqual(Object.keys(after).filter(name => after[name] !== before[name]).sort(), f.files.map(({ target }) => target).sort());
  assert.deepEqual(Object.keys(after).filter(name => !(name in before)), [f.files[2].target]);
  const stats = await Promise.all(f.files.map(({ file }) => lstat(file)));
  const repeat = f.run();
  assert.equal(repeat.status, 0, repeat.stderr);
  assert.equal(JSON.parse(repeat.stdout).status, 'already-prepared');
  for (const [index, { file }] of f.files.entries()) {
    const repeatedStat = await lstat(file), stat = stats[index];
    assert.equal(repeatedStat.ino, stat.ino);
    assert.equal(repeatedStat.mtimeMs, stat.mtimeMs);
    assert.equal(repeatedStat.ctimeMs, stat.ctimeMs);
  }
  assert.deepEqual(await snapshot(f.demo), after);
});

test('Android unknown, user-modified and EOL-converted sources are refused without writes', async t => {
  const f = await fixture(t, 'android');
  for (const text of ['unknown Activity\r\n', `${f.before}// User edit\r\n`, `${f.after}// User edit\r\n`, f.before.replaceAll('\r\n', '\n')]) {
    await writeFile(f.file, text);
    const before = await snapshot(f.demo);
    const directoryStat = await lstat(dirname(f.file));
    const result = f.run();
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Unknown or user-modified/);
    assert.deepEqual(await snapshot(f.demo), before);
    assert.equal((await lstat(dirname(f.file))).mtimeMs, directoryStat.mtimeMs);
  }
});

for (const location of ['ancestor', 'demo-root', 'nested-source-directory']) {
  test(`Android linked ${location} is refused before changing its target`, async t => {
    const f = await fixture(t, 'android');
    const alias = join(f.root, 'android-linked');
    const target = location === 'ancestor' ? join(alias, basename(f.demo)) : alias;
    let linked = alias;
    let destination = location === 'ancestor' ? f.root : f.demo;
    if (location === 'nested-source-directory') {
      linked = join(target, 'sample', 'src', 'main');
      destination = join(f.demo, 'sample', 'src', 'main');
      await mkdir(dirname(linked), { recursive: true });
    }
    await symlink(destination, linked, process.platform === 'win32' ? 'junction' : 'dir');
    try {
      const before = await snapshot(f.demo);
      const result = f.run(['android', target]);
      assert.equal(result.status, 1);
      assert.match(result.stderr, /link|junction|redirected/);
      assert.deepEqual(await snapshot(f.demo), before);
    } finally { await unlink(linked); }
  });
}

test('Android hard-linked Activity is refused and both names retain their bytes', async t => {
  const f = await fixture(t, 'android');
  const other = join(f.root, 'kept-Activity.kt');
  await link(f.file, other);
  const result = f.run();
  assert.equal(result.status, 1);
  assert.match(result.stderr, /regular, unlinked/);
  assert.equal(await readFile(f.file, 'utf8'), f.before);
  assert.equal(await readFile(other, 'utf8'), f.before);
  assert.deepEqual((await readdir(dirname(f.file))).sort(), ['DemoMediaPreview.kt', 'OrderAssistantActivity.kt']);
});

test('Android later missing or ambiguous edits and wrong final hash leave the entire source untouched', async t => {
  const f = await fixture(t, 'android');
  const initial = await snapshot(f.demo);
  for (const before of ['missing fourth edit', '\r\n']) {
    const bad = JSON.parse(JSON.stringify(f.manifest));
    bad.files[0].replacements[3].before = before;
    await writeFile(f.manifestPath, JSON.stringify(bad));
    const result = f.run();
    assert.equal(result.status, 1);
    assert.match(result.stderr, /exactly one repair location/);
    assert.deepEqual(await snapshot(f.demo), initial);
  }
  const wrongHash = JSON.parse(JSON.stringify(f.manifest));
  wrongHash.files[0].after.sha256 = '0'.repeat(64);
  await writeFile(f.manifestPath, JSON.stringify(wrongHash));
  const result = f.run();
  assert.equal(result.status, 1);
  assert.match(result.stderr, /verified output/);
  assert.deepEqual(await snapshot(f.demo), initial);
});

test('Android selector refuses escaped or cross-platform manifests and accepts no external patch flag', async t => {
  const f = await fixture(t, 'android');
  const before = await snapshot(f.demo);
  for (const mutation of [{ target: '../user-draft.txt' }, { target: repairs.electron.target }, { replacement: f.manifest.files[0].replacements[0] }]) {
    const manifest = JSON.parse(JSON.stringify(f.manifest));
    Object.assign(manifest.files[0], mutation);
    await writeFile(f.manifestPath, JSON.stringify(manifest));
    const result = f.run();
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Invalid bundled Android/);
    assert.deepEqual(await snapshot(f.demo), before);
  }
  const extra = f.run(['android', f.demo, '--manifest', f.manifestPath]);
  assert.equal(extra.status, 1);
  assert.deepEqual(await snapshot(f.demo), before);
});

test('Android second-file unknown or modified bytes reject the whole set before any directory writes', async t => {
  const f = await fixture(t, 'android');
  const second = f.files[1];
  for (const text of ['Unknown media file\r\n', `${second.before}// User edit\r\n`, `${second.after}// User edit\r\n`, second.before.replaceAll('\r\n', '\n')]) {
    await writeFile(second.file, text);
    const before = await snapshot(f.demo), stat = await lstat(f.file), dirStat = await lstat(dirname(f.file));
    const result = f.run();
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Unknown or user-modified/);
    assert.deepEqual(await snapshot(f.demo), before);
    assert.equal((await lstat(f.file)).mtimeMs, stat.mtimeMs);
    assert.equal((await lstat(dirname(f.file))).mtimeMs, dirStat.mtimeMs);
  }
});

test('Android bad second output or patch leaves the already computed first output unwritten', async t => {
  const f = await fixture(t, 'android');
  const before = await snapshot(f.demo), dirStat = await lstat(dirname(f.file));
  for (const kind of ['bad-output', 'missing-edit']) {
    const manifest = JSON.parse(JSON.stringify(f.manifest));
    if (kind === 'bad-output') manifest.files[1].after.sha256 = '0'.repeat(64);
    else manifest.files[1].replacements[1].before = 'Absent caption anchor';
    await writeFile(f.manifestPath, JSON.stringify(manifest));
    const result = f.run();
    assert.equal(result.status, 1);
    assert.match(result.stderr, /verified output|exactly one repair location/);
    assert.deepEqual(await snapshot(f.demo), before);
    assert.equal((await lstat(dirname(f.file))).mtimeMs, dirStat.mtimeMs);
  }
});

test('Android missing or hard-linked second file cannot partially repair the first', async t => {
  const f = await fixture(t, 'android');
  const second = f.files[1], alias = join(f.root, 'kept-media.kt');
  await link(second.file, alias);
  let before = await snapshot(f.demo);
  const linked = f.run();
  assert.equal(linked.status, 1);
  assert.match(linked.stderr, /regular, unlinked/);
  assert.deepEqual(await snapshot(f.demo), before);
  assert.equal(await readFile(alias, 'utf8'), second.before);
  await unlink(alias);
  await unlink(second.file);
  before = await snapshot(f.demo);
  const missing = f.run();
  assert.equal(missing.status, 1);
  assert.deepEqual(await snapshot(f.demo), before);
});

test('Android exact final Activity is retained while media and the missing helper are prepared', async t => {
  const f = await fixture(t, 'android');
  await writeFile(f.file, f.after);
  const before = await snapshot(f.demo), stat = await lstat(f.file);
  const result = f.run();
  assert.equal(result.status, 0, result.stderr);
  const receipt = JSON.parse(result.stdout);
  assert.deepEqual(receipt.files.map(({ changed }) => changed), [false, true, true]);
  const after = await snapshot(f.demo);
  assert.deepEqual(Object.keys(after).filter(name => after[name] !== before[name]).sort(), [f.files[1].target, f.files[2].target].sort());
  assert.equal(await readFile(f.files[1].file, 'utf8'), f.files[1].after);
  const latest = await lstat(f.file);
  assert.equal(latest.ino, stat.ino);
  assert.equal(latest.mtimeMs, stat.mtimeMs);
  assert.equal(latest.ctimeMs, stat.ctimeMs);
});

test('Android exact old P05 and repaired P06 upgrade Activity and add the missing helper', async t => {
  const f = await fixture(t, 'android');
  await writeFile(f.file, f.files[0].knownInputs[0]);
  await writeFile(f.files[1].file, f.files[1].after);
  const before = await snapshot(f.demo), stat = await lstat(f.files[1].file);
  const result = f.run();
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout).files.map(({ changed }) => changed), [true, false, true]);
  assert.equal(await readFile(f.file, 'utf8'), f.after);
  const after = await snapshot(f.demo);
  assert.deepEqual(Object.keys(after).filter(name => after[name] !== before[name]).sort(), [f.files[0].target, f.files[2].target].sort());
  const current = await lstat(f.files[1].file);
  assert.equal(current.ino, stat.ino);
  assert.equal(current.mtimeMs, stat.mtimeMs);
  assert.equal(current.ctimeMs, stat.ctimeMs);
});

test('Android exact P05-only state receives all three final corrections', async t => {
  const f = await fixture(t, 'android');
  await writeFile(f.file, f.files[0].knownInputs[0]);
  const result = f.run();
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout).files.map(({ changed }) => changed), [true, true, true]);
  for (const file of f.files) assert.equal(await readFile(file.file, 'utf8'), file.after);
});

test('Android user edits to the old P05 state are refused without applying either repair', async t => {
  const f = await fixture(t, 'android');
  await writeFile(f.file, `${f.files[0].knownInputs[0]}// User edit\r\n`);
  const before = await snapshot(f.demo), dirStat = await lstat(dirname(f.file));
  const result = f.run();
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Unknown or user-modified/);
  assert.deepEqual(await snapshot(f.demo), before);
  assert.equal((await lstat(dirname(f.file))).mtimeMs, dirStat.mtimeMs);
});

test('Android bad second input or bad incremental output leaves the old P05 state unchanged', async t => {
  const f = await fixture(t, 'android');
  await writeFile(f.file, f.files[0].knownInputs[0]);
  await writeFile(f.files[1].file, `${f.files[1].before}// User edit\r\n`);
  let before = await snapshot(f.demo);
  assert.equal(f.run().status, 1);
  assert.deepEqual(await snapshot(f.demo), before);
  await writeFile(f.files[1].file, f.files[1].before);
  const manifest = JSON.parse(JSON.stringify(f.manifest));
  manifest.files[0].upgrades[0].replacements[0].after += '// Incorrect incremental output\r\n';
  await writeFile(f.manifestPath, JSON.stringify(manifest));
  before = await snapshot(f.demo);
  const result = f.run();
  assert.equal(result.status, 1);
  assert.match(result.stderr, /verified output/);
  assert.deepEqual(await snapshot(f.demo), before);
});

test('Android new-file repair creates only the pinned file and exact existing output is idempotent', async t => {
  const f = await historyFixture(t);
  const before = await snapshot(f.demo);
  const result = f.run();
  assert.equal(result.status, 0, result.stderr);
  const receipt = JSON.parse(result.stdout);
  assert.deepEqual(receipt.files.map(({ changed }) => changed), [true, true, true]);
  assert.equal(receipt.files[2].beforeSha256, null);
  for (const file of f.files) assert.equal(await readFile(file.file, 'utf8'), file.after);
  const after = await snapshot(f.demo);
  assert.deepEqual(Object.keys(after).filter(name => !(name in before)), [f.added.target]);
  assert.equal((await lstat(f.added.file)).nlink, 1);
  const stats = await Promise.all(f.files.map(({ file }) => lstat(file)));
  const repeat = f.run();
  assert.equal(repeat.status, 0, repeat.stderr);
  assert.equal(JSON.parse(repeat.stdout).status, 'already-prepared');
  for (const [index, { file }] of f.files.entries()) assertIdentity(await lstat(file), stats[index]);
  assert.deepEqual(await snapshot(f.demo), after);
  await writeFile(f.file, f.before);
  await writeFile(f.files[1].file, f.files[1].before);
  const mixed = f.run();
  assert.equal(mixed.status, 0, mixed.stderr);
  assert.deepEqual(JSON.parse(mixed.stdout).files.map(({ changed }) => changed), [true, true, false]);
  assertIdentity(await lstat(f.added.file), stats[2]);
});

test('Android new-file repair upgrades both exact known Activity states and preserves repaired media', async t => {
  const f = await historyFixture(t);
  await writeFile(f.files[1].file, f.files[1].after);
  const mediaStat = await lstat(f.files[1].file);
  for (const known of f.files[0].knownInputs) {
    await writeFile(f.file, known);
    const result = f.run();
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout).files.map(({ changed }) => changed), [true, false, true]);
    assert.equal(await readFile(f.file, 'utf8'), f.after);
    assert.equal(await readFile(f.added.file, 'utf8'), f.added.after);
    assertIdentity(await lstat(f.files[1].file), mediaStat);
    await unlink(f.added.file);
  }
});

test('Android new-file repair refuses unknown or user-edited existing files before any writes', async t => {
  const f = await historyFixture(t);
  for (const content of ['', 'User file\r\n', `${f.added.after}// User edit\r\n`, f.added.after.replaceAll('\n', '\r\n')]) {
    await writeFile(f.added.file, content);
    const before = await snapshot(f.demo), stat = await lstat(f.file), directory = await lstat(dirname(f.file));
    const result = f.run();
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Unknown or user-modified/);
    assert.deepEqual(await snapshot(f.demo), before);
    assertIdentity(await lstat(f.file), stat);
    assertIdentity(await lstat(dirname(f.file)), directory);
  }
});

test('Android new-file repair rejects a directory, linked path, or hard-linked final file without touching earlier files', async t => {
  const f = await historyFixture(t);
  const initial = await snapshot(f.demo);
  await mkdir(f.added.file);
  let result = f.run();
  assert.equal(result.status, 1);
  assert.match(result.stderr, /regular, unlinked/);
  await rmdir(f.added.file);
  const destination = join(f.root, 'kept-user-directory');
  await mkdir(destination);
  await writeFile(join(destination, 'user.txt'), 'User content');
  await symlink(destination, f.added.file, process.platform === 'win32' ? 'junction' : 'dir');
  try {
    result = f.run();
    assert.equal(result.status, 1);
    assert.match(result.stderr, /link|junction|redirected/);
    assert.equal(await readFile(join(destination, 'user.txt'), 'utf8'), 'User content');
  } finally { await unlink(f.added.file); }
  await writeFile(f.added.file, f.added.after);
  const alias = join(f.root, 'kept-adapter.kt');
  await link(f.added.file, alias);
  result = f.run();
  assert.equal(result.status, 1);
  assert.match(result.stderr, /regular, unlinked/);
  assert.equal(await readFile(alias, 'utf8'), f.added.after);
  await unlink(f.added.file);
  assert.deepEqual(await snapshot(f.demo), initial);
});

test('Android new-file repair validates pinned target, entire content and known inputs before writes', async t => {
  const f = await historyFixture(t);
  const before = await snapshot(f.demo), directory = await lstat(dirname(f.file));
  for (const kind of ['wrong-content', 'wrong-hash', 'escaped-target', 'patch-instead', 'duplicate-input']) {
    const manifest = JSON.parse(JSON.stringify(f.manifest));
    if (kind === 'wrong-content') manifest.files[2].content += 'Unexpected edit';
    if (kind === 'wrong-hash') manifest.files[2].after.sha256 = '0'.repeat(64);
    if (kind === 'escaped-target') manifest.files[2].target = '../user-draft.txt';
    if (kind === 'patch-instead') manifest.files[2].before = digest('');
    if (kind === 'duplicate-input') manifest.files[0].upgrades[1].before = manifest.files[0].before;
    await writeFile(f.manifestPath, JSON.stringify(manifest));
    const result = f.run();
    assert.equal(result.status, 1);
    assert.match(result.stderr, /verified output|Invalid bundled/);
    assert.deepEqual(await snapshot(f.demo), before);
    assertIdentity(await lstat(dirname(f.file)), directory);
  }
});

test('Android new-file repair leaves the new path absent when an earlier source is user-modified', async t => {
  const f = await historyFixture(t);
  await writeFile(f.file, f.files[0].knownInputs[1]);
  await writeFile(f.files[1].file, `${f.files[1].after}// User change\r\n`);
  const before = await snapshot(f.demo), directory = await lstat(dirname(f.file));
  const result = f.run();
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Unknown or user-modified/);
  assert.deepEqual(await snapshot(f.demo), before);
  await assert.rejects(lstat(f.added.file), { code: 'ENOENT' });
  assertIdentity(await lstat(dirname(f.file)), directory);
});

test('Android new-file repair cannot overwrite a path created after its final absence check', async t => {
  const f = await historyFixture(t);
  const preload = join(f.root, 'inject-creation-race.mjs');
  // Inject a competing writer at the actual publication syscall, without a
  // production test hook or timing-sensitive polling.
  await writeFile(preload, `import fs from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
const original = fs.link;
fs.link = async (source, target) => {
  await fs.writeFile(target, 'Concurrent user file\\r\\n', { flag: 'wx' });
  return original(source, target);
};
syncBuiltinESMExports();
`);
  const result = spawnSync(process.execPath, ['--import', pathToFileURL(preload).href, join(f.skill, 'scripts', 'prepare-demo.mjs'), 'android', f.demo], {
    cwd: f.root, encoding: 'utf8', timeout: 10_000,
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /stopped after replacing 2 file\(s\)/);
  assert.equal(await readFile(f.added.file, 'utf8'), 'Concurrent user file\r\n');
  assert.equal((await lstat(f.added.file)).nlink, 1);
  for (const file of f.files.slice(0, 2)) assert.equal(await readFile(file.file, 'utf8'), file.after);
  assert.equal((await readdir(dirname(f.file))).some(name => name.startsWith('.tansr-repair-')), false);
  const after = await snapshot(f.demo);
  assert.equal(f.run().status, 1);
  assert.deepEqual(await snapshot(f.demo), after);
});

test('Android publication cleanup failure preserves partial-state diagnostics and the recoverable owned path', async t => {
  const f = await historyFixture(t);
  const preload = join(f.root, 'inject-unlink-failure.mjs');
  await writeFile(preload, `import fs from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
const originalLink = fs.link;
const originalUnlink = fs.unlink;
let publishedTemporary;
fs.link = async (source, target) => {
  await originalLink(source, target);
  publishedTemporary = source;
};
fs.unlink = async path => {
  if (path === publishedTemporary) throw Object.assign(new Error('Injected persistent temporary unlink failure'), { code: 'EACCES' });
  return originalUnlink(path);
};
syncBuiltinESMExports();
`);
  const result = spawnSync(process.execPath, ['--import', pathToFileURL(preload).href, join(f.skill, 'scripts', 'prepare-demo.mjs'), 'android', f.demo], {
    cwd: f.root, encoding: 'utf8', timeout: 10_000,
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /stopped after replacing 3 file\(s\)/);
  assert.match(result.stderr, /cleanup failed/i);
  assert.match(result.stderr, /EACCES/);
  const temporaryNames = (await readdir(dirname(f.file))).filter(name => name.startsWith('.tansr-repair-'));
  assert.equal(temporaryNames.length, 1);
  const temporary = join(dirname(f.file), temporaryNames[0]);
  assert.ok(result.stderr.includes(temporary));
  for (const file of f.files) assert.equal(await readFile(file.file, 'utf8'), file.after);
  const targetStat = await lstat(f.added.file), temporaryStat = await lstat(temporary);
  assert.equal(targetStat.nlink, 2);
  assert.equal(targetStat.ino, temporaryStat.ino);
  const preserved = await snapshot(f.demo);
  const retry = f.run();
  assert.equal(retry.status, 1);
  assert.match(retry.stderr, /regular, unlinked/);
  assert.deepEqual(await snapshot(f.demo), preserved);
  // A human/owner may remove this verified extra name after permission is fixed;
  // the generic preparation command must never remove an arbitrary hard link.
  await unlink(temporary);
  assert.equal((await lstat(f.added.file)).nlink, 1);
  const recovered = f.run();
  assert.equal(recovered.status, 0, recovered.stderr);
  assert.equal(JSON.parse(recovered.stdout).status, 'already-prepared');
});

test('Android publication cleanup preserves a temporary path replaced by another writer', async t => {
  const f = await historyFixture(t);
  const preload = join(f.root, 'inject-temporary-replacement.mjs');
  await writeFile(preload, `import fs from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
const originalLink = fs.link;
fs.link = async (source, target) => {
  await originalLink(source, target);
  await fs.unlink(source);
  await fs.writeFile(source, 'Concurrent replacement temporary file\\r\\n', { flag: 'wx' });
};
syncBuiltinESMExports();
`);
  const result = spawnSync(process.execPath, ['--import', pathToFileURL(preload).href, join(f.skill, 'scripts', 'prepare-demo.mjs'), 'android', f.demo], {
    cwd: f.root, encoding: 'utf8', timeout: 10_000,
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /stopped after replacing 3 file\(s\)/);
  assert.match(result.stderr, /OWNERSHIP_CHANGED/);
  const names = (await readdir(dirname(f.file))).filter(name => name.startsWith('.tansr-repair-'));
  assert.equal(names.length, 1);
  const temporary = join(dirname(f.file), names[0]);
  assert.ok(result.stderr.includes(temporary));
  assert.equal(await readFile(temporary, 'utf8'), 'Concurrent replacement temporary file\r\n');
  for (const file of f.files) assert.equal(await readFile(file.file, 'utf8'), file.after);
  assert.equal((await lstat(f.added.file)).nlink, 1);
  assert.notEqual((await lstat(temporary)).ino, (await lstat(f.added.file)).ino);
});

test('Android staging identity failure closes its handle and reports the unverified temporary path', async t => {
  const f = await historyFixture(t);
  const preload = join(f.root, 'inject-staging-stat-failure.mjs');
  await writeFile(preload, `import fs from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
const originalOpen = fs.open;
fs.open = async (...args) => {
  const handle = await originalOpen(...args);
  if (String(args[0]).includes('.tansr-repair-')) {
    const originalClose = handle.close.bind(handle);
    handle.stat = async () => { throw Object.assign(new Error('Injected staging identity failure'), { code: 'EIO' }); };
    handle.close = async () => {
      await originalClose();
      await fs.writeFile(new URL('./handle-closed.txt', import.meta.url), 'closed');
    };
  }
  return handle;
};
syncBuiltinESMExports();
`);
  const before = await snapshot(f.demo);
  const result = spawnSync(process.execPath, ['--import', pathToFileURL(preload).href, join(f.skill, 'scripts', 'prepare-demo.mjs'), 'android', f.demo], {
    cwd: f.root, encoding: 'utf8', timeout: 10_000,
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Cannot establish ownership/);
  assert.equal(await readFile(join(f.root, 'handle-closed.txt'), 'utf8'), 'closed');
  const names = (await readdir(dirname(f.file))).filter(name => name.startsWith('.tansr-repair-'));
  assert.equal(names.length, 1);
  const temporary = join(dirname(f.file), names[0]);
  assert.ok(result.stderr.includes(temporary));
  assert.equal((await lstat(temporary)).size, 0);
  const after = await snapshot(f.demo);
  delete after[relative(f.demo, temporary).split(sep).join('/')];
  assert.deepEqual(after, before);
  await assert.rejects(lstat(f.added.file), { code: 'ENOENT' });
});
