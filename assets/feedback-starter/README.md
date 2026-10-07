# 反馈工具循环参考

这是可运行的 Node 核心示例，不含网页/移动界面，也不是平台 token 换发服务。使用正式发行的 `@tansr/sdk@0.18.1` 读取随附六条示例反馈并完成工具循环。完整网页起步工程见相邻的 `product-starter/`。

需要 Node.js ≥ 22.19。先在此目录运行：

```text
npm ci --ignore-scripts
npm test
```

测试用脚本模型驱动实际 SDK，零账号、零模型费用。它验证工具执行、结果进入上下文、错误与收尾语义，不证明真实模型的分类质量或平台接入成功。

测试会故意触发两次 `history_callback_failed`，检查存储失败以及业务失败叠加收尾失败时不能误报完成；末行 `PASS` 表示所有断言通过。也检查调用前/执行中取消、旧轮历史不会冒充新结果，以及延迟提交真正完成前不能返回成功。配置检查仅将随包设置与合成的用户、上级、项目本地及托管设置交给 SDK，不读取真实用户配置或发起网络请求。

先按已有资源选真实接入。已有 Tansr 平台应用时，在服务器用官方换票器取得来源，再传给 `runFeedback`；无需另买供应商密钥。可执行接线见本 skill 的 `references/sdk.md`，协议见 [官方 SDK 接入文档](https://docs.tansr.com/getting-started/sdk/)。以下 `npm start` 入口仅适用于开发者自有供应商（managed）模式：

1. 复制 `.env.example` 为本机 `.env`，由用户安全填写 `MODEL_API_KEY`；不要发到聊天。
2. 在 `.tansr/settings.json` 将 `https://YOUR_MODEL_PROVIDER/v1` 和 `YOUR_TOOL_CAPABLE_MODEL_ID` 替换为已核实的 OpenAI 兼容端点与支持工具调用的模型 ID。模型密钥保持环境变量引用。
3. 确认调用范围及费用后执行 `npm start`。成功标准：工具确实读取输入，结果包含可核对的反馈编号，资源收尾完成；仍需人工核对模型输出内容。

CLI 从 `agent.mjs` 所在工程目录加载 `.tansr` 配置，不依赖调用者的当前目录。保留 SDK 的正常配置优先级：托管配置高于项目本地、项目共享和用户层；有配置冲突时按该顺序检查，不通过删除用户配置或绕开托管规则解决。`.env` 由 `npm start` 在工程目录读取；若从别处直接调用脚本，应自行以安全方式提供环境变量。`managedFeedbackSource()` 返回这条 CLI 所用的 `{ model, cwd }`，便于宿主按相同入口核查配置。

`agent.mjs` 导出的 `runFeedback(source, write)` 可接其他合法 SDK 来源。平台应用须在自家服务器为已登录用户换票；Electron 主进程才接收短期 token，移动端使用自家 Serve。绝不分发供应商密钥或 appkey。

该示例是一次任务、内存会话，最多六轮，两分钟发出取消信号；实际退出还需初始化、工具和存储响应取消并完成收尾，不保证任何自定义依赖都能被即时终止。轮终事件后等待 `session.idle()` 再读取最终历史，随后用 `closeAsync()` 核对持久化与资源收尾。持续聊天、界面投影、用户隔离和恢复需根据应用任务接线。示例 `.env` 已在 `.gitignore` 中。

嵌入服务时通过 `source.signal` 传取消信号；函数将它与内部超时合并。收尾失败会抛出带 `error.session`、`error.cleanup` 的错误，原业务错误保存在 `error.cause`。宿主保留句柄检查/继续 `drain()`，不能直接丢弃或重启来假装保存成功；这些对象仅供服务端使用，不整体记录或返回前端。命令行示例只输出安全摘要，不提供跨进程恢复。
