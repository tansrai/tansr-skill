#!/usr/bin/env node
// @ts-check
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/** @typedef {'install'|'preview'|'status'|'update'|'rollback'|'uninstall'|'recover'} Action */
/** @typedef {{command: Action|'hosts'|'help'|'version', host?: string, scope?: string, project?: string, yes: boolean, json: boolean, dryRun: boolean}} Arguments */
/** @typedef {{schemaVersion: number, action: string, ok: boolean, exitCode: number, status: string, targetPath: string, statePath: string, version?: string|null, changes: {added: string[], updated: string[], removed: string[]}, preserved: unknown[], warnings: unknown[], recoveryRequired: boolean, filesInstalled?: boolean|null, staticStructureValid?: boolean|null}} EngineResult */
/** @typedef {import('./engine.mjs').Options} EngineOptions */
/** @typedef {Record<Action, (options: EngineOptions) => Promise<EngineResult>>} Engine */
/** @typedef {{host: string, scope: string, targetPath: string, loading: unknown}} HostTarget */
/** @typedef {{cwd?: string, home?: string, packageRoot?: string, nodeVersion?: string, input?: NodeJS.ReadableStream, output?: NodeJS.WritableStream, errorOutput?: NodeJS.WritableStream, isTTY?: boolean, prompt?: (question: string) => Promise<string>, loadEngine?: () => Promise<Engine>}} CliContext */
/** @typedef {{id: string, version: string}} TemplateBaseline */
/** @typedef {{id: string, name: string, version: string}} RuntimeBaseline */
/** @typedef {{packageName: string, binName: string, version: string, node: string, skillVersion: string, templateBaselines: TemplateBaseline[], runtimeBaselines: RuntimeBaseline[]}} Release */

const commands = new Set(['install', 'preview', 'status', 'update', 'rollback', 'uninstall', 'recover', 'hosts']);
const mutations = new Set(['install', 'update', 'rollback', 'uninstall', 'recover']);
const moduleRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

class CliError extends Error {
  /** @param {string} code @param {string} message @param {number} [exitCode] */
  constructor(code, message, exitCode = 2) {
    super(message); this.code = code; this.exitCode = exitCode;
  }
}

/** Parse without touching disk, starting an engine or asking for input. @param {string[]} argv @returns {Arguments} */
export function parseArguments(argv) {
  /** @type {Arguments} */
  const parsed = { command: 'install', yes: false, json: false, dryRun: false };
  const seen = new Set();
  let hasCommand = false;
  for (let i = 0; i < argv.length; i++) {
    const raw = argv[i];
    const equals = raw.indexOf('=');
    const flag = equals === -1 ? raw : raw.slice(0, equals);
    const inline = equals === -1 ? undefined : raw.slice(equals + 1);
    if (['--host', '--scope', '--project'].includes(flag)) {
      if (seen.has(flag)) throw new CliError('DUPLICATE_OPTION', `选项不可重复 / Duplicate option: ${flag}`);
      seen.add(flag);
      const value = inline === undefined ? argv[++i] : inline;
      if (!value || value.startsWith('-')) throw new CliError('MISSING_VALUE', `选项需要值 / Missing value: ${flag}`);
      if (flag === '--host') parsed.host = value;
      if (flag === '--scope') parsed.scope = value;
      if (flag === '--project') parsed.project = value;
    } else if (['--yes', '--json', '--dry-run', '--help', '-h', '--version', '-v'].includes(flag)) {
      if (inline !== undefined) throw new CliError('INVALID_OPTION', `选项不接受值 / Flag takes no value: ${flag}`);
      const canonical = flag === '-h' ? '--help' : flag === '-v' ? '--version' : flag;
      if (seen.has(canonical)) throw new CliError('DUPLICATE_OPTION', `选项不可重复 / Duplicate option: ${canonical}`);
      seen.add(canonical);
      if (canonical === '--yes') parsed.yes = true;
      if (canonical === '--json') parsed.json = true;
      if (canonical === '--dry-run') parsed.dryRun = true;
    } else if (commands.has(raw) && !hasCommand) {
      parsed.command = /** @type {Arguments['command']} */ (raw); hasCommand = true;
    } else {
      throw new CliError('INVALID_ARGUMENT', `未知或多余参数 / Unknown or extra argument: ${raw}. 使用 / Run --help.`);
    }
  }
  if (seen.has('--help') && seen.has('--version')) throw new CliError('INVALID_ARGUMENT', '--help 与 --version 不能同时使用 / Choose --help or --version.');
  if (seen.has('--help')) parsed.command = 'help';
  if (seen.has('--version')) parsed.command = 'version';
  if (parsed.host !== undefined && !['codex', 'workbuddy'].includes(parsed.host)) throw new CliError('INVALID_HOST', '--host 必须为 / must be codex or workbuddy.');
  if (parsed.scope !== undefined && !['project', 'user'].includes(parsed.scope)) throw new CliError('INVALID_SCOPE', '--scope 必须为 / must be project or user.');
  if (parsed.project !== undefined && !path.isAbsolute(parsed.project)) throw new CliError('INVALID_PROJECT', '--project 必须为绝对路径 / must be an absolute path.');
  if (parsed.project !== undefined && parsed.scope === 'user') throw new CliError('INVALID_SCOPE', '--project 仅适用于 --scope project / --project requires project scope.');
  if (parsed.dryRun && !['install', 'update'].includes(parsed.command)) throw new CliError('INVALID_ARGUMENT', '--dry-run 仅适用于 install/update / --dry-run requires install or update.');
  if (parsed.command === 'hosts' && (parsed.host || parsed.scope || parsed.project || parsed.yes)) throw new CliError('INVALID_ARGUMENT', 'hosts 仅列出宿主；使用 hosts --json / hosts only lists adapters; use hosts --json.');
  return parsed;
}

/** @param {string} version @param {string} [minimum] */
export function supportsNode(version, minimum = '22.19') {
  const actual = /^(\d+)\.(\d+)\.(\d+)(?:$|-)/.exec(version);
  const required = /^(\d+)\.(\d+)(?:\.(\d+))?$/.exec(minimum);
  if (!actual || !required || version.includes('-')) return false;
  for (let i = 1; i <= 3; i++) {
    const a = Number(actual[i]), b = Number(required[i] || 0);
    if (a !== b) return a > b;
  }
  return true;
}

/** @param {unknown} version */
function validVersion(version) { return typeof version === 'string' && /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version); }

/** @param {unknown} values @param {string[]} ids @param {boolean} runtime */
function validBaselines(values, ids, runtime) {
  return Array.isArray(values) && values.length === ids.length && new Set(values.map(value => value?.id)).size === ids.length
    && values.every(value => value && typeof value === 'object' && ids.includes(value.id) && validVersion(value.version)
      && (!runtime || value.name === `@tansr/${value.id}`));
}

/** @param {string} root @returns {Promise<Release>} */
async function readRelease(root) {
  try {
    const value = JSON.parse(await readFile(path.join(root, 'release.json'), 'utf8'));
    if (value?.schemaVersion !== 1 || value.packageName !== '@tansr/skill' || value.binName !== 'tansr-skill'
      || !validVersion(value.version) || !validVersion(value.skillVersion) || value.node !== '>=22.19'
      || !validBaselines(value.templateBaselines, ['web', 'node'], false)
      || !validBaselines(value.runtimeBaselines, ['sdk', 'serve'], true)) throw new Error('Invalid release metadata');
    const release = /** @type {Release} */ (value);
    return {
      packageName: release.packageName, binName: release.binName, version: release.version, node: release.node, skillVersion: release.skillVersion,
      templateBaselines: release.templateBaselines.map(({ id, version }) => ({ id, version })),
      runtimeBaselines: release.runtimeBaselines.map(({ id, name, version }) => ({ id, name, version })),
    };
  } catch {
    throw new CliError('INVALID_RELEASE', '发行元数据缺失或损坏；请重新获取官方包 / Release metadata is missing or invalid; obtain the official package again.', 3);
  }
}

/** @param {string} root @returns {Promise<unknown>} */
async function readManifest(root) {
  try { return JSON.parse(await readFile(path.join(root, 'manifest.json'), 'utf8')); }
  catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      throw new CliError('PACKAGE_NOT_BUILT', '未找到随包 manifest.json；开发仓请先运行 pnpm build，再使用生成包中的安装器 / Package manifest missing; build the workspace with pnpm build and use the generated package.', 3);
    }
    throw new CliError('INVALID_MANIFEST', '无法读取安装包清单；请重新获取官方包 / Package manifest cannot be read; obtain the official package again.', 3);
  }
}

/** @param {{binName: string, packageName: string, version: string, node: string}} release */
function helpText(release) {
  return `Tansr Skill ${release.version} — 安装后向助手描述你想做的 AI 产品 / Install, then describe your AI product.\n\n`
    + `用法 / Usage: ${release.binName} [install|preview|status|update|rollback|uninstall|recover|hosts] [options]\n`
    + `默认命令 / Default: install. Node ${release.node}; 无第三方运行依赖 / no third-party runtime dependencies.\n\n`
    + '  --host codex|workbuddy  选择一个助手 / Choose one assistant\n'
    + '  --scope project|user   明确安装范围 / Choose the installation scope\n'
    + '  --project <absolute>   项目绝对路径，默认当前目录 / Absolute project path; defaults to cwd\n'
    + '  --yes                  确认更改 / Confirm changes\n'
    + '  --json                 结构化输出且不询问 / JSON output; never prompts\n'
    + '  --dry-run              install/update 只读预览 / Read-only install/update preview\n'
    + '  --help, -h             查看帮助 / Show help\n'
    + '  --version, -v          查看版本 / Show version\n\n'
    + '示例 / Example: tansr-skill install --host codex --scope project --yes\n'
    + '无人值守执行需明确 host/scope，更改还需 --yes / Noninteractive use requires host/scope and --yes for changes.\n'
    + '用户级安装仅在显式选择 user 后执行 / User-wide installation requires explicit user scope.\n'
    + 'preview/status 为只读；recover 仅在确认后恢复中断事务 / preview/status are read-only; recover requires confirmation.\n'
    + '本地运行不下载内容、不调用模型；首次 npx 获取包需要网络 / Local execution uses bundled files; initial npx download needs network.\n'
    + '找不到 Node 或 npx 时，先安装 Node 22.19+ 与 npm / If Node or npx is missing, install Node 22.19+ and npm.\n';
}

/** @param {unknown} error */
function errorInfo(error) {
  const data = error instanceof Error ? /** @type {Error & {code?: unknown, exitCode?: unknown, details?: unknown}} */ (error) : undefined;
  const code = typeof data?.code === 'string' ? data.code : 'CLI_ERROR';
  const exitCode = typeof data?.exitCode === 'number' && Number.isInteger(data.exitCode) && data.exitCode > 0 && data.exitCode < 256 ? data.exitCode : 5;
  let message = data?.message || '安装器失败 / Installer failed.';
  const fsCode = data?.details && typeof data.details === 'object' && 'fsCode' in data.details ? data.details.fsCode : undefined;
  if (['EACCES', 'EPERM'].includes(code) || fsCode === 'EACCES' || fsCode === 'EPERM') message += ' 请使用当前用户可写的目标目录并检查文件权限 / Choose a writable target and check its permissions.';
  return { code, exitCode, message, ...(data?.details === undefined ? {} : { details: data.details }) };
}

/** Run without exiting the embedding process; the executable wrapper applies its return code.
 * Test injection is local to this function and is never exposed as a CLI option.
 * @param {string[]} [argv] @param {CliContext} [context] @returns {Promise<number>}
 */
export async function runCli(argv = process.argv.slice(2), context = {}) {
  const output = context.output ?? process.stdout;
  const errorOutput = context.errorOutput ?? process.stderr;
  const input = context.input ?? process.stdin;
  const json = argv.includes('--json');
  const terminal = context.isTTY ?? Boolean(/** @type {{isTTY?: boolean}} */ (input).isTTY && /** @type {{isTTY?: boolean}} */ (output).isTTY);
  const interactive = terminal && !json;
  const root = context.packageRoot ?? moduleRoot;
  /** @type {import('node:readline/promises').Interface|undefined} */ let reader;
  /** @type {Arguments|undefined} */ let parsed;
  /** @type {HostTarget|undefined} */ let target;
  /** @param {string} question */
  const ask = async question => {
    if (!interactive) throw new CliError('INPUT_REQUIRED', '非交互模式不会询问；请补齐参数 / Noninteractive mode never prompts; supply explicit options.');
    if (context.prompt) return context.prompt(question);
    reader ??= (await import('node:readline/promises')).createInterface({ input, output });
    try { return await reader.question(question); }
    catch { throw new CliError('INPUT_CLOSED', '输入已关闭，未确认更改 / Input closed without confirmation.'); }
  };
  try {
    parsed = parseArguments(argv);
    const release = await readRelease(root);
    const nodeVersion = context.nodeVersion ?? process.versions.node;
    if (!supportsNode(nodeVersion, release.node.slice(2))) throw new CliError('UNSUPPORTED_NODE', `需要 Node ${release.node}，当前 ${nodeVersion}；升级 Node 后重试 / Node ${release.node} required; upgrade Node and retry.`, 3);
    if (parsed.command === 'help' || parsed.command === 'version') {
      const text = parsed.command === 'help' ? helpText(release) : `${release.version}\n`;
      output.write(json ? `${JSON.stringify({ schemaVersion: 1, action: parsed.command, ok: true, exitCode: 0, ...release, ...(parsed.command === 'help' ? { help: text } : {}) })}\n` : text);
      return 0;
    }
    const adapters = await import('./hosts.mjs');
    if (parsed.command === 'hosts') {
      const hosts = adapters.listHosts();
      output.write(json ? `${JSON.stringify({ schemaVersion: 1, action: 'hosts', ok: true, exitCode: 0, hosts })}\n` : `宿主安装合同 / Host installation contracts:\n${JSON.stringify(hosts, null, 2)}\n实际发现及调用需要在宿主内验证 / Discovery and invocation require verification in the host.\n`);
      return 0;
    }
    if (!parsed.host) {
      if (!interactive) throw new CliError('HOST_REQUIRED', '请指定 --host codex 或 --host workbuddy / Specify --host codex or --host workbuddy.');
      const answer = (await ask('选择助手 / Host [1 codex, 2 workbuddy]: ')).trim().toLowerCase();
      parsed.host = answer === '1' ? 'codex' : answer === '2' ? 'workbuddy' : answer;
      if (!['codex', 'workbuddy'].includes(parsed.host)) throw new CliError('INVALID_HOST', '未选择有效宿主 / No valid host selected.');
    }
    if (!parsed.scope) {
      if (!interactive) throw new CliError('SCOPE_REQUIRED', '请指定 --scope project 或 --scope user / Specify --scope project or --scope user.');
      const answer = (await ask('选择范围 / Scope [1 project, 2 user (全部项目 / all projects)]: ')).trim().toLowerCase();
      parsed.scope = answer === '1' ? 'project' : answer === '2' ? 'user' : answer;
      if (!['project', 'user'].includes(parsed.scope)) throw new CliError('INVALID_SCOPE', '未选择有效范围 / No valid scope selected.');
    }
    if (parsed.project !== undefined && parsed.scope === 'user') throw new CliError('INVALID_SCOPE', '--project 仅适用于 --scope project / --project requires project scope.');
    target = await adapters.resolveHostTarget({ host: parsed.host, scope: parsed.scope, ...(parsed.scope === 'project' ? { project: parsed.project ?? context.cwd ?? process.cwd() } : {}), ...(context.home === undefined ? {} : { home: context.home }) });
    const action = parsed.dryRun ? 'preview' : parsed.command;
    if (mutations.has(action) && !parsed.yes) {
      if (!interactive) throw new CliError('CONFIRMATION_REQUIRED', `尚未授权更改目标 ${target.targetPath}；检查目标后添加 --yes / Changes require confirmation; review the target and add --yes.`);
      const answer = (await ask(`将执行 / Action: ${action}\n宿主 / Host: ${target.host}\n范围 / Scope: ${target.scope}\n精确目标 / Exact target: ${target.targetPath}\n确认更改？ / Confirm changes? [y/N]: `)).trim().toLowerCase();
      if (!['y', 'yes'].includes(answer)) throw new CliError('CANCELLED', '已取消，未执行更改 / Cancelled without changes.');
    }
    /** @type {EngineOptions} */
    const options = { targetPath: target.targetPath, metadata: { host: target.host, scope: target.scope, packageName: release.packageName, packageVersion: release.version, skillVersion: release.skillVersion, templateBaselines: release.templateBaselines, runtimeBaselines: release.runtimeBaselines } };
    if (['install', 'update', 'preview'].includes(action)) {
      const manifest = await readManifest(root);
      if (!manifest || typeof manifest !== 'object' || !('version' in manifest) || manifest.version !== release.skillVersion) {
        throw new CliError('BUNDLE_VERSION_MISMATCH', '安装清单与发行 Skill 版本不一致；请重新获取官方包 / Bundled manifest does not match the release Skill version; obtain the official package again.', 3);
      }
      options.manifest = manifest;
      options.payloadRoot = path.join(root, 'skill');
    }
    const engine = context.loadEngine ? await context.loadEngine() : /** @type {Engine} */ (await import('./engine.mjs'));
    const result = await engine[action](options);
    const exitCode = Number.isInteger(result.exitCode) && result.exitCode >= 0 && result.exitCode < 256 ? result.exitCode : 5;
    const incomplete = result.recoveryRequired || ['partial', 'recovery-required'].includes(result.status);
    const actualExitCode = result.ok && !incomplete ? exitCode : exitCode || 5;
    const readiness = {
      filesInstalled: result.filesInstalled ?? null,
      staticStructureValid: result.staticStructureValid ?? null,
      hostDiscovery: 'not-verified',
      skillInvocation: 'not-verified',
    };
    const nextSteps = result.ok && actualExitCode === 0 && ['install', 'update', 'rollback'].includes(action) ? {
      verify: '回到助手确认 Tansr Skill 已被发现；必要时重启或按宿主指引重载 / Return to the assistant, verify Tansr discovery, and reload as directed by the host.',
      productExample: '帮我做一个学习计划助手，能记录目标、安排每日任务并回顾进展。',
      productExampleEn: 'Build a study planner that records goals, schedules daily tasks, and reviews progress.',
    } : undefined;
    const publicResult = { ...result, ok: result.ok && actualExitCode === 0, exitCode: actualExitCode, requestedAction: parsed.command, host: target.host, scope: target.scope, readiness, loading: target.loading, ...(nextSteps ? { nextSteps } : {}) };
    if (json) output.write(`${JSON.stringify(publicResult)}\n`);
    else {
      output.write(`Tansr Skill: ${publicResult.status}\n宿主 / Host: ${target.host}; 范围 / Scope: ${target.scope}\n目标 / Target: ${target.targetPath}\n`
        + `文件已安装 / Files installed: ${readiness.filesInstalled === null ? '未核实 / not verified' : readiness.filesInstalled}\n静态结构有效 / Static structure valid: ${readiness.staticStructureValid === null ? '未核实 / not verified' : readiness.staticStructureValid}\n`
        + '助手发现 / Host discovery: 待验 / not verified\n实际调用 / Skill invocation: 待验 / not verified\n'
        + `变更 / Changes: +${result.changes.added.length} ~${result.changes.updated.length} -${result.changes.removed.length}; 保留 / Preserved: ${result.preserved.length}\n`);
      if (result.preserved.length) output.write(`保留项 / Preserved entries: ${JSON.stringify(result.preserved)}\n`);
      if (result.warnings.length) output.write(`提示 / Warnings: ${JSON.stringify(result.warnings)}\n`);
      if (result.recoveryRequired) errorOutput.write('安装事务未完成；检查状态后使用 recover 并确认 / Transaction incomplete; inspect status, then confirm recover.\n');
      if (nextSteps) {
        output.write(`加载指引 / Loading guidance: ${JSON.stringify(target.loading)}\n`
          + `下一步 / Next: ${nextSteps.verify}\n`
          + `描述你想做的产品，例如：“${nextSteps.productExample}”\n`
          + `Describe your product, for example: “${nextSteps.productExampleEn}”\n`);
      }
    }
    return actualExitCode;
  } catch (error) {
    const info = errorInfo(error);
    const result = { schemaVersion: 1, action: parsed?.command ?? 'arguments', ok: false, exitCode: info.exitCode, status: 'error', recoveryRequired: info.code === 'RECOVERY_REQUIRED', ...(target ? { host: target.host, scope: target.scope, targetPath: target.targetPath } : {}), error: info };
    if (json) output.write(`${JSON.stringify(result)}\n`);
    else errorOutput.write(`${info.code}: ${info.message}\n`);
    return info.exitCode;
  } finally {
    reader?.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) process.exitCode = await runCli();
