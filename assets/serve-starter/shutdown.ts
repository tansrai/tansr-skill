/** 示例宿主的真实收尾与有限观察;不把HTTP已停监听当作全部查询完成。 */
import type { DrainReport, ServerHandle } from '@tansr/serve';

export interface DemoResource {
  /** 同一个对象只关闭一次；借用对象的关闭权留给外部所有者。 */
  readonly resource: { close(): void | Promise<void> };
  readonly ownership: 'owned' | 'borrowed';
}

/** 应用级资源账，不接管 SDK 内部资源；配置时固定归属，结束时逆序释放。 */
export function demoResourceCleanup(resources: readonly DemoResource[] = []): () => Promise<void> {
  const selected = new Map<DemoResource['resource'], DemoResource['ownership']>();
  for (const { resource, ownership } of resources) {
    if (!resource || typeof resource.close !== 'function' || !['owned', 'borrowed'].includes(ownership) ||
      selected.has(resource) && selected.get(resource) !== ownership) throw new Error('invalid_resource_ownership');
    selected.set(resource, ownership);
  }
  let actual: Promise<void> | undefined;
  return () => actual ??= (async () => {
    const errors: unknown[] = [];
    for (const [resource, ownership] of [...selected].reverse()) {
      if (ownership === 'owned') try { await resource.close(); } catch (error) { errors.push(error); }
    }
    if (errors.length) throw new AggregateError(errors, 'resource_cleanup_failed');
  })();
}

export function createDemoShutdown(server: Pick<ServerHandle, 'drain' | 'settleResources'>, options: {
  drainTimeoutMs: number;
  onDrained?: () => void | Promise<void>;
  resources?: readonly DemoResource[];
}) {
  const closeResources = demoResourceCleanup(options.resources);
  let actual: Promise<DrainReport> | undefined;
  const settle = (): Promise<DrainReport> => {
    if (actual !== undefined) return actual;
    actual = (async () => {
      const failures: unknown[] = [];
      let report: DrainReport | undefined;
      try { report = await server.drain({ timeoutMs: options.drainTimeoutMs }); } catch (error) { failures.push(error); }
      try {
        if (server.settleResources === undefined) throw new Error('当前serve版本未提供真实资源收尾接口。');
        await server.settleResources();
      } catch (error) { failures.push(error); }
      try { await options.onDrained?.(); } catch (error) { failures.push(error); }
      try { await closeResources(); } catch (error) { failures.push(error); }
      if (failures.length > 0) throw new AggregateError(failures, '示例宿主关闭未全部成功。');
      return report!;
    })();
    void actual.catch(() => {});
    return actual;
  };
  return {
    settle,
    async observe(timeoutMs = options.drainTimeoutMs + 15_000): Promise<'completed' | 'failed' | 'timeout'> {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        return await Promise.race([
          settle().then(() => 'completed' as const, () => 'failed' as const),
          new Promise<'timeout'>((resolve) => { timer = setTimeout(() => resolve('timeout'), timeoutMs); }),
        ]);
      } finally { clearTimeout(timer); }
    },
  };
}
