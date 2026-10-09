/**
 * 开发者自定 token 形制(demo 示例件)。
 *
 * 要点只有一个:**形制自定、平台不管**。serve 引擎唯一的会话鉴权面是
 * `AgentSessionsOptions.authenticate(req)` 注入缝——你用什么 token(自家
 * JWT / session cookie / OAuth access token / 数据库簿记表随机串……)、
 * 怎么签发、怎么校验,引擎一概不规定;缝里返回 `{ endUserId }` 即放行,
 * 返回 null 即 401(fail-closed)。
 *
 * 本 demo 选了一种「带过期的 HMAC 签名 token」做示范,形如:
 *
 *   demo1.<endUserId 的 base64url>.<过期时刻 epoch 秒>.<HMAC-SHA256 hex>
 *
 * 好处是无状态可校验(不用查库);换成「签发时写一行 token→endUserId
 * 簿记表、校验时查表」同样成立——那是你的登录态体系的自由。
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

const PREFIX = 'demo1';

/** 远程监听必须自设强签名密钥；公开演示缺省值仅限loopback。 */
export function demoAuthSecret(host: string, configured = process.env.DEMO_AUTH_SECRET): string {
  if (!['127.0.0.1', 'localhost', '::1'].includes(host) && (!configured || configured.length < 32 || configured === 'demo-secret-change-me')) {
    throw new Error('Remote serve requires DEMO_AUTH_SECRET with at least 32 characters.');
  }
  return configured ?? 'demo-secret-change-me';
}

function sign(secret: string, material: string): string {
  return createHmac('sha256', secret).update(material, 'utf8').digest('hex');
}

/** 签发:开发者登录服务在用户登录成功后调用(demo 里客户端本地直签模拟) */
export function issueToken(secret: string, endUserId: string, ttlSeconds = 3600, now = Date.now()): string {
  const expires = Math.floor(now / 1000) + ttlSeconds;
  const idPart = Buffer.from(endUserId, 'utf8').toString('base64url');
  const material = `${PREFIX}.${idPart}.${expires}`;
  return `${material}.${sign(secret, material)}`;
}

/** 校验:签名不符 / 过期 / 形态不符一律 null(authenticate 缝据此回 401) */
export function verifyToken(secret: string, token: string): string | null {
  const parts = token.split('.');
  if (parts.length !== 4 || parts[0] !== PREFIX) return null;
  const [, idPart, expiresPart, sig] = parts as [string, string, string, string];
  if (!/^\d+$/.test(expiresPart)) return null;
  if (Number.parseInt(expiresPart, 10) * 1000 <= Date.now()) return null;
  const expected = sign(secret, `${PREFIX}.${idPart}.${expiresPart}`);
  const a = Buffer.from(sig, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  const endUserId = Buffer.from(idPart, 'base64url').toString('utf8');
  return endUserId.length > 0 ? endUserId : null;
}

/** 从 Authorization: Bearer <token> 头提取 token(头形也归你定,这里选 Bearer) */
export function bearerOf(authorization: string | string[] | undefined): string | undefined {
  const raw = Array.isArray(authorization) ? authorization[0] : authorization;
  if (raw === undefined) return undefined;
  const match = /^Bearer\s+(\S+)$/i.exec(raw.trim());
  return match?.[1];
}
