// @ts-check
import { homedir } from 'node:os';
import { isAbsolute, join, parse, resolve } from 'node:path';

/** @typedef {'codex'|'workbuddy'} HostId */
/** @typedef {'project'|'user'} Scope */

const hosts = [
  {
    id: 'codex', label: 'Codex', scopes: ['project', 'user'],
    directory: '.agents',
    documentation: 'https://learn.chatgpt.com/docs/build-skills',
    loading: {
      discovery: 'Changes are detected automatically; restart Codex if the Skill is not visible.',
      explicitInvocation: 'In the CLI/IDE select /skills or $tansr; in chat explicitly request Tansr Skill.',
      automaticInvocation: 'Describe the AI product you want; automatic selection depends on the host and task.',
      verification: 'Check the actual SKILL.md path read by the assistant. Installation alone does not prove loading.',
    },
  },
  {
    id: 'workbuddy', label: 'WorkBuddy', scopes: ['project', 'user'],
    directory: '.codebuddy',
    documentation: 'https://www.codebuddy.cn/docs/workbuddy/From-Beginner-to-Expert-Guide/Function-Description/Project',
    loading: {
      discovery: 'Open the target project in WorkBuddy and inspect the Skill entry. The official project guide also supports the user .codebuddy configuration.',
      explicitInvocation: 'Select the installed Skill in the task input or explicitly request Tansr Skill.',
      automaticInvocation: 'Describe the AI product you want; confirm the assistant actually reads the installed Skill.',
      verification: 'Project and user-compatible configuration directories are documented. Host loading and reload behavior need separate actual verification.',
    },
  },
];

/** Return detached public descriptions; callers cannot mutate future resolutions. */
export function listHosts() { return structuredClone(hosts); }

/** @param {string} code @param {string} message */
function fail(code, message) { return Object.assign(new Error(message), { code, exitCode: 2 }); }

/**
 * Resolve one explicitly chosen host and scope without creating directories or changing host settings.
 * home is an internal test seam. The public command never accepts an arbitrary user-home override.
 * @param {{host:string,scope:string,project?:string,home?:string}} options
 */
export async function resolveHostTarget(options) {
  const host = hosts.find(item => item.id === options.host);
  if (!host) throw fail('host_unknown', '请使用 --host codex 或 --host workbuddy。');
  if (!['project', 'user'].includes(options.scope)) throw fail('scope_invalid', '请使用 --scope project 或 --scope user。');
  if (!host.scopes.includes(options.scope)) throw fail('scope_unsupported', `${host.label} 的 ${options.scope} 范围尚未核实；请使用已支持的 project 范围。`);
  if (options.scope === 'user' && options.project !== undefined) throw fail('project_scope_conflict', '--project 只适用于 --scope project。');
  const input = options.scope === 'project' ? (options.project ?? process.cwd()) : (options.home ?? homedir());
  if (!isAbsolute(input)) throw fail('project_path_relative', '安装范围必须使用绝对路径。');
  const base = resolve(input);
  if (base === parse(base).root) throw fail('filesystem_root_forbidden', '请选择具体项目目录或用户级范围，不在文件系统根目录安装。');
  return { host: host.id, scope: options.scope, targetPath: join(base, host.directory, 'skills', 'tansr'), loading: structuredClone(host.loading) };
}
