import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, realpath, writeFile, readFile, mkdir, readdir, rm, symlink, unlink, link, lstat, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, relative, delimiter } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { parseEnv } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { inspectProject } from '../scripts/doctor.mjs';
import { configureProject, configurationFailure, WINDOWS_ACL_SIGNATURE, windowsPowerShell } from '../scripts/configure-project.mjs';

const CONFIGURE = fileURLToPath(new URL('../scripts/configure-project.mjs', import.meta.url));
const DOCTOR = fileURLToPath(new URL('../scripts/doctor.mjs', import.meta.url));
const ID = 'synthetic-id-CONFIG_TEST_ONLY';
const KEY = 'synthetic-key-CONFIG_TEST_ONLY#with-hash';
const ready = `TANSR_MODE=offline\nTANSR_APP_ID=${ID}\nTANSR_APP_KEY="${KEY}"\n`;

async function fixture(t, text = ready, web = true) {
  const temp = await realpath(tmpdir());
  const root = await mkdtemp(join(temp, 'tansr-config-test-'));
  t.after(async () => {
    assert.ok(relative(temp, resolve(root)).startsWith('tansr-config-test-'));
    await rm(root, { recursive: true, force: true });
  });
  await writeFile(join(root, 'package.json'), JSON.stringify({ name: KEY }));
  if (web) await writeFile(join(root, 'product.config.json'), '{}');
  if (text !== null) await writeFile(join(root, '.env'), text);
  return root;
}

function noValues(value, extra = []) {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  for (const secret of [ID, KEY, 'CONFIG_TEST_ONLY', ...extra]) assert.equal(text.includes(secret), false, 'output must contain no configuration values or fragments');
  assert.equal(/"(?:value|source|line|length|package|project)"\s*:/.test(text), false, 'output must not return source context or lengths');
}

async function refusesUnchanged(root, options, expectedCode) {
  const before = await readFile(join(root, '.env'));
  const names = await readdir(root);
  await assert.rejects(configureProject({ project: root, apply: true, ...options }), error => {
    const safe = configurationFailure(error);
    noValues(safe);
    assert.equal(safe.code, expectedCode);
    return true;
  });
  assert.deepEqual(await readFile(join(root, '.env')), before);
  assert.deepEqual(await readdir(root), names);
}

test('doctor identifies filled comments and offline/expected-mode mismatch without echoing values', async t => {
  const root = await fixture(t, `TANSR_MODE=offline\n# TANSR_APP_ID=${ID}\n# TANSR_APP_KEY="${KEY}"\n`);
  const report = await inspectProject(root);
  assert.equal(report.mode, 'offline');
  assert.equal(report.modeStatus, 'credentials-inactive');
  assert.equal(report.configurationStatus, 'needs-attention');
  assert.deepEqual(report.variables.slice(1).map(v => [v.active, v.commented]), [['missing', 'configured'], ['missing', 'configured']]);
  assert.equal((await inspectProject(root, 'platform')).modeStatus, 'mismatch');
  noValues(report);
  const cli = spawnSync(process.execPath, [DOCTOR, '--project', root, '--mode', 'platform'], { encoding: 'utf8' });
  assert.equal(cli.status, 0);
  noValues(cli.stdout + cli.stderr);
});

test('doctor recognizes active empty, placeholders, duplicates and invalid mode as controlled statuses', async t => {
  const root = await fixture(t, 'TANSR_MODE=platform\nTANSR_APP_ID=  \nTANSR_APP_KEY=YOUR_KEY\n');
  let report = await inspectProject(root);
  assert.deepEqual(report.variables.slice(1).map(v => v.active), ['empty', 'placeholder']);
  assert.deepEqual(report.missingConfigurationNames, ['TANSR_APP_ID', 'TANSR_APP_KEY']);
  await writeFile(join(root, '.env'), ready + `TANSR_APP_KEY=${ID}\nTANSR_MODE=${KEY}\n`);
  report = await inspectProject(root);
  assert.equal(report.mode, 'invalid');
  assert.equal(report.variables[0].active, 'duplicate');
  assert.equal(report.variables[2].active, 'duplicate');
  noValues(report);
});

test('Windows case-insensitive environment aliases are limited rather than misreported offline', { skip: process.platform !== 'win32' }, async t => {
  const root = await fixture(t, `tansr_mode=platform\ntansr_app_id=${ID}\ntansr_app_key="${KEY}"\n`);
  const env = { ...process.env };
  for (const name of Object.keys(env)) if (name.toUpperCase().startsWith('TANSR_')) delete env[name];
  const runtime = spawnSync(process.execPath, ['--env-file', join(root, '.env'), '-e', 'console.log(JSON.stringify({platform:process.env.TANSR_MODE === "platform",configured:Boolean(process.env.TANSR_APP_ID && process.env.TANSR_APP_KEY)}))'], { encoding: 'utf8', timeout: 10_000, env });
  assert.equal(runtime.status, 0);
  assert.deepEqual(JSON.parse(runtime.stdout), { platform: true, configured: true });
  const report = await inspectProject(root);
  assert.equal(report.mode, 'invalid');
  assert.equal(report.configurationStatus, 'limited');
  assert.deepEqual(report.variables.map(v => v.active), ['noncanonical', 'noncanonical', 'noncanonical']);
  noValues(report);
  noValues(runtime.stdout + runtime.stderr);
  await refusesUnchanged(root, { mode: 'platform' }, 'format');
  await writeFile(join(root, '.env'), ready + `tansr_app_key=${ID}\n`);
  assert.equal((await inspectProject(root)).configurationStatus, 'limited');
  await refusesUnchanged(root, { mode: 'platform' }, 'format');
});

test('doctor follows Node quotes/multiline and does not discover fake credential comments inside another value', async t => {
  for (const quote of ['"', "'", '`']) {
    const root = await fixture(t, `OTHER=${quote}begin\n# TANSR_APP_ID=${ID}\n# TANSR_APP_KEY=${KEY}\nend${quote}\nTANSR_MODE=offline\n`);
    const report = await inspectProject(root);
    assert.deepEqual(report.variables.slice(1).map(v => [v.active, v.commented]), [['missing', 'none'], ['missing', 'none']]);
    noValues(report);
    await refusesUnchanged(root, { mode: 'platform' }, 'format');
  }
});

test('doctor reports quoted hashes as configured and malformed quotes as limited without raw parse errors', async t => {
  const root = await fixture(t, ready.replace('offline', 'platform'));
  assert.equal((await inspectProject(root)).configurationStatus, 'ready');
  await writeFile(join(root, '.env'), `TANSR_MODE=platform\nTANSR_APP_ID=${ID}\nTANSR_APP_KEY="${KEY}\n`);
  const report = await inspectProject(root);
  assert.equal(report.configurationStatus, 'limited');
  assert.equal(report.variables[2].active, 'invalid');
  noValues(report);
  await refusesUnchanged(root, { mode: 'platform' }, 'format');
});

test('multiline credentials remain diagnosable, while unsupported encodings and syntax never get rewritten', async t => {
  const root = await fixture(t, `TANSR_MODE=platform\nTANSR_APP_ID=${ID}\nTANSR_APP_KEY="${KEY}\nsecond-line"\n`);
  const multiline = await inspectProject(root);
  assert.equal(multiline.variables[2].active, 'configured');
  assert.equal(multiline.variables[2].format, 'multiline');
  noValues(multiline, ['second-line']);
  await refusesUnchanged(root, { mode: 'offline' }, 'format');
  for (const text of [ready + 'unexpected syntax\n', '\uFEFF' + ready, ready.replace('\n', '\r'), ready + 'OTHER="unclosed\n']) {
    await writeFile(join(root, '.env'), text);
    assert.equal((await inspectProject(root)).configurationStatus, 'limited');
    await refusesUnchanged(root, { mode: 'platform' }, 'format');
  }
  await writeFile(join(root, '.env'), Buffer.concat([Buffer.from(ready), Buffer.from([255])]));
  assert.equal((await inspectProject(root)).configurationStatus, 'limited');
  await refusesUnchanged(root, { mode: 'platform' }, 'format');
});

test('preview is read-only; apply activates original comments and preserves unrelated bytes, CRLF and user lines', async t => {
  const original = [
    '# user heading', " export TANSR_MODE = 'offline'  # retain mode note", 'PORT=4317',
    'TANSR_APP_ID=', 'TANSR_APP_KEY=REPLACE_ME', `  # export TANSR_APP_ID = '${ID}'  # id note`,
    `\t# TANSR_APP_KEY="${KEY}" # key note`, 'OTHER="hash # is literal"', '# TANSR_MODE=platform', '',
  ].join('\r\n');
  const root = await fixture(t, original);
  const preview = await configureProject({ project: root, mode: 'platform' });
  assert.equal(preview.status, 'preview');
  assert.deepEqual(preview.changes.map(v => v.name), ['TANSR_MODE', 'TANSR_APP_ID', 'TANSR_APP_KEY']);
  assert.equal(await readFile(join(root, '.env'), 'utf8'), original);
  noValues(preview);
  const applied = await configureProject({ project: root, mode: 'platform', apply: true });
  assert.equal(applied.status, 'applied');
  noValues(applied);
  const actual = await readFile(join(root, '.env'), 'utf8');
  const expected = original.replace("'offline'", 'platform').replace('TANSR_APP_ID=\r\n', '# TANSR_APP_ID=\r\n').replace('TANSR_APP_KEY=REPLACE_ME', '# TANSR_APP_KEY=REPLACE_ME').replace('  # export', '   export').replace('\t# TANSR_APP_KEY', '\t TANSR_APP_KEY');
  assert.equal(actual, expected);
  assert.deepEqual(parseEnv(actual), { TANSR_MODE: 'platform', PORT: '4317', TANSR_APP_ID: ID, TANSR_APP_KEY: KEY, OTHER: 'hash # is literal' });
  assert.equal((await inspectProject(root, 'platform')).configurationStatus, 'ready');
  assert.equal((await configureProject({ project: root, mode: 'platform', apply: true })).status, 'unchanged');
  assert.equal((await readdir(root)).some(name => name.startsWith('.env.tansr-configure') || name === '.tansr-configure.lock'), false);
});

test('explicit offline changes only mode and does not activate commented credentials', async t => {
  const root = await fixture(t, `TANSR_MODE=platform # note\n# TANSR_APP_ID=${ID}\n# TANSR_APP_KEY="${KEY}"`);
  const before = await readFile(join(root, '.env'), 'utf8');
  const result = await configureProject({ project: root, mode: 'offline', apply: true });
  assert.deepEqual(result.changes, [{ name: 'TANSR_MODE', action: 'set-explicit-mode' }]);
  assert.equal(await readFile(join(root, '.env'), 'utf8'), before.replace('platform', 'offline'));
  noValues(result);
});

test('missing/placeholder/duplicate/conflicting candidate credentials refuse without touching files', async t => {
  const cases = [
    'TANSR_MODE=offline\nTANSR_APP_ID=\nTANSR_APP_KEY=\n',
    'TANSR_MODE=offline\n# TANSR_APP_ID=YOUR_APP_ID\n# TANSR_APP_KEY=REPLACE_ME\n',
    ready + `TANSR_APP_KEY="${KEY}"\n`,
    ready + `# TANSR_APP_KEY="${KEY}"\n`,
    `TANSR_MODE=offline\n# TANSR_APP_ID=${ID}\n# TANSR_APP_ID=${ID}\n# TANSR_APP_KEY="${KEY}"\n`,
  ];
  for (const text of cases) await refusesUnchanged(await fixture(t, text), { mode: 'platform' }, 'credentials');
  await refusesUnchanged(await fixture(t, ready + 'TANSR_MODE=platform\n'), { mode: 'platform' }, 'mode');
});

test('fresh project tells user to enter values locally and refuses missing env without creating it', async t => {
  const root = await fixture(t, null);
  const report = await inspectProject(root);
  assert.equal(report.environmentFilePresent, false);
  assert.equal(report.mode, 'offline');
  assert.match(report.next, /本机填写/);
  await assert.rejects(configureProject({ project: root, mode: 'platform', apply: true }), error => configurationFailure(error).code === 'missing');
  assert.deepEqual((await readdir(root)).sort(), ['package.json', 'product.config.json']);
});

test('managed remains diagnostic-only and helper never imports credential values from process environment', async t => {
  const root = await fixture(t, `# MODEL_API_KEY=${KEY}\nMODEL_API_KEY=REPLACE_ME\n`, false);
  const report = await inspectProject(root);
  assert.equal(report.mode, 'managed');
  assert.deepEqual(report.missingConfigurationNames, ['MODEL_API_KEY']);
  assert.equal(report.variables[0].commented, 'configured');
  noValues(report);
  await refusesUnchanged(root, { mode: 'platform' }, 'project');
  const web = await fixture(t, 'TANSR_MODE=offline\nTANSR_APP_ID=\nTANSR_APP_KEY=\n');
  const child = spawnSync(process.execPath, [CONFIGURE, '--project', web, '--mode', 'platform', '--apply'], { encoding: 'utf8', env: { ...process.env, TANSR_APP_ID: ID, TANSR_APP_KEY: KEY } });
  assert.equal(child.status, 1);
  noValues(child.stdout + child.stderr);
  assert.equal(await readFile(join(web, '.env'), 'utf8'), 'TANSR_MODE=offline\nTANSR_APP_ID=\nTANSR_APP_KEY=\n');
});

test('CLI rejects credentials/options and sanitizes reflected paths, package names and parse errors', async t => {
  const root = await fixture(t);
  for (const args of [
    ['--project', root, '--mode', KEY],
    ['--project', root, '--mode', 'platform', '--key', KEY],
    ['--project', join(root, KEY), '--mode', 'platform'],
    ['--project', root, '--mode', 'managed'],
  ]) {
    const child = spawnSync(process.execPath, [CONFIGURE, ...args], { encoding: 'utf8' });
    assert.equal(child.status, 1);
    noValues(child.stdout + child.stderr);
  }
  await writeFile(join(root, 'package.json'), `{"name":"${KEY}", bad`);
  const doctor = spawnSync(process.execPath, [DOCTOR, '--project', root], { encoding: 'utf8' });
  assert.equal(doctor.status, 1);
  assert.equal(JSON.parse(doctor.stderr).code, 'project');
  noValues(doctor.stdout + doctor.stderr);
});

test('unsafe links and hardlinked env are rejected and external content survives', async t => {
  const root = await fixture(t);
  const target = join(root, 'outside');
  await mkdir(target);
  const linked = join(root, 'linked');
  await symlink(target, linked, process.platform === 'win32' ? 'junction' : 'dir');
  try { await assert.rejects(inspectProject(linked), error => configurationFailure(error).code === 'path'); }
  finally { await unlink(linked); }
  await link(join(root, '.env'), join(target, 'shared.env'));
  await refusesUnchanged(root, { mode: 'platform' }, 'path');
  assert.equal(await readFile(join(target, 'shared.env'), 'utf8'), ready);
  if (process.platform === 'win32') {
    await assert.rejects(inspectProject('\\\\synthetic-no-network\\share\\project'), error => configurationFailure(error).code === 'path');
    await assert.rejects(inspectProject('\\root-relative'), error => ['arguments', 'path'].includes(configurationFailure(error).code));
  }
});

test('existing lock is respected and never removed or overwritten', async t => {
  const root = await fixture(t);
  await writeFile(join(root, '.tansr-configure.lock'), 'another owner');
  await refusesUnchanged(root, { mode: 'platform' }, 'locked');
  assert.equal(await readFile(join(root, '.tansr-configure.lock'), 'utf8'), 'another owner');
});

test('explicit mode can be appended without normalizing existing text or its lack of final newline', async t => {
  const original = `# private note\nTANSR_APP_ID=${ID}\nTANSR_APP_KEY="${KEY}"`;
  const root = await fixture(t, original);
  const result = await configureProject({ project: root, mode: 'platform', apply: true });
  assert.equal(result.status, 'applied');
  assert.equal(await readFile(join(root, '.env'), 'utf8'), original + '\nTANSR_MODE=platform\n');
  noValues(result);
});

test('interrupted staging filename is ignored by the actual shipped template rule', async t => {
  const root = await fixture(t);
  await writeFile(join(root, '.gitignore'), await readFile(new URL('../assets/product-starter/.gitignore', import.meta.url)));
  const initialized = spawnSync('git', ['init', '--quiet', root], { encoding: 'utf8', timeout: 10_000, windowsHide: true });
  assert.equal(initialized.status, 0, 'synthetic Git repository must initialize');
  const temporaryName = '.env.tansr-configure-12345678-1234-1234-1234-123456789012.tmp';
  await writeFile(join(root, temporaryName), ready);
  const checked = spawnSync('git', ['-C', root, 'check-ignore', '--', temporaryName], { encoding: 'utf8', timeout: 10_000, windowsHide: true });
  assert.equal(checked.status, 0, 'sensitive interrupted staging must be ignored');
  assert.equal(checked.stdout.trim(), temporaryName);
  noValues(checked.stdout + checked.stderr);
});

test('existing permissions survive actual replacement', async t => {
  const root = await fixture(t);
  const path = join(root, '.env');
  if (process.platform === 'win32') {
    const command = "$ErrorActionPreference='Stop'; $a=Get-Acl -LiteralPath $env:TANSR_TEST_ENV; $a.SetAccessRuleProtection($true,$true); Set-Acl -LiteralPath $env:TANSR_TEST_ENV -AclObject $a; (Get-Acl -LiteralPath $env:TANSR_TEST_ENV).Sddl";
    const ps = await windowsPowerShell();
    const env = { ...process.env, TANSR_TEST_ENV: path };
    for (const name of Object.keys(env)) if (name.toUpperCase() === 'PSMODULEPATH') delete env[name];
    const settings = { encoding: 'utf8', timeout: 10_000, windowsHide: true, env };
    const before = spawnSync(ps, ['-NoProfile', '-NonInteractive', '-Command', command], settings);
    assert.equal(before.status, 0, 'synthetic ACL setup must succeed');
    await configureProject({ project: root, mode: 'platform', apply: true });
    const after = spawnSync(ps, ['-NoProfile', '-NonInteractive', '-Command', '(Get-Acl -LiteralPath $env:TANSR_TEST_ENV).Sddl'], settings);
    assert.equal(after.status, 0);
    // This fixture has only explicit ALLOW entries. Set-Acl may reorder them;
    // compare all SDDL entries plus its owner/group/control prefix independently
    // of the production binary-ACE signature implementation.
    const normalized = value => value.slice(0, value.indexOf('(')) + (value.match(/\([^)]*\)/g) ?? []).sort().join('');
    assert.equal(normalized(after.stdout.trim()) === normalized(before.stdout.trim()), true, 'ACL must not be widened');
  } else {
    await chmod(path, 0o600);
    await configureProject({ project: root, mode: 'platform', apply: true });
    assert.equal((await lstat(path)).mode & 0o777, 0o600);
  }
});

test('Windows legacy inherited permissions survive replacement without changing inheritance metadata', { skip: process.platform !== 'win32' }, async t => {
  const root = await fixture(t);
  const path = join(root, '.env');
  const command = `$ErrorActionPreference='Stop'
Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public static class LegacyAclFixture { [DllImport("advapi32.dll", CharSet=CharSet.Unicode, SetLastError=true)] public static extern bool SetFileSecurity(string name, uint information, byte[] descriptor); }'
$raw=[System.Security.AccessControl.RawSecurityDescriptor]::new((Get-Acl -LiteralPath $env:TANSR_TEST_ENV).GetSecurityDescriptorBinaryForm(),0)
if (([int]$raw.ControlFlags -band 4096) -ne 0 -or -not (@($raw.DiscretionaryAcl | Where-Object { ([int]$_.AceFlags -band 16) -ne 0 }).Count)) { throw 'fixture-must-inherit' }
$raw.SetFlags([System.Security.AccessControl.ControlFlags]([int]$raw.ControlFlags -band (-bnot 1024)))
$bytes=New-Object byte[] $raw.BinaryLength; $raw.GetBinaryForm($bytes,0)
if (-not [LegacyAclFixture]::SetFileSecurity($env:TANSR_TEST_ENV,4,$bytes)) { throw 'fixture-write-failed' }
$acl=Get-Acl -LiteralPath $env:TANSR_TEST_ENV
if (([int]([System.Security.AccessControl.RawSecurityDescriptor]::new($acl.GetSecurityDescriptorBinaryForm(),0)).ControlFlags -band 1024) -ne 0) { throw 'fixture-must-be-legacy' }
$acl.Sddl`;
  const env = { ...process.env, TANSR_TEST_ENV: path };
  for (const name of Object.keys(env)) if (name.toUpperCase() === 'PSMODULEPATH') delete env[name];
  const settings = { encoding: 'utf8', timeout: 10_000, windowsHide: true, env };
  const ps = await windowsPowerShell();
  const before = spawnSync(ps, ['-NoProfile', '-NonInteractive', '-Command', command], settings);
  assert.equal(before.status, 0, 'real inherited ACL fixture must retain its legacy control flags');
  const result = await configureProject({ project: root, mode: 'platform', apply: true });
  assert.equal(result.status, 'applied');
  noValues(result);
  assert.equal(await readFile(path, 'utf8'), ready.replace('offline', 'platform'));
  const after = spawnSync(ps, ['-NoProfile', '-NonInteractive', '-Command', '(Get-Acl -LiteralPath $env:TANSR_TEST_ENV).Sddl'], settings);
  assert.equal(after.status, 0);
  assert.equal(after.stdout.trim(), before.stdout.trim(), 'owner, group, control flags and every inherited ACE must remain exact');
  assert.equal((await readdir(root)).some(name => name.startsWith('.env.tansr-configure') || name === '.tansr-configure.lock'), false);
});

test('Windows ACL comparison accepts only equivalent allow order and rejects changed permissions, flags, owner or deny order', { skip: process.platform !== 'win32' }, async () => {
  const command = `$ErrorActionPreference='Stop'; ${WINDOWS_ACL_SIGNATURE}
function Signature($sddl) { Get-TansrRawAclSignature ([System.Security.AccessControl.RawSecurityDescriptor]::new($sddl)) }
try {
  $original=Signature 'O:SYG:SYD:P(A;;FR;;;SY)(A;;FW;;;BA)'
  $reordered=Signature 'O:SYG:SYD:P(A;;FW;;;BA)(A;;FR;;;SY)'
  $permissions=Signature 'O:SYG:SYD:P(A;;FA;;;SY)(A;;FW;;;BA)'
  $flags=Signature 'O:SYG:SYD:P(A;OI;FR;;;SY)(A;;FW;;;BA)'
  $owner=Signature 'O:BAG:SYD:P(A;;FR;;;SY)(A;;FW;;;BA)'
  $denyA=Signature 'O:SYG:SYD:P(D;;FR;;;SY)(D;;FW;;;BA)(A;;FA;;;SY)'
  $denyB=Signature 'O:SYG:SYD:P(D;;FW;;;BA)(D;;FR;;;SY)(A;;FA;;;SY)'
  $inheritedA=Signature 'O:SYG:SYD:AI(A;ID;FR;;;SY)(A;ID;FW;;;BA)'
  $inheritedB=Signature 'O:SYG:SYD:AI(A;ID;FW;;;BA)(A;ID;FR;;;SY)'
  $legacy=Signature 'O:SYG:SYD:(A;ID;FR;;;SY)(A;ID;FW;;;BA)'
  $noncanonicalRejected=$false
  try { $acl=[System.Security.AccessControl.FileSecurity]::new(); $acl.SetSecurityDescriptorSddlForm('O:SYG:SYD:P(A;;FR;;;SY)(D;;FW;;;BA)'); Get-TansrAclSignature $acl | Out-Null } catch { $noncanonicalRejected=$true }
  $nullRejected=$false
  try { Signature 'O:SYG:SYD:NO_ACCESS_CONTROL' | Out-Null } catch { $nullRejected=$true }
  $emptyAccepted=[bool](Signature 'O:SYG:SYD:P')
  $systemAclRejected=$false
  try { Signature 'O:SYG:SYD:P(A;;FR;;;SY)S:(AU;SA;FR;;;SY)' | Out-Null } catch { $systemAclRejected=$true }
  @{allowEquivalent=(Test-TansrAclSignatureEqual $original $reordered);permissionsRejected=(-not (Test-TansrAclSignatureEqual $original $permissions));flagsRejected=(-not (Test-TansrAclSignatureEqual $original $flags));ownerRejected=(-not (Test-TansrAclSignatureEqual $original $owner));denyOrderRejected=(-not (Test-TansrAclSignatureEqual $denyA $denyB));inheritedOrderRejected=(-not (Test-TansrAclSignatureEqual $inheritedA $inheritedB));inheritanceMetadataRejected=(-not (Test-TansrAclSignatureEqual $inheritedA $legacy));noncanonicalRejected=$noncanonicalRejected;nullRejected=$nullRejected;emptyAccepted=$emptyAccepted;systemAclRejected=$systemAclRejected;caseRejected=(-not (Test-TansrAclSignatureEqual 'AQ==' 'aQ=='))}|ConvertTo-Json -Compress
  exit 0
} catch { exit 1 }`;
  const env = { ...process.env };
  for (const name of Object.keys(env)) if (name.toUpperCase() === 'PSMODULEPATH') delete env[name];
  const result = spawnSync(await windowsPowerShell(), ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', command], { encoding: 'utf8', timeout: 10_000, windowsHide: true, env });
  assert.equal(result.status, 0, 'fixed ACL comparison must run within its bound');
  const checks = JSON.parse(result.stdout);
  assert.equal(Object.keys(checks).length, 12);
  assert.equal(Object.values(checks).every(value => value === true), true, `permission-preservation checks: ${JSON.stringify(checks)}`);
});

test('Windows shell resolution skips relative paths, prefers existing pwsh and falls back only when unavailable', { skip: process.platform !== 'win32' }, async t => {
  const root = await fixture(t);
  const absoluteBin = join(root, 'absolute-bin');
  const missingBin = join(root, 'missing-bin');
  await mkdir(absoluteBin);
  await writeFile(join(absoluteBin, 'pwsh.exe'), 'synthetic-invalid-executable');
  assert.equal(await windowsPowerShell(['.', 'relative-bin', missingBin, absoluteBin].join(delimiter)), join(absoluteBin, 'pwsh.exe'));
  assert.equal(await windowsPowerShell(['.', 'relative-bin', missingBin].join(delimiter), root), join(root, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'));
  // A discovered but non-runnable binary is an actual operation failure, not a
  // reason to try another engine or commit anyway. No shell/code is run here.
  const before = await readFile(join(root, '.env'));
  const child = spawnSync(process.execPath, [CONFIGURE, '--project', root, '--mode', 'platform', '--apply'], { encoding: 'utf8', timeout: 10_000, env: { ...process.env, PATH: absoluteBin } });
  assert.equal(child.status, 1);
  assert.equal(JSON.parse(child.stderr).code, 'permissions');
  noValues(child.stdout + child.stderr);
  assert.deepEqual(await readFile(join(root, '.env')), before);
  assert.equal((await readdir(root)).some(name => name.startsWith('.env.tansr-configure') || name === '.tansr-configure.lock'), false);
});

test('detected concurrent same-size edit is preserved instead of overwritten', { skip: process.platform !== 'win32' }, async t => {
  const root = await fixture(t);
  const newer = ready.replace('offline', 'platfrm'); // same byte count, invalid mode is deliberately left for the user
  const child = spawn(process.execPath, [CONFIGURE, '--project', root, '--mode', 'platform', '--apply'], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  let output = '';
  child.stdout.on('data', value => { output += value; });
  child.stderr.on('data', value => { output += value; });
  const done = new Promise((resolveDone, rejectDone) => { child.once('error', rejectDone); child.once('close', code => resolveDone(code)); });
  let observed = false;
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline && child.exitCode === null) {
    const entries = await readdir(root);
    if (entries.some(name => name.startsWith('.env.tansr-configure-') && name.endsWith('.tmp'))) {
      await writeFile(join(root, '.env'), newer);
      observed = true;
      break;
    }
    await delay(5);
  }
  if (!observed) child.kill();
  assert.equal(await done, 1);
  assert.equal(observed, true, 'must exercise a real edit after snapshot and before commit');
  noValues(output);
  assert.match(output, /concurrent/);
  assert.equal(await readFile(join(root, '.env'), 'utf8'), newer);
  assert.equal((await readdir(root)).some(name => name.startsWith('.env.tansr-configure') || name === '.tansr-configure.lock'), false);
});
