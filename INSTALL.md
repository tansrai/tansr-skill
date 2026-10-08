# Tansr Skill

让你熟悉的编程助手，帮你把想法做成 AI 产品：选择助手安装 Skill，再描述产品需求。Skill 提供开发指引、SDK / Serve 接入资料和起步工程；安装本身不创建账号、不调用模型、不部署应用。

**发行快照（2026-10-08）：** `0.1.1` 已发布至 `next`，现发现其事务备份位于宿主技能扫描目录，WorkBuddy 可在卸载后继续发现备份。`0.1.2` 为修正状态隔离及旧安装迁移的候选；**下文精确命令在该版本实际发布后使用**。发行事实以 [npm 版本与标签](https://www.npmjs.com/package/@tansr/skill)为准；文件安装与助手实际加载分别核验。

## 第一步：选择一个助手并安装

需要已有 Node.js ≥22.19、npm 和目标助手。安装器不代装这些软件。首次 npx 获取包需要网络；缺少 Node 时先从 [Node.js 官网](https://nodejs.org/en/download)安装受支持版本，重新打开终端。

在准备开发产品的目录运行以下命令。以下以 Codex 为例，换助手时只替换 `--host`：

```sh
# 0.1.2 候选发布后使用
npx --yes @tansr/skill@0.1.2 hosts
npx --yes @tansr/skill@0.1.2 preview --host codex --scope project
npx --yes @tansr/skill@0.1.2 install --host codex --scope project --yes
```

也可把这段话交给编程助手：

> 请在当前项目安装 Tansr Skill。先确认精确版本 0.1.2 已发布、Node.js 至少为 22.19，使用 `preview --host codex --scope project` 查看目标，再运行同版本的 `install --host codex --scope project --yes`。有冲突时保留已有内容。安装后在本助手中确认技能可见，并实际读取它的 SKILL.md，分别报告结果。

0.1.2 候选的目录安装选择如下；**支持写入目录不等于该助手已通过实际加载验收**。产品版本、启用状态和运行系统仍会影响发现结果。

| 助手 / 产品 | `--host`（括号内为别名） | 可选范围 |
| --- | --- | --- |
| Codex | `codex` | `project` / `user` |
| WorkBuddy / CodeBuddy | `workbuddy`（`codebuddy`） | `project` / `user` |
| Claude Code | `claude-code`（`claude`） | `project` / `user` |
| Cursor | `cursor` | `project` / `user` |
| TRAE 国内版 / TraeCode | `trae`（`trae-cn`、`traecode`） | `project` / `user` |
| TraeCode CLI | `trae-cli`（`traecode-cli`） | `project` / `user` |
| Qoder 国际版 IDE / CLI | `qoder` | `project` / `user` |
| Qoder 国内版 IDE | `qoder-cn`（`lingma`） | `project` / `user` |
| ZCode Agent | `zcode` | 仅 `user` |
| Kimi Code | `kimi`（`kimi-code`） | `project` / `user` |
| MiniMax Code CLI | `minimax`（`minimax-code`、`mcode`） | `project` / `user` |
| 千问 Qwen Code | `qwen-code`（`qwen`、`qianwen`、`千问`） | `project` / `user` |
| 通用 Agent Skills 目录 | `generic`（`agents`、`universal`、`通用`） | `project` / `user` |

别名与正式 ID 指向同一目标，例如 `--host claude` 等同 `--host claude-code`。一般选项目范围；跨项目使用时明确选 `--scope user`。ZCode 目前只核实用户目录，例如：

```sh
# 仅当你选择 ZCode；0.1.2 候选发布后使用
npx --yes @tansr/skill@0.1.2 install --host zcode --scope user --yes
```

**一次只安装所选的一处。** `generic` 写入 `.agents/skills/tansr`，与 Codex 共用目标，也可能被其他已支持该约定的助手读取；它不是“自动安装到所有助手”。精确路径、重载和自定义配置根限制见[助手安装说明](https://github.com/tansrai/tansr-skill/blob/main/references/assistant-setup.md)；包内对应 `skill/references/assistant-setup.md`。

共用目录的更新、回退或卸载会影响读取它的所有助手。Kimi 的项目安装需从最近的 Git 根执行，子目录调用会提示正确根路径；MiniMax 自定义 profile 必须明确实际数据目录。

`feishu`（飞书 aily）、`yuanbao`、`doubao`、`volcengine`（火山 Agent）和 `trae-global` 仅提供官方手动入口或待核实说明，不执行目录安装。云端 Agent、普通聊天产品与同品牌编程助手分别处理，不自动上传、注册或启用 Skill。

## 第二步：描述你想做的产品

回到所选助手，按安装回执重载或检查技能列表，再描述需求：

> 使用 Tansr Skill，帮我做一个学习计划助手，能记录目标、安排每日任务并回顾进展。先做出能运行的第一版，再告诉我需要完成哪些配置。

已有项目也可以说：

> 使用 Tansr Skill，为当前订单系统加入自然语言查询助手，沿用原登录、权限、数据库和锁文件，保留我的现有修改。

助手会继续完成界面、业务工具、接线与验证。需要平台应用或模型授权时，按实际平台入口人工配置；真实密钥放在应用服务端，不填入聊天、客户端或 Skill 安装记录。

## 检查、更新与卸载

以下同样使用已发布的精确候选版本，并保留最初选择的宿主与范围：

```sh
# 0.1.2 候选发布后使用
npx --yes @tansr/skill@0.1.2 status --host codex --scope project
npx --yes @tansr/skill@0.1.2 update --host codex --scope project --yes
npx --yes @tansr/skill@0.1.2 rollback --host codex --scope project --yes
npx --yes @tansr/skill@0.1.2 uninstall --host codex --scope project --yes
```

`status` 只检查文件，不证明助手已加载。`update` 使用当前命令取得的包内容；`rollback` 回退登记的前一版。卸载保留用户修改、未知文件、其他 Skill 和已创建的产品。上次进程中断时先看 `status`，仅按提示执行同目标的 `recover --yes`。

从 0.1.2 起，事务、暂存和备份存放在 `skills` 的父目录下，以目标路径摘要区分安装，例如 `.codebuddy/.tansr-installer-state-<摘要>`。它们不会放进助手扫描的 `skills` 树。旧版本的受管状态在执行确认后的更新、卸载或恢复操作时迁移；只读的 `preview`/`status` 显示待迁移状态，不移动文件。迁移保留备份和历史，旧位置只留无技能内容的防回写标记，拒绝旧安装器重新管理。此后请使用 0.1.2 或更新版本管理该目标。

若旧版卸载后仍看见 Tansr，先用修复版对原宿主和原范围执行 `status`，再按提示执行 `recover --yes` 或 `uninstall --yes`，并按助手要求重载。不要从事务备份调用技能，也不要删除整个 `skills` 目录。用户修改的技能入口会被保留，可能仍被助手发现，回执会明确列出该保留项。

`--project <绝对路径>` 只适用于项目范围；`--json` 不等待交互输入，修改操作仍需明确 `--yes`。安装器校验随包文件大小和 SHA256，不执行模板依赖或安装脚本，不上传项目数据。

Tansr 自有安装器与原创贡献采用 [MIT](LICENSE)。既有 Apache 来源适配义务及第三方许可见 [NOTICE](NOTICE) 和 [LICENSES/Apache-2.0.txt](LICENSES/Apache-2.0.txt)；随包 Demo 与独立 SDK / Serve 沿用各自许可。

[Tansr 官网](https://tansr.com/) · [开发文档](https://docs.tansr.com/)
