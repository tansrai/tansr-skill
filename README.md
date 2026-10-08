# Tansr Skill

帮助用户在熟悉的编程助手中，把产品想法做成可运行的 AI 应用，为已有项目接入 Tansr，并继续修改、验证与排错。

TPB-01 第一、二阶段已完成验收。入口为 [SKILL.md](SKILL.md)，不需要自行挑选多组内部技能。`@tansr/skill@0.1.3` 已正式发布，`latest` 与 `next` 均指向0.1.3。三系统 CI、公开包安装与卸载、Codex和WorkBuddy适用的项目/用户范围实际读取及新需求产品流程均有验收证据；第三阶段新引导首页尚未开始。

安装（Node.js ≥22.19，在目标项目目录执行，以下选择 Codex）：

```sh
npx --yes @tansr/skill@latest install --host codex --scope project --yes
```

WorkBuddy 将参数改为 `--host workbuddy`；需要用户级安装时使用 `--scope user`。安装后重新加载助手，并确认实际读到 Tansr 入口。WorkBuddy 5.7.6 与 CodeBuddy 项目根共用 `.codebuddy/skills`，默认用户根分别为 `.workbuddy/skills` / `.codebuddy/skills`。安装器不会自动搬移可能由另一助手使用的旧目录。

需要固定本次已验版本时，将 `@latest` 换为 `@0.1.3`；可用 `npx --yes @tansr/skill@0.1.3 hosts` 查看目标。安装合同见 [安装说明](INSTALL.md)，助手接入见 [assistant-setup.md](references/assistant-setup.md)。**包内安装说明和兼容清单是构建时快照，其中“未发布／未测试”不表示当前状态。2026-10-08发布及宿主验收补充见 [第二阶段回执](doc/S2-实施回执.md)**；不改写已发布包的字节或历史失败证据。

安装器提供 14 个目录配置，覆盖通用目录、Codex、WorkBuddy、CodeBuddy、Claude Code、Cursor、TRAE、Qoder、ZCode、Kimi Code、MiniMax Code CLI 与千问 Qwen Code 的已核实入口及地区/CLI差异。另 5 个入口提供手动导入或待核实说明，不假报安装成功。精确路径与状态可运行 `hosts --json` 查看。目录安装验收不等于全部助手实际加载验收。

## 开始一个产品

安装后向同一个编程助手描述想做什么，例如：“请使用 Tansr Skill，帮我做一个可以录入日常活动、查看历史与生成建议的健身助手”。助手应完成界面、业务数据、Tansr 接线及验证，不能只返回聊天回答或方案。已有项目保留原技术栈和锁文件。

仓内的 Web 基础工程提供记录管理、SDK 工具调用、事件进度、取消与历史；Node 样例提供独立工具循环。它们是开发起点，业务界面、数据及工具应按实际产品调整：

```sh
node scripts/create-project.mjs --template web --name my-ai-product --target /absolute/new/project
```

Windows 使用完整的新目录路径，如 `J:/my-ai-product`。命令只复制源码，不安装依赖、不调用模型；目标存在时拒绝覆盖。随后按生成工程的 README 配置，执行 `npm ci`、`npm test`、`npm run build`、`npm start`。需要 Node ≥22.19。

离线模式明确标为本地规则演示。平台模式由后端持有应用密钥，不需要另购厂商密钥；真实调用失败不会替换成模拟结果。静态配置诊断：

```sh
node scripts/doctor.mjs --project /absolute/project
```

诊断不联网、不验证余额或模型授权、不输出秘密值。应用配置、账号及接线参见 [use.md](references/use.md) 与 [build.md](references/build.md)。

## 维护与验收

技能开发目录使用 pnpm；生成的两个应用使用各自 npm 锁文件。不要混用锁文件。

```sh
pnpm install --frozen-lockfile --ignore-scripts
pnpm test
pnpm typecheck
pnpm lint
pnpm build
pnpm check:package
```

根检查负责生成器、诊断、内容一致性和安装器。构建产物为 `dist/npm`，包门核对真实 npm tarball 及解包后的内容；具体候选发行顺序见 [发行与维护](doc/S2-发行与维护.md)。Web 工程另外执行自己的 `npm test`、`npm run typecheck`、`npm run lint`、`npm run build`；Node 样例按其 README 验证。构建通过不代表真实平台、浏览器和原生设备全部验收。

发行版本、公开 Demo 差异与逐平台运行状态见 [compatibility.json](compatibility.json) 和 [平台接入](references/platforms.md)，发布后结果见第二阶段回执。Electron 的原界面、恢复与合成媒体已验；移动端按各自回执区分构建、服务联验和界面验收。公开0.1.1的Codex项目/用户加载和新需求产品流程、WorkBuddy项目调用证据继续有效；0.1.3修复备份误发现及用户根差异后，WorkBuddy已通过技能列表实际读取正确用户入口。该项为用户辅助验收，不冒充自动化操作成功。

复用已核的 Electron、Android 或鸿蒙公开 Demo，可先使用本仓的 `scripts/prepare-demo.mjs` 离线准备工具；支持 `electron`、`android`、`harmony` 三种平台参数。它仅对清单中固定原件应用修正，保留 SDK/锁文件，拒绝覆盖用户修改；不安装依赖、不调用模型。完整命令、来源及各修正的原生验收边界见[平台接入](references/platforms.md)。

iPhone App 的已有宿主已整理为[公开 Demo 准备资产](assets/ios-app-host/README.md)，消费正式 SDK 0.3.0 和原 SwiftUI 示例。准备脚本验证公开文件后新增 App 工程，并应用清单中固定摘要的 Demo 修正；不改 SDK、锁文件或用户已有工程。Apple 编译、模拟器与签名结果分别记录，不能用 Windows 的目录准备检查替代。

逐项实施、证据与剩余工作统一记录在 [实施方案](doc/PLAN-01-Skill生态与两步产品构建实施方案.md)。

Tansr 自有安装器、开发工具、测试及原创贡献采用 [MIT](LICENSE)，项目位于 [tansrai/tansr-skill](https://github.com/tansrai/tansr-skill)。既有 `SKILL.md` 与参考资料中的 Apache 来源适配内容继续保留其许可义务，完整许可见 [Apache-2.0](LICENSES/Apache-2.0.txt)，来源、修订和范围见 [NOTICE](NOTICE)。随包 Demo 资产及 SDK、Serve、CLI 等独立发行物沿用各自许可，不因根许可变更而重新许可。
