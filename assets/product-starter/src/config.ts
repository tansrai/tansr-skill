import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { ProductError } from './errors.ts';
import { product } from './product.ts';
import { requireObject } from './store.ts';
import type { Mode } from './types.ts';

export interface ProductConfig { name: string; domain: string; description: string; system: string; task: string }
export interface RuntimeConfig {
  mode: Mode; port: number; dataDir: string; publicDir: string; product: ProductConfig;
  appId?: string; appKey?: string; apiBaseUrl: string;
}
export const owner = 'local-owner';
export async function loadConfig(root: string, env: NodeJS.ProcessEnv): Promise<RuntimeConfig> {
  const mode = env.TANSR_MODE ?? 'offline';
  if (mode !== 'offline' && mode !== 'platform') throw new ProductError('invalid_config', 'TANSR_MODE 只能是 offline 或 platform。');
  const port = Number(env.PORT ?? '4317');
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new ProductError('invalid_config', 'PORT 必须是 1–65535。');
  const raw = requireObject(JSON.parse(await readFile(resolve(root, 'product.config.json'), 'utf8')));
  const configured = { ...product };
  for (const key of ['name', 'domain', 'description', 'system', 'task'] as const) {
    if (typeof raw[key] !== 'string' || !raw[key].trim() || raw[key].length > (['system', 'task'].includes(key) ? 8000 : 500)) throw new ProductError('invalid_config', `product.config.json 的 ${key} 配置无效。`);
    configured[key] = raw[key];
  }
  const apiBaseUrl = env.TANSR_API_BASE_URL || 'https://api.tansr.com';
  const api = new URL(apiBaseUrl);
  if (api.protocol !== 'https:' || api.username || api.password || api.search || api.hash || api.pathname !== '/') throw new ProductError('invalid_config', '平台地址须为不含路径、凭据和查询参数的 HTTPS 源地址。');
  return { mode, port, dataDir: resolve(root, env.DATA_DIR || '.data'), publicDir: resolve(root, 'public'), product: configured, appId: env.TANSR_APP_ID, appKey: env.TANSR_APP_KEY, apiBaseUrl: api.origin };
}
export function configuration(config: RuntimeConfig): { ready: boolean; message: string } {
  if (config.mode === 'offline') return { ready: true, message: '离线验证：真实 SDK + 规则脚本模型，不调用平台或真实模型。' };
  if (!config.appId?.trim() || !config.appKey?.trim()) return { ready: false, message: '平台模式未配置服务端 TANSR_APP_ID / TANSR_APP_KEY。请在本工程 .env 中配置并重启。' };
  return { ready: true, message: '平台模式：配置已提供；实际账户、模型授权与余额会在调用时由平台校验。' };
}
