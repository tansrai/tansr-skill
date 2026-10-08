# 在自己的助手中安装 Tansr Skill

先选择你实际使用的编程助手或 Agent 产品，安装后向同一个助手描述需求。Skill 提供开发步骤与资源，应用运行使用 SDK / Serve，见[产品使用](use.md)。

**发行快照（2026-10-08）：** `0.1.2` 已发布至 `next` 并修复备份误发现；真实 WorkBuddy 5.7.6 的用户技能根为 `.workbuddy/skills`，与旧官方文档不同。`0.1.3` 为区分 WorkBuddy / CodeBuddy 目录的修正候选，**下文精确命令在该版本实际发布后使用**。实际发行以 [npm 版本与标签](https://www.npmjs.com/package/@tansr/skill)为准；宿主加载单独验收。

## 选择目标并预览

需要 Node.js ≥22.19 和 npm。初次 npx 下载需要网络，之后使用随包内容；安装器不安装宿主、模型或模板依赖，不调用模型。

以下是 0.1.3 候选的原生目录合同。项目列相对所选项目，`~` 表示当前运行环境的用户主目录；每个目标都保留完整 `tansr/` 及其相对资源。表中路径有文档或官方源码依据，**不是实际加载通过表**。

| 产品 / `--host` | `project` | `user` | 官方依据 |
| --- | --- | --- | --- |
| Codex `codex` | `.agents/skills/tansr` | `~/.agents/skills/tansr` | [技能文档](https://learn.chatgpt.com/docs/build-skills) |
| WorkBuddy `workbuddy` | `.codebuddy/skills/tansr` | `~/.workbuddy/skills/tansr` | 本机 WorkBuddy 5.7.6 已安装程序的配置根与扫描实现；[官方项目文档](https://www.codebuddy.cn/docs/workbuddy/From-Beginner-to-Expert-Guide/Function-Description/Project)的旧用户路径与此版本有差异 |
| CodeBuddy `codebuddy` | `.codebuddy/skills/tansr` | `~/.codebuddy/skills/tansr` | [CodeBuddy 目录](https://www.codebuddy.cn/docs/cli/codebuddy-dir)及本机捆绑 CLI 实现 |
| Claude Code `claude-code` | `.claude/skills/tansr` | `~/.claude/skills/tansr` | [技能文档](https://code.claude.com/docs/en/skills) |
| Cursor `cursor` | `.cursor/skills/tansr` | `~/.cursor/skills/tansr` | [技能文档](https://cursor.com/docs/skills) |
| TRAE 国内版 `trae` | `.trae/skills/tansr` | `~/.trae-cn/skills/tansr` | [IDE Skills](https://docs.trae.cn/ide_skills) |
| TraeCode CLI `trae-cli` | `.traecli/skills/tansr` | `~/.traecli/skills/tansr` | [CLI Skills](https://docs.trae.cn/cli_skills) |
| Qoder 国际版 IDE / CLI `qoder` | `.qoder/skills/tansr` | `~/.qoder/skills/tansr` | [CLI Skills](https://docs.qoder.com/cli/Skills) |
| Qoder 国内版 IDE `qoder-cn` | `.lingma/skills/tansr` | `~/.lingma/skills/tansr` | [国内版 Skills](https://docs.qoder.cn/user-guide/skills) |
| ZCode Agent `zcode` | 未核实，不接受此范围 | `~/.zcode/skills/tansr` | [技能文档](https://zcode.z.ai/cn/docs/skill) |
| Kimi Code `kimi` | `.kimi-code/skills/tansr` | `~/.kimi-code/skills/tansr` | [当前官方实现](https://github.com/MoonshotAI/kimi-code) |
| MiniMax Code CLI `minimax` | `.minimax/skills/tansr` | `~/.minimax/skills/tansr` | [官方实现](https://github.com/MiniMax-AI/minimax-code) |
| 千问 Qwen Code `qwen-code` | `.qwen/skills/tansr` | `~/.qwen/skills/tansr` | [Skills](https://qwenlm.github.io/qwen-code-docs/en/users/features/skills/) |
| 通用 `generic` | `.agents/skills/tansr` | `~/.agents/skills/tansr` | [跨客户端约定](https://agentskills.io/client-implementation/adding-skills-support) |

一般选 `project`，跨项目使用时明确选 `user`。一次只处理所选位置。项目路径默认当前目录，也可用 `--project <绝对路径>`；用户范围不接受 `--project`。

```sh
# 0.1.3 候选发布后使用；下面只选择 Claude Code 一个目标
npx --yes @tansr/skill@0.1.3 hosts --json
npx --yes @tansr/skill@0.1.3 preview --host claude --scope project --json
npx --yes @tansr/skill@0.1.3 install --host claude-code --scope project --yes --json
```

这里 `claude` 是 `claude-code` 的别名，预览与安装仍是同一目标。其他别名包括 `kimi-code` → `kimi`、`mcode` → `minimax`、`qwen` / `qianwen` → `qwen-code`、`agents` → `generic`；完整列表以当前包的 `hosts` 为准。

前一个 `--yes` 确认 npx 取得包，末尾 `--yes` 确认安装器更改目标。先核对预览的路径和冲突；`--json` 和非交互执行不会等待输入。维护者在候选发布前可用构建产物 `node dist/npm/installer/cli.mjs` 加同样参数验证，不把未构建源码当安装包。

## 共用目录和自定义配置根

`generic` 与 `codex` 解析到同一 `.agents/skills/tansr`；它也可能被 Cursor 等助手读取。更新、回退、卸载会影响读取这一位置的所有助手；安装记录的 host 表示管理入口，不构成独立的一份安装。通用格式并不强制所有助手扫描该目录。其他宿主有自己的兼容开关和优先级，安装器不会启用开关、同步云端或向每个检测到的助手复制。同名技能来自多个目录时，核对实际读取路径。

Kimi 的项目范围必须位于最近的 Git 根目录。在仓库子目录执行会拒绝安装并提示根路径，请核对后用 `--project <Git根绝对路径>` 指定；安装器不会自动向父目录写入。没有 Git 标记时使用所选项目目录。

WorkBuddy 与 CodeBuddy 从 0.1.3 起是两个独立 profile；项目范围共用 `.codebuddy/skills`，用户范围不同。旧版用 `--host workbuddy --scope user` 安装的 `.codebuddy` 内容可能仍被 CodeBuddy 使用，因此新版不自动搬移或删除：先预览并安装正确的 WorkBuddy 用户目标；如需移除旧位置，明确使用 `--host codebuddy --scope user` 预览/卸载，保留原受管备份。

本机 WorkBuddy 5.7.6 的桌面项目技能列表与内置 CLI 的项目扫描实现也有差异。`.codebuddy/skills` 保留已通过的实际项目调用路径；桌面列表是否展示应分别核对，不能仅凭列表未出现断言运行入口不可用。用户范围 `.workbuddy/skills` 的修正依据配置根、列表扫描与子 CLI 环境传递三处实现。

用户范围有以下边界：

- WorkBuddy 用户根依次读取去除两端空白的 `WORKBUDDY_CONFIG_DIR`、`CODEBUDDY_CONFIG_DIR`，然后回退 `~/.workbuddy`；CodeBuddy 使用非空的 `CODEBUDDY_CONFIG_DIR`（非空路径原样保留），否则回退 `~/.codebuddy`。两者都追加 `skills/tansr`，相对配置根被明确拒绝。两者项目范围只支持默认 `.codebuddy`；自定义 `CODEBUDDY_PROJECT_CONFIG_DIR` 指向其他目录时明确拒绝，不猜目标，不修改宿主配置。
- Codex 的通用用户根是 `~/.agents/skills`；`CODEX_HOME` 管状态与配置，不能据此把通用根迁进去。
- Claude Code 的 `CLAUDE_CONFIG_DIR`、Qoder 的 `QODER_CONFIG_DIR` 若指向非默认配置根，当前安装器会拒绝用户范围。改选项目范围或按宿主官方导入步骤操作，不替用户改环境变量。
- Kimi Code 使用 `KIMI_CODE_HOME/skills`，未设置时用表中默认根；这适用于当前 Kimi Code，不是旧归档 kimi-cli 的 `.kimi` 目录。
- MiniMax Code 用户根依次取去除首尾空白后的 `MINIMAX_DATA_DIR`、兼容变量 `MAVIS_DATA_DIR`，再回退表中默认根，均追加 `skills/tansr`。若内部 `__MAVIS_RUNTIME_PROFILE` 为任何非空值（包括 `default` 或空白），必须先明确实际数据根并设置绝对路径的 `MINIMAX_DATA_DIR`；安装器不猜 profile 对应目录。
- 环境覆盖路径须为绝对路径。安装器不读取账号配置来猜目标，也不提供任意用户目录 `--target` 参数。

这些范围属于目标助手运行的环境；本机安装不自动覆盖远程工作机、容器或云端账号。

## 回到助手确认加载

| 助手 | 下一步 |
| --- | --- |
| Codex | 自动检测变化；未出现时重启。CLI / IDE 用 `/skills` 或 `$tansr`。 |
| WorkBuddy / CodeBuddy | 打开目标项目，在技能选择器确认可见、启用，再明确要求使用 Tansr。不要假设有 `/tansr`。 |
| Claude Code | 用 `/reload-skills`；旧版不支持时重启。输入 `/tansr`。 |
| Cursor | 重新打开，检查 Agent 技能列表，再用 `/tansr` 或 `@` 选择。 |
| TRAE 国内版 | 在“技能与命令”检查并启用，再选择技能或明确请求。 |
| TraeCode CLI | 重启后用 `/skills` 检查；CLI 2.0 可用范围由厂商套餐决定。 |
| Qoder | IDE 重启；CLI 新会话或 `/skills reload`，用 `/tansr`。国内版 profile 仅指 IDE。 |
| ZCode | 设置 → 技能 → 刷新并启用，使用 `$tansr` 或 `/` 菜单。 |
| Kimi / MiniMax / Qwen Code | 使用该版本的技能入口确认已加载，再明确请求使用 Tansr；同时核对 profile、启用状态与项目信任。 |
| 通用目录 | 按目标助手自己的入口检查，通用目标没有统一调用命令。 |

安装器的 `hostDiscovery` 和 `skillInvocation` 不会因为写入成功而变为通过。请先给只读小任务：“使用 Tansr Skill，阅读当前项目并说明接入位置，不安装或运行应用。”核对它真正读取的 `tansr/SKILL.md` 和按需参考；然后再独立确认自然需求能否触发。

历史 Codex 手工项目触发及本地候选包自然读取已有证据；公开 0.1.0 包的显式验收曾因宿主网络超时停止，用户项未启动。新增助手、各运行系统、scope 和最终包的加载不能借用这些历史结果；当前状态见兼容清单。

## 手动入口与尚未核实的产品

| `--host` | 处理方式 |
| --- | --- |
| `feishu`（`lark` / `aily` / `飞书`） | [飞书 aily SkillHub](https://aily.feishu.cn/)走云端技能上传与审核；本轮未核实完整 Tansr 包导入结果和本地扫描目录。 |
| `yuanbao`（`元宝`） | [元宝 Agent](https://yuanbao.tencent.com/)的具体第三方技能入口仍需确认；不能借 WorkBuddy 的目录宣称元宝已支持。 |
| `doubao`（`豆包`） | [豆包 Agent](https://www.doubao.com/)的本地技能合同仍待核实；TRAE 是单独目标。 |
| `volcengine`（`volcano` / `火山`） | [火山引擎](https://www.volcengine.com/)有多种 Agent / CLI 产品，需先确定具体入口，没有本轮已证的统一目录。 |
| `trae-global` | [TRAE 国际版](https://www.trae.ai/blog/trae_tutorial_0115)使用官方技能导入 UI；本轮不猜其精确目录。 |

这些 ID 会给出手动指引并停止，不写入猜测目录，也不自动登录、上传、发布或审核技能。普通 Kimi、千问聊天端和 MiniMax 云端 Agent，同样不能直接继承各自 Code 产品的本地目录合同。

## 更新、恢复与卸载

0.1.2 将状态、暂存和备份移到技能扫描树之外：`<宿主配置根>/.tansr-installer-state-<目标路径摘要>`。旧 `skills/.tansr-installer-state` 中只保留无技能内容的防回写标记，旧安装器不能再管理该目标。受管旧状态随确认后的管理操作迁移，`status`/`preview` 保持只读。中断时按同目标回执用修复版 `recover --yes`；不要手工删锁、删备份或从备份调用技能。用户自己修改过的入口仍会保留，并在回执中列明，不能把这种部分卸载说成完全移除。

从已取得的同一精确包运行，保留原 `--host` / `--scope`：

| 命令 | 行为 |
| --- | --- |
| `status` | 只读检查文件状态，不代替宿主加载 |
| `update --yes` | 更新为所执行包的内容，保留前版恢复信息 |
| `rollback --yes` | 回退登记前版，先核归属及用户修改 |
| `recover --yes` | 按状态回执恢复已退出进程的事务，不抢占活进程 |
| `uninstall --yes` | 删除登记且未改动的 Skill 文件，保留用户改动和未知文件 |

来源不明的同名目录不会被强制接管，冲突和部分完成会非零退出。不要删除整个宿主技能目录排错。安装记录保留版本、目标、模板及运行时基线和哈希；SDK 0.18.1 / Serve 0.15.0 等基线不触发已有项目的自动升级。

确认加载后，直接描述目标用户、业务需求、运行设备和已有项目，沿[应用开发](build.md)继续。账号配置、应用运行、真实平台调用及发布分别验证；失败按[排错](troubleshoot.md)处理。
