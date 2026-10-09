/** OBS-03B：独立开发者登录服务。仅签serve登录票，不接收平台凭据。 */
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { issueToken } from './auth.js';
import { isLocalServiceRequest } from './local-request.js';
import type { DemoSdk2Scope } from './execution-policy.js';

export interface DemoLoginTicket {
  tokenType: 'Bearer'; accessToken: string; expiresAt: number;
  refreshToken: string; refreshExpiresAt: number; endUserId: string;
  sdk2Scope?: DemoSdk2Scope;
}
export interface DemoLoginServiceOptions {
  secret: string; username: string; password: string; endUserId: string;
  accessTtlSeconds?: number; refreshTtlSeconds?: number; maxSessions?: number;
  now?: () => number; forbidden?: boolean;
  /** Local status contains field names only, never credential values. */
  configuration?: () => { status: 'ok'; configured: boolean; mode: 'platform'; missingConfig: string[] };
  /** 仅来自可信登录服务配置；缺省保持原SDK1登录响应。 */
  sdk2Scope?: DemoSdk2Scope;
}

const digest = (value: string): Buffer => createHash('sha256').update(value).digest();
const matches = (left: string, right: string): boolean => timingSafeEqual(digest(left), digest(right));

export function createDemoLoginService(options: DemoLoginServiceOptions) {
  const now = options.now ?? Date.now;
  const accessTtl = options.accessTtlSeconds ?? 300;
  const refreshTtl = options.refreshTtlSeconds ?? 86400;
  const maxSessions = options.maxSessions ?? 100;
  if ([options.secret, options.username, options.password, options.endUserId].some(value => !value.trim()) ||
    !Number.isInteger(accessTtl) || accessTtl < 1 || accessTtl > 3600 || !Number.isInteger(refreshTtl) || refreshTtl < accessTtl || refreshTtl > 604800 ||
    !Number.isInteger(maxSessions) || maxSessions < 1) throw new Error('invalid_login_configuration');
  // 只存refresh摘要；重启即要求重新登录，示例不假装有跨进程持久认证。
  const sessions = new Map<string, { expiresAt: number }>();
  const reply = (res: ServerResponse, status: number, body: unknown): void => {
    res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store', pragma: 'no-cache' });
    res.end(JSON.stringify(body));
  };
  const fail = (res: ServerResponse, status: number, code: string): void => reply(res, status, { error: { code } });
  const issue = (refreshExpiresAt: number): DemoLoginTicket => {
    const refreshToken = `refresh1.${randomBytes(32).toString('base64url')}`;
    sessions.set(digest(refreshToken).toString('hex'), { expiresAt: refreshExpiresAt });
    const expiresAt = (Math.floor(now() / 1000) + accessTtl) * 1000;
    return { tokenType: 'Bearer', accessToken: issueToken(options.secret, options.endUserId, accessTtl, now()),
      expiresAt, refreshToken, refreshExpiresAt, endUserId: options.endUserId,
      ...(options.sdk2Scope ? { sdk2Scope: { ...options.sdk2Scope, endUserId: options.endUserId } } : {}) };
  };
  const handler = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    if (req.method === 'GET' && req.url === '/configuration' && options.configuration) {
      reply(res, 200, options.configuration()); return;
    }
    if (req.method !== 'POST' || (req.url !== '/login' && req.url !== '/refresh')) return fail(res, 404, 'not_found');
    if (!isLocalServiceRequest(req)) return fail(res, 403, 'forbidden');
    // 平台票或serve Bearer误投登录服务时明确拒绝；正常客户端只发本服务JSON合同。
    if (Object.keys(req.headers).some(key => key === 'authorization' || key === 'app-token' || key === 'appkey' || key === 'x-app-key' || key === 'x-api-key' || key.startsWith('x-tansr-'))) return fail(res, 400, 'credential_domain_mismatch');
    if (!req.headers['content-type']?.startsWith('application/json')) return fail(res, 415, 'invalid_content_type');
    const chunks: Buffer[] = []; let size = 0;
    for await (const chunk of req) {
      size += Buffer.byteLength(chunk);
      if (size > 4096) { fail(res, 413, 'payload_too_large'); return; }
      chunks.push(Buffer.from(chunk));
    }
    let body: Record<string, unknown>;
    try {
      const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error();
      body = parsed as Record<string, unknown>;
    } catch { return fail(res, 400, 'invalid_request'); }
    for (const [key, session] of sessions) if (session.expiresAt <= now()) sessions.delete(key);
    if (req.url === '/login') {
      if (Object.keys(body).some(key => key !== 'username' && key !== 'password') ||
        typeof body.username !== 'string' || typeof body.password !== 'string') return fail(res, 400, 'invalid_request');
      if (!matches(body.username, options.username) || !matches(body.password, options.password)) return fail(res, 401, 'unauthorized');
      if (options.forbidden) return fail(res, 403, 'forbidden');
      if (sessions.size >= maxSessions) return fail(res, 503, 'login_capacity');
      reply(res, 200, issue(now() + refreshTtl * 1000));
    } else {
      if (Object.keys(body).some(key => key !== 'refreshToken') || typeof body.refreshToken !== 'string') return fail(res, 400, 'invalid_request');
      const key = digest(body.refreshToken).toString('hex');
      const session = sessions.get(key);
      if (session === undefined) return fail(res, 401, 'login_required');
      if (options.forbidden) return fail(res, 403, 'forbidden');
      sessions.delete(key); // 单次轮换与签发同一同步片段；旧票重放失败。
      reply(res, 200, issue(session.expiresAt));
    }
  };
  const server = createServer((req, res) => { void handler(req, res).catch(() => {
    if (!res.headersSent) fail(res, 500, 'login_failed'); else res.destroy();
  }); });
  server.requestTimeout = 10_000;
  server.headersTimeout = 10_000;
  return { server, close: (): Promise<void> => new Promise((resolve, reject) => {
    sessions.clear(); server.close(error => error ? reject(error) : resolve()); server.closeIdleConnections();
  }) };
}
