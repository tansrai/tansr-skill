import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, relative, sep } from 'node:path';
import { Writable } from 'node:stream';
import { spawnSync } from 'node:child_process';
import { runCli, parseArguments, supportsNode } from '../installer/cli.mjs';

const release = {
  schemaVersion: 1, packageName: '@tansr/skill', binName: 'tansr-skill', version: '0.1.0', node: '>=22.19', skillVersion: '0.1.0',
  templateBaselines: [{ id: 'web', version: '0.1.0' }, { id: 'node', version: '1.0.0' }],
  runtimeBaselines: [{ id: 'sdk', name: '@tansr/sdk', version: '0.18.1' }, { id: 'serve', name: '@tansr/serve', version: '0.15.0' }],
};
const actions = ['install', 'preview', 'status', 'update', 'rollback', 'uninstall', 'recover'];
const selector = ['--host', 'codex', '--scope', 'project'];

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'tansr-installer-cli-'));
  t.diagnostic(`CLI fixture (controlled engine only): ${root}`);
  t.after(async () => {
    const location = resolve(root);
    const within = relative(resolve(tmpdir()), location);
    assert.ok(within.startsWith('tansr-installer-cli-') && !within.includes(sep));
    await rm(location, { recursive: true, force: true });
    t.diagnostic(`CLI fixture cleanup complete: ${location}`);
  });
  const packageRoot = join(root, 'package');
  const project = join(root, '中文 project');
  const home = join(root, 'test-home');
  await mkdir(join(packageRoot, 'skill'), { recursive: true });
  await mkdir(project);
  await mkdir(home);
  await writeFile(join(packageRoot, 'release.json'), JSON.stringify(release));
  // These are controlled CLI inputs, not an installation/integrity fixture.
  await writeFile(join(packageRoot, 'manifest.json'), JSON.stringify({ schemaVersion: 1, name: 'tansr', version: '0.1.0', files: [] }));
  return { root, packageRoot, project, home };
}

function outputStream(append) {
  return new Writable({ write(chunk, _encoding, done) { append(String(chunk)); done(); } });
}

async function invoke(f, argv, overrides = {}, resultOverrides = {}) {
  let stdout = '', stderr = '', loads = 0;
  const calls = [], prompts = [];
  const engine = Object.fromEntries(actions.map(action => [action, async options => {
    calls.push({ action, options });
    return { schemaVersion: 1, action, ok: true, exitCode: 0, status: action === 'preview' ? 'ready' : action === 'uninstall' ? 'uninstalled' : 'installed',
      targetPath: options.targetPath, statePath: join(options.targetPath, '..', '.tansr-installer-state'), version: '0.1.0',
      changes: { added: [], updated: [], removed: [] }, preserved: [], warnings: [], recoveryRequired: false, filesInstalled: action !== 'preview' && action !== 'uninstall', staticStructureValid: action !== 'preview' && action !== 'uninstall', ...resultOverrides };
  }]));
  const exitCode = await runCli(argv, {
    packageRoot: f.packageRoot, cwd: f.project, home: f.home, isTTY: false,
    output: outputStream(text => { stdout += text; }), errorOutput: outputStream(text => { stderr += text; }),
    loadEngine: async () => { loads++; return engine; },
    prompt: async question => { prompts.push(question); return 'yes'; }, ...overrides,
  });
  return { exitCode, stdout, stderr, loads, calls, prompts, json: argv.includes('--json') ? JSON.parse(stdout) : undefined };
}

test('CLI parsing accepts one action and explicit options without running anything', () => {
  assert.deepEqual(parseArguments(['--host=codex', '--scope=project', '--yes', '--json']), { command: 'install', host: 'codex', scope: 'project', yes: true, json: true, dryRun: false });
  for (const command of actions) assert.equal(parseArguments([command]).command, command);
  assert.equal(parseArguments(['--help']).command, 'help');
  assert.equal(parseArguments(['-v']).command, 'version');
});

test('CLI rejects unknown, ambiguous, duplicate, malformed and unsupported options', async t => {
  const f = await fixture(t);
  const invalid = [
    ['--home', f.home], ['--host', 'all'], ['--host', 'codex', '--host', 'workbuddy'],
    ['--scope', 'global'], ['--scope', 'project', '--scope', 'user'], ['--host'], ['--host', '--yes'],
    ['--scope='], ['--yes=true'], ['--json=false'], ['install', 'uninstall'], ['--force'],
    ['--project', 'relative'], ['--scope', 'user', '--project', f.project],
    ['status', '--dry-run'], ['uninstall', '--dry-run'], ['preview', '--dry-run'],
    ['--version', '--help'], ['--yes', '--yes'], ['hosts', '--host', 'codex'], ['--', 'install'],
  ];
  for (const args of invalid) {
    const r = await invoke(f, [...args, '--json']);
    assert.notEqual(r.exitCode, 0, JSON.stringify(args));
    assert.equal(r.json.ok, false);
    assert.equal(r.json.exitCode, r.exitCode);
    assert.equal(r.loads, 0);
    assert.equal(r.prompts.length, 0);
  }
  assert.deepEqual(await readdir(f.project), []);
  assert.deepEqual(await readdir(f.home), []);
});

test('noninteractive and JSON requests never guess host, scope, or mutation consent', async t => {
  const f = await fixture(t);
  for (const isTTY of [false, true]) {
    for (const [args, code] of [
      [[], 'HOST_REQUIRED'], [['--yes'], 'HOST_REQUIRED'], [['--host', 'codex'], 'SCOPE_REQUIRED'],
      [selector, 'CONFIRMATION_REQUIRED'],
    ]) {
      const r = await invoke(f, [...args, '--json'], { isTTY });
      assert.equal(r.json.error.code, code);
      assert.notEqual(r.exitCode, 0);
      assert.equal(r.loads, 0);
      assert.equal(r.prompts.length, 0);
      assert.equal(r.stderr, '');
    }
  }
  const plain = await invoke(f, selector);
  assert.notEqual(plain.exitCode, 0);
  assert.match(plain.stderr, /CONFIRMATION_REQUIRED/);
  assert.equal(plain.stdout, '');
  assert.equal(plain.prompts.length, 0);
});

test('all mutating commands require current confirmation', async t => {
  const f = await fixture(t);
  for (const command of ['install', 'update', 'rollback', 'uninstall', 'recover']) {
    const denied = await invoke(f, [command, ...selector, '--json']);
    assert.equal(denied.json.error.code, 'CONFIRMATION_REQUIRED');
    assert.equal(denied.loads, 0);
    const accepted = await invoke(f, [command, ...selector, '--yes', '--json']);
    assert.equal(accepted.exitCode, 0);
    assert.equal(accepted.calls.length, 1);
    assert.equal(accepted.calls[0].action, command);
  }
});

test('default install delegates only the selected Codex project target and bundled payload', async t => {
  const f = await fixture(t);
  const r = await invoke(f, [...selector, '--yes', '--json']);
  assert.equal(r.exitCode, 0);
  assert.equal(r.loads, 1);
  assert.equal(r.calls.length, 1);
  const { action, options } = r.calls[0];
  assert.equal(action, 'install');
  assert.equal(options.targetPath, join(f.project, '.agents', 'skills', 'tansr'));
  assert.equal(options.payloadRoot, join(f.packageRoot, 'skill'));
  assert.equal(options.manifest.version, release.version);
  assert.deepEqual(options.metadata, { host: 'codex', scope: 'project', packageName: release.packageName, packageVersion: release.version,
    skillVersion: release.skillVersion, templateBaselines: release.templateBaselines, runtimeBaselines: release.runtimeBaselines });
  assert.deepEqual(r.json.readiness, { filesInstalled: true, staticStructureValid: true, hostDiscovery: 'not-verified', skillInvocation: 'not-verified' });
  assert.match(r.json.nextSteps.productExampleEn, /study planner/);
  assert.equal(r.prompts.length, 0);
  assert.deepEqual(await readdir(f.project), []);
  assert.deepEqual(await readdir(f.home), []);
});

test('project override and explicit user scope are isolated', async t => {
  const f = await fixture(t);
  const overrideProject = join(f.root, 'other project');
  const project = await invoke(f, ['preview', ...selector, '--project', overrideProject, '--json']);
  assert.equal(project.calls[0].options.targetPath, join(overrideProject, '.agents', 'skills', 'tansr'));
  const user = await invoke(f, ['install', '--host', 'codex', '--scope', 'user', '--yes', '--json']);
  assert.equal(user.calls[0].options.targetPath, join(f.home, '.agents', 'skills', 'tansr'));
  assert.equal(user.json.scope, 'user');
  assert.equal(user.calls.length, 1);
});

test('WorkBuddy project and explicitly selected user scopes delegate through the host adapter', async t => {
  const f = await fixture(t);
  const supported = await invoke(f, ['preview', '--host', 'workbuddy', '--scope', 'project', '--json']);
  assert.equal(supported.exitCode, 0);
  assert.equal(supported.calls[0].options.targetPath, join(f.project, '.codebuddy', 'skills', 'tansr'));
  const user = await invoke(f, ['install', '--host', 'workbuddy', '--scope', 'user', '--yes', '--json']);
  assert.equal(user.exitCode, 0);
  assert.equal(user.calls[0].options.targetPath, join(f.home, '.codebuddy', 'skills', 'tansr'));
  assert.equal(user.calls.length, 1);
  assert.equal(user.json.readiness.hostDiscovery, 'not-verified');
});

test('preview, status and install/update dry runs do not request confirmation or call mutation methods', async t => {
  const f = await fixture(t);
  for (const command of ['preview', 'status']) {
    const r = await invoke(f, [command, ...selector, '--json']);
    assert.equal(r.exitCode, 0);
    assert.equal(r.calls[0].action, command);
    assert.equal(r.prompts.length, 0);
  }
  for (const requestedAction of ['install', 'update']) {
    const r = await invoke(f, [requestedAction, ...selector, '--dry-run', '--json']);
    assert.equal(r.exitCode, 0);
    assert.equal(r.calls[0].action, 'preview');
    assert.equal(r.json.requestedAction, requestedAction);
    assert.equal(r.json.action, 'preview');
    assert.equal(r.prompts.length, 0);
  }
});

test('interactive selection displays one exact target before confirmation', async t => {
  const f = await fixture(t);
  const answers = ['1', '1', 'yes'], questions = [];
  const r = await invoke(f, [], { isTTY: true, prompt: async question => { questions.push(question); return answers.shift(); } });
  assert.equal(r.exitCode, 0);
  assert.equal(questions.length, 3);
  assert.ok(questions[2].includes(join(f.project, '.agents', 'skills', 'tansr')));
  assert.equal(r.calls.length, 1);
  assert.match(r.stdout, /Files installed: true/);
  assert.match(r.stdout, /Host discovery: 待验/);
  assert.match(r.stdout, /study planner/);
});

test('interactive refusal, empty selection and user scope conflict cause no engine invocation', async t => {
  const f = await fixture(t);
  for (const answer of ['', 'n', 'no', 'anything']) {
    const r = await invoke(f, selector, { isTTY: true, prompt: async () => answer });
    assert.notEqual(r.exitCode, 0);
    assert.equal(r.loads, 0);
    assert.match(r.stderr, /CANCELLED/);
  }
  const empty = await invoke(f, [], { isTTY: true, prompt: async () => '' });
  assert.equal(empty.loads, 0);
  assert.match(empty.stderr, /INVALID_HOST/);
  const conflict = await invoke(f, ['--host', 'codex', '--project', f.project], { isTTY: true, prompt: async () => 'user' });
  assert.equal(conflict.loads, 0);
  assert.match(conflict.stderr, /INVALID_SCOPE/);
});

test('Node version gate rejects obsolete and prerelease runtimes before an engine is loaded', async t => {
  const f = await fixture(t);
  for (const version of ['18.20.0', '20.19.0', '22.18.9', '22.19.0-rc.1', 'invalid']) {
    assert.equal(supportsNode(version), false);
    const r = await invoke(f, [...selector, '--yes', '--json'], { nodeVersion: version });
    assert.equal(r.json.error.code, 'UNSUPPORTED_NODE');
    assert.equal(r.loads, 0);
    assert.equal(r.prompts.length, 0);
    assert.notEqual(r.exitCode, 0);
  }
  for (const version of ['22.19.0', '22.22.1', '23.0.0', '24.0.0']) assert.equal(supportsNode(version), true);
});

test('unbuilt source never substitutes source contents and read-only maintenance does not need a payload', async t => {
  const f = await fixture(t);
  await rm(join(f.packageRoot, 'manifest.json'));
  for (const command of ['install', 'update', 'preview']) {
    const r = await invoke(f, [command, ...selector, '--yes', '--json']);
    assert.equal(r.json.error.code, 'PACKAGE_NOT_BUILT');
    assert.equal(r.loads, 0);
  }
  for (const command of ['status', 'rollback', 'uninstall', 'recover']) {
    const r = await invoke(f, [command, ...selector, '--yes', '--json']);
    assert.equal(r.exitCode, 0);
    assert.equal(r.calls[0].options.manifest, undefined);
    assert.equal(r.calls[0].options.payloadRoot, undefined);
  }
});

test('malformed release and manifest fail before loading the engine', async t => {
  const f = await fixture(t);
  await writeFile(join(f.packageRoot, 'manifest.json'), '{');
  const manifest = await invoke(f, ['preview', ...selector, '--json']);
  assert.equal(manifest.json.error.code, 'INVALID_MANIFEST');
  assert.equal(manifest.loads, 0);
  await writeFile(join(f.packageRoot, 'release.json'), JSON.stringify({ ...release, version: false }));
  const brokenRelease = await invoke(f, ['--version', '--json']);
  assert.equal(brokenRelease.json.error.code, 'INVALID_RELEASE');
  assert.equal(brokenRelease.loads, 0);
});

test('release baseline metadata must be complete and valid before engine load', async t => {
  const f = await fixture(t);
  for (const delta of [
    { skillVersion: undefined }, { skillVersion: 'latest' },
    { templateBaselines: [] }, { templateBaselines: [{ id: 'web', version: '0.1.0' }, { id: 'web', version: '1.0.0' }] },
    { runtimeBaselines: [{ id: 'sdk', name: 'wrong-package', version: '0.18.1' }, release.runtimeBaselines[1]] },
  ]) {
    await writeFile(join(f.packageRoot, 'release.json'), JSON.stringify({ ...release, ...delta }));
    const r = await invoke(f, [...selector, '--yes', '--json']);
    assert.equal(r.json.error.code, 'INVALID_RELEASE');
    assert.equal(r.loads, 0);
  }
});

test('bundled manifest must match the Skill version while package and Skill versions may differ', async t => {
  const f = await fixture(t);
  await writeFile(join(f.packageRoot, 'manifest.json'), JSON.stringify({ schemaVersion: 1, name: 'tansr', version: '0.2.0', files: [] }));
  for (const command of ['install', 'update', 'preview']) {
    const r = await invoke(f, [command, ...selector, '--yes', '--json']);
    assert.equal(r.json.error.code, 'BUNDLE_VERSION_MISMATCH');
    assert.notEqual(r.exitCode, 0);
    assert.equal(r.loads, 0);
  }
  await writeFile(join(f.packageRoot, 'manifest.json'), JSON.stringify({ schemaVersion: 1, name: 'tansr', version: release.skillVersion, files: [] }));
  await writeFile(join(f.packageRoot, 'release.json'), JSON.stringify({ ...release, version: '0.2.0' }));
  const distinct = await invoke(f, [...selector, '--yes', '--json']);
  assert.equal(distinct.exitCode, 0);
  assert.equal(distinct.calls[0].options.metadata.packageVersion, '0.2.0');
  assert.equal(distinct.calls[0].options.metadata.skillVersion, '0.1.0');
});

test('JSON output preserves engine diagnostics and forces nonzero for partial or recovery results', async t => {
  const f = await fixture(t);
  const details = { changes: { added: ['SKILL.md'], updated: [], removed: [] }, preserved: [{ path: 'custom.txt', reason: 'user-modified' }], warnings: ['User changes preserved'] };
  for (const result of [
    { ok: false, exitCode: 4, status: 'partial', ...details },
    { ok: true, exitCode: 0, status: 'partial', ...details },
    { ok: true, exitCode: 0, recoveryRequired: true, status: 'recovery-required', ...details },
  ]) {
    const r = await invoke(f, [...selector, '--yes', '--json'], {}, result);
    assert.notEqual(r.exitCode, 0);
    assert.equal(r.json.ok, false);
    assert.equal(r.json.exitCode, r.exitCode);
    assert.deepEqual(r.json.preserved, details.preserved);
    assert.deepEqual(r.json.warnings, details.warnings);
    assert.equal(r.json.readiness.skillInvocation, 'not-verified');
  }
});

test('engine error codes, details and permission next steps remain actionable without reading secrets', async t => {
  const f = await fixture(t);
  const secret = 'synthetic-cli-secret-not-for-output';
  await writeFile(join(f.project, '.env'), `TANSR_APP_KEY=${secret}\n`);
  for (const code of ['CONFLICT', 'EACCES']) {
    const r = await invoke(f, [...selector, '--yes', '--json'], { loadEngine: async () => { throw Object.assign(new Error('Engine could not continue'), { code, exitCode: 4, details: { path: 'SKILL.md' } }); } });
    assert.equal(r.exitCode, 4);
    assert.equal(r.json.error.code, code);
    assert.deepEqual(r.json.error.details, { path: 'SKILL.md' });
    assert.ok(!r.stdout.includes(secret));
    if (code === 'EACCES') assert.match(r.json.error.message, /writable/);
  }
  assert.equal(await readFile(join(f.project, '.env'), 'utf8'), `TANSR_APP_KEY=${secret}\n`);
  const wrapped = await invoke(f, [...selector, '--yes', '--json'], { loadEngine: async () => { throw Object.assign(new Error('Filesystem error'), { code: 'IO_ERROR', exitCode: 5, details: { fsCode: 'EPERM' } }); } });
  assert.equal(wrapped.exitCode, 5);
  assert.match(wrapped.json.error.message, /writable/);
  assert.deepEqual(wrapped.json.error.details, { fsCode: 'EPERM' });
});

test('files and static structure remain unverified when an engine does not provide evidence', async t => {
  const f = await fixture(t);
  const r = await invoke(f, ['status', ...selector, '--json'], {}, { filesInstalled: undefined, staticStructureValid: undefined });
  assert.deepEqual(r.json.readiness, { filesInstalled: null, staticStructureValid: null, hostDiscovery: 'not-verified', skillInvocation: 'not-verified' });
});

test('help, version and hosts terminate without engine import, target creation, or prompts', async t => {
  const f = await fixture(t);
  for (const args of [['--help'], ['--version'], ['hosts']]) {
    const r = await invoke(f, [...args, '--json']);
    assert.equal(r.exitCode, 0);
    assert.equal(r.json.ok, true);
    assert.equal(r.loads, 0);
    assert.equal(r.prompts.length, 0);
  }
  assert.deepEqual(await readdir(f.project), []);
  assert.deepEqual(await readdir(f.home), []);
});

test('executable help and JSON argument failures run in a package without an engine or adapters', async t => {
  const f = await fixture(t);
  const installer = join(f.packageRoot, 'installer');
  await mkdir(installer);
  const executable = join(installer, 'cli.mjs');
  await writeFile(executable, await readFile(new URL('../installer/cli.mjs', import.meta.url)));
  const help = spawnSync(process.execPath, [executable, '--help', '--json'], { encoding: 'utf8', timeout: 10000, cwd: f.project });
  assert.equal(help.status, 0, help.stderr);
  assert.equal(JSON.parse(help.stdout).action, 'help');
  const invalid = spawnSync(process.execPath, [executable, '--home', f.home, '--json'], { encoding: 'utf8', timeout: 10000, cwd: f.project });
  assert.equal(invalid.status, 2, invalid.stderr);
  assert.equal(JSON.parse(invalid.stdout).error.code, 'INVALID_ARGUMENT');
  assert.deepEqual(await readdir(f.project), []);
});
