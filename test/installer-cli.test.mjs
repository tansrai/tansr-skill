import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, readFile, readdir, symlink, unlink, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, relative, sep, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { Writable } from 'node:stream';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { runCli, parseArguments, supportsNode } from '../installer/cli.mjs';
import { listHosts, findHost } from '../installer/hosts.mjs';
import { resolvePaths } from '../installer/paths.mjs';

test('confirmation names active, transaction and legacy migration locations before any engine call', async t => {
  const f = await fixture(t);
  const locations = await resolvePaths(join(f.project, '.codebuddy', 'skills', 'tansr'));
  const args = ['uninstall', '--host', 'workbuddy', '--scope', 'project'];
  const denied = await invoke(f, [...args, '--json']);
  assert.equal(denied.json.error.code, 'CONFIRMATION_REQUIRED');
  assert.equal(denied.loads, 0);
  for (const value of [locations.target, locations.state, locations.legacyState]) assert.ok(denied.json.error.message.includes(value));
  const questions = [];
  const prompted = await invoke(f, args, { isTTY: true, prompt: async question => { questions.push(question); return 'n'; } });
  assert.equal(prompted.loads, 0);
  assert.equal(questions.length, 1);
  for (const value of [locations.target, locations.state, locations.legacyState]) assert.ok(questions[0].includes(value));
  assert.deepEqual(await readdir(f.project), []);
});

test('CLI preserves migration diagnostics and does not turn status into a mutation', async t => {
  const f = await fixture(t);
  const target = join(f.project, '.codebuddy', 'skills', 'tansr');
  const details = { stateLayout: 'legacy', migrationRequired: true, legacyStatePath: join(dirname(target), '.tansr-installer-state') };
  const result = await invoke(f, ['status', '--host', 'workbuddy', '--scope', 'project', '--json'], {}, details);
  assert.equal(result.exitCode, 0);
  assert.deepEqual(result.calls.map(call => call.action), ['status']);
  assert.equal(result.json.stateLayout, 'legacy');
  assert.equal(result.json.migrationRequired, true);
  assert.equal(result.json.legacyStatePath, details.legacyStatePath);
  assert.equal(result.json.readiness.hostDiscovery, 'not-verified');
  assert.equal(result.json.readiness.skillInvocation, 'not-verified');
  assert.deepEqual(await readdir(f.project), []);
});

test('real installer CLI targeting WorkBuddy leaves no recursive backup Skill entry after uninstall', async t => {
  const f = await fixture(t);
  const executable = await copyExecutable(f);
  for (const name of ['engine.mjs', 'paths.mjs', 'manifest.mjs', 'errors.mjs', 'migration.mjs']) {
    await writeFile(join(f.packageRoot, 'installer', name), await readFile(new URL('../installer/' + name, import.meta.url)));
  }
  const bytes = Buffer.from('---\nname: tansr\ndescription: synthetic CLI discovery fixture\n---\n');
  await writeFile(join(f.packageRoot, 'skill', 'SKILL.md'), bytes);
  await writeFile(join(f.packageRoot, 'manifest.json'), JSON.stringify({ schemaVersion: 1, name: 'tansr', version: release.skillVersion, files: [
    { path: 'SKILL.md', bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') },
  ] }));
  const project = await realpath(f.project);
  const skillsRoot = join(project, '.codebuddy', 'skills');
  const options = ['--host', 'workbuddy', '--scope', 'project', '--project', project, '--yes', '--json'];
  const run = action => {
    const child = spawnSync(process.execPath, [executable, action, ...options], { cwd: project, encoding: 'utf8', timeout: 30000 });
    assert.equal(child.error, undefined);
    assert.equal(child.status, 0, child.stderr || child.stdout);
    return JSON.parse(child.stdout);
  };
  const installed = run('install');
  assert.equal(installed.readiness.filesInstalled, true);
  assert.equal(installed.stateLayout, 'outside-skills-v2');
  assert.equal(dirname(installed.statePath), dirname(skillsRoot));
  assert.equal(installed.migrationRequired, false);
  const discovered = async () => (await readdir(skillsRoot, { recursive: true })).filter(name => name.split(/[\\/]/).at(-1) === 'SKILL.md').map(name => name.replaceAll('\\', '/')).sort();
  assert.deepEqual(await discovered(), ['tansr/SKILL.md']);
  const removed = run('uninstall');
  assert.equal(removed.status, 'uninstalled');
  assert.deepEqual(await discovered(), []);
  const marker = JSON.parse(await readFile(join(skillsRoot, '.tansr-installer-state', 'owner.json'), 'utf8'));
  assert.equal(marker.name, 'tansr-installer-migrated');
  assert.equal(run('status').status, 'uninstalled');
});


const release = {
  schemaVersion: 1, packageName: '@tansr/skill', binName: 'tansr-skill', version: '0.1.0', node: '>=22.19', skillVersion: '0.1.0',
  templateBaselines: [{ id: 'web', version: '0.1.0' }, { id: 'node', version: '1.0.0' }],
  runtimeBaselines: [{ id: 'sdk', name: '@tansr/sdk', version: '0.18.1' }, { id: 'serve', name: '@tansr/serve', version: '0.15.0' }],
};
const actions = ['install', 'preview', 'status', 'update', 'rollback', 'uninstall', 'recover'];
const selector = ['--host', 'codex', '--scope', 'project'];

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'tansr-installer-cli-'));
  t.diagnostic(`Isolated CLI fixture: ${root}`);
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

async function copyExecutable(f) {
  const installer = join(f.packageRoot, 'installer');
  await mkdir(installer);
  for (const file of ['cli.mjs', 'hosts.mjs']) {
    await writeFile(join(installer, file), await readFile(new URL(`../installer/${file}`, import.meta.url)));
  }
  return join(installer, 'cli.mjs');
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
      targetPath: options.targetPath, statePath: (await resolvePaths(options.targetPath)).state, version: '0.1.0',
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

test('registered new host IDs and aliases are canonicalized before a single engine delegation', async t => {
  const f = await fixture(t);
  for (const [input, canonical] of [
    ['generic', 'generic'], ['agents', 'generic'], ['universal', 'generic'],
    ['claude-code', 'claude-code'], ['claude', 'claude-code'], ['cursor', 'cursor'],
    ['qwen', 'qwen-code'], ['qianwen', 'qwen-code'],
  ]) {
    assert.equal(parseArguments(['--host', input]).host, canonical);
    const r = await invoke(f, ['preview', '--host', input, '--scope', 'project', '--json']);
    assert.equal(r.exitCode, 0, `${input}: ${r.stdout}`);
    assert.equal(r.calls.length, 1);
    assert.equal(r.calls[0].action, 'preview');
    assert.equal(r.calls[0].options.metadata.host, canonical);
    assert.equal(r.json.host, canonical);
    assert.equal(r.prompts.length, 0);
  }
  assert.deepEqual(await readdir(f.project), []);
  assert.deepEqual(await readdir(f.home), []);
});

test('hosts includes manual entries while every manual operation rejects before scope prompts or engine load', async t => {
  const f = await fixture(t);
  const listing = await invoke(f, ['hosts', '--json']);
  assert.equal(listing.exitCode, 0);
  for (const id of ['yuanbao', 'doubao', 'feishu']) {
    const host = listing.json.hosts.find(item => item.id === id);
    assert.equal(host.installation, 'manual');
    assert.equal(parseArguments(['--host', id]).host, id);
    for (const action of actions) {
      const r = await invoke(f, [action, '--host', id, '--yes', '--json']);
      assert.notEqual(r.exitCode, 0);
      assert.equal(r.json.error.code, 'host_manual_setup_required');
      assert.equal(r.loads, 0);
      assert.equal(r.prompts.length, 0);
    }
    const interactive = await invoke(f, ['--host', id], { isTTY: true });
    assert.notEqual(interactive.exitCode, 0);
    assert.equal(interactive.loads, 0);
    assert.equal(interactive.prompts.length, 0);
    assert.match(interactive.stderr, /host_manual_setup_required/);
  }
  assert.deepEqual(await readdir(f.project), []);
  assert.deepEqual(await readdir(f.home), []);
});

test('interactive host numbers follow the current installable registry and omit manual entries', async t => {
  const f = await fixture(t);
  const choices = listHosts().filter(host => host.installation === 'directory' && host.scopes.length > 0);
  const selected = choices.findIndex(host => host.id === 'claude-code');
  assert.ok(selected >= 0);
  const questions = [];
  const answers = [String(selected + 1), 'project', 'yes'];
  const r = await invoke(f, [], { isTTY: true, prompt: async question => { questions.push(question); return answers.shift(); } });
  assert.equal(r.exitCode, 0);
  assert.equal(r.calls.length, 1);
  assert.equal(r.calls[0].options.metadata.host, 'claude-code');
  assert.equal(questions.length, 3);
  for (const [index, host] of choices.entries()) assert.ok(questions[0].includes(`${index + 1} ${host.label} (${host.id})`));
  for (const host of listHosts().filter(host => host.installation === 'manual')) assert.ok(!questions[0].includes(`(${host.id})`));
  assert.ok(questions[2].includes(r.calls[0].options.targetPath));
  const outOfRange = await invoke(f, [], { isTTY: true, prompt: async () => String(choices.length + 1) });
  assert.notEqual(outOfRange.exitCode, 0);
  assert.equal(outOfRange.loads, 0);
  assert.match(outOfRange.stderr, /INVALID_HOST/);
});

test('user-only hosts still require an explicit scope and reject project scope before engine load', async t => {
  const f = await fixture(t);
  const host = findHost('zcode');
  assert.deepEqual(host.scopes, ['user']);
  const missing = await invoke(f, ['--host', 'zcode', '--yes', '--json']);
  assert.equal(missing.json.error.code, 'SCOPE_REQUIRED');
  assert.equal(missing.loads, 0);
  const unsupported = await invoke(f, ['--host', 'zcode', '--scope', 'project', '--yes', '--json']);
  assert.notEqual(unsupported.exitCode, 0);
  assert.equal(unsupported.json.error.code, 'scope_unsupported');
  assert.equal(unsupported.loads, 0);
  const questions = [], answers = ['1', 'yes'];
  const selected = await invoke(f, ['--host', 'zcode'], { isTTY: true, prompt: async question => { questions.push(question); return answers.shift(); } });
  assert.equal(selected.exitCode, 0);
  assert.equal(questions.length, 2);
  assert.ok(questions[0].includes('1 user'));
  assert.equal(selected.calls.length, 1);
  assert.equal(selected.calls[0].options.metadata.scope, 'user');
  assert.ok(questions[1].includes(selected.calls[0].options.targetPath));
  for (const answer of ['', '0', '2']) {
    const invalid = await invoke(f, ['--host', 'zcode'], { isTTY: true, prompt: async () => answer });
    assert.equal(invalid.loads, 0);
    assert.match(invalid.stderr, /INVALID_SCOPE/);
  }
  assert.deepEqual(await readdir(f.project), []);
  assert.deepEqual(await readdir(f.home), []);
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
  const choices = listHosts().filter(host => host.installation === 'directory' && host.scopes.length > 0);
  const selected = choices.findIndex(host => host.id === 'codex');
  assert.ok(selected >= 0);
  const answers = [String(selected + 1), String(choices[selected].scopes.indexOf('project') + 1), 'yes'], questions = [];
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

test('executable help and JSON argument failures run with the host registry but without an engine', async t => {
  const f = await fixture(t);
  const executable = await copyExecutable(f);
  const help = spawnSync(process.execPath, [executable, '--help', '--json'], { encoding: 'utf8', timeout: 10000, cwd: f.project });
  assert.equal(help.status, 0, help.stderr);
  assert.equal(JSON.parse(help.stdout).action, 'help');
  const invalid = spawnSync(process.execPath, [executable, '--home', f.home, '--json'], { encoding: 'utf8', timeout: 10000, cwd: f.project });
  assert.equal(invalid.status, 2, invalid.stderr);
  assert.equal(JSON.parse(invalid.stdout).error.code, 'INVALID_ARGUMENT');
  assert.deepEqual(await readdir(f.project), []);
});

test('executable invocation through filesystem aliases returns help, version and JSON errors', async t => {
  const f = await fixture(t);
  const executable = await copyExecutable(f);
  const alias = join(f.root, 'package alias');
  const links = [];
  try {
    await symlink(f.packageRoot, alias, process.platform === 'win32' ? 'junction' : 'dir');
    links.push(alias);
    const entries = [join(alias, 'installer', 'cli.mjs')];
    if (process.platform !== 'win32') {
      const bin = join(f.root, 'node_modules', '.bin');
      await mkdir(bin, { recursive: true });
      const linkedBin = join(bin, 'tansr-skill');
      await symlink(relative(bin, executable), linkedBin, 'file');
      links.push(linkedBin);
      entries.push(linkedBin);
    } else {
      const caseAlias = join(f.root, 'case alias');
      await symlink(f.packageRoot.toUpperCase(), caseAlias, 'junction');
      links.push(caseAlias);
      entries.push(join(caseAlias, 'installer', 'cli.mjs'));
      t.diagnostic('Windows npm uses command shims; POSIX npm-style file symlink route runs on macOS/Linux. Directory junction alias is exercised here.');
      t.diagnostic('Windows also executes a junction whose stored target uses a different path spelling; the fixture root is not canonicalized.');
    }
    for (const entry of entries) {
      for (const [args, expectedCode, expectedAction] of [
        [['--help', '--json'], 0, 'help'],
        [['--version', '--json'], 0, 'version'],
        [['--home', f.home, '--json'], 2, 'arguments'],
      ]) {
        const child = spawnSync(process.execPath, [entry, ...args], { encoding: 'utf8', timeout: 10000, cwd: f.project });
        assert.equal(child.error, undefined, `${entry}: ${child.error?.message}`);
        assert.equal(child.signal, null);
        assert.equal(child.status, expectedCode, child.stderr);
        assert.notEqual(child.stdout.trim(), '', `CLI must execute when started through ${entry}`);
        const result = JSON.parse(child.stdout);
        assert.equal(result.action, expectedAction);
        assert.equal(result.exitCode, expectedCode);
        assert.equal(child.stderr, '');
      }
    }
    assert.deepEqual(await readdir(f.project), []);
    assert.deepEqual(await readdir(f.home), []);
  } finally {
    for (const link of links.reverse()) await unlink(link);
  }
});

test('importing the CLI through an alias never starts it or fails for a nonexistent argv entry', async t => {
  const f = await fixture(t);
  await copyExecutable(f);
  const alias = join(f.root, 'import alias');
  await symlink(f.packageRoot, alias, process.platform === 'win32' ? 'junction' : 'dir');
  try {
    const moduleUrl = pathToFileURL(join(alias, 'installer', 'cli.mjs')).href;
    const wrapper = join(f.root, 'consumer.mjs');
    for (const missingArgv of [false, true]) {
      await writeFile(wrapper, `${missingArgv ? `process.argv[1] = ${JSON.stringify(join(f.root, 'nonexistent-entry.mjs'))};\n` : ''}`
        + `const cli = await import(${JSON.stringify(moduleUrl)});\nprocess.stdout.write(JSON.stringify({ imported: typeof cli.runCli }));\n`);
      const child = spawnSync(process.execPath, [wrapper], { encoding: 'utf8', timeout: 10000, cwd: f.project });
      assert.equal(child.error, undefined);
      assert.equal(child.signal, null);
      assert.equal(child.status, 0, child.stderr);
      assert.deepEqual(JSON.parse(child.stdout), { imported: 'function' });
      assert.equal(child.stderr, '');
    }
  } finally { await unlink(alias); }
});
