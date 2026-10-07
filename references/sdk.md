# Node / Electron SDK

正式发行基线（2026-10-07 核实）：SDK **0.18.1**、Serve **0.15.0**，均要求 Node.js ≥ 22.19。新工程精确锁版本并保存锁文件；已有项目先核对实际安装包 `package.json` 的 `exports` / `types`，再验证升级。SDK 根入口和 `./extensions` 是公开路径；不要猜包内文档或导入私有内核。

## 一次选一种模型来源

| 来源 | 选项轮廓 | 适用 |
| --- | --- | --- |
| token | `{ token, baseUrl }` | 平台管理模型/能力，分发桌面或受控服务端 |
| managed | `{ model: 'main' }` 加 `.tansr/settings.json` | 开发者自有供应商/本地模型；配置只存 `auth.env` 名称 |
| injected | `{ client, model: { provider, model } }` | 离线测试、自定义 provider |

三种来源互斥；token 模式不能再混入本地 config 或自定 capabilities。平台模型用实际授权的别名/目录，不能照抄官网历史模型名。

token 来自应用自己的服务端：校验自己的登录态 → 从服务端确定 `endUserId` → 使用 appid/appkey 向平台 `POST /v1/app-tokens` 换短期票。新应用键要求 `x-tansr-ts` / `x-tansr-nonce` / `x-tansr-sign`；签名算法、请求体和有效期从当前官方协议/可访问样板核对，不凭头名自造签名。`baseUrl` 是平台网关，不是自家换票端点。Electron 仅主进程持短期票，renderer 用受限 IPC；不要提供任意执行 IPC。短期 app_user 仅保留内存，不写 `.env`、配置文件或本地存储；不能将服务端长期 appkey 的环境配置方式照搬给端侧短期票。

## 把平台接入落到可执行步骤

1. 查看当前控制台中应用的归属、平台类型与模型/能力配置；已有应用就复用。由用户在自己的服务器安全配置 `TANSR_APP_ID` / `TANSR_APP_KEY`，不在聊天接收密钥，不要求另购供应商 key。真实调用前核对该应用所属钱包、授权与费用范围。
2. Web 后端优先复用已有登录与业务 API；移动端走 Serve 的平台工厂。只有需要自行在 Node 后端换票时，使用发布包已导出的 `@tansr/serve` **`createAppTokenMinter`**，复用签名、缓存与错误分类，不手写一份签名算法。这只需库，不要求另起 Serve HTTP 服务。已有换票模块先复用；新增依赖前核对目标版本导出并使用项目包管理器。
3. 下列服务端模块适用于一次短任务（Serve 0.15.0）。`verifiedUser` 必须来自已有登录中间件，不能从请求正文/自报用户头构造。它返回 SDK 来源，仍需接业务工具、事件和收尾。

```js
import { createAppTokenMinter } from '@tansr/serve';

const baseUrl = 'https://api.tansr.com';
const appId = process.env.TANSR_APP_ID;
const appKey = process.env.TANSR_APP_KEY;
if (!appId || !appKey) throw new Error('请在服务器配置 TANSR_APP_ID 和 TANSR_APP_KEY。');
const minter = createAppTokenMinter({
  apiBaseUrl: baseUrl, appId, appKey,
  fetchImpl: (url, init) => {
    const timeout = AbortSignal.timeout(10_000);
    const signal = init?.signal ? AbortSignal.any([init.signal, timeout]) : timeout;
    return fetch(url, { ...init, redirect: 'error', signal });
  },
});

export async function sourceForUser(verifiedUser) {
  const id = verifiedUser?.id;
  if (typeof id !== 'string' || !/^[\x21-\x7E]{1,128}$/.test(id)) {
    throw new Error('请先登录；用户身份须由服务器校验并映射为稳定 ID。');
  }
  return { token: await minter.tokenFor(id), baseUrl };
}
```

4. 在受控后端 `await sourceForUser(req.user)` 后，把结果传给 `createSession` 或反馈示例的 `runFeedback`；网页只得到业务结果，不返回 token/appkey。用户 ID 若不能满足协议，使用业务侧稳定映射，并确保在本应用与租户范围内唯一；不要全体映射成一个演示用户。工具访问数据也绑定此身份，不能相信模型给出的 ownerId。平台地址用已核实的 HTTPS 网关，带应用密钥的请求拒绝自动跳转。
5. 本地先以假的 `fetchImpl` 和脚本模型核对请求形状、用户分域、错误与完整工具循环；有授权后再做一次范围明确的真实平台调用，核对结果与用量。换票成功本身不证明模型能运行。不要把测试凭据当作真实配置。

该片段不提供桌面换票 HTTP 端点或长会话自动续期。Electron 端点需自家登录、限流和最小响应；按当前协议返回 `{ token, expiresAt }`，不要从只返回字符串的 `tokenFor()` 猜过期时间。长会话可用 Serve 平台工厂处理换票；直接 SDK 的 `token: () => currentToken` 是**同步** getter，刷新逻辑需在宿主安全更新内存值，覆盖长轮中的过期场景，不能传 `async () => minter.tokenFor(...)`。当前正式包没有 `createPlatformTokenProvider`。Serve 装配器每请求读取 `tokenFor()`，只对规定的令牌失效 401 重铸并重试一次；不要在业务层泛化为自动重放整轮或写入工具。

## 业务接线

- `await createSession(options)` 提供跨轮会话；`query()` 是单轮生成器，`runAgent()` 是需自备 `client`、`ResolvedModel`、`IRToolDef[]` 与 `executor` 的低阶入口。`runAgent` 不接受 `{ builtin, custom }` 工具装配形，省略执行器会返回 `unknown_tool`。普通应用优先会话。
- 明确写 `tools: { builtin: [...], custom: [...] }`。省略 tools 会装配允许的默认工具，不适合无意中给业务应用增加文件/命令权限。`defineTool` 连接实际业务函数，参数和资源归属在函数内校验。
- `readOnly: true` 是声明，不是无条件许可。安全的只读函数可用精确 `permission.rules.allow`；需要确认的操作接 `permission.askUser`，无桥时 ask 被拒绝。不要用全局 bypass 修“工具不执行”。
- `permission.mode` 表示宿主自管裁决；与显式 `adjudication` 同时使用会冲突。令牌路径通常保留平台裁决配置。
- 媒体工具需要实际能力和模型支持，再显式选择 `imageGen`、`videoGen`、`speechToText`、`textToSpeech`。没有能力时诚实报配置依赖，不偷偷换实现或重建收费产物。
- 业务角色用 `system`，宿主补充用 `systemAppend`，普通任务用 `send()`。平台默认 fallback 下显式 system（包括 `[]`）替换平台业务段；prepend 策略保留平台段。下一轮刷新平台角色，当前轮保持原快照；提示词不授予权限。
- 运行时 skills 与 MCP 仅按业务需要装配；不能假定 SDK 自动扫描用户技能目录。`trustProjectHooks` 默认关闭，不因复制工程就自动授权项目 hooks。

## 事件与界面

首轮发送前挂好事件消费者。事件平铺，通过 `event.type` 判断；`seq` 在同会话内单调。多消费者独立广播；晚订阅不保证已有历史齐全。

处理 `msg.text.delta`、`turn.completed`、`turn.aborted` 和 `turn.error`。`turn.completed` 只表示轮结束，仍须看 reason：`completed` / `structured_output` 与 `max_turns` / `max_tool_rounds` / `stop_hook_limit` 等并不等价。不能只看事件名字就显示任务成功。`turn.error.recoverable === true` 是通知，不能直接当本轮失败；工具错误也可能由模型继续处理。不存在通用 `turn.failed` 事件。未知事件/新增字段容忍，不按封闭枚举炸掉连接。

完整界面优先 `createSessionView(session)` 提供的消息、工具卡、用量和 notices；用户输入须在 `send()` 同时调用 `view.appendUserMessage()` 入账。Web 可由 Node 后端投影，再用 SSE 传安全视图；不能把完整 SDK 当浏览器包。`createNarrator` 可生成调试叙述。自行拼文本还要正确处理 `msg.retracted`，不能将已撤回内容留作最终结果。轮终事件后先 `await session.idle()` 再读最终 `messages()`，事件送达不充当历史就位屏障。单轮 `query()` 的返回结果要用生成器最终 `next().value` 获取，`for await` 不保留 return 值。

`session.events` 跨轮持续，不能靠流自然结束判断一轮完成。`send()` 在空闲时开新轮；严格的“补充当前任务”用 `getInputTarget()` / `submitInput()` / `getInputStatus()`，先保留原 inputId、target 和正文。目标关闭或状态未知时不能回落 `send()`、换 ID 或重放工具。当前仅 memory 回执，accepted/consumed 都不是业务完成或耐久落盘证明。

## 存储、预算与退出

默认会话只在内存。需要恢复就显式传 store，恢复时同时传 `resume: { sessionId, store }` 与顶层 store 继续写入。`createFileSessionStore({ dir })` 是单租户存储，没有用户首参；多用户 Web 须按服务端已验证身份隔离 store 域，并校验恢复的 sessionId 归属，业务工具沿同一身份访问数据。仅确定 `session_not_found` 才考虑新建；损坏必须保留数据并排错。自建存储处理 `rewritten: true` 时整体替换历史，不能只追加。

`idle()` / `close()` / `session.ended` 不证明异步提交已完成。退出用 `closeAsync({ timeoutMs, flushStore: true })` 并检查 `status === 'completed'`；其他状态保留资源与数据，报告未完成项。共用 MCP host 要等所有会话收尾后再 dispose。不要在 `onHistoryCommit` 内等待同会话 drain。

宿主的取消信号与内部超时用 `AbortSignal.any` 合并，不能被覆盖；异步创建前后都检查取消，已取消时不再 `send()`。关闭等待超时不等于底层任务已结束。错误通道需保留宿主可继续 `drain()` 的会话句柄和回执；只向界面返回安全错误信息，不序列化 session、failures 或原始 cause。检查从 SDK helper 到最外层业务入口的完整错误链：接口返回安全错误后，宿主仍须拿得到收尾回执与会话，组合失败也要保留原业务 cause，不能被外层 `catch` 丢弃。从该业务入口注入一次真实持久化回调失败来验证，不能只测 helper 抛错。处理待修复持久化时查 `retryPersistence` 的当前语义，不自动重放业务工具。

取消依赖初始化请求、业务工具和存储实际响应信号；`createSession({ signal })` 不代表每个自定义依赖都能即时退出。必要的网络/数据库适配器也要接取消和有界超时，界面区分“正在停止”与“已停止”。不能用 `Promise.race` 先返回来假称后台工作已结束。

`budget.maxTotalTokens` 是跨币种的 token 上限；`maxUsd` 仅对 USD 计价出数，不能用它保证 CNY 钱包费用。不要为优化缓存发付费保活请求。内核已有模型重试/fallback，业务变更不能未经幂等分析再套自动重试。

存储版本 2 支持媒体产物；升级前核对所有写同目录的版本和备份。SDK 0.17.0 → 0.18.1 的根运行时导出与本参考使用的核心声明保持，存储增加可选 `attachmentCheckpoints` 承诺；自建 store 未实现原子附件保存就不声明该位。静态签名兼容不替代目标应用回归。恢复会话、压缩、检查点、同轮输入、MCP 收尾等仅在任务涉及时打开专题文档。

来源：[API](https://docs.tansr.com/sdk/api/) · [平台装配](https://docs.tansr.com/sdk/platform-bundle/) · [事件](https://docs.tansr.com/sdk/sessions-and-events/) · [系统提示词](https://docs.tansr.com/sdk/system-prompts/) · [恢复](https://docs.tansr.com/sdk/checkpoints/) · [同轮输入](https://docs.tansr.com/sdk/midturn-input/) · [生命周期](https://docs.tansr.com/sdk/lifecycle/)
