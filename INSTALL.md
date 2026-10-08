# Tansr Skill

让熟悉的编程助手，帮你把想法做成 AI 产品。

发行状态以 npm 上的实际版本和标签为准：`next` 用于候选验收，只有完成公开安装闭环的版本才启用 `latest`。下文 `@latest` 是正式入口；若 registry 尚无对应标签，请等待正式发行，不能把文档中的命令当作已发布证明。

Tansr Skill 提供需求梳理、SDK 与服务接入、可运行起步工程，以及验证和排错指引。安装后，直接描述想做的产品即可。Skill 为开发过程提供帮助；生成的应用使用 Tansr SDK 或 Serve 运行。

## 第一步：交给助手安装

在你准备开发产品的目录打开 Codex，把下面这段话交给它：

> 请在当前项目安装 Tansr Skill。先确认 Node.js 至少为22.19，并检查安装目标是否已有用户修改。运行 `npx --yes @tansr/skill@latest install --host codex --scope project --yes`。如遇冲突请保留已有内容并说明，不强制覆盖。随后检查 Skill 是否能被发现，实际读取它的 SKILL.md 后告诉我结果。

在 WorkBuddy 中使用同样的指令，将 `--host codex` 改为 `--host workbuddy`。

熟悉终端也可直接执行：

```sh
npx --yes @tansr/skill@latest install --host codex --scope project --yes
```

安装器需要已有 Node.js ≥22.19 和 npm。它不自动安装 Node、桌面助手或模型运行依赖。缺少运行环境时，先安装 [Node.js 的受支持版本](https://nodejs.org/en/download)，重新打开终端后再执行。

这里的 `latest` 是正式发行入口；候选验收使用明确的 `next` 或精确版本。安装前可在 [npm 包页面](https://www.npmjs.com/package/@tansr/skill) 核对实际发行状态。文件安装成功后，助手是否发现、实际读取，仍需分别确认。

## 第二步：描述你想做的产品

例如：

> 使用 Tansr Skill，帮我做一个智能健身助手。可以记录每天的活动和感受，查看历史与趋势，并根据我提供的信息生成可以检查和修改的建议。先做出能运行的第一版，再告诉我哪些配置需要完成。

已有产品也可以直接说：

> 使用 Tansr Skill，为当前订单系统加入自然语言查询助手，沿用原登录、权限和数据库，保留我的现有修改。

助手会继续完成界面、业务工具、接线与验证。需要平台应用或模型授权时会说明具体步骤；安装 Skill 本身不创建账号、不发起模型调用，也不部署你的产品。

## 安装位置

| 宿主 | 当前项目 | 当前用户所有项目 |
|---|---|---|
| Codex | `.agents/skills/tansr` | `~/.agents/skills/tansr` |
| WorkBuddy | `.codebuddy/skills/tansr` | `~/.codebuddy/skills/tansr` |

默认建议项目范围。跨项目使用时，明确改为 `--scope user`。每次只安装所选的一处，不会同时写入多个助手。`--project` 可以指定项目绝对路径；用户范围不接受此参数。

WorkBuddy 的目录依据是其官方项目文档明确支持的项目配置和用户级兼容配置。文件安装与目标版本实际加载是两项验证；如没有显示技能，先按宿主界面检查当前项目、技能启用及重载，不猜测其他目录反复复制。

Codex 会自动检测技能变化；未显示时保存工作后重新启动助手。在 CLI/IDE 可通过 `/skills` 或 `$tansr` 显式选择，也可以在对话中说明“使用 Tansr Skill”。同名技能可能来自不同范围，请核对实际读取路径。

## 检查、更新与卸载

先预览目标，不修改文件：

```sh
npx --yes @tansr/skill@latest preview --host codex --scope project
npx --yes @tansr/skill@latest status --host codex --scope project
```

更新到当前命令取得的包版本：

```sh
npx --yes @tansr/skill@latest update --host codex --scope project --yes
```

回退到保留的前一版，或卸载登记的 Skill 文件：

```sh
npx --yes @tansr/skill@latest rollback --host codex --scope project --yes
npx --yes @tansr/skill@latest uninstall --host codex --scope project --yes
```

安装器保留被用户修改的文件和其他 Skill，不接管来源不明的同名目录。遇到冲突会列出保留项并返回非零状态；不会用“完成”掩盖未处理文件。卸载不删除你使用 Skill 创建的产品。

如果上次进程中断，先查看 `status`。只有提示需要恢复时，运行相同宿主与范围的 `recover --yes`。正在使用目标的安装进程不会被另一个命令强制抢占。

自动化调用使用 `--json` 获取结构化状态；这个模式不会等待交互输入，修改命令需要明确 `--yes`。`--help` 和 `hosts` 列出实际支持参数与宿主。

## 内容与版本

包内包含 Skill、参考资料、起步模板、固定文件清单，以及离线生成/诊断/Demo准备工具。安装时核验文件大小及 SHA256；不在后台下载另一份技能、不上传项目数据、不执行模板依赖或安装脚本。

模板保留锁文件、`.env.example`、`.tansr` 和 `.gitignore` 等必要配置。真实密钥由应用的服务端安全配置持有，不应填入聊天、Skill 安装记录或客户端代码。

本 Skill 使用 Apache-2.0，来源见随包 LICENSE 与 NOTICE。应用运行依赖的 SDK、Serve 与各平台产物分别使用其自身许可和已验版本。

[Tansr 官网](https://tansr.com/) · [开发文档](https://docs.tansr.com/)
