import { createSession, defineTool } from '@tansr/sdk';
import type { AgentSession, CreateSessionOptions, SessionDrainResult } from '@tansr/sdk';
import { platformFailure, ProductError } from './errors.ts';
import type { ProductConfig } from './config.ts';
import type { BusinessRecord, EventInput, RunResult } from './types.ts';
import type { Source, SourceFactory } from './source.ts';
import type { TransportDrain } from './platform-transport.ts';

export class TransportCleanupError extends ProductError {
  declare readonly transportDrain?: Source['drain'];
  declare readonly transportCleanup?: TransportDrain;
  constructor(cause: unknown, transportDrain?: Source['drain'], transportCleanup?: TransportDrain) {
    super('cleanup_incomplete', '会话收尾尚未完成；新分析已暂停。请保留服务进程与数据并检查资源状态。', 503);
    Object.defineProperties(this, { cause: { value: cause }, transportDrain: { value: transportDrain }, transportCleanup: { value: transportCleanup } });
  }
  async drain(): Promise<boolean> {
    const transport = await this.transportDrain?.(30_000);
    return !transport || transport.status === 'completed';
  }
}
export class CleanupError extends TransportCleanupError {
  declare readonly session: AgentSession;
  declare readonly cleanup: SessionDrainResult;
  constructor(session: AgentSession, cleanup: SessionDrainResult, cause: unknown, transportDrain?: Source['drain'], transportCleanup?: TransportDrain) {
    super(cause, transportDrain, transportCleanup);
    Object.defineProperties(this, { session: { value: session }, cleanup: { value: cleanup } });
  }
  override async drain(): Promise<boolean> {
    const receipt = await this.session.drain({ timeoutMs: 30_000, flushStore: true });
    const transportCompleted = await super.drain();
    return receipt.status === 'completed' && transportCompleted;
  }
}

export interface AgentInput {
  records: BusinessRecord[]; sourceFor: SourceFactory; product: ProductConfig;
  signal: AbortSignal; emit: (event: EventInput) => void;
  // Host-only dependency seam for verifying SDK persistence failures.
  onHistoryCommit?: CreateSessionOptions['onHistoryCommit'];
}
export async function analyze(input: AgentInput): Promise<RunResult> {
  const failureController = new AbortController();
  const signal = AbortSignal.any([input.signal, AbortSignal.timeout(120_000), failureController.signal]);
  signal.throwIfAborted();
  // Fetch cancellation settles first. The SDK's TWP adapter otherwise rethrows
  // an abort racing its fetch rejection as a query-resource failure. Closing on
  // the next event-loop turn lets that rejection become an IR error before the
  // SDK stops its retry wait; the transport has already blocked further IO.
  const sessionController = new AbortController();
  let deferredAbort: ReturnType<typeof setImmediate> | undefined;
  const abortSession = () => { deferredAbort = setImmediate(() => sessionController.abort()); };
  const releaseAbort = () => { signal.removeEventListener('abort', abortSession); if (deferredAbort) clearImmediate(deferredAbort); };
  signal.addEventListener('abort', abortSession, { once: true });
  let platformError: ProductError | undefined;
  const aborted = () => new ProductError(input.signal.aborted ? 'cancelled' : 'run_aborted', input.signal.aborted ? '任务已取消。' : '任务超时、预算耗尽或被中止；未确认完成。');
  let source: Awaited<ReturnType<SourceFactory>>;
  try {
    source = await input.sourceFor(signal, error => { platformError ??= error; failureController.abort(error); });
    signal.throwIfAborted();
  } catch (error) { releaseAbort(); throw platformError ?? (signal.aborted ? aborted() : error); }
  let toolCalls = 0;
  const readIds = new Set<string>();
  const tool = defineTool({ name: 'readRecords', readOnly: true,
    description: '读取本次用户选择并授权分析的业务记录快照。不接受用户、记录或路径参数；不修改数据。',
    handler: async () => {
      signal.throwIfAborted();
      toolCalls++;
      const records = structuredClone(input.records);
      for (const row of records) readIds.add(row.id);
      input.emit({ type: 'tool', name: 'readRecords', recordIds: records.map(row => row.id), message: `已通过业务工具读取 ${records.length} 条记录。` });
      return { records };
    },
  });
  let session: AgentSession;
  const { drain: drainTransport, ...sessionSource } = source;
  try { session = await createSession({ ...sessionSource, signal: sessionController.signal,
    tools: { builtin: [], custom: [tool] },
    permission: { rules: { allow: ['readRecords'] } },
    system: [{ text: input.product.system }],
    maxTurnsPerQuery: 6, maxTokens: 4000, budget: { maxTotalTokens: 24000 },
    onHistoryCommit: input.onHistoryCommit,
    onWarning: () => input.emit({ type: 'progress', message: 'SDK 或平台提示存在配置/额度告警，请核对控制台状态。' }),
    onPlatformWarning: () => {},
  }); } catch (error) {
    releaseAbort();
    const cause = platformError ?? (signal.aborted ? aborted() : error);
    const transport = await drainTransport?.(30_000);
    if (transport && transport.status !== 'completed') throw new TransportCleanupError(cause, drainTransport, transport);
    throw cause;
  }
  const events = session.events[Symbol.asyncIterator]();
  let failure: unknown;
  let output = '';
  let cleanup: SessionDrainResult;
  let transportCleanup: TransportDrain | undefined;
  try {
    signal.throwIfAborted();
    input.emit({ type: 'progress', message: '会话已建立，正在读取业务记录。' });
    session.send(input.product.task);
    let completed = false;
    let streamed = 0;
    while (true) {
      const next = await events.next();
      if (next.done) break;
      const event = next.value;
      if (event.type === 'msg.text.delta') {
        streamed += event.text.length;
        if (streamed > 128_000) throw new ProductError('output_limit', '输出超过本机安全上限，任务已停止。');
        input.emit({ type: 'progress', text: event.text });
      } else if (event.type === 'msg.retracted') {
        input.emit({ type: 'progress', text: '', replace: true, message: '模型已撤回部分草稿，最终内容以完成结果为准。' });
      } else if (event.type === 'turn.error' && !event.recoverable) {
        const code = /^([a-z_]+):/.exec(event.message)?.[1];
        if (['unauthorized', 'model_not_authorized', 'insufficient_balance', 'quota_exceeded', 'plan_concurrency_exceeded'].includes(code ?? '')) throw platformFailure(undefined, code);
        const kind = event.errorKind;
        if (kind === 'auth') throw new ProductError('credentials_rejected', '平台凭据或令牌无效/过期。请核对应用配置后重新开始分析。', 502);
        if (kind === 'policy_denied') throw new ProductError('permission_denied', '应用或模型拒绝本次请求，请核对授权和输入。', 502);
        if (event.detail?.scope === 'plan' || kind === 'billing') throw new ProductError('account_limit', '账户余额或套餐额度不足，请在控制台核对后重试。', 502);
        throw new ProductError('model_failed', '模型调用失败，请核对模型授权、账户余额和网络后手动重试。', 502);
      } else if (event.type === 'turn.aborted') {
        throw platformError ?? aborted();
      } else if (event.type === 'turn.completed') {
        if (!['completed', 'structured_output'].includes(event.reason)) throw new ProductError('incomplete_turn', '任务触及执行限制，未完成分析。');
        completed = true; break;
      }
    }
    // Terminal events precede the SDK's finally/history update. idle() settles that
    // turn; closeAsync below separately confirms asynchronous persistence/resources.
    await session.idle();
    signal.throwIfAborted();
    const answer = session.messages().filter(message => message.role === 'assistant').at(-1);
    output = answer?.blocks.filter(block => block.t === 'text').map(block => block.text).join('\n') ?? '';
    if (!completed || !toolCalls || readIds.size !== input.records.length || !output.trim()) throw new ProductError('missing_evidence', '未获得真实工具读取与最终文本，不能确认分析成功。请使用支持工具调用的模型。');
  } catch (error) { failure = platformError ?? (signal.aborted ? aborted() : error); }
  finally {
    try { cleanup = await session.closeAsync({ timeoutMs: 30_000, flushStore: true }); transportCleanup = await drainTransport?.(30_000); }
    finally { releaseAbort(); await events.return?.(); }
  }
  if (cleanup.status !== 'completed' || (transportCleanup && transportCleanup.status !== 'completed')) throw new CleanupError(session, cleanup, failure, drainTransport, transportCleanup);
  if (failure) throw failure;
  return { text: output, readIds: [...readIds], toolCalls };
}
