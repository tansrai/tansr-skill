import { randomUUID } from 'node:crypto';
import { analyze, TransportCleanupError } from './agent.ts';
import { configuration } from './config.ts';
import type { RuntimeConfig } from './config.ts';
import { ProductError, safeError } from './errors.ts';
import { LocalStore, requireObject } from './store.ts';
import type { SourceFactory } from './source.ts';
import { terminal } from './types.ts';
import type { Run, RunEvent, EventInput } from './types.ts';

interface ActiveRun { run: Run; controller: AbortController; task?: Promise<void>; cleanup?: TransportCleanupError; finalizing?: boolean }
export class RunManager {
  readonly store: LocalStore;
  readonly config: RuntimeConfig;
  readonly sourceFor: SourceFactory;
  #active?: ActiveRun;
  #accepting = true;
  #admitting = false;
  #events = new Map<string, RunEvent[]>();
  #listeners = new Map<string, Set<(event: RunEvent) => void>>();
  #failedRun?: Run;
  constructor(store: LocalStore, config: RuntimeConfig, sourceFor: SourceFactory) {
    this.store = store; this.config = config; this.sourceFor = sourceFor;
  }
  get activeRunId(): string | null { return this.#active?.run.id ?? null; }
  snapshot(): Run[] {
    const runs = this.store.snapshot().runs;
    if (this.#active?.run.status === 'cancelling') {
      const index = runs.findIndex(run => run.id === this.#active?.run.id);
      if (index >= 0) runs[index] = structuredClone(this.#active.run);
    }
    if (this.#failedRun) {
      const index = runs.findIndex(run => run.id === this.#failedRun?.id);
      if (index < 0) runs.push(structuredClone(this.#failedRun));
      else runs[index] = structuredClone(this.#failedRun);
    }
    return runs;
  }
  getRun(id: string): Run {
    const run = this.snapshot().find(run => run.id === id);
    if (!run) throw new ProductError('not_found', '分析不存在或已随原始记录删除。', 404);
    return run;
  }
  assertCanDelete(id: string): void {
    if (this.#admitting || this.#active?.run.recordIds.includes(id)) throw new ProductError('record_busy', '此记录正在分析，请等待结束或取消后再删除。', 409);
  }
  async deleteRecord(id: string): Promise<void> {
    this.assertCanDelete(id);
    this.#admitting = true;
    try { await this.store.delete(id); this.forgetDeletedHistory(); }
    finally { this.#admitting = false; }
  }
  forgetDeletedHistory(): void {
    const ids = new Set(this.store.snapshot().runs.map(run => run.id));
    for (const id of this.#events.keys()) if (!ids.has(id)) this.#events.delete(id);
  }
  async start(input: unknown): Promise<Run> {
    const body = requireObject(input);
    if (Object.keys(body).some(key => key !== 'recordIds')) throw new ProductError('invalid_input', '分析只接受 recordIds；身份由本机服务固定。');
    if (!this.#accepting) throw new ProductError('shutting_down', '服务正在停止或存储需恢复，暂不接受新分析。', 503);
    if (this.#admitting || this.#active) throw new ProductError('busy', '已有分析正在执行或收尾，请等待完成。', 409);
    const configured = configuration(this.config);
    if (!configured.ready) throw new ProductError('missing_credentials', configured.message, 503);
    const records = this.store.snapshot().records;
    const ids = body.recordIds ?? records.map(row => row.id);
    if (!Array.isArray(ids) || !ids.length || ids.length > 50 || ids.some(id => typeof id !== 'string') || new Set(ids).size !== ids.length) throw new ProductError('invalid_input', '请选择 1–50 条不重复的记录。');
    const selected = ids.map(id => records.find(row => row.id === id));
    if (selected.some(row => !row)) throw new ProductError('record_not_found', '选中的记录不存在，请刷新后重试。', 404);
    const run: Run = { id: randomUUID(), status: 'running', mode: this.config.mode, recordIds: ids as string[], inputRecords: selected as Run['inputRecords'], createdAt: new Date().toISOString() };
    this.#admitting = true;
    try {
      await this.store.saveRun(run);
      const active: ActiveRun = { run, controller: new AbortController() };
      this.#active = active;
      this.#events.set(run.id, []);
      // Full durable results live in the store; retain streaming replay for only
      // the ten most recent runs to keep memory bounded across long sessions.
      while (this.#events.size > 10) this.#events.delete(this.#events.keys().next().value!);
      this.#emit(run.id, { type: 'progress', message: this.config.mode === 'offline' ? '离线验证已开始；不会调用真实模型。' : '平台分析已开始；正在获取短期会话令牌。' });
      active.task = this.#execute(active);
      return structuredClone(run);
    } finally { this.#admitting = false; }
  }
  #emit(id: string, event: EventInput): void {
    const list = this.#events.get(id) ?? [];
    const entry: RunEvent = { ...event, id: (list.at(-1)?.id ?? 0) + 1, runId: id, time: new Date().toISOString() };
    list.push(entry);
    if (list.length > 2000) list.splice(0, list.length - 2000);
    this.#events.set(id, list);
    for (const listener of this.#listeners.get(id) ?? []) listener(entry);
  }
  async #execute(active: ActiveRun): Promise<void> {
    const run = active.run;
    try {
      const result = await analyze({ records: run.inputRecords, sourceFor: this.sourceFor, product: this.config.product, signal: active.controller.signal, emit: event => this.#emit(run.id, event) });
      active.controller.signal.throwIfAborted();
      run.status = 'completed'; run.result = result;
    } catch (error) {
      if (error instanceof TransportCleanupError) {
        active.cleanup = error; this.#accepting = false;
        run.status = 'failed'; run.error = safeError(error);
      } else if (active.controller.signal.aborted && (!(error instanceof ProductError) || error.code === 'cancelled')) {
        run.status = 'cancelled'; run.error = { code: 'cancelled', message: '任务已取消，未保存为成功分析。' };
      } else {
        run.status = 'failed'; run.error = safeError(error);
      }
    }
    active.finalizing = true;
    run.finishedAt = new Date().toISOString();
    try { await this.store.saveRun(run); }
    catch (error) {
      run.status = 'failed'; delete run.result; run.error = safeError(error);
      this.#failedRun = structuredClone(run); this.#accepting = false;
    }
    if (run.result && run.status === 'completed') this.#emit(run.id, { type: 'result', result: run.result });
    if (run.error) this.#emit(run.id, { type: 'error', error: run.error });
    this.#emit(run.id, { type: 'done', status: run.status });
    if (!active.cleanup) this.#active = undefined;
  }
  async cancel(id: string): Promise<Run> {
    const run = this.getRun(id);
    if (terminal(run.status)) return run;
    const active = this.#active;
    if (!active || active.run.id !== id) throw new ProductError('not_active', '此分析已不在运行。', 409);
    if (active.finalizing) throw new ProductError('run_finalizing', '会话已结束，正在保存结果，请稍后刷新。', 409);
    active.controller.abort();
    active.run.status = 'cancelling';
    this.#emit(id, { type: 'progress', message: '正在停止并等待工具与会话资源收尾。', status: 'cancelling' });
    // Cancellation is immediately visible without racing a durable terminal write.
    return structuredClone(active.run);
  }
  subscribe(id: string, after: number, listener: (event: RunEvent) => void): () => void {
    const run = this.getRun(id);
    const listeners = this.#listeners.get(id) ?? new Set();
    listeners.add(listener); this.#listeners.set(id, listeners);
    const history = this.#events.get(id);
    if (history?.length) {
      if (after && after < history[0].id - 1) listener({ id: history[0].id - 1, type: 'progress', runId: id, time: new Date().toISOString(), replace: true, text: '', message: '早期流片段已释放，请以最终结果和历史输入为准。' });
      for (const event of history) if (event.id > after) listener(event);
      if (terminal(run.status) && after >= history.at(-1)!.id) listener({ id: after + 1, type: 'done', runId: id, time: new Date().toISOString(), status: run.status });
    } else if (terminal(run.status)) {
      const time = new Date().toISOString();
      if (run.result) listener({ id: 1, type: 'result', runId: id, time, result: run.result });
      if (run.error) listener({ id: 2, type: 'error', runId: id, time, error: run.error });
      listener({ id: 3, type: 'done', runId: id, time, status: run.status });
    }
    return () => { listeners.delete(listener); if (!listeners.size) this.#listeners.delete(id); };
  }
  async close(): Promise<void> {
    this.#accepting = false;
    const active = this.#active;
    if (active) {
      active.controller.abort();
      await active.task;
      if (active.cleanup) {
        if (!await active.cleanup.drain()) throw active.cleanup;
        this.#active = undefined;
      }
    }
  }
}
