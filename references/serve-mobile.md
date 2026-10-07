# Serve 与移动端

## 多用户服务的边界

`@tansr/serve` 是嵌入 Node 后端的 REST + SSE 服务库。通常用 `createAgentSessionFactory` 接平台、`createServeAgentSessionStore` 接本地存储、`startServer` 接 `/v2`。三个函数的完整参数必须对照目标版本类型；文档中的 `myAuth.verify` 等是宿主占位函数，不是 Tansr API 或已实现的登录。

0.12.0 的 `startServer.createSession` 是 `/v1` 的 SessionFactory，`create()` 返回 SessionHandle；`v2.createSession` 才接 AgentSessionFactory，其 `create()` 返回 `{ handle, resumed }`。不要照部分起步示例把 `build.factory` 同时塞给两者。只做 `/v2` 时明确处理未用的 `/v1` 创建入口，仍保留独立运维 token，不能随意给它一个终端用户身份。

| 路径 | 鉴权与职责 |
| --- | --- |
| 客户端 → 自家 `/v2` | `authenticate(req)` 校验真实登录态，返回 `{ endUserId }` 或 null；身份从服务端会话取得，不信任请求体/自报头 |
| Serve → 平台 | 服务端保管 appid/appkey，工厂按用户换取 app_user；app_user 不发给手机/网页 |
| 运维 → `/v1` | `startServer.token` 的独立强随机 Bearer；不发给终端用户，不与 `/v2` 混用 |

每个按 sessionId 访问的接口都要校验归属。CORS、难猜 ID、页面登录按钮不能替代这层授权。应用工具访问业务数据时仍需独立校验用户与租户，不以模型提供的用户 ID 为准。CLI `serve --v2` 的共享 Bearer + `x-tansr-end-user` 仅用于可信调用方，不作为公网用户登录。

生产接 store，重启后才能 resume。工厂的 store 与 `v2.store: build.storeReader` 要同时接对；无 store 时 `resume_unavailable` 是配置问题。store 目录各副本私有，不能多个进程共享 NFS/同一卷并发写。需要多副本时再查分片前缀路由；小应用不预建集群。

## REST 与流式恢复

- `POST /v2/sessions` 建会或 resume；`POST /v2/sessions/:id/messages` 发普通用户消息，202 只说明接纳。
- `GET /v2/sessions/:id/events` 为 SSE：业务事件在 data 内，控制帧用 `event: server.*`。按 seq 去重；重连发送 Last-Event-ID。
- `server.replay.gap` 时重新取元信息与 `/history` 构建视图，从 `history.lastSeq` 继续。休眠看 `live: false`，不以 `lastSeq === 0` 判断。
- 冷启动保留原 sessionId，先 attach/resume；不能每次断网都新建付费会话。严格同轮追加另走 `/input-capabilities`、`/inputs` 和回执查询，未知状态不自动降级发新消息。
- `DELETE /v2/sessions/:id` 返回 202/accepted，表示接纳关闭运行态，store 历史保留；它不证明底层资源已收尾。真正删除是 store 层动作。不能把“关闭”按钮写成删除所有历史。
- 权限、提问和端侧工具分别有桥。权限需要正确 requestId/digest、时限和真实确认；普通消息或补充文本不等于批准工具。未接权限桥按拒绝处理。

## 部署和停止

本地先绑回环；公网由宿主完成 TLS、登录、入口限流与必要网络控制。SSE 反代关闭缓冲，读超时覆盖心跳。`/healthz`、`/readyz`、`/metrics` 的暴露行为依 host/配置而定，不把免鉴权 metrics 暴露公网。

宿主接 SIGINT/SIGTERM：先 `server.drain`，再按当前包的资源收尾接口等待；不要假定库替宿主注册信号。确实需要环境变量旋钮时查 `resolveServeRuntimeOptions` 和官方表，CLI 与库并非所有默认值一致。例如 CLI 0.9 的每轮墙钟默认值不等于库的默认值。

持久化失败应在界面提示未可靠保存，不能静默展示“已保存”。物理删除、保留期扫描和存储升级先确定范围/备份。原始请求、消息、工具参数或 cause 可能包含秘密，不全量发往日志/浏览器。

Webhook 只提供轮末通知接缝，手机推送由宿主完成。需要时查当前签名协议，验证原始请求体、时间和 nonce，已出现 v2 签名时不降级验 v1；网络超时不能触发重复的业务写入或收费媒体生成。

## 移动端选择

| 平台 | 官方交付形态与基线 | 主要宿主工作 |
| --- | --- | --- |
| Android | `com.tansr.sdk:core` / `client` / `compose`，minSdk 26 | authProvider、生命周期、业务工具、可选 Compose 对话框 |
| iOS | SwiftPM，TansrCore / TansrClient / TansrUI，iOS 16+、macOS 13+ | 自有登录、SwiftUI/其他 UI 接线、前后台收放 |
| 原生鸿蒙 | 独立版本 HAR `@tansr/harmony`，文档基线 0.1.0、HarmonyOS 6 / API 20 | ArkUI、网络权限、AuthProvider、生命周期与桥；不是公共 OHPM 包 |

移动端只连自己的 Serve。系统角色在平台/服务端设，`prompt` 和 `send()` 是普通用户消息。SDK 的状态投影与 L1/L2/L3 恢复尽量复用；iOS/Android 有 UI 绑定，鸿蒙 HAR 不附页面。

回后台 stop 订阅、回前台 start；stop 不等于删会话。退出登录要隔离账户对应的 sessionId，迟到结果不能写入新用户/新会话。401 刷新有限次仍失败时由宿主修登录态，403/429/5xx 不等于令牌失效。

Android 模拟器访问开发机用 `10.0.2.2`；iOS 模拟器通常用 `127.0.0.1`；真机用可达开发机地址和适当防火墙规则。HTTP 仅开发时按平台明确放行，生产用 HTTPS。录音权限、录音/播放、APNs/FCM 等由宿主实现。媒体下载失败不能自动重新付费生成。

获取移动依赖前从官方页面确认实际发布地址与版本，不编造 Maven 仓库或 Swift git URL。不具备平台工具链/设备时可检查源码、协议与服务端，但不得声称已通过安装包或真机验收。

来源：[Serve 起步](https://docs.tansr.com/getting-started/serve/) · [部署与鉴权](https://docs.tansr.com/serve/deploy-and-auth/) · [协议](https://docs.tansr.com/serve/v2-and-webhooks/) · [存储治理](https://docs.tansr.com/serve/retention-and-governance/) · [环境变量](https://docs.tansr.com/serve/env/) · [Android](https://docs.tansr.com/android/) · [iOS](https://docs.tansr.com/ios/) · [鸿蒙](https://docs.tansr.com/harmony/)
