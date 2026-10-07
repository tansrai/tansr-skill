import test from 'node:test';
import assert from 'node:assert/strict';
import { copyFile, link, lstat, mkdir, mkdtemp, readFile, readdir, realpath, rm, symlink, unlink, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { basename, join, relative, resolve, sep } from 'node:path';
import { spawnSync } from 'node:child_process';

const scriptUrl = new URL('../scripts/prepare-demo.mjs', import.meta.url);
const repair = JSON.parse(await readFile(new URL('../assets/demo-repairs/electron.json', import.meta.url), 'utf8'));
const digest = bytes => ({ sha256: createHash('sha256').update(bytes).digest('hex'), bytes: Buffer.byteLength(bytes) });

// The engine is exercised through its actual CLI with a small synthetic,
// independently hashed manifest. The official whole-file preimage is verified
// separately by the public-ZIP consumption rehearsal, not bundled into tests.
async function fixture(t) {
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
  await mkdir(join(demo, 'renderer'), { recursive: true });
  const script = join(skill, 'scripts', 'prepare-demo.mjs');
  await copyFile(scriptUrl, script);
  const before = `// Synthetic test renderer\nfunction render(part, card, el) {\n${repair.replacement.before}  return card;\n}\n`;
  const after = before.replace(repair.replacement.before, repair.replacement.after);
  const manifest = JSON.parse(JSON.stringify(repair));
  manifest.source = { description: 'Synthetic offline test fixture; not the public Demo' };
  manifest.before = digest(before);
  manifest.after = digest(after);
  const manifestPath = join(skill, 'assets', 'demo-repairs', 'electron.json');
  await writeFile(manifestPath, JSON.stringify(manifest));
  const file = join(demo, 'renderer', 'renderer.js');
  await writeFile(file, before);
  await writeFile(join(demo, 'package-lock.json'), '{"locked":"synthetic"}\n');
  await writeFile(join(demo, 'LICENSE'), 'Synthetic license to preserve\n');
  await writeFile(join(demo, 'user-draft.txt'), 'Unrelated user work\n');
  const run = (args = ['electron', demo]) => spawnSync(process.execPath, [script, ...args], {
    cwd: root, encoding: 'utf8', timeout: 10_000,
  });
  return { root, skill, demo, file, manifestPath, manifest, before, after, run };
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
