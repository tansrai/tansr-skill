# Tansr Skill

让你熟悉的编程助手，帮你把想法做成 AI 产品：选择助手安装 Skill，再描述产品需求。Skill 提供开发指引、SDK / Serve 接入资料和起步工程；安装本身不创建账号、不调用模型、不部署应用。

**本说明对应 `0.1.6`。** 该版本修复已公开 0.1.5 的发行元数据校验错误；0.1.5 安装入口会在写入前拒绝新增模板，不能以版本已存在代替可用性验证。 下文统一使用该精确版本，执行前确认 registry 已提供该版本；精确版本与可变标签以 [npm 实际记录](https://www.npmjs.com/package/@tansr/skill)为准。发行、同包核验与宿主结果另见[第三阶段回执](https://github.com/tansrai/tansr-skill/blob/main/doc/S3-实施回执.md)，安装文件不等于助手已加载。

## 第一步：选择一个助手并安装

需要已有 Node.js ≥22.19、npm 和目标助手。安装器不代装这些软件。首次 npx 获取包需要网络；缺少 Node 时先从 [Node.js 官网](https://nodejs.org/en/download)安装受支持版本，重新打开终端。

在准备开发产品的目录执行版本查询，确认返回 `0.1.6` 后再运行后续命令；查询失败或版本尚不可用时停止，不自动安装旧版本。以下以 Codex 为例，换助手时只替换 `--host`：

```sh
# 先核实精确版本可用，再执行安装
npm view @tansr/skill@0.1.6 version
npx --yes @tansr/skill@0.1.6 hosts
npx --yes @tansr/skill@0.1.6 preview --host codex --scope project
npx --yes @tansr/skill@0.1.6 install --host codex --scope project --yes
```

也可把这段话交给编程助手：

> 请在当前项目安装 Tansr Skill。先查询 registry 确认精确版本 0.1.6 可用、Node.js 至少为 22.19；该版本不可用时停止，不换旧版本。确认后，使用 `preview --host codex --scope project` 查看目标，再运行同版本的 `install --host codex --scope project --yes`。有冲突时保留已有内容。安装后在本助手中确认技能可见，并实际读取它的 SKILL.md，分别报告结果。

目录安装选择如下；**支持写入目录不等于该助手已通过实际加载验收**。产品版本、启用状态和运行系统仍会影响发现结果。

| 助手 / 产品 | `--host`（括号内为别名） | 可选范围 |
| --- | --- | --- |
| Codex | `codex` | `project` / `user` |
| WorkBuddy | `workbuddy` | `project` / `user` |
| CodeBuddy | `codebuddy` | `project` / `user` |
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
# 仅当你选择 ZCode，且已核实精确版本 0.1.6 可用
npx --yes @tansr/skill@0.1.6 install --host zcode --scope user --yes
```

**一次只安装所选的一处。** `generic` 写入 `.agents/skills/tansr`，与 Codex 共用目标，也可能被其他已支持该约定的助手读取；它不是“自动安装到所有助手”。精确路径、重载和自定义配置根限制见[助手安装说明](https://github.com/tansrai/tansr-skill/blob/main/references/assistant-setup.md)；包内对应 `skill/references/assistant-setup.md`。

共用目录的更新、回退或卸载会影响读取它的所有助手。Kimi 的项目安装需从最近的 Git 根执行，子目录调用会提示正确根路径；MiniMax 自定义 profile 必须明确实际数据目录。

`feishu`（飞书 aily）、`yuanbao`、`doubao`、`volcengine`（火山 Agent）和 `trae-global` 仅提供官方手动入口或待核实说明，不执行目录安装。云端 Agent、普通聊天产品与同品牌编程助手分别处理，不自动上传、注册或启用 Skill。

## 第二步：描述你想做的产品

回到所选助手，按安装回执重载或检查技能列表，再描述需求：

> 使用 Tansr Skill，帮我做一个运行在 Windows 电脑上的学习计划助手，能记录目标、安排每日任务并回顾进展。先做出能运行的第一版，协助完成所需配置，并展示真实工具执行的进度和结果。

已有项目也可以说：

> 使用 Tansr Skill，为当前订单系统加入自然语言查询助手，沿用原登录、权限、数据库和锁文件，保留我的现有修改。

助手会继续完成界面、业务工具、接线与验证。所需后端先复用已有受控服务，缺少时一起建立、接线并启动；随包 `create-project.mjs` 支持 `--template token-server` 和 `--template serve`，按产品所需选择并沿生成工程 README 分别启动前后端、检查健康和端到端流程。完整入口见[前后端交付指导](https://github.com/tansrai/tansr-skill/blob/main/references/build.md)。没有平台账号或凭据时仍完成本地运行链路，平台换票和真实调用保留未验状态。

需要平台应用或模型授权时，助手沿实际入口引导获取 ApiKeyId（App ID）与 App Key，并给出实际后端 `.env` 的可点击绝对路径或已有安全配置入口，协助本机配置、检查和重启。Web 的 `TANSR_APP_ID` 与 token-server / Serve 的 `TANSR_APP_KEY_ID` 都填写同一应用 ApiKeyId；`TANSR_APP_KEY` 才填写秘密值。配置步骤见[使用指导](https://github.com/tansrai/tansr-skill/blob/main/references/use.md)，避免只留一句“填写 .env”。真实密钥放在应用服务端，日常不回显；诊断确有必要时可在当前受控界面最小范围展示，随后提醒适时轮换并更新相关服务，不擅自轮换。密钥不进入客户端、常规日志或 Skill 安装记录。交付时说明当前可用的平台及验证状态，并给出适合本产品的后续选择，如手机 App、电脑安装包或网站发布。

## 检查、更新与卸载

以下命令同样以已核实可用的精确 `0.1.6` 为前提，并保留最初选择的宿主与范围；已有安装不因本文版本变化自动更新：

```sh
# 已核实精确版本 0.1.6 可用时
npx --yes @tansr/skill@0.1.6 status --host codex --scope project
npx --yes @tansr/skill@0.1.6 update --host codex --scope project --yes
npx --yes @tansr/skill@0.1.6 rollback --host codex --scope project --yes
npx --yes @tansr/skill@0.1.6 uninstall --host codex --scope project --yes
```

`status` 只检查文件，不证明助手已加载。`update` 使用当前命令取得的包内容；`rollback` 回退登记的前一版。卸载保留用户修改、未知文件、其他 Skill 和已创建的产品。上次进程中断时先看 `status`，仅按提示执行同目标的 `recover --yes`。

从 0.1.2 起，事务、暂存和备份存放在 `skills` 的父目录下，以目标路径摘要区分安装，例如 `.codebuddy/.tansr-installer-state-<摘要>`。它们不会放进助手扫描的 `skills` 树。旧版本的受管状态在执行确认后的更新、卸载或恢复操作时迁移；只读的 `preview`/`status` 显示待迁移状态，不移动文件。迁移保留备份和历史，旧位置只留无技能内容的防回写标记，拒绝旧安装器重新管理。此后请使用 0.1.2 或更新版本管理该目标。

若旧版卸载后仍看见 Tansr，先用修复版对原宿主和原范围执行 `status`，再按提示执行 `recover --yes` 或 `uninstall --yes`，并按助手要求重载。不要从事务备份调用技能，也不要删除整个 `skills` 目录。用户修改的技能入口会被保留，可能仍被助手发现，回执会明确列出该保留项。

`--project <绝对路径>` 只适用于项目范围；`--json` 不等待交互输入，修改操作仍需明确 `--yes`。安装器校验随包文件大小和 SHA256，不执行模板依赖或安装脚本，不上传项目数据。

Tansr 自有安装器与原创贡献采用 [MIT](LICENSE)。既有 Apache 来源适配义务及第三方许可见 [NOTICE](NOTICE) 和 [LICENSES/Apache-2.0.txt](LICENSES/Apache-2.0.txt)；随包 Demo 与独立 SDK / Serve 沿用各自许可。

[Tansr 官网](https://tansr.com/) · [开发文档](https://docs.tansr.com/)
