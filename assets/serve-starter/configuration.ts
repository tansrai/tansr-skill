import path from 'node:path';

export type StarterConfiguration = ReturnType<typeof readConfiguration>;
const value = (env: NodeJS.ProcessEnv, name: string): string => {
  const candidate = env[name]?.trim() ?? '';
  return /^REPLACE_/i.test(candidate) ? '' : candidate;
};
const port = (env: NodeJS.ProcessEnv, name: string, fallback: number): number => {
  const raw = value(env, name) || String(fallback);
  if (!/^\d+$/.test(raw) || Number(raw) > 65535) throw new Error(`invalid_configuration: ${name}`);
  return Number(raw);
};
export function readConfiguration(env: NodeJS.ProcessEnv = process.env, root = process.cwd()) {
  const appId = value(env, 'TANSR_APP_KEY_ID');
  const appKey = value(env, 'TANSR_APP_KEY');
  const missingConfig = ['TANSR_APP_KEY_ID', 'TANSR_APP_KEY'].filter(name => !value(env, name));
  const apiBaseUrl = value(env, 'TANSR_API_BASE') || 'https://api.tansr.com';
  let url: URL;
  try { url = new URL(apiBaseUrl); } catch { throw new Error('invalid_configuration: TANSR_API_BASE'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || url.pathname !== '/' ||
      (url.protocol === 'http:' && !['127.0.0.1', '[::1]', 'localhost'].includes(url.hostname))) {
    throw new Error('invalid_configuration: TANSR_API_BASE');
  }
  const host = value(env, 'DEMO_HOST') || '127.0.0.1';
  const loginHost = value(env, 'DEMO_LOGIN_HOST') || '127.0.0.1';
  if (![host, loginHost].every(item => ['127.0.0.1', '::1'].includes(item))) {
    throw new Error('invalid_configuration: DEMO_HOST and DEMO_LOGIN_HOST must be loopback IP addresses');
  }
  const secret = value(env, 'DEMO_AUTH_SECRET');
  if (secret.length < 32 || secret === 'demo-secret-change-me') throw new Error('invalid_configuration: DEMO_AUTH_SECRET; run npm run configure');
  if (value(env, 'DEMO_SERVE_ONLY') && value(env, 'DEMO_SERVE_ONLY') !== '1') {
    throw new Error('invalid_configuration: DEMO_SERVE_ONLY must be 1');
  }
  return {
    appId, appKey, apiBaseUrl, secret,
    host, port: port(env, 'DEMO_PORT', 8788),
    loginHost, loginPort: port(env, 'DEMO_LOGIN_PORT', 8787),
    username: value(env, 'DEMO_LOGIN_USER') || 'demo', password: value(env, 'DEMO_LOGIN_PASSWORD'),
    endUserId: value(env, 'DEMO_END_USER') || 'u-alice',
    cwd: root, storeDir: path.resolve(root, value(env, 'DEMO_STORE_DIR') || '.serve-demo-store'),
    status: { status: 'ok' as const, configured: missingConfig.length === 0, mode: 'platform' as const, missingConfig },
  };
}
