# 帮用户使用 Tansr

先识别用户卡在安装、登录、选模型、运行、接入还是计费。给能执行的下一步及成功现象；不要求先读架构说明。只回答产品问题时不创建工程或更改账户。

## CLI 起步和日常使用

确认 Node ≥ 22.19、操作系统与现有 CLI 版本；已安装就复用，不无故升级。新安装按官方 npm 包 `npm install -g @tansr/cli`；不适合安装 Node 时查官方 SEA 包及 SHA256SUMS。CLI 命令叫 `tansr`，包叫 `@tansr/cli`。

1. 用户自己在控制台登录/注册、创建 PAT，然后在本机 `tansr init` 的掩码交互输入。不要让用户把 PAT 发到聊天或放入 `--pat` 历史。CI 用秘密环境变量 `TANSR_PAT`。
2. 平台模式下模型和价目由平台下发；不需要手写 provider。运行 `tansr doctor` 查看装配状态，再用 `tansr` 进入 TUI。
3. 常用 `/status`、`/model`、`/cost`、`/usage`、`/doctor`、`/help`。自动化用 `tansr -p "任务" --json`，持续消费 NDJSON，末尾 result 与退出码决定结果。

`init` 不调用模型，但会验证身份并创建/轮换设备凭据，执行前应已有相应登录授权；用户负责秘密输入。`logout` 清本机凭据并尽力停用设备键，不吊销原 PAT，也不删除会话数据。

headless 没有询问界面，ask 默认拒绝。只为已授权工具给精确规则，不默认加 `auto`、`bypassPermissions` 或信任全部仓库。ACP 是编辑器协议；MCP serve 是另一个入口，涉及它们再查当前命令参考，不能照旧首页“四种形态”漏掉新入口。

退出码基线：0 成功、1 模型/内部错误、2 中止、3 预算或轮数触顶、4 输入过长、5 用法/初始化错误。具体 result.reason 与错误码一起判断。

## 配置来源与本地供应商

settings.json 为 JSONC，优先级由高到低是 managed → projectLocal → projectShared → user → builtin。`permissions` / `hooks` / `mcpServers` 有专门合并与信任规则，不能简单当普通深合并。

先检查 `doctor` 的 config_sources、config_diagnostics、model_resolution 和 localProviders，再决定改哪层。项目层不能自己扩权；用户/组织治理上限不能通过项目配置绕过。不要覆写整个用户配置以修一个项目。

完全本地供应商模式用 `TANSR_ESCAPE_LOCAL=1` 并配置 provider/别名，密钥只通过环境变量名 `auth.env` 引用。这会停止平台模型/配置/用量链，应解释变化而不是偷偷用它规避接入错误。脚本语法适配当前 shell，不向 PowerShell 用户照抄 Bash 的行内赋值。

沙箱/CI 隔离可用 `TANSR_USER_HOME`，或更精确的配置/存储根变量。仅在需要时设置；环境隔离不等于授权执行不可信项目 hooks/MCP/plugins。

## 开发者使用控制台

通过官网入口进入实际控制台，根据真实界面处理，不凭文档猜当前按钮名称。

- PAT 代表个人，供 CLI 初始化；应用页创建的 appid/appkey 代表应用。
- 创建应用先确认个人/组织归属与平台类型；多端按当前平台规则配置独立 appid。终端用户通常不需要 Tansr 账号。
- 应用模型授权、能力开关、系统角色与本地工具配置是不同层。改系统角色不自动开权限。
- appkey 保留服务端；泄露后轮换会使旧键立即失效，应明确部署更新范围；不未经要求轮换现有键。
- 排查账单用时间、订单/请求标识和已脱敏错误；不是索要全量会话内容或凭据。

应用开发者的下一步应具体到“在控制台确认哪个应用 → 在自己的服务器配置哪两个变量 → 运行哪个验证入口”。平台 SDK 的换票接线见 [SDK 参考](sdk.md)，移动应用见 [Serve](serve-mobile.md)。不要把 CLI 的 PAT 初始化当成平台应用接入，也不要把自有供应商示例的 `MODEL_API_KEY` 当成 appkey。

## 解释费用，不预设购买

SDK 应用运行规模与模型/媒体调用分别计费；个人和组织各自持套餐与钱包。独立 CLI/serve/ACP/headless 无需因安装就购买 SDK 套餐，经平台应用提供服务仍适用所属账户应用额度。

免费创建应用不等于免费模型调用，赠送余额不等于可提现返款。模型目录的计量单位、缓存规则、媒体和搜索价格、BYOK 费用分别核对，不把 token 数直接换算成金额。

给选择建议前查当前套餐、模型目录与服务端报价，并了解用户预计的应用数、活跃会话和用户规模。并发按当前服务端口径，不等于注册人数。用户没有估算时建议从小范围验证收集实际用量；不要假称已经有成本或转化实测。购买、充值和合同选择留给用户明确决定。

来源：[CLI 起步](https://docs.tansr.com/getting-started/cli/) · [配置与 doctor](https://docs.tansr.com/cli/settings-and-doctor/) · [命令参考](https://docs.tansr.com/cli/commands/) · [账号](https://docs.tansr.com/support/account/) · [安全](https://docs.tansr.com/security/) · [套餐](https://www.tansr.com/sdk-pricing) · [计费](https://www.tansr.com/pricing)
