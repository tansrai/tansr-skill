# 按证据排错

先确认形态、实际版本、失败步骤和脱敏错误码。CLI 从 `tansr doctor --json` 开始；SDK 从装配异常或运行事件开始；Serve 用 HTTP 状态、code、detail.scope 与 x-request-id；移动端看连接状态。不要先让所有人登录、升级或充值。

`doctor` 默认是本地装配诊断，不证明远端可用；`--connectors` 才涉及特定网络探测。其他形态不必为排错安装 CLI。

| 现象或证据 | 应对 |
| --- | --- |
| `invalid_options` | 检查三种模型来源混用、旧 API、工具名称和裁决选项；不循环重试 |
| `assembly_failed` | 核对版本、模型别名、必需环境变量是否存在与平台配置；只查看需要的脱敏 cause，不输出原凭据 |
| `capability_disabled` / `model_not_authorized` / 403 | 查应用能力、模型授权和资源归属；403 不是刷新 token 的理由 |
| 工具全部被拒 | 检查规则、能力门和 askUser/移动审批桥；只读声明不能代替许可，不全局放权 |
| 有文本但任务未执行 | 查实际工具事件、调用次数与业务结果；模型说“完成”不是写入证据 |
| 收到 turn.completed 但结果不完整 | 查 reason，轮数/工具轮数/停止钩子触顶也可使用该事件；不能只按事件名判成功 |
| 事件流一直不退出 | 区分跨轮订阅和单轮终态，检查消费者接线及 closeAsync 回执；不能用固定延时假装完成 |
| `turn.error` 且 recoverable=true | 保留告警，按 scope 处理；存储失败应提示未可靠保存，不当成成功落盘，也不一律中断会话 |
| 401 / `unauthorized` / `token_expired` | 按所在鉴权层修复：CLI init、桌面回自家服务换票、移动端修自家登录；有限重试仍失败则停止 |
| `signature_invalid` | 查 app-token 换发的签名协议、时间/nonce/请求字节；不要关签名或误当余额问题 |
| 402 / `insufficient_balance` | 核对正确个人/组织钱包与账单；重试无益，不能自动充值 |
| 429 + `detail.scope: 'plan'` / `plan_concurrency_exceeded` | 套餐额度类；展示稍后重试与开发者核对入口，不套自动重试循环、不强推升档 |
| 普通 `rate_limited` / 瞬态 5xx | 尊重 Retry-After 与有限退避，先确认内核已有重试；变更请求需考虑重复副作用 |
| 日/月配额触顶 | 等窗口或由用户调整资源；不是短时间反复请求能解决 |
| Serve 503 | 分清 `overloaded` 本机准入、`upstream_unavailable` 上游、`draining` 停机；别都算网络抖动 |
| `resume_unavailable` | 未接正确 store；连接工厂存储与 v2.store，不假建空会话替代 |
| `session_store_corrupted` / `store_corrupted` | 保留原卷与错误证据，检查多进程共盘/版本混写；有备份再制定修复，不自动删历史 |
| `session_archived` | 平台侧归档，不能将其当普通 SSE 闪断；说明恢复限制，按需新建 |
| 413 / `payload_too_large` | 查实际接口/客户端上限，减少或拆输入；不无限增缓冲/重试 |
| 模拟器/真机连不上 | 检查宿主地址、监听、端口、防火墙、HTTP 开发许可和自有登录，不能关掉鉴权来试 |

尽量先做无费用的配置、类型和本地重现。需要真实调用时说明最小验证操作，沿已有授权执行；验证失败不增加未经授权的费用或扩大读写范围。

仍不能定位时，整理运行版本、时间、最小复现、脱敏 code/状态/请求标识以及已排除项。联系支持或上传日志需用户要求；本地诊断不自动外发。即便官方导出宣称脱敏，也检查业务隐私后再共享。

来源：[SDK 错误与重试](https://docs.tansr.com/sdk/errors-and-retries/) · [错误码](https://docs.tansr.com/errors/codes/) · [排障](https://docs.tansr.com/support/troubleshooting/) · [Serve 部署](https://docs.tansr.com/serve/deploy-and-auth/)
