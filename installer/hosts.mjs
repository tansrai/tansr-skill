// @ts-check
import { homedir } from 'node:os';
import { access } from 'node:fs/promises';
import { dirname, isAbsolute, join, parse, resolve } from 'node:path';

/** @typedef {'project'|'user'} Scope */
/** @typedef {{discovery:string,explicitInvocation:string,automaticInvocation:string,verification:string}} Loading */
/** @typedef {{id:string,label:string,aliases:string[],scopes:Scope[],installation:'directory'|'manual',directories:Partial<Record<Scope,string>>,documentation:string,loading:Loading,projectRoot?:'git',userRootEnv?:string[],trimUserRootEnv?:boolean,skipBlankUserRootEnv?:boolean,unsupportedUserProfileEnv?:string[],unsupportedUserConfigEnv?:string[],unsupportedProjectConfigEnv?:string[],reason?:string}} Host */
const verification = '文件安装不证明助手加载成功；请核对实际读取的 tansr/SKILL.md 路径 / File installation does not prove host loading; verify the actual Skill path read.';
/** @param {string} discovery @param {string} explicitInvocation @returns {Loading} */
const loading = (discovery, explicitInvocation) => ({ discovery, explicitInvocation, automaticInvocation: '向所选助手描述产品需求；是否自动选择由宿主及任务决定 / Describe your product; automatic selection depends on the host and task.', verification });
/** @param {string} id @param {string} label @param {string[]} aliases @param {string|undefined} project @param {string|undefined} user @param {string} documentation @param {Loading} instructions @param {Partial<Host>} [extras] @returns {Host} */
function directory(id, label, aliases, project, user, documentation, instructions, extras = {}) {
  return { id, label, aliases, installation: 'directory', scopes: [...(project ? [/** @type {const} */('project')] : []), ...(user ? [/** @type {const} */('user')] : [])], directories: { ...(project ? {project} : {}), ...(user ? {user} : {}) }, documentation, loading: instructions, ...extras };
}
/** @param {string} id @param {string} label @param {string[]} aliases @param {string} documentation @param {string} reason @returns {Host} */
function manual(id, label, aliases, documentation, reason) {
  return { id, label, aliases, installation: 'manual', scopes: [], directories: {}, documentation, reason, loading: loading(reason, '按该产品官方技能导入或发布流程操作 / Follow the product-specific Skill import or publishing instructions.') };
}

/** Default profiles only. Each installation selects one location; no settings are changed. @type {Host[]} */
const hosts = [
  directory('generic', '通用 Agent Skills 目录', ['agents', 'universal', '通用'], '.agents/skills', '.agents/skills', 'https://agentskills.io/integrate-skills', loading('与 Codex 共用同一物理目录，更新、回退、卸载影响所有读取它的助手；请确认宿主支持通用目录 / Shared with Codex; updates, rollback and removal affect every consumer of this path.', '按所用助手的技能入口调用 / Use your host Skill entry.')),
  directory('codex', 'Codex', [], '.agents/skills', '.agents/skills', 'https://learn.chatgpt.com/docs/build-skills', loading('自动检测变化；未出现时重启。与 generic 共用物理目录，更新、回退、卸载影响同目录所有消费者 / Restart if missing. The generic profile shares this location and all management actions.', '在 CLI/IDE 使用 /skills 或 $tansr / Use /skills or $tansr.')),
  directory('workbuddy', 'WorkBuddy', [], '.codebuddy/skills', '.workbuddy/skills', 'https://www.codebuddy.cn/docs/workbuddy/From-Beginner-to-Expert-Guide/Function-Description/Project', loading('桌面用户技能默认从 ~/.workbuddy/skills 读取，可在技能列表核对启用状态；项目 .codebuddy/skills 沿用已验证的运行入口，需核对实际读取的 SKILL.md 路径，未保证出现在桌面技能列表。发现后是否选用由宿主决定 / Desktop user Skills use ~/.workbuddy/skills. The project .codebuddy/skills path follows the verified runtime entry; verify the actual SKILL.md read, as desktop listing is not guaranteed. Discovery does not prove selection.', '在技能选择器选择 Tansr，或明确提及 Tansr Skill / Select Tansr or explicitly request it.'), { userRootEnv: ['WORKBUDDY_CONFIG_DIR', 'CODEBUDDY_CONFIG_DIR'], trimUserRootEnv: true, unsupportedProjectConfigEnv: ['CODEBUDDY_PROJECT_CONFIG_DIR'] }),
  directory('codebuddy', 'CodeBuddy', [], '.codebuddy/skills', '.codebuddy/skills', 'https://www.codebuddy.cn/docs/cli/codebuddy-dir', loading('默认用户与项目技能分别从 ~/.codebuddy/skills 和 .codebuddy/skills 读取；与 WorkBuddy 桌面的默认用户目录不同，请核对技能列表实际路径 / Default user and project Skills use ~/.codebuddy/skills and .codebuddy/skills; WorkBuddy desktop has a separate default user root. Verify the actual listed path.', '在 CodeBuddy 的技能入口选择 Tansr，或明确要求使用 Tansr Skill / Select Tansr in CodeBuddy or explicitly request it.'), { userRootEnv: ['CODEBUDDY_CONFIG_DIR'], skipBlankUserRootEnv: true, unsupportedProjectConfigEnv: ['CODEBUDDY_PROJECT_CONFIG_DIR'] }),
  directory('claude-code', 'Claude Code', ['claude'], '.claude/skills', '.claude/skills', 'https://code.claude.com/docs/en/skills', loading('使用 /reload-skills；旧版不支持时重新启动 / Use /reload-skills, or restart older versions.', '/tansr'), { unsupportedUserConfigEnv: ['CLAUDE_CONFIG_DIR'] }),
  directory('cursor', 'Cursor', [], '.cursor/skills', '.cursor/skills', 'https://cursor.com/docs/context/skills', loading('重新打开 Cursor，检查 Agent 的技能列表；不会开启云端同步 / Reopen Cursor and inspect Agent Skills; no cloud sync is enabled.', '/tansr 或 @ 选择技能 / /tansr or @ Skill selection.')),
  directory('trae', 'TRAE 国内版 / TraeCode', ['trae-cn', 'traecode'], '.trae/skills', '.trae-cn/skills', 'https://docs.trae.cn/ide_skills', loading('在设置的技能与命令中检查并启用；不代改通用目录导入开关 / Check Skills and Commands; generic-directory import settings remain under your control.', '在技能入口选择，或明确要求使用 Tansr Skill / Select the Skill or explicitly request it.')),
  directory('trae-cli', 'TraeCode CLI', ['traecode-cli'], '.traecli/skills', '.traecli/skills', 'https://docs.trae.cn/cli_skills', loading('重启 CLI 后使用 /skills；CLI 2.0 可用范围由厂商套餐决定 / Restart and inspect /skills; CLI 2.0 availability depends on the vendor plan.', '/skills 中选择 Tansr / Select Tansr in /skills.')),
  directory('qoder', 'Qoder 国际版 IDE / CLI', [], '.qoder/skills', '.qoder/skills', 'https://docs.qoder.com/cli/Skills', loading('IDE 重启；CLI 新会话或 /skills reload；两种 scope 的优先级按宿主版本核实 / Restart the IDE or use /skills reload in the CLI.', '/tansr'), { unsupportedUserConfigEnv: ['QODER_CONFIG_DIR'] }),
  directory('qoder-cn', 'Qoder 国内版 IDE', ['lingma'], '.lingma/skills', '.lingma/skills', 'https://docs.qoder.cn/user-guide/skills', loading('重启 IDE，再在 / 列表确认技能；此目录合同不代表 Qoder CN CLI / Restart the IDE; this profile does not claim the CN CLI path.', '/tansr'), { unsupportedUserConfigEnv: ['QODER_CONFIG_DIR'] }),
  directory('zcode', 'ZCode Agent', [], undefined, '.zcode/skills', 'https://zcode.z.ai/cn/docs/skill', loading('设置 → 技能 → 刷新并启用；当前只核实用户范围 / Refresh and enable in Settings → Skills; user scope only.', '$tansr 或 / 菜单 / $tansr or the / menu.')),
  directory('kimi', 'Kimi Code', ['kimi-code'], '.kimi-code/skills', '.kimi-code/skills', 'https://github.com/MoonshotAI/kimi-code', loading('适用于新版 Kimi Code；Git 项目须在仓库根安装，不写旧版 kimi-cli 的 .kimi 目录 / Current Kimi Code discovers project Skills at the Git root; archived kimi-cli is separate.', '在 Kimi Code 技能入口检查并使用 Tansr / Inspect and invoke Tansr in Kimi Code.'), { projectRoot: 'git', userRootEnv: ['KIMI_CODE_HOME'] }),
  directory('minimax', 'MiniMax Code CLI', ['minimax-code', 'mcode'], '.minimax/skills', '.minimax/skills', 'https://github.com/MiniMax-AI/minimax-code', loading('适用于 MiniMax Code CLI 默认 profile；命名 profile 请明确 MINIMAX_DATA_DIR。云端 Agent 需独立插件导入 / Default CLI profile; set MINIMAX_DATA_DIR for a named profile. Cloud Agent import is separate.', '在 MiniMax Code CLI 检查已加载技能并明确要求使用 Tansr / Inspect loaded Skills and request Tansr.'), { userRootEnv: ['MINIMAX_DATA_DIR', 'MAVIS_DATA_DIR'], trimUserRootEnv: true, unsupportedUserProfileEnv: ['__MAVIS_RUNTIME_PROFILE'] }),
  directory('qwen-code', '千问 Qwen Code', ['qwen', 'qianwen', '千问'], '.qwen/skills', '.qwen/skills', 'https://qwenlm.github.io/qwen-code-docs/en/users/features/skills/', loading('使用 Qwen Code 的技能列表核实加载；普通千问聊天端不是本地目录宿主 / Verify in Qwen Code; this does not install into Qwen chat.', '通过 /skills 管理和显式选择 Tansr / Manage and select Tansr with /skills.')),
  manual('feishu', '飞书 aily SkillHub', ['lark', 'aily', '飞书'], 'https://www.feishu.cn/content/article/7646699294103292898', '飞书 aily 使用云端技能上传与审核流程，尚无已核实的本地扫描目录；请在 aily SkillHub 按官方规范导入 / Cloud import and review required; no verified local directory.'),
  manual('yuanbao', '腾讯元宝 Agent', ['元宝'], 'https://yuanbao.tencent.com/', '尚未核实该产品开放给第三方的本地 Skill 目录；请确认具体 Agent 产品及官方技能入口。腾讯开发助手可选择 --host workbuddy / Confirm the Agent integration; use workbuddy for the documented Tencent coding host.'),
  manual('doubao', '豆包 Agent', ['豆包'], 'https://www.doubao.com/', '尚未核实豆包 Agent 的本地 Skill 目录；字节开发助手可选择 --host trae，云端 Agent 需其官方导入入口 / Confirm the Agent integration; use trae for the documented coding host.'),
  manual('volcengine', '火山引擎 Agent', ['volcano', '火山'], 'https://www.volcengine.com/', '请明确火山 Agent 产品及官方技能导入入口；veCLI、arkcli、云端 Agent 与 TRAE 是不同产品，尚无本轮已核实的统一扫描目录 / Select the actual Agent integration; no shared local directory is assumed.'),
  manual('trae-global', 'TRAE 国际版', [], 'https://www.trae.ai/blog/trae_tutorial_0115', '已核实官方技能导入入口，未核实国际版精确本地目录；请使用其设置中的技能导入 / Use the official Skill import UI; international filesystem paths are not yet verified.'),
];

/** Return detached descriptions; callers cannot mutate future resolutions. */
export function listHosts() { return structuredClone(hosts); }
/** @param {string} input @returns {Host|undefined} */
export function findHost(input) {
  const id = input.trim().toLowerCase();
  const host = hosts.find(item => item.id === id || item.aliases.includes(id));
  return host ? structuredClone(host) : undefined;
}
/** @param {string} code @param {string} message */
function fail(code, message) { return Object.assign(new Error(message), { code, exitCode: 2 }); }

/**
 * Resolve one chosen profile without writes or setting changes; inspect Git markers only when required.
 * home/env are internal test seams, not public arbitrary target overrides.
 * @param {{host:string,scope:string,project?:string,home?:string,env?:NodeJS.ProcessEnv}} options
 */
export async function resolveHostTarget(options) {
  const host = findHost(options.host);
  if (!host) throw fail('host_unknown', '未知宿主；运行 hosts 查看可用产品与范围 / Unknown host; run hosts.');
  if (host.installation === 'manual') throw fail('host_manual_setup_required', `${host.label}: ${host.reason} ${host.documentation}`);
  if (!['project', 'user'].includes(options.scope)) throw fail('scope_invalid', '请使用 --scope project 或 --scope user。');
  const scope = /** @type {Scope} */ (options.scope);
  if (!host.scopes.includes(scope)) throw fail('scope_unsupported', `${host.label} 支持的安装范围 / Supported scopes: ${host.scopes.join(', ')}。请使用 hosts 查看说明。`);
  if (scope === 'user' && options.project !== undefined) throw fail('project_scope_conflict', '--project 只适用于 --scope project。');
  const home = options.home ?? homedir();
  const env = options.env ?? process.env;
  let input = scope === 'project' ? (options.project ?? process.cwd()) : home;
  let directory = host.directories[scope];
  if (!directory) throw fail('scope_unsupported', '该宿主范围未配置 / Host scope has no installation directory.');
  if (scope === 'user') {
    for (const key of host.unsupportedUserConfigEnv ?? []) {
      const value = env[key];
      if (value && (!isAbsolute(value) || resolve(value) !== resolve(home, directory, '..'))) throw fail('host_custom_configuration_unsupported', `${host.label}: ${key} 指向自定义配置根；当前适配只核实默认用户目录。请选择项目范围，或按宿主文档导入 / Custom user config requires the host-specific import flow. ${host.documentation}`);
    }
    let overridden = false;
    for (const key of host.userRootEnv ?? []) {
      const value = host.trimUserRootEnv ? env[key]?.trim() : env[key];
      if (host.skipBlankUserRootEnv && !value?.trim()) continue;
      if (value) { input = value; directory = 'skills'; overridden = true; break; }
    }
    if (!overridden && host.unsupportedUserProfileEnv?.some(key => env[key] !== undefined && env[key] !== '')) throw fail('host_custom_profile_unsupported', `${host.label}: 命名用户 profile 需要显式绝对配置根（${host.userRootEnv?.[0]}），或选择项目范围 / Specify the named profile data root, or choose project scope.`);
  }
  if (!isAbsolute(input)) throw fail('project_path_relative', '安装范围及配置根必须使用绝对路径 / Installation and config roots must be absolute.');
  const base = resolve(input);
  if (base === parse(base).root) throw fail('filesystem_root_forbidden', '请选择具体项目目录或用户级范围，不在文件系统根目录安装。');
  if (scope === 'project') {
    for (const key of host.unsupportedProjectConfigEnv ?? []) {
      const value = env[key]?.trim();
      if (!value) continue;
      const actual = resolve(base, value), expected = resolve(base, directory, '..');
      const same = process.platform === 'win32' ? actual.toLowerCase() === expected.toLowerCase() : actual === expected;
      if (!same) throw fail('host_custom_configuration_unsupported', `${host.label}: ${key} 指向自定义项目配置根；当前适配只支持所选项目的 .codebuddy 目录。请按宿主文档导入 / This profile supports the selected project's default .codebuddy root; custom project roots require host-specific import. ${host.documentation}`);
    }
  }
  if (scope === 'project' && host.projectRoot === 'git') {
    for (let current = base; ; current = dirname(current)) {
      let markerExists = false;
      try { await access(join(current, '.git')); markerExists = true; }
      catch (error) { if (!['ENOENT', 'ENOTDIR'].includes(/** @type {NodeJS.ErrnoException} */ (error).code ?? '')) throw fail('host_project_root_unreadable', '无法核实 Git 项目根，请检查目录权限 / Cannot inspect Git project root.'); }
      if (markerExists) {
        if (current !== base) throw fail('host_project_root_required', `${host.label} 从 Git 根读取项目技能；请在 ${current} 执行，或显式设置 --project "${current}" / Select the actual repository root before installing.`);
        break;
      }
      if (current === dirname(current)) break;
    }
  }
  return { host: host.id, scope, targetPath: join(base, directory, 'tansr'), loading: structuredClone(host.loading) };
}
