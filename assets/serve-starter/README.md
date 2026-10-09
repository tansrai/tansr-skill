# Tansr Serve starter

从正式 Android Serve Demo 提炼的独立后端：Serve 承载平台会话，登录服务签发原 Demo 登录票。依赖、锁文件和公开 API 均沿用发行来源，详见 `SOURCE.json`。需要 Node.js >=22.19。

```sh
npm ci
npm run configure
npm start
# 另一个终端，同一目录：
npm run login
```

`configure` 从 `.env.example` 创建本目录 `.env`，只在本地密钥为空时生成 `DEMO_AUTH_SECRET` 和 `DEMO_LOGIN_PASSWORD`，保留已有配置，不显示秘密。重复变量、未闭合引号或多行歧义会明确拒绝；既有短签名密钥或占位值报告 `configuration_not_ready`，文件字节保持不变，不自动旋转密钥。配置器要求每项是唯一、完整的单行赋值（可加引号、`export` 和注释）；需先由开发者消除歧义。其成功提示只表示本地认证材料就绪，平台状态仍以 `/configuration` 为准。客户端登录所需的用户名和密码由开发者从本地 `.env` 接线；平台应用密钥仅留在后端。两个启动入口都读取包根 `.env`，会清除继承的 `TANSR_*`/`DEMO_*`，避免误用别的项目凭据。修改配置后重启两项服务。启动不会自动更新依赖或触发模型 smoke。

| 配置 | 默认与用途 |
| --- | --- |
| `TANSR_APP_KEY_ID` / `TANSR_APP_KEY` | 默认空。真实平台会话必需；缺失不阻止本地服务和登录启动。 |
| `TANSR_API_BASE` | `https://api.tansr.com`；须 HTTPS 根 URL，仅回环合成测试可用 HTTP。 |
| `DEMO_HOST` / `DEMO_PORT` | `127.0.0.1` / `8788`，Serve 监听。 |
| `DEMO_LOGIN_HOST` / `DEMO_LOGIN_PORT` | `127.0.0.1` / `8787`，登录服务监听。 |
| `DEMO_AUTH_SECRET` | 两服务共享的登录票签名密钥；至少 32 字符，由 configure 生成。 |
| `DEMO_LOGIN_USER` / `DEMO_LOGIN_PASSWORD` | `demo` / 本地生成密码。原示例为一个用户的登录服务。 |
| `DEMO_END_USER` | `u-alice`，登录票对应用户。 |
| `DEMO_SERVE_ONLY` | 固定为 `1`，其他值明确拒绝。 |
| `DEMO_STORE_DIR` | `.serve-demo-store`，相对本项目的正式 Serve 会话存储目录。 |

本 starter 仅允许 `127.0.0.1` / `::1` 监听。需要远程或真机连接时应另行接入 HTTPS 代理、访问控制与正式用户系统。身份 API 同时校验 Host 和 Origin：Host 必须是回环 authority 且端口与当前服务一致；浏览器 Origin 在场时必须属于同一服务。Node/原生客户端不发 Origin 的原合同保留。跨端口网页需同源代理接线，并由代理核验浏览器来源再按受信后端地址转发；不能直接透传外站 Origin。此边界用于阻止 DNS rebinding 与跨站请求，身份仍由原登录票验证。本 starter 保留正式 Demo 的登录票和刷新合同，不代替产品账号管理。

## 前后端接线

- Serve base URL：`http://127.0.0.1:8788`；正式会话 API 为 `/api/sessions`，原 `/v2` 兼容面保留。
- 登录 `POST http://127.0.0.1:8787/login`，JSON `{ "username": "demo", "password": "本地配置的密码" }`，不要发送平台凭据或 Authorization 头。
- 成功返回原字段 `tokenType`、`accessToken`、`expiresAt`、`refreshToken`、`refreshExpiresAt`、`endUserId`。客户端只将 accessToken 作为 Serve 的 `Authorization: Bearer ...`。
- `POST /refresh` JSON `{ "refreshToken": "..." }` 单次轮换刷新票。刷新票只存内存摘要；登录服务重启后重新登录。
- 网页浏览器跨端口请求需要由产品后端/开发服务器提供同源代理，或单独设计受限 CORS；原正式 Demo 未开放通配跨域。

## 健康与配置状态

Serve 保留正式发行协议：`GET /healthz` 是进程存活检查；`GET /readyz` 是就绪检查。缺少平台应用凭据时前者 200、后者 503，`reasons` 说明 `configuration_not_ready` 及缺失字段名。

登录服务 `GET /configuration` 始终返回 200：

```json
{"status":"ok","configured":false,"mode":"platform","missingConfig":["TANSR_APP_KEY_ID","TANSR_APP_KEY"]}
```

`configured` 只表示必需参数齐备，不代表凭据已被平台认可。未登录建会为正式 401；已登录而缺少配置时建会返回正式 503 `upstream_unavailable`。`/api` 使用正式 `unified-v1` 顶层 `code`，原 `/v2` 使用 `error.code`。正式 Serve 会统一该错误的 HTTP message，具体缺项从 `/configuration` 或 `/readyz` 查看。本工程不增造 wire 错误枚举、不生成平台假票，也不返回 echo 回答。

填入应用凭据后，真实会话通过 `@tansr/serve` 的 `createAgentSessionFactory({ platform })` 建立，平台鉴权、计费、权限及模型装配由正式包处理。`npm start` 本身不调用模型；客户端主动发送真实请求可能产生费用。

## 局部验证

```sh
npm run typecheck
npm test
```

单 worker 测试使用 OS 临时目录和真实回环 TCP，覆盖配置保留、健康/就绪、登录/刷新、鉴权、无配置失败、关闭，以及公开平台工厂向合成 upstream 发出原铸票请求。合成 upstream 固定拒绝铸票，因此不会发起模型调用。关闭使用正式 Demo 的 drain + settleResources 并保留失败状态。合成验证不等于真实平台、浏览器或移动设备通过。
