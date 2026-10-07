# 产品定位与接入选择

核对日期：2026-09-24。先根据用户任务选形态，再查该形态的实际版本。以下是开发使用参考，不是套餐或性能承诺。

## 产品在应用里负责什么

Tansr 的核心是嵌入应用的 Agent Harness：把模型请求、工具调用、权限判断、上下文处理、会话与事件连接起来。CLI 使用同一核心，服务端和移动端提供不同接入面。

| 能力 | Tansr 提供 | 应用开发仍要完成 |
| --- | --- | --- |
| AI 执行 | 模型接入、多步工具循环、上下文管理 | 业务目标、实际数据、可调用的业务函数 |
| 交互 | 事件流、SessionView、权限/提问桥 | 页面、输入、状态、结果依据、确认交互 |
| 会话 | store 接口、恢复、检查点 | 存储位置、保留规则、账户和租户隔离 |
| 平台接入 | 应用模型目录、能力配置、令牌与用量 | 自己的用户登录、服务端换票、业务授权 |
| 商业使用 | 运行规模套餐、模型与媒体计量 | 面向终端用户的定价、支付、对账与支持 |

帮助用户开发出有用的应用并持续使用产品，是本 skill 的产品目标；减少开发耗时、提高转化等效果需要实际数据验证。没有证据时不承诺“零代码”“几分钟上线”、收入或转化率。

这里的开发辅助 skill 运行在用户的编码助手中。Tansr 运行时的 `defineSkill` / 技能目录是另一层扩展机制；两者不能相互替代，也不能假定装了本 skill 就已注册平台应用。

## 选最短的适用路径

| 需求 | 默认建议 | 必要边界 |
| --- | --- | --- |
| 个人在终端用 AI 工作 | `@tansr/cli` | PAT 初始化；不要求先买 SDK 套餐 |
| Node 后端或本机脚本 | `@tansr/sdk` | 在受控 Node 进程运行；按需自接 HTTP / 登录 |
| Electron 桌面应用 | 主进程用 SDK，IPC 向界面发送投影 | appkey 不打进安装包；服务端给主进程换短期令牌 |
| Web 多用户应用、移动端服务 | `@tansr/serve` 的 `/v2`，或在现有后端安全嵌入 SDK | 自有登录鉴权、按用户分域、持久化；不能共用用户会话 |
| Android / iOS / 鸿蒙 | 官方薄客户端连接自有 Serve | 手机不运行 Node 内核、不持平台 appkey/app_user |
| 单运维方脚本控制 | CLI `serve` 的 `/v1` | 共用运维 Bearer 不是终端用户登录体系 |

已有后端能满足需求就直接复用；不为所有项目强制新增 Serve。CLI `serve --v2` 的共享 Bearer 与自报用户头适合受控联调，不能直接暴露给不可信终端作为用户身份体系。

## 版本基线与已知资料差异

2026-09-24 核对 npm 发布元数据和本地 SDK：`@tansr/sdk 0.17.0`、`@tansr/serve 0.12.0`、`@tansr/cli 0.9.0`，npm 形态要求 Node.js ≥ 22.19。Node SDK 为 ESM。SEA CLI 自带运行时。

- 部分快速开始仍写 SDK 0.16 / Serve 0.11；示例必须对照已装包类型核实。
- 官网与账号帮助页列出的套餐名称、并发和应用额度不同。不要把静态表写死；打开实时套餐页，购买前看服务端报价和个人/组织归属。
- 官网写 SDK 源码拟于 2026-12-31 按 MIT 开放；npm SDK/Serve 元数据已标 MIT，CLI 标 UNLICENSED。这些信息不证明整个产品源码已公开，也不构成重新分发 CLI 的许可。
- 首页旧的 CLI 叙事、模型示例和路线图不能代替当前 API、模型目录、功能状态或认证证明。
- C# / Go / Rust / C++ 桌面 Demo 在下载页仍标“近期支持”；不要编造对应原生 SDK。
- 文档引用的 monorepo `examples/*`、`deploy/*` 不保证公共 npm 包或公开仓库附带这些文件。先确认来源可访问，再给下载/运行命令。`llms.txt` 未核实为可用入口。

## 官方资料入口

按主题打开直接来源，不全站爬取，也不要求专用 MCP：

- [官网](https://www.tansr.com/) · [SDK 产品页](https://www.tansr.com/sdk) · [Demo 下载](https://www.tansr.com/downloads)
- [选择使用路径](https://docs.tansr.com/getting-started/) · [CLI 起步](https://docs.tansr.com/getting-started/cli/) · [Node SDK 起步](https://docs.tansr.com/getting-started/sdk/) · [Serve 起步](https://docs.tansr.com/getting-started/serve/)
- [SDK API](https://docs.tansr.com/sdk/api/) · [平台 bundle](https://docs.tansr.com/sdk/platform-bundle/) · [移动端起步](https://docs.tansr.com/getting-started/android/)
- [SDK 套餐](https://www.tansr.com/sdk-pricing) · [调用计费](https://www.tansr.com/pricing) · [账号与密钥](https://docs.tansr.com/support/account/)
- [安全与隐私](https://docs.tansr.com/security/) · [错误码](https://docs.tansr.com/errors/codes/) · [排障](https://docs.tansr.com/support/troubleshooting/)
- [SDK 发布](https://docs.tansr.com/releases/sdk/) · [Serve 发布](https://docs.tansr.com/releases/serve/) · [CLI 发布](https://docs.tansr.com/releases/cli/)
- npm 元数据：`https://registry.npmjs.org/@tansr/sdk/latest`；Serve、CLI 替换包名。用户已有项目以锁文件为准。

未登录的公开文档不能证明某账号的授权、余额、套餐、控制台当前 UI 或某个真实设备可用。只核对过文档时应明确说“官方文档描述”，不能说“已经实测”。
