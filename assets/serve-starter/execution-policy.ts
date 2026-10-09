/** 单用户示例的可信服务端配置。登录与 serve 共读；请求正文不参与授权。 */
import type { ClientToolDecl } from '@tansr/serve';

/** 同一申报供 serve 建会及开发者生成绑定摘要；终端只保留业务函数，无模型循环。 */
export const demoBusinessTool: ClientToolDecl = {
  name: 'DemoOrderStatus', description: 'Read the status of sample order DEMO-001; this is demonstration data.',
  parameters: { orderId: { type: 'string', description: 'Sample order ID: DEMO-001' } }, readOnly: true,
};

/** 明确的业务 handler：不读宿主文件、不执行命令、不调用模型。真实业务由开发者替换。 */
export async function executeDemoBusinessTool(args: Readonly<Record<string, unknown>>, context: { signal: AbortSignal }): Promise<
  { status: 'ok'; content: { t: 'text'; text: string }[] } | { status: 'error'; message: string }
> {
  context.signal.throwIfAborted();
  if (typeof args.orderId !== 'string' || Object.keys(args).some(key => key !== 'orderId')) {
    return { status: 'error', message: 'Invalid sample order ID / 演示订单编号无效' };
  }
  if (args.orderId !== 'DEMO-001') return { status: 'error', message: 'Sample order not found / 演示订单不存在' };
  return { status: 'ok', content: [{ t: 'text', text: 'DEMO-001: awaiting shipment (sample data) / 待发货（演示数据）' }] };
}

export interface DemoSdk2Scope { applicationScopeId: string; endUserId: string; authorizationRevision: string }
export function configuredExecutionPolicy(env: NodeJS.ProcessEnv = process.env): {
  scope: DemoSdk2Scope; executorId: string; tools: readonly string[];
} | undefined {
  if (env.DEMO_EXECUTION !== '1') return undefined;
  const applicationScopeId = env.DEMO_EXECUTION_APPLICATION_SCOPE_ID;
  const authorizationRevision = env.DEMO_EXECUTION_AUTHORIZATION_REVISION ?? '1';
  const executorId = env.DEMO_EXECUTOR_ID;
  const endUserId = env.DEMO_END_USER ?? 'u-alice';
  if (!applicationScopeId || !executorId || !/^[A-Za-z0-9][A-Za-z0-9._~-]{0,127}$/.test(applicationScopeId) ||
    !/^[A-Za-z0-9][A-Za-z0-9._~-]{0,127}$/.test(executorId) || !/^[\x21-\x7e]{1,128}$/.test(endUserId) ||
    !/^(0|[1-9][0-9]*)$/.test(authorizationRevision) || authorizationRevision.length > 19 || BigInt(authorizationRevision) > 9223372036854775807n) throw new Error('invalid_execution_configuration');
  const tools = (env.DEMO_EXECUTION_TOOLS ?? 'Read,List').split(',').map(value => value.trim()).filter(Boolean);
  const allowed = new Set(['Read', 'Write', 'Edit', 'List', 'Glob', 'Grep', 'Shell', 'ImageGen', 'VideoGen', 'SpeechToText', 'TextToSpeech', 'WebFetch', 'WebSearch', 'Http', 'TodoWrite', 'AskUser', demoBusinessTool.name]);
  if (tools.length === 0 || new Set(tools).size !== tools.length || tools.some(tool => !allowed.has(tool))) throw new Error('invalid_execution_tools');
  return { scope: { applicationScopeId, endUserId, authorizationRevision }, executorId, tools };
}
