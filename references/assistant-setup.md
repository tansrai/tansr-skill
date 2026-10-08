# 在自己的助手中安装 Tansr Skill

适用于“让 Codex 或 WorkBuddy 借助 Tansr 构建产品”。安装 Skill 后，向同一个助手描述产品需求。Skill 提供开发步骤、参考资料与起步工程；应用实际运行依赖 SDK / Serve，见[产品使用](use.md)。

本版构建时，第一阶段 Skill 集已验收，安装器进入第二阶段候选验收。构建时的发行和宿主验证状态见[兼容清单](../compatibility.json)，这些是带时间的快照；此后的实际发行状态应查 [npm 包与标签](https://www.npmjs.com/package/@tansr/skill)。本文命令不能作为已发布证明：`next` 用于候选验收，`latest` 只有在精确候选通过公开下载及宿主验证后才启用。

## 选择范围并预览

需要已有 Node.js ≥22.19 和 npm；安装器不代装 Node、桌面助手、SDK 或模板依赖，不发起模型调用。初次通过 npx 取得包需要网络，下载失败就报告失败；本地安装使用随包字节。

在准备开发产品的目录打开助手，明确选择一个宿主和一个范围：

| 宿主 | 项目范围 `--scope project` | 用户范围 `--scope user` |
|---|---|---|
| Codex | `<项目>/.agents/skills/tansr` | `<用户目录>/.agents/skills/tansr` |
| WorkBuddy | `<项目>/.codebuddy/skills/tansr` | `<用户目录>/.codebuddy/skills/tansr` |

一般先选项目范围；跨项目使用时明确选择用户范围。一次命令只处理一个位置。项目路径默认当前目录，也可用 `--project` 指定绝对路径；该参数不适用于用户范围。只预览目标可运行 `preview`，`install/update --dry-run` 也只预览。

维护者当前可先构建本地候选，再使用生成包 `dist/npm/installer/cli.mjs` 的入口；不能直接把开发仓源码当已构建的安装包。以下为 **0.1.0 精确候选实际发布后** 的示例，发布之前不可承诺它已经能从 registry 下载：

```sh
npx --yes @tansr/skill@0.1.0 preview --host codex --scope project --json
npx --yes @tansr/skill@0.1.0 install --host codex --scope project --yes --json
```

WorkBuddy 使用 `--host workbuddy`。前一个 `--yes` 是 npx 取得包的确认；命令尾部的 `--yes` 才是安装器更改目标的确认。安装前先查看预览的精确目标和冲突。无人值守执行及 `--json` 均不会等待输入；缺少宿主、范围或更改确认时会非零退出。交互终端会询问缺少的选择，并在确认更改前显示精确目标。

候选发布后的助手指令可以是：

> 请在当前项目安装精确版本 0.1.0 的 Tansr Skill。先确认该候选已经发布、Node.js 至少为 22.19，并用 `preview --host codex --scope project --json` 核对目标；确认后执行同版本的 `install --host codex --scope project --yes --json`。如有冲突，保留已有内容并说明。安装后分别检查 Skill 是否可见、是否实际读取，不把文件安装成功写成已经加载。

## Codex 的加载与同名技能

Codex 官方确认项目 `.agents/skills` 和用户 `$HOME/.agents/skills`；项目发现还会从当前目录向仓库根逐级查找。安装后回到目标项目，在 CLI / IDE 用 `/skills` 或输入 `$` 选择 Tansr，也可明确要求“使用 Tansr Skill”。技能变化通常自动检测；未出现时保存工作并重启 Codex，再检查实际读取路径。[官方技能文档](https://learn.chatgpt.com/docs/build-skills)

同名 Skill 不会合并，可能同时出现在选择器。项目与用户范围都有 `tansr` 时，先核对实际读取的 `SKILL.md`，不自动覆盖或删除另一个范围。安装器不改全局助手配置、权限或其他 Skill。

第一阶段已在 Windows Codex CLI 0.158.0-alpha.2.1 的隔离项目验证手动放置后的自然触发、显式 `$tansr` 和无关负触发；前两项实际读取入口及按需参考，负触发零工具，项目文件未改变。该历史事实继续有效。第二阶段本轮 **打包安装后的宿主发现/调用、用户范围、GUI 选择器及 macOS/Linux** 仍需各自证据，不能由第一阶段手工验证代签。

## WorkBuddy 的加载与同名技能

WorkBuddy 自己的[项目文档](https://www.codebuddy.cn/docs/workbuddy/From-Beginner-to-Expert-Guide/Function-Description/Project)明确项目 `.codebuddy/skills/`，每个技能使用独立目录和 `SKILL.md`；它也明确兼容用户 `~/.codebuddy/`，并引用[目录规范](https://www.codebuddy.cn/docs/cli/codebuddy-dir)。安装器据此支持表中的两个范围。同名技能按项目级优先；用户兼容目录也可能被 CodeBuddy 消费，选择前应理解影响。

在 WorkBuddy 中打开所选本地项目，沿宿主原有提示处理工作区信任，在技能选择入口确认 Tansr 可见及启用。官方[技能页](https://www.codebuddy.cn/docs/workbuddy/From-Beginner-to-Expert-Guide/Function-Description/Skills-Market)还提供本地包导入和启用管理。目录安装与界面导入是不同入口；本轮未验证 Tansr 包的界面导入、目录加载或资源读取。

可以在输入区选择已安装技能，并用明确提及 Tansr Skill 的任务做显式验证；不要发明 `/tansr` 命令。外部文件更新的热重载和缓存行为仍待实测。若没有出现，检查当前项目、所选范围与启用状态，并依据实际宿主界面处理重载，不向猜测目录重复复制。桌面个人技能库与 Web 个人技能库也不能互作安装结果。

目前没有可宣称已通过本轮真实 Tansr/WorkBuddy 加载验收的系统组合。官方 Windows 指南给出 Windows 10+ x64，Mac 指南给出 macOS 12+ 及 Intel x64 / Apple arm64；这些是系统文档事实，实际加载、ARM64 Windows 和 Linux 仍按具体版本另核。资料与待验项见兼容清单中的 `stage2Documentation` 与 `packagedHostValidation`。

## 状态、更新、恢复与卸载

从同一个已取得的候选包运行以下命令，均带原来的 `--host` 和 `--scope`：

| 命令 | 行为 |
|---|---|
| `status` | 只读检查目标及受管文件状态；不代替宿主实际调用 |
| `update --yes` | 更新到当前所执行包的内容版本，保留可用的前版恢复信息 |
| `rollback --yes` | 回退登记的前一版；先核对文件归属和用户修改 |
| `recover --yes` | 明确恢复已退出安装进程留下的事务；不抢占仍在运行的进程 |
| `uninstall --yes` | 删除登记且未被修改的 Skill 文件，保留用户改动和未知文件 |

未知同名目录不会被强制接管。遇到权限问题选择当前用户可写的位置；遇到未完成事务先检查 `status`，再按回执处理恢复。冲突、保留项和部分完成会明确报告并非零退出。不得删除整个宿主技能目录来解决失败；使用 Skill 创建的产品也不属于卸载对象。

安装记录含包版本、Skill 版本、模板基线、SDK/Serve 基线、宿主、范围和文件哈希。当前基线为 Skill 0.1.0、Web 模板 0.1.0、Node 模板 1.0.0、SDK 0.18.1、Serve 0.15.0；发行配置与兼容清单须通过打包核对。已有项目仍沿用其锁文件和技术栈，这些基线不会触发自动升级。

## 安装后开始构建产品

回执分别报告文件安装、静态结构、宿主发现和实际调用。安装器只凭文件证据判断前两项，后两项保持待验。在宿主内给一个不调用模型、不部署的小任务，例如“使用 Tansr Skill，阅读当前项目并说明接入位置”，记录实际读取路径。随后独立验证自然语言触发；显式调用通过不能代替自动触发。

确认可用后，直接描述用户、需求、运行设备及已有项目。例如：“帮我做一个学习计划助手，能记录目标、安排每日任务并回顾进展。”沿[应用开发](build.md)继续。账号配置、生成应用运行、真实平台调用及发布各自验证；安装 Skill 不代表它们已经完成。失败按[排错](troubleshoot.md)处理。
