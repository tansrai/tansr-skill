/**
 * tansr SDK 官方示例 · token-server(开发者服务端样板)
 *
 * 你的终端应用(Electron / 桌面 / 移动)里嵌着 @tansr/sdk,但它手里恒不能有
 * appkey——appkey 是「App 主密钥」,谁拿到谁就能以你的名义烧你的钱包。本服务
 * 演示三方闭环里「开发者服务端」这一角的最小完整形态:
 *
 *   终端应用 ──自家登录态──▶ 本服务 ──appkey 双头──▶ tansr 平台
 *   终端应用 ◀─{ token, expiresAt }─ 本服务 ◀─短期 app_user 令牌─ tansr 平台
 *
 * ┌─────────────────────── 防盗要点(为什么必须有这台服务器)───────────────────────┐
 * │ 1. appkey 恒不出服务端:不下发、不打日志、不进错误响应。终端只拿短期令牌,   │
 * │    令牌泄露的止损面 = TTL 窗口 + 平台四级吊销,appkey 泄露则是整个 App 失守。 │
 * │ 2. 不开放换发:/api/token 恒在你自家登录态校验之后。绝不做「客户端传什么     │
 * │    userId 就给谁发令牌」的开放代发——那等于把 appkey 的用量额度公开领取。    │
 * │ 3. endUserId 恒取自服务端会话,恒不信任请求体:否则用户 A 能领到署名 B 的     │
 * │    令牌,平台侧配额、用量归因、吊销全部错位。                                  │
 * │ 4. TTL 语义:令牌到期后终端必须重新走本服务换发(= 重新过一遍你的登录态);   │
 * │    「续期」不存在——想收回某人的访问,停掉他的登录态即可自然断供。            │
 * │ 5. 吊销通路:单令牌(jti)/ 单终端用户 / 整 App 三级实时吊销 + appkey 轮换    │
 * │    兜底全断,都在平台控制台/管理 API;本服务只需保证「换发前必过自家鉴权」。  │
 * └─────────────────────────────────────────────────────────────────────────────┘
 *
 * 依赖刻意只有 express 一件;HTTP 出站用 Node 内置 fetch。跑法见 README.md。
 */
import { createHash, createHmac, randomBytes, randomUUID } from 'node:crypto';
import express from 'express';

// Published token/auth/signature contract retained. Missing credentials are
// configuration-not-ready, never a request for a substitute token.
// Loopback binding alone does not stop DNS rebinding from a browser.
function trustedLocalRequest(req) {
  const parse = text => {
    if (typeof text !== 'string') return null;
    try {
      const url = new URL(text);
      if (url.protocol !== 'http:' || !['127.0.0.1', '[::1]', 'localhost'].includes(url.hostname)
        || url.username || url.password || url.search || url.hash || url.pathname !== '/'
        || Number(url.port || 80) !== req.socket.localPort) return null;
      return url;
    } catch { return null; }
  };
  if (!parse('http://' + (req.headers.host ?? ''))) return false;
  return req.headers.origin === undefined || parse(req.headers.origin) !== null;
}

export function readConfig(env = process.env) {
  const host = env.HOST?.trim() || '127.0.0.1';
  if (!['127.0.0.1', '::1'].includes(host)) throw new Error('This local starter must bind a loopback HOST.');
  const port = Number(env.PORT ?? 8788);
  const ttlSeconds = Number(env.TOKEN_TTL_SECONDS ?? 3600);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('PORT must be 0–65535.');
  if (!Number.isInteger(ttlSeconds) || ttlSeconds < 60 || ttlSeconds > 86400) throw new Error('TOKEN_TTL_SECONDS must be 60–86400.');
  const api = new URL(env.TANSR_API_BASE?.trim() || 'https://api.tansr.com');
  const local = ['127.0.0.1', '[::1]'].includes(api.hostname);
  if ((api.protocol !== 'https:' && !(api.protocol === 'http:' && local))
    || api.username || api.password || api.search || api.hash || api.pathname !== '/') {
    throw new Error('TANSR_API_BASE must be an HTTPS origin, or loopback HTTP for local verification.');
  }
  const usable = value => typeof value === 'string' && !!value.trim() && !/^REPLACE_/i.test(value.trim());
  const missingConfig = ['TANSR_APP_KEY_ID', 'TANSR_APP_KEY'].filter(name => !usable(env[name]));
  return { host, port, ttlSeconds, apiBase: api.origin,
    appId: env.TANSR_APP_KEY_ID, appKey: env.TANSR_APP_KEY,
    readiness: { status: 'ok', mode: 'platform', configured: missingConfig.length === 0, missingConfig } };
}

export function createTokenServer({ env = process.env, fetchImpl = fetch, logger = console } = {}) {
const config = readConfig(env);
const { appId: TANSR_APP_KEY_ID, appKey: TANSR_APP_KEY, apiBase: TANSR_API_BASE, ttlSeconds: TOKEN_TTL_SECONDS } = config;

// ———————————————————— ①自家用户体系(演示用最小实现) ————————————————————
// 【换成你的真实用户体系】下面这段(账号表 + 登录 + 会话)只是演示桩:
// 生产里应替换为你既有的 cookie session / JWT / OAuth 等任意形态。对令牌换发
// 唯一重要的是:/api/token 能从「已验证的登录态」里拿到当前用户的稳定标识。
//
// endUserId 的选取:用你用户体系里稳定、不含空格的 ASCII 标识(用户表主键、
// username 均可,1–128 字符)。平台按它做用量归因、per-user 配额与定向吊销;
// 平台不背书它与自然人的映射——语义归你的用户体系。

const DEMO_USERS = new Map([
  // username → { password, endUserId }(演示明文;生产恒为哈希)
  ['alice', { password: 'alice123', endUserId: 'demo-alice' }],
  ['bob', { password: 'bob123', endUserId: 'demo-bob' }],
]);

/** 演示会话store:sessionId → { username, endUserId }(内存态,重启即清) */
const sessions = new Map();

/** 自家登录态校验中间件:头 x-demo-session 承载会话 id */
function requireLogin(req, res, next) {
  const session = sessions.get(req.header('x-demo-session') ?? '');
  if (session === undefined) {
    res.status(401).json({ error: 'not_logged_in', message: '请先 POST /api/login 登录(演示账号见 README)' });
    return;
  }
  req.demoUser = session;
  next();
}

const app = express();
app.use((req, res, next) => {
  if (!trustedLocalRequest(req)) {
    res.status(403).json({ error: 'untrusted_request_origin', message: '本地服务仅接受自身回环地址请求。' });
    return;
  }
  next();
});
app.use(express.json());
app.get('/healthz', (_req, res) => res.json(config.readiness));
app.get('/readyz', (_req, res) => res.status(config.readiness.configured ? 200 : 503).json(config.readiness));

function requireConfiguration(_req, res, next) {
  if (!config.readiness.configured) {
    res.status(503).json({ error: 'configuration_not_ready', message: '请在此后端 .env 配置平台应用凭据并重启。', missingConfig: config.readiness.missingConfig });
    return;
  }
  next();
}

/** 演示登录:换成你的真实登录接口 */
app.post('/api/login', (req, res) => {
  const { username, password } = req.body ?? {};
  const user = typeof username === 'string' ? DEMO_USERS.get(username) : undefined;
  if (user === undefined || user.password !== password) {
    res.status(401).json({ error: 'bad_credentials', message: '用户名或密码错误' });
    return;
  }
  const sessionId = randomUUID();
  sessions.set(sessionId, { username, endUserId: user.endUserId });
  // 令牌换发之外的一切(会话时效、登出、多端)都归你的用户体系,示例不展开
  res.json({ sessionId, endUserId: user.endUserId });
});

// ———————————————————— ②令牌换发(本示例的核心端点) ————————————————————

/**
 * TWP1-HMAC-SHA256 请求签名(T-A34):平台新签发的 App 键缺省强制签名
 * (signRequired=true),未签名换发恒 401 signature_invalid。签名三头恒随行——
 * 头在场平台恒校验,对老的兼容档键同样有效,无需任何开关。
 * 覆盖面 = 算法名 + 方法 + 路径 + unix 秒 + 随机 nonce + 原始体 sha256;
 * 签名密钥 = sha256(appkey)。时钟要求:与平台偏差 ≤±300s(NTP 正常即满足)。
 */
function twpSignatureHeaders(method, pathWithQuery, rawBody) {
  const ts = String(Math.floor(Date.now() / 1000));
  const nonce = randomBytes(16).toString('hex');
  const bodySha256 = createHash('sha256').update(rawBody ?? '').digest('hex');
  const signing = ['TWP1-HMAC-SHA256', method.toUpperCase(), pathWithQuery, ts, nonce, bodySha256].join('\n');
  const signingKey = createHash('sha256').update(TANSR_APP_KEY, 'utf8').digest();
  return {
    'x-tansr-ts': ts,
    'x-tansr-nonce': nonce,
    'x-tansr-sign': createHmac('sha256', signingKey).update(signing, 'utf8').digest('hex'),
  };
}

/**
 * 持 appkey 向平台换取指定终端用户的短期 app_user 令牌。
 * appkey 双头(x-tansr-key-id / x-tansr-key)只在这一个函数里出现;
 * 签名三头(见 twpSignatureHeaders)对原始体字节签名,body 必须与签名用的
 * 同一份字符串原样发出(恒不二次序列化)。
 */
async function mintAppToken(endUserId, ttlSeconds) {
  const rawBody = JSON.stringify({ endUserId, ttlSeconds });
  const upstream = await fetchImpl(`${TANSR_API_BASE}/v1/app-tokens`, {
    method: 'POST',
    redirect: 'error',
    signal: AbortSignal.timeout(10_000),
    headers: {
      'content-type': 'application/json',
      'x-tansr-key-id': TANSR_APP_KEY_ID,
      'x-tansr-key': TANSR_APP_KEY,
      ...twpSignatureHeaders('POST', '/v1/app-tokens', rawBody),
    },
    body: rawBody,
  });
  const body = await upstream.json().catch(() => null);
  if (!upstream.ok) {
    // 日志与外抛都只带错误码,恒不带凭据与令牌本体
    const candidate = body?.error?.code ?? body?.code;
    const code = typeof candidate === 'string' && /^[a-z0-9_.-]{1,80}$/i.test(candidate) ? candidate : 'unknown';
    throw Object.assign(new Error(`平台换发令牌失败(HTTP ${upstream.status}, code=${code})`), {
      upstreamStatus: upstream.status,
      upstreamCode: code,
    });
  }
  if (typeof body?.token !== 'string' || !body.token || /[\u0000-\u0020\u007f]/.test(body.token)
    || typeof body.expiresAt !== 'string' || !Number.isFinite(Date.parse(body.expiresAt))
    || Date.parse(body.expiresAt) <= Date.now()) throw new Error('平台令牌响应无效。');
  // 平台响应含 { token, expiresAt, appId, endUserId };下发终端前在调用方裁剪
  return body;
}

/**
 * 终端换令牌入口:先过自家登录态(requireLogin),再以服务端会话里的
 * endUserId 换发——请求体一概不读(防盗要点 2/3)。
 * 只把 { token, expiresAt } 下发终端:appId 等平台侧元数据终端用不上,
 * 最小暴露面。
 */
app.post('/api/token', requireLogin, requireConfiguration, async (req, res) => {
  try {
    const { token, expiresAt } = await mintAppToken(req.demoUser.endUserId, TOKEN_TTL_SECONDS);
    // 审计日志:记录「给谁、何时到期」,恒不记录令牌本体(防盗要点 1/5)
    logger.log(`[token-server] 已为 endUserId=${req.demoUser.endUserId} 换发令牌,expiresAt=${expiresAt}`);
    res.json({ token, expiresAt });
  } catch (err) {
    logger.error('[token-server] 平台换票未完成。');
    res.status(502).json({ error: 'token_exchange_failed', message: '平台换票未完成，请检查后端配置或上游状态。' });
  }
});

// ———————————————— ③用量自查代理(可选端点,两种形态讲清) ————————————————

/**
 * 形态 A(本端点):服务端代查。终端问本服务,本服务临时签一枚最短时效
 * (60s)令牌去平台查 GET /v1/my-usage——终端无需在本地持久化令牌也能看用量。
 *
 * 形态 B(零代码):终端直查。终端本就持有会话令牌,可直接
 *   GET {TANSR_API_BASE}/v1/my-usage?window=7d,头 x-tansr-app-token: <token>
 * 平台恒只返回令牌所属 endUserId 自己的计数(横向越权不可能),且响应
 * schema 级不含任何金额字段——终端用户可自查用量,但价格谈判面恒在你手里。
 *
 * 恒不要做的形态:把 /v1/app-usage/by-end-user(appkey 鉴权的开发者对账面,
 * 含金额)代理给终端——金额与成本结构是你的商业信息,不下发。
 */
app.get('/api/my-usage', requireLogin, requireConfiguration, async (req, res) => {
  const window = /^([1-9]\d?)d$/.test(req.query.window ?? '') ? req.query.window : '7d';
  try {
    const { token } = await mintAppToken(req.demoUser.endUserId, 60);
    const upstream = await fetchImpl(`${TANSR_API_BASE}/v1/my-usage?window=${window}`, {
      headers: { 'x-tansr-app-token': token },
      redirect: 'error', signal: AbortSignal.timeout(10_000),
    });
    res.status(upstream.status).json(await upstream.json());
  } catch (err) {
    logger.error('[token-server] 用量代查未完成。');
    res.status(502).json({ error: 'usage_proxy_failed', message: '用量代查未完成，请检查后端配置或上游状态。' });
  }
});

// ———————————————————————— 收尾:错误兜底与启动 ————————————————————————

// 兜底错误面:任何未捕获异常恒不把内部细节(更不可能把凭据)带进响应
app.use((err, _req, res, _next) => {
  logger.error('[token-server] 请求处理失败。');
  res.status(500).json({ error: 'internal_error', message: '服务内部错误' });
});

return { app, config };
}

export async function startTokenServer(options = {}) {
  const { app, config } = createTokenServer(options);
  const server = await new Promise((resolve, reject) => {
    const listening = app.listen(config.port, config.host, () => resolve(listening));
    listening.once('error', reject);
  });
  const address = server.address();
  const url = 'http://' + (config.host === '::1' ? '[::1]' : config.host) + ':' + address.port;
  return { server, url, readiness: config.readiness,
    close: () => new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())) };
}
