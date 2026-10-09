import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, mkdir, readdir, realpath, rm, symlink, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, relative } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createProject } from '../scripts/create-project.mjs';
import { inspectProject } from '../scripts/doctor.mjs';

async function fixture(t) {
  const temp = await realpath(tmpdir());
  const root = await mkdtemp(join(temp, 'tansr-tpb-01-'));
  t.after(async () => {
    const checked = resolve(root);
    assert.ok(relative(temp, checked).startsWith('tansr-tpb-01-'));
    await rm(checked, { recursive: true, force: true });
  });
  return root;
}

test('Node project contains usable locked manifest and hidden configuration without installing or leaking secrets', async t => {
  const root = await fixture(t);
  const target = join(root, '项目 with spaces');
  const result = await createProject({ template: 'node', target, name: 'my-agent' });
  assert.equal(result.dependenciesInstalled, false);
  const pkg = JSON.parse(await readFile(join(target, 'package.json'), 'utf8'));
  const lock = JSON.parse(await readFile(join(target, 'package-lock.json'), 'utf8'));
  assert.equal(pkg.name, 'my-agent');
  assert.equal(lock.packages[''].name, 'my-agent');
  assert.equal(pkg.dependencies['@tansr/sdk'], '0.18.1');
  const receipt = JSON.parse(await readFile(join(target, 'tansr-project.json'), 'utf8'));
  const baseline = JSON.parse(await readFile(new URL('../compatibility.json', import.meta.url), 'utf8'));
  assert.equal(receipt.skillVersion, baseline.skill.version);
  assert.ok((await readFile(join(target, '.env.example'), 'utf8')).includes('MODEL_API_KEY'));
  assert.ok((await readFile(join(target, '.tansr/settings.json'), 'utf8')).includes('MODEL_API_KEY'));
  const entries = await readdir(target);
  assert.ok(!entries.includes('node_modules') && !entries.includes('.env'));
});

test('existing directory and user changes survive refused generation', async t => {
  const root = await fixture(t);
  const target = join(root, 'existing');
  await mkdir(target);
  await writeFile(join(target, 'keep.txt'), 'user work');
  await assert.rejects(createProject({ template: 'web', target, name: 'existing' }), /目标已存在/);
  assert.equal(await readFile(join(target, 'keep.txt'), 'utf8'), 'user work');
});

test('invalid template, relative target, invalid package name and source tree target are rejected', async t => {
  const root = await fixture(t);
  await assert.rejects(createProject({ template: '../escape', target: join(root, 'bad'), name: 'valid' }), /template/);
  await assert.rejects(createProject({ template: 'node', target: 'relative-path', name: 'valid' }), /绝对/);
  await assert.rejects(createProject({ template: 'node', target: join(root, 'bad'), name: 'x;echo secret' }), /name/);
  await assert.rejects(createProject({ template: 'node', target: resolve('assets', 'unsafe-generated'), name: 'valid' }), /源码目录外/);
});

test('generation refuses linked destination parent and leaves external content intact', async t => {
  const root = await fixture(t);
  const outside = join(root, 'kept');
  const linked = join(root, 'linked');
  await mkdir(outside);
  await writeFile(join(outside, 'keep.txt'), 'do not overwrite');
  await symlink(outside, linked, process.platform === 'win32' ? 'junction' : 'dir');
  try {
    await assert.rejects(createProject({ template: 'node', target: join(linked, 'new'), name: 'valid' }), /链接|junction/);
    assert.deepEqual(await readdir(outside), ['keep.txt']);
  } finally { await unlink(linked); }
});

test('doctor lists missing configuration by name and never returns configured secrets', async t => {
  const root = await fixture(t);
  await writeFile(join(root, 'package.json'), JSON.stringify({ name: 'doctor-example' }));
  await writeFile(join(root, 'product.config.json'), '{}');
  await writeFile(join(root, '.env'), 'TANSR_MODE=platform\nTANSR_APP_ID=demo\nTANSR_APP_KEY=synthetic-secret-only\n');
  const result = await inspectProject(root);
  assert.equal(result.mode, 'platform');
  assert.deepEqual(result.missingConfigurationNames, []);
  assert.ok(!JSON.stringify(result).includes('synthetic-secret-only'));
  assert.equal(result.dependenciesInstalled, false);
  await writeFile(join(root, '.env'), 'TANSR_MODE=platform\nTANSR_APP_ID=demo\nTANSR_APP_KEY=REPLACE_ME\n');
  assert.deepEqual((await inspectProject(root)).missingConfigurationNames, ['TANSR_APP_KEY']);
});

test('fresh web template creates actual backend and UI with explicit offline default', async t => {
  const root = await fixture(t);
  const target = join(root, 'web-product');
  await createProject({ template: 'web', target, name: 'web-product' });
  const pkg = JSON.parse(await readFile(join(target, 'package.json'), 'utf8'));
  assert.equal(pkg.dependencies['@tansr/sdk'], '0.18.1');
  assert.equal(pkg.dependencies['@tansr/serve'], '0.15.0');
  assert.ok((await readFile(join(target, 'public/index.html'), 'utf8')).includes('<html'));
  assert.ok((await readFile(join(target, '.env.example'), 'utf8')).includes('TANSR_MODE=offline'));
  const report = await inspectProject(target);
  assert.equal(report.mode, 'offline');
  assert.equal(report.lockfilePresent, true);
});

test('generation from a previously used template excludes saved data and secrets but keeps required dotfiles', async t => {
  const root = await fixture(t);
  const fakeSkill = join(root, 'skill');
  const template = join(fakeSkill, 'assets', 'product-starter');
  await mkdir(join(fakeSkill, 'scripts'), { recursive: true });
  await mkdir(join(template, '.data'), { recursive: true });
  await mkdir(join(template, '.tansr'));
  await mkdir(join(template, '.serve-demo-store'));
  await mkdir(join(template, '.serve-demo-cold'));
  await writeFile(join(template, '.serve-demo-store', 'state.json'), 'synthetic-existing-conversation');
  await writeFile(join(template, '.serve-demo-cold', 'state.json'), 'synthetic-existing-history');
  await writeFile(join(fakeSkill, 'scripts', 'create-project.mjs'), await readFile(new URL('../scripts/create-project.mjs', import.meta.url)));
  await writeFile(join(fakeSkill, 'compatibility.json'), JSON.stringify({ skill: { version: '0.1.4' } }));
  await writeFile(join(template, 'package.json'), JSON.stringify({ name: 'template', private: true }));
  await writeFile(join(template, '.env'), 'TOKEN=synthetic-private');
  await writeFile(join(template, '.env.example'), 'TOKEN=');
  await writeFile(join(template, '.data', 'state.json'), '{"privateRecord":"synthetic"}');
  await writeFile(join(template, '.tansr', 'settings.json'), '{}');
  const target = join(root, 'new-product');
  const run = spawnSync(process.execPath, [join(fakeSkill, 'scripts', 'create-project.mjs'), '--template', 'web', '--target', target, '--name', 'new-product'], { encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr);
  assert.deepEqual((await readdir(target)).sort(), ['.env.example', '.tansr', 'package.json', 'tansr-project.json'].sort());
  assert.equal(await readFile(join(template, '.data', 'state.json'), 'utf8'), '{"privateRecord":"synthetic"}');
});

test('backend templates generate new independent projects with preserved official dependencies and startup guidance', async t => {
  const root = await fixture(t);
  for (const template of ['token-server', 'serve']) {
    const target = join(root, template + '-with-spaces');
    const result = await createProject({ template, target, name: 'custom-' + template });
    assert.equal(result.networkAccessed, false);
    assert.equal(result.applicationStarted, false);
    assert.equal(result.dependenciesInstalled, false);
    assert.equal(result.environmentFilePath, join(target, '.env'));
    assert.equal(result.startCommand, 'npm start');
    assert.equal(result.loginCommand, template === 'serve' ? 'npm run login' : undefined);
    const pkg = JSON.parse(await readFile(join(target, 'package.json'), 'utf8'));
    const lock = JSON.parse(await readFile(join(target, 'package-lock.json'), 'utf8'));
    assert.equal(pkg.name, 'custom-' + template);
    assert.equal(lock.name, pkg.name);
    assert.equal(lock.packages[''].name, pkg.name);
    assert.equal((await inspectProject(target)).projectType, template);
    const files = await readdir(target);
    assert.equal(files.includes('.env'), false);
    assert.equal(files.includes('node_modules'), false);
    assert.equal(JSON.parse(await readFile(join(target, 'tansr-project.json'), 'utf8')).template, template);
    const keptEnv = 'USER_EXISTING=do-not-overwrite\n';
    await writeFile(join(target, '.env'), keptEnv);
    await assert.rejects(createProject({ template, target, name: 'other-name' }), /目标已存在/);
    assert.equal(await readFile(join(target, '.env'), 'utf8'), keptEnv);
  }
});
