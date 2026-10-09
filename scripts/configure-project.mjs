// @ts-check
import { lstat, realpath, open, rename, unlink } from 'node:fs/promises';
import { isAbsolute, resolve, join, dirname, parse, delimiter } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseEnv } from 'node:util';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';

const WEB_NAMES = /** @type {const} */ (['TANSR_MODE', 'TANSR_APP_ID', 'TANSR_APP_KEY']);
const BACKEND_NAMES = ['TANSR_APP_KEY_ID', 'TANSR_APP_KEY'];
const SERVE_AUTH_NAMES = ['DEMO_AUTH_SECRET', 'DEMO_LOGIN_PASSWORD'];
const TRACKED_NAMES = [...new Set([...WEB_NAMES, ...BACKEND_NAMES, ...SERVE_AUTH_NAMES, 'MODEL_API_KEY'])];
const MAX_ENV_BYTES = 1024 * 1024;
const MESSAGES = {
  arguments: '必须指定工程绝对路径及 offline 或 platform 模式；不接收命令行凭据。',
  path: '工程路径或配置文件不安全：只支持已有普通工程目录，拒绝链接和共享硬链接。',
  project: '无法确认工程文件。请在本机检查 package.json；自动配置支持 Web、token-server 和 Serve 工程；其他工程只诊断。',
  missing: '尚无本工程 .env。请在本机从 .env.example 创建并录入所需变量，然后重新预演。',
  format: '配置包含不明确或不支持自动修改的格式。请在本机编辑器检查；不会显示原文。',
  credentials: '平台变量缺值、占位或存在多个候选。请在本机确认所列平台变量；后端使用 TANSR_APP_KEY_ID / TANSR_APP_KEY。',
  mode: '模式设置重复、无效或不适用于此工程。Web 保留一个明确的 offline/platform；后端只支持 platform，不设置 TANSR_MODE。',
  concurrent: '检测到配置或路径变化，已停止提交。请关闭并发编辑后重新预演。',
  locked: '配置辅助锁已存在。本次未提交；请确认其他配置操作已结束，再在本机检查锁文件。',
  permissions: '无法安全保留配置文件的现有权限，已停止提交；请在本机编辑器完成修改。',
  cleanup: '配置未提交，但辅助临时文件或锁未能清理。请在本机检查 .env.tansr-configure-*.tmp 和 .tansr-configure.lock，勿把内容复制到日志。',
  io: '配置操作未完成。请在本机检查文件访问权限和磁盘状态；不会显示底层错误或原文。',
};

class ConfigurationError extends Error {
  /** @param {keyof typeof MESSAGES} code */
  constructor(code) { super(MESSAGES[code]); this.code = code; }
}

/** @param {unknown} error */
export function configurationFailure(error) {
  const code = error instanceof ConfigurationError ? error.code : 'io';
  return { status: 'refused', code, next: MESSAGES[code] };
}

/** @param {unknown} error */
function isMissing(error) { return /** @type {NodeJS.ErrnoException} */ (error)?.code === 'ENOENT'; }
/** @param {import('node:fs').BigIntStats} a @param {import('node:fs').BigIntStats} b */
function sameIdentity(a, b) { return a.dev === b.dev && a.ino === b.ino; }
/** @param {import('node:fs').BigIntStats} a @param {import('node:fs').BigIntStats} b */
function sameFile(a, b) {
  return sameIdentity(a, b) && a.size === b.size && a.mtimeNs === b.mtimeNs && a.ctimeNs === b.ctimeNs && a.mode === b.mode && a.nlink === b.nlink;
}

/** Refuse symlinks/junctions at every parent, including the project itself. @param {string} root */
async function parents(root) {
  /** @type {{ path: string, stat: import('node:fs').BigIntStats }[]} */
  const entries = [];
  let cursor = root;
  for (;;) {
    const stat = await lstat(cursor, { bigint: true });
    if (stat.isSymbolicLink() || !stat.isDirectory()) throw new ConfigurationError('path');
    entries.push({ path: cursor, stat });
    const parent = dirname(cursor);
    if (parent === cursor) break;
    cursor = parent;
  }
  const actual = await realpath(root);
  const normalize = (/** @type {string} */ value) => process.platform === 'win32' ? value.toLowerCase() : value;
  if (normalize(actual) !== normalize(root)) throw new ConfigurationError('path');
  return entries;
}

/** Read through one descriptor; reject linked, shared or changed files. @param {string} path @param {boolean} [optional] */
async function readRegular(path, optional = false) {
  let before;
  try { before = await lstat(path, { bigint: true }); }
  catch (error) { if (optional && isMissing(error)) return null; throw error; }
  if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1n || before.size > BigInt(MAX_ENV_BYTES)) throw new ConfigurationError('path');
  const handle = await open(path, 'r');
  try {
    const opened = await handle.stat({ bigint: true });
    if (!sameFile(before, opened)) throw new ConfigurationError('concurrent');
    const bytes = await handle.readFile();
    const after = await handle.stat({ bigint: true });
    const named = await lstat(path, { bigint: true });
    if (named.isSymbolicLink() || !sameFile(opened, after) || !sameFile(after, named)) throw new ConfigurationError('concurrent');
    return { bytes, stat: after };
  } finally { await handle.close(); }
}

/** @param {string} project */
async function snapshot(project) {
  if (typeof project !== 'string' || !isAbsolute(project)) throw new ConfigurationError('arguments');
  if (process.platform === 'win32' && !/^[A-Za-z]:[\\/]/.test(project)) throw new ConfigurationError('path');
  const root = resolve(project);
  if (root === parse(root).root) throw new ConfigurationError('path');
  const chain = await parents(root);
  const pkg = await readRegular(join(root, 'package.json'));
  let data;
  let receipt;
  try {
    data = JSON.parse(pkg?.bytes.toString('utf8') ?? 'null');
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error();
    const marker = await readRegular(join(root, 'tansr-project.json'), true);
    receipt = marker ? JSON.parse(marker.bytes.toString('utf8')) : null;
  } catch (error) { if (error instanceof ConfigurationError) throw error; throw new ConfigurationError('project'); }
  const web = Boolean(await readRegular(join(root, 'product.config.json'), true));
  /** @type {'web'|'managed'|'token-server'|'serve'} */
  let projectType = web ? 'web' : 'managed';
  const hint = receipt?.template;
  const hasStart = typeof data.scripts?.start === 'string';
  if (!web && (hint === 'token-server' || data.name === 'tansr-example-token-server')) {
    if (!hasStart || typeof data.dependencies?.express !== 'string' || !await readRegular(join(root, 'server.mjs'), true)) throw new ConfigurationError('project');
    projectType = 'token-server';
  } else if (!web && (hint === 'serve' || data.name === 'tansr-standalone-serve-demo')) {
    if (!hasStart || typeof data.dependencies?.['@tansr/serve'] !== 'string' || typeof data.dependencies?.['@tansr/api-client'] !== 'string') throw new ConfigurationError('project');
    projectType = 'serve';
  }
  const env = await readRegular(join(root, '.env'), true);
  const backend = projectType === 'token-server' || projectType === 'serve';
  return { root, chain, env, web, backend, projectType };
}

/** @typedef {{ name: string, start: number, end: number, hash: number, commented: boolean, value: string | undefined, valueStart: number, valueEnd: number, multiline: boolean, invalid: boolean }} Assignment */

/**
 * Node parseEnv is the authority for values. This scanner only locates records for
 * diagnostics and byte-preserving edits. Quotes terminate as Node does (a
 * backslash does not escape the delimiter). Skip ALL quoted multiline records so
 * apparent comments inside another variable never become credential candidates.
 * Unusual/malformed syntax is diagnosed conservatively and is never rewritten.
 * @param {string} text
 */
function analyze(text) {
  /** @type {Assignment[]} */
  const records = [];
  let limited = text.includes('\0') || /\r(?!\n)/.test(text) || text.startsWith('\uFEFF');
  let multiline = false;
  let offset = 0;
  while (offset < text.length) {
    const newline = text.indexOf('\n', offset);
    const physicalEnd = newline < 0 ? text.length : newline;
    const lineEnd = physicalEnd > offset && text[physicalEnd - 1] === '\r' ? physicalEnd - 1 : physicalEnd;
    const line = text.slice(offset, lineEnd);
    const prefix = /^[ \t]*/.exec(line)?.[0].length ?? 0;
    const commented = line[prefix] === '#';
    const hash = commented ? offset + prefix : -1;
    const contentStart = commented ? prefix + 1 : 0;
    const match = /^[ \t]*(?:export +)?([A-Za-z_][A-Za-z0-9_]*)[ \t]*=[ \t]*/.exec(line.slice(contentStart));
    if (!match) {
      if (!commented && line.trim()) limited = true;
      offset = newline < 0 ? text.length : newline + 1;
      continue;
    }
    const name = match[1];
    const valueStart = offset + contentStart + match[0].length;
    const quote = text[valueStart];
    let valueEnd = lineEnd;
    let end = newline < 0 ? text.length : newline + 1;
    let invalid = false;
    let recordMultiline = false;
    if (quote === '"' || quote === "'" || quote === '`') {
      const close = text.indexOf(quote, valueStart + 1);
      if (close < 0 || (commented && close >= lineEnd)) {
        invalid = true;
      } else {
        recordMultiline = close >= physicalEnd;
        valueEnd = close + 1;
        const lastNewline = text.indexOf('\n', close);
        const trailingEnd = lastNewline < 0 ? text.length : lastNewline;
        const trailing = text.slice(close + 1, trailingEnd).trim();
        if (trailing && !trailing.startsWith('#')) invalid = true;
        end = lastNewline < 0 ? text.length : lastNewline + 1;
      }
    } else {
      const inlineHash = text.indexOf('#', valueStart);
      if (inlineHash >= 0 && inlineHash < lineEnd) valueEnd = inlineHash;
      while (valueEnd > valueStart && /[ \t]/.test(text[valueEnd - 1])) valueEnd--;
    }
    const raw = commented ? text.slice(offset, hash) + text.slice(hash + 1, end) : text.slice(offset, end);
    const value = parseEnv(raw)[name];
    if (value === undefined) invalid = true;
    if (invalid && (!commented || TRACKED_NAMES.includes(name))) limited = true;
    multiline ||= recordMultiline;
    records.push({ name, start: offset, end, hash, commented, value, valueStart, valueEnd, multiline: recordMultiline, invalid });
    offset = end;
  }
  const values = parseEnv(text);
  // Node's main-thread process.env is case-insensitive on Windows. Refuse to
  // rewrite aliases rather than claiming a lower-case key is inactive there.
  const noncanonical = new Set(Object.keys(values).filter(name => process.platform === 'win32' && TRACKED_NAMES.includes(name.toUpperCase()) && name !== name.toUpperCase()).map(name => name.toUpperCase()));
  limited ||= noncanonical.size > 0;
  for (const name of TRACKED_NAMES) {
    const active = records.filter(record => record.name === name && !record.commented);
    if (values[name] !== active.at(-1)?.value) limited = true;
  }
  return { records, values, limited, multiline, noncanonical };
}

/** @param {string | undefined} value */
function valueState(value) {
  if (value === undefined) return 'missing';
  if (!value.trim()) return 'empty';
  if (/^(?:REPLACE(?:_|\b)|YOUR(?:_|\b)|CHANGE[_ -]?ME\b|TODO\b|<[^>]*>|\$\{[^}]*\})/i.test(value.trim())) return 'placeholder';
  return 'configured';
}

/** @param {ReturnType<typeof analyze>} parsed @param {string} name */
function variableStatus(parsed, name) {
  const active = parsed.records.filter(record => record.name === name && !record.commented);
  const comments = parsed.records.filter(record => record.name === name && record.commented);
  const filled = comments.filter(record => valueState(record.value) === 'configured');
  const activeStatus = parsed.noncanonical.has(name) ? 'noncanonical' : active.length > 1 ? 'duplicate' : active.some(record => record.invalid) ? 'invalid' : valueState(active[0]?.value);
  const commentedStatus = comments.some(record => record.invalid) ? 'invalid' : filled.length > 1 ? 'ambiguous' : filled.length === 1 ? 'configured' : comments.some(record => valueState(record.value) === 'placeholder') ? 'placeholder' : comments.length ? 'empty' : 'none';
  return { name, active: activeStatus, commented: commentedStatus, format: [...active, ...comments].some(record => record.multiline) ? 'multiline' : 'single-line' };
}

/** @param {Awaited<ReturnType<typeof snapshot>>} saved @param {string | undefined} expectedMode */
function report(saved, expectedMode) {
  const text = saved.env?.bytes.toString('utf8') ?? '';
  const parsed = analyze(text);
  if (saved.env && !saved.env.bytes.equals(Buffer.from(text))) parsed.limited = true;
  const names = saved.web ? WEB_NAMES : saved.projectType === 'serve' ? [...BACKEND_NAMES, ...SERVE_AUTH_NAMES] : saved.backend ? BACKEND_NAMES : ['MODEL_API_KEY'];
  const variables = names.map(name => {
    const status = variableStatus(parsed, name);
    return saved.projectType === 'serve' && name === 'DEMO_AUTH_SECRET' && status.active === 'configured' && (parsed.values[name]?.length ?? 0) < 32 ? { ...status, active: 'invalid' } : status;
  });
  const rawMode = saved.web ? parsed.values.TANSR_MODE ?? 'offline' : saved.backend ? 'platform' : 'managed';
  const unsupportedBackendMode = saved.backend && parsed.records.some(record => record.name === 'TANSR_MODE' && !record.commented);
  const mode = !unsupportedBackendMode && !parsed.noncanonical.has('TANSR_MODE') && ['offline', 'platform', 'managed'].includes(rawMode) && (!saved.web || rawMode !== 'managed') ? rawMode : 'invalid';
  const credentials = saved.backend ? BACKEND_NAMES : WEB_NAMES.slice(1);
  const required = saved.projectType === 'serve' ? [...BACKEND_NAMES, ...SERVE_AUTH_NAMES] : saved.backend || mode === 'platform' ? credentials : mode === 'managed' ? ['MODEL_API_KEY'] : [];
  const platformConfigured = BACKEND_NAMES.every(name => variables.find(variable => variable.name === name)?.active === 'configured');
  const authReady = SERVE_AUTH_NAMES.every(name => variables.find(variable => variable.name === name)?.active === 'configured');
  const missingConfigurationNames = required.filter(name => variables.find(variable => variable.name === name)?.active !== 'configured');
  const inactiveCredentials = saved.web && mode === 'offline' && variables.some(variable => variable.name !== 'TANSR_MODE' && (variable.active === 'configured' || variable.commented === 'configured'));
  const modeStatus = mode === 'invalid' ? 'invalid' : variables.some(variable => variable.name === 'TANSR_MODE' && variable.active === 'duplicate') ? 'duplicate' : expectedMode && mode !== expectedMode ? 'mismatch' : inactiveCredentials ? 'credentials-inactive' : 'matched';
  const attention = modeStatus !== 'matched' || missingConfigurationNames.length > 0 || variables.some(variable => ['duplicate', 'invalid'].includes(variable.active) || ['configured', 'ambiguous', 'invalid'].includes(variable.commented) && variable.name !== 'TANSR_MODE');
  const environmentFilePath = join(saved.root, '.env');
  return {
    environmentFilePresent: saved.env !== null, environmentFilePath, environmentFileLink: '[.env](<' + environmentFilePath.replaceAll('\\', '/') + '>)',
    projectType: saved.projectType, mode, modeStatus, startCommand: 'npm start',
    ...(saved.backend ? { platformConfigured } : {}),
    ...(saved.projectType === 'serve' ? { authReady, configureCommand: 'npm run configure', loginCommand: 'npm run login' } : {}),
    ...(expectedMode ? { expectedMode } : {}),
    configurationStatus: parsed.limited ? 'limited' : attention ? 'needs-attention' : 'ready',
    variables, missingConfigurationNames,
    next: parsed.limited ? MESSAGES.format : unsupportedBackendMode ? '此后端只提供平台接线，不读取 TANSR_MODE；请移除该无效模式设置后重新预演。' : modeStatus === 'mismatch' || modeStatus === 'credentials-inactive' ? '配置模式与预期或已填平台变量不一致。确认意图后，用 configure-project 显式指定模式先预演；不会自动启用平台。' : saved.projectType === 'serve' && !authReady ? '先按 README 运行本工程 npm run configure，只初始化缺失的本机登录材料并保留已有登录配置；再在本机填写平台变量并重新预演。' : attention ? '所列变量需要本机确认。无 .env 时从 .env.example 在本机创建；填值仅在本机编辑器进行，注释中的值尚未启用，可先预演。' : mode === 'offline' ? '当前为离线模式。接入平台前，请在本机填写 TANSR_APP_ID 和 TANSR_APP_KEY，再显式预演 platform 配置。' : '静态配置已就绪。已有可用后端应复用；按本工程 README 启动并验证登录和就绪状态。配置辅助本身不会联网、启动服务或调用模型。',
  };
}

/** Safe, value-free diagnostics shared with doctor. @param {string} project @param {string} [expectedMode] */
export async function inspectConfiguration(project, expectedMode) {
  if (expectedMode !== undefined && !['offline', 'platform', 'managed'].includes(expectedMode)) throw new ConfigurationError('arguments');
  try { return report(await snapshot(project), expectedMode); }
  catch (error) { throw error instanceof ConfigurationError ? error : new ConfigurationError('io'); }
}

/** @param {Awaited<ReturnType<typeof snapshot>>} saved */
async function unchanged(saved) {
  const chain = await parents(saved.root);
  if (chain.length !== saved.chain.length || chain.some((entry, i) => !sameIdentity(entry.stat, saved.chain[i].stat))) throw new ConfigurationError('concurrent');
  const current = await readRegular(join(saved.root, '.env'));
  if (!saved.env || !current || !sameFile(saved.env.stat, current.stat) || !saved.env.bytes.equals(current.bytes)) throw new ConfigurationError('concurrent');
}

// Kept as one fixed, credential-free script so the real .NET descriptor handling
// can be regression-tested. Only equivalent explicit ALLOW permutations in one
// consecutive flags/qualifier group are ignored. DENY and inherited order stay
// significant; noncanonical, callback and object-specific ACLs are refused.
export const WINDOWS_ACL_SIGNATURE = String.raw`
function Get-TansrAclSignature([System.Security.AccessControl.FileSecurity] $acl) {
  if (-not $acl.AreAccessRulesCanonical) { throw 'unsupported-acl' }
  $raw = [System.Security.AccessControl.RawSecurityDescriptor]::new($acl.GetSecurityDescriptorBinaryForm(), 0)
  return Get-TansrRawAclSignature $raw
}
function Get-TansrRawAclSignature([System.Security.AccessControl.RawSecurityDescriptor] $raw) {
  if ($null -eq $raw.DiscretionaryAcl -or $null -ne $raw.SystemAcl -or ([int]$raw.ControlFlags -band 16) -ne 0) { throw 'unsupported-acl' }
  $parts = @()
  [string[]] $run = @()
  $group = $null
  $sortable = $false
  foreach ($ace in $raw.DiscretionaryAcl) {
    if ($ace -isnot [System.Security.AccessControl.CommonAce] -or $ace.IsCallback -or [int]$ace.AceQualifier -gt 1) { throw 'unsupported-acl' }
    $key = [string][int]$ace.AceQualifier + ':' + [string][int]$ace.AceFlags
    if ($null -ne $group -and $key -cne $group) {
      if ($sortable) { [Array]::Sort($run, [StringComparer]::Ordinal) }
      $parts += $group + '=' + ($run -join ',')
      $run = @()
    }
    $group = $key
    $sortable = [int]$ace.AceQualifier -eq 0 -and ([int]$ace.AceFlags -band 16) -eq 0
    $bytes = New-Object byte[] $ace.BinaryLength
    $ace.GetBinaryForm($bytes, 0)
    $run += [Convert]::ToBase64String($bytes)
  }
  if ($null -ne $group) {
    if ($sortable) { [Array]::Sort($run, [StringComparer]::Ordinal) }
    $parts += $group + '=' + ($run -join ',')
  }
  return $raw.Owner.Value + '|' + $raw.Group.Value + '|' + [string][int]$raw.ControlFlags + '|' + [string]$raw.ResourceManagerControl + '|' + [string]$raw.DiscretionaryAcl.Revision + '|' + ($parts -join ';')
}
function Test-TansrAclSignatureEqual([string] $a, [string] $b) {
  return [String]::Equals($a, $b, [StringComparison]::Ordinal)
}
`;

/** Resolve an existing local PATH executable, never an implicit current-directory command. @param {string} [searchPath] @param {string} [systemRoot] */
export async function windowsPowerShell(searchPath = process.env.PATH ?? '', systemRoot = process.env.SystemRoot ?? 'C:\\Windows') {
  for (const entry of searchPath.split(delimiter)) {
    const directory = entry.trim().replace(/^"(.*)"$/, '$1');
    if (!isAbsolute(directory) || !/^[A-Za-z]:[\\/]/.test(directory)) continue;
    const candidate = join(directory, 'pwsh.exe');
    try {
      const stat = await lstat(candidate);
      if (stat.isFile() && !stat.isSymbolicLink()) return candidate;
    } catch (error) { if (!isMissing(error)) throw new ConfigurationError('permissions'); }
  }
  return join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
}

/** Preserve existing permissions before replacement; mode alone is not Windows ACL. @param {string} source @param {string} temporary @param {import('node:fs/promises').FileHandle} handle @param {import('node:fs').BigIntStats} stat */
async function preservePermissions(source, temporary, handle, stat) {
  if (process.platform === 'win32') {
    const command = `$ErrorActionPreference='Stop'; ${WINDOWS_ACL_SIGNATURE}; try {
  $acl=Get-Acl -LiteralPath $env:TANSR_CONFIG_SOURCE
  $expected=Get-TansrAclSignature $acl
  $binary=$acl.GetSecurityDescriptorBinaryForm()
  $raw=[System.Security.AccessControl.RawSecurityDescriptor]::new($binary,0)
  $legacy=-not $acl.AreAccessRulesProtected -and ([int]$raw.ControlFlags -band 1024) -eq 0
  Set-Acl -LiteralPath $env:TANSR_CONFIG_TEMP -AclObject $acl
  # Set-Acl converts legacy inherited ACLs to the automatic inheritance model.
  # Preserve the original DACL, including its control flags, on the EMPTY staging
  # file. This narrow legacy API use never retries a failed Set-Acl operation.
  if ($legacy) {
    Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public static class TansrLegacyAcl { [DllImport("advapi32.dll", EntryPoint="SetFileSecurityW", CharSet=CharSet.Unicode, ExactSpelling=true, SetLastError=true)] [return: MarshalAs(UnmanagedType.Bool)] public static extern bool SetFileSecurity(string name, uint information, byte[] descriptor); }'
    if (-not [TansrLegacyAcl]::SetFileSecurity($env:TANSR_CONFIG_TEMP,4,$binary)) { throw 'permissions' }
  }
  if (-not (Test-TansrAclSignatureEqual (Get-TansrAclSignature (Get-Acl -LiteralPath $env:TANSR_CONFIG_TEMP)) $expected)) { exit 2 }
  if (-not (Test-TansrAclSignatureEqual (Get-TansrAclSignature (Get-Acl -LiteralPath $env:TANSR_CONFIG_SOURCE)) $expected)) { exit 2 }
  exit 0
} catch { exit 1 }`;
    /** @type {NodeJS.ProcessEnv} */
    const env = { ...process.env, TANSR_CONFIG_SOURCE: source, TANSR_CONFIG_TEMP: temporary };
    // Cross-version inherited module paths can break the built-in Security module.
    // Let the selected child discover its own modules; never change user state.
    for (const name of Object.keys(env)) if (name.toUpperCase() === 'PSMODULEPATH') delete env[name];
    const result = spawnSync(await windowsPowerShell(), ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', command], {
      windowsHide: true, timeout: 10_000, stdio: 'ignore', env,
    });
    if (result.status !== 0 || result.error) throw new ConfigurationError('permissions');
  } else {
    const current = await handle.stat({ bigint: true });
    if (current.uid !== stat.uid || current.gid !== stat.gid) await handle.chown(Number(stat.uid), Number(stat.gid));
    await handle.chmod(Number(stat.mode & 0o777n));
  }
}

/** Remove only a temporary file/lock that still has our recorded identity. @param {string} path @param {import('node:fs').BigIntStats | undefined} owned */
async function cleanOwned(path, owned) {
  if (!owned) return true;
  try {
    const current = await lstat(path, { bigint: true });
    if (current.isSymbolicLink() || !sameIdentity(current, owned)) return false;
    await unlink(path);
    return true;
  } catch (error) { return isMissing(error); }
}

/**
 * Existing .env only. No credentials accepted through options/environment.
 * Cooperating helpers use an exclusive lock; full bytes and path identities are
 * rechecked before rename. Node has no pathname CAS: this does not isolate a
 * noncooperating writer acting after the last check. Never retry/restore blindly.
 * @param {{ project: string, mode: string, apply?: boolean }} options
 */
export async function configureProject({ project, mode, apply = false }) {
  if (!['offline', 'platform'].includes(mode) || typeof apply !== 'boolean') throw new ConfigurationError('arguments');
  try {
    const saved = await snapshot(project);
    if (!saved.web && !saved.backend) throw new ConfigurationError('project');
    if (saved.backend && mode !== 'platform') throw new ConfigurationError('mode');
    if (!saved.env) throw new ConfigurationError('missing');
    const text = saved.env.bytes.toString('utf8');
    if (!Buffer.from(text, 'utf8').equals(saved.env.bytes)) throw new ConfigurationError('format');
    const parsed = analyze(text);
    if (parsed.limited || parsed.multiline) throw new ConfigurationError('format');
    /** @type {{ start: number, end: number, text: string }[]} */
    const edits = [];
    /** @type {{ name: string, action: string }[]} */
    const changes = [];
    const credentials = saved.backend ? BACKEND_NAMES : WEB_NAMES.slice(1);
    const modeRecords = parsed.records.filter(record => record.name === 'TANSR_MODE' && !record.commented);
    if (saved.backend && modeRecords.length) throw new ConfigurationError('mode');
    if (modeRecords.length > 1 || modeRecords.length === 1 && !['offline', 'platform'].includes(modeRecords[0].value ?? '')) throw new ConfigurationError('mode');
    if (saved.web && modeRecords.length === 0) {
      const eol = text.includes('\r\n') ? '\r\n' : '\n';
      edits.push({ start: text.length, end: text.length, text: `${text && !text.endsWith('\n') ? eol : ''}TANSR_MODE=${mode}${eol}` });
      changes.push({ name: 'TANSR_MODE', action: 'add-explicit-mode' });
    } else if (saved.web && modeRecords[0].value !== mode) {
      edits.push({ start: modeRecords[0].valueStart, end: modeRecords[0].valueEnd, text: mode });
      changes.push({ name: 'TANSR_MODE', action: 'set-explicit-mode' });
    }
    if (mode === 'platform') {
      for (const name of credentials) {
        const records = parsed.records.filter(record => record.name === name);
        const active = records.filter(record => !record.commented);
        const candidates = records.filter(record => record.commented && valueState(record.value) === 'configured');
        if (active.length > 1 || candidates.length > 1 || active.length === 1 && valueState(active[0].value) === 'configured' && candidates.length) throw new ConfigurationError('credentials');
        if (active.length === 1 && valueState(active[0].value) === 'configured') continue;
        if (candidates.length !== 1) throw new ConfigurationError('credentials');
        // Retain a blank/template line as a comment, then activate the user's one
        // filled comment by removing just its comment marker.
        if (active.length) edits.push({ start: active[0].start, end: active[0].start, text: '# ' });
        edits.push({ start: candidates[0].hash, end: candidates[0].hash + 1, text: '' });
        changes.push({ name, action: 'activate-existing-comment' });
      }
    }
    let updated = text;
    for (const edit of edits.sort((a, b) => b.start - a.start)) updated = updated.slice(0, edit.start) + edit.text + updated.slice(edit.end);
    const checked = analyze(updated);
    if (checked.limited || saved.web && checked.values.TANSR_MODE !== mode || mode === 'platform' && credentials.some(name => valueState(checked.values[name]) !== 'configured')) throw new ConfigurationError('format');
    const result = { status: changes.length ? apply ? 'applied' : 'preview' : 'unchanged', mode, changes, configurationAfter: report({ ...saved, env: { ...saved.env, bytes: Buffer.from(updated) } }, mode), networkAccessed: false, applicationStarted: false };
    if (!apply || !changes.length) return result;

    const lockPath = join(saved.root, '.tansr-configure.lock');
    // The shipped .env.* ignore rule also covers interrupted sensitive staging.
    // Do not edit a user's .gitignore: verify their local ignore rules separately.
    const tempPath = join(saved.root, `.env.tansr-configure-${randomUUID()}.tmp`);
    let lock;
    let temporary;
    /** @type {import('node:fs').BigIntStats | undefined} */
    let lockIdentity;
    /** @type {import('node:fs').BigIntStats | undefined} */
    let tempIdentity;
    let committed = false;
    let cleanupComplete = true;
    try {
      try { lock = await open(lockPath, 'wx', 0o600); }
      catch (error) { if (/** @type {NodeJS.ErrnoException} */ (error).code === 'EEXIST') throw new ConfigurationError('locked'); throw error; }
      lockIdentity = await lock.stat({ bigint: true });
      await unchanged(saved);
      temporary = await open(tempPath, 'wx', 0o600);
      tempIdentity = await temporary.stat({ bigint: true });
      // Copy ACL BEFORE writing sensitive bytes to the temporary file.
      await preservePermissions(join(saved.root, '.env'), tempPath, temporary, saved.env.stat);
      await temporary.writeFile(updated, 'utf8');
      await temporary.sync();
      await temporary.close();
      temporary = undefined;
      await unchanged(saved);
      const tempNow = await readRegular(tempPath);
      if (!tempNow || !sameIdentity(tempNow.stat, tempIdentity) || !tempNow.bytes.equals(Buffer.from(updated))) throw new ConfigurationError('concurrent');
      await rename(tempPath, join(saved.root, '.env'));
      committed = true;
    } finally {
      if (temporary) { try { await temporary.close(); } catch { cleanupComplete = false; } }
      if (lock) { try { await lock.close(); } catch { cleanupComplete = false; } }
      cleanupComplete = await cleanOwned(tempPath, tempIdentity) && cleanupComplete;
      cleanupComplete = await cleanOwned(lockPath, lockIdentity) && cleanupComplete;
      // A successful rename is the commit point; cleanup never rolls it back.
      if (committed) result.status = cleanupComplete ? 'applied' : 'applied-cleanup-required';
      else if (!cleanupComplete) throw new ConfigurationError('cleanup');
    }
    return result;
  } catch (error) { throw error instanceof ConfigurationError ? error : new ConfigurationError('io'); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const args = process.argv.slice(2);
    if (![4, 5].includes(args.length) || args[0] !== '--project' || args[2] !== '--mode' || args.length === 5 && args[4] !== '--apply') throw new ConfigurationError('arguments');
    console.log(JSON.stringify(await configureProject({ project: args[1], mode: args[3], apply: args[4] === '--apply' }), null, 2));
  } catch (error) { console.error(JSON.stringify(configurationFailure(error))); process.exitCode = 1; }
}
