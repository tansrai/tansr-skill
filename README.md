# Tansr Skill

帮助用户在熟悉的编程助手中，把产品想法做成可运行的 AI 应用，为已有项目接入 Tansr，并继续修改、验证与排错。

TPB-01 第一阶段 Skill 集已完成验收，当前为本地可交付候选。入口为 [SKILL.md](SKILL.md)，不需要自行挑选多组内部技能。第二阶段的 npx 安装器尚未发布；这里不提供虚构的安装命令。助手手动接入见 [assistant-setup.md](references/assistant-setup.md)。

## 开始一个产品

把本仓 Skill 交给编程助手，并描述想做什么，例如：“我想做一个可以录入日常活动、查看历史与生成建议的健身助手”。助手应完成界面、业务数据、Tansr 接线及验证，不能只返回聊天回答或方案。已有项目保留原技术栈和锁文件。

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
```

根检查负责生成器、诊断和内容一致性。Web 工程另外执行自己的 `npm test`、`npm run typecheck`、`npm run lint`、`npm run build`；Node 样例按其 README 验证。构建通过不代表真实平台、浏览器和原生设备全部验收。

发行版本、公开 Demo 差异与逐平台运行状态见 [compatibility.json](compatibility.json) 和 [平台接入](references/platforms.md)。Electron 的原界面、恢复与合成媒体已验；移动端按各自回执区分构建、服务联验和界面验收。WorkBuddy 的正式包格式和加载规则仍需实际宿主核验。

复用已核的 Electron、Android 或鸿蒙公开 Demo，可先使用本仓的 `scripts/prepare-demo.mjs` 离线准备工具；支持 `electron`、`android`、`harmony` 三种平台参数。它仅对清单中固定原件应用修正，保留 SDK/锁文件，拒绝覆盖用户修改；不安装依赖、不调用模型。完整命令、来源及各修正的原生验收边界见[平台接入](references/platforms.md)。

iPhone App 的已有宿主已整理为[公开 Demo 准备资产](assets/ios-app-host/README.md)，消费正式 SDK 0.3.0 和原 SwiftUI 示例。准备脚本验证公开文件后新增 App 工程，并应用清单中固定摘要的 Demo 修正；不改 SDK、锁文件或用户已有工程。Apple 编译、模拟器与签名结果分别记录，不能用 Windows 的目录准备检查替代。

逐项实施、证据与剩余工作统一记录在 [实施方案](doc/PLAN-01-Skill生态与两步产品构建实施方案.md)。本 Skill 的 Apache-2.0 及 [NOTICE](NOTICE) 保留原始来源；SDK、CLI 等独立产品许可按对应发行物核对。
