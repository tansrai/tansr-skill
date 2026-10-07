import { AppTokenMintError } from '@tansr/serve';
import type { SafeError } from './types.ts';

export class ProductError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(code: string, message: string, status = 400) {
    super(message); this.code = code; this.status = status;
  }
}
// Presentation only: keep the public HTTP/code distinction which the SDK's
// broader IR error kinds intentionally group together. Never expose raw text.
export function platformFailure(status?: number, code?: string): ProductError {
  if (status === 401 || ['unauthorized', 'app_key_invalid', 'signature_invalid'].includes(code ?? '')) return new ProductError('credentials_rejected', '平台凭据或令牌无效/过期。请核对应用配置后重新开始分析。', 502);
  if (status === 402 || ['insufficient_balance', 'quota_exceeded', 'plan_concurrency_exceeded'].includes(code ?? '')) return new ProductError('account_limit', '账户余额、套餐或配额不足，请在控制台核对后手动重试。', 502);
  if (status === 403 || ['model_not_authorized', 'adjudicator_not_authorized', 'forbidden'].includes(code ?? '')) return new ProductError('permission_denied', '应用无权访问所需模型或能力，请在控制台核对授权。', 502);
  return new ProductError('model_failed', '平台请求或响应流失败，本次分析已停止。请核对网络和平台状态后手动重试。', 502);
}
export function safeError(error: unknown): SafeError {
  if (error instanceof ProductError) return { code: error.code, message: error.message };
  if (error instanceof AppTokenMintError) {
    if (error.status === 401) return { code: 'credentials_rejected', message: '平台拒绝凭据或令牌已过期。请检查服务端应用凭据后手动重试。' };
    if (error.status === 403) return { code: 'permission_denied', message: '应用无权访问所需模型或能力。请在应用控制台核对授权。' };
    if (error.status === 402 || /balance|credit|quota|plan_/i.test(error.code ?? '')) return { code: 'account_limit', message: '账户余额、套餐或配额不足。请核对应用归属账户与额度后重试。' };
    if (error.kind === 'rejected') return { code: 'platform_rejected', message: '平台拒绝应用配置。请核对应用凭据、账户及模型授权。' };
    return { code: 'platform_unavailable', message: '平台网络、限流或服务暂不可用。请检查连接后手动重试。' };
  }
  return { code: 'internal_error', message: '操作未完成。请检查本地存储权限、平台配置或网络；原始错误不会发送到浏览器。' };
}
