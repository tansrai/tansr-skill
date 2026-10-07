import { setTimeout as delay } from 'node:timers/promises';
import { createAppTokenMinter } from '@tansr/serve';
import type { CreateSessionOptions, ModelClient } from '@tansr/sdk';
import type { RuntimeConfig } from './config.ts';
import { configuration, owner } from './config.ts';
import { ProductError } from './errors.ts';
import { offlineSummary } from './product.ts';
import type { BusinessRecord } from './types.ts';
import { stopOnPlatformFailure } from './platform-transport.ts';
import type { TransportDrain } from './platform-transport.ts';

export type Source = Pick<CreateSessionOptions, 'client' | 'model' | 'token' | 'baseUrl' | 'fetchImpl'> & { drain?: (timeoutMs: number) => Promise<TransportDrain> };
export type SourceFactory = (signal: AbortSignal, onFailure?: (error: ProductError) => void) => Promise<Source>;

// This deterministic model consumes the actual SDK tool result. It cannot access
// the application database or the original selected records by another path.
export function scriptedClient(stepDelayMs = 180): ModelClient {
  let calls = 0;
  const pause = async (milliseconds: number, signal?: AbortSignal): Promise<boolean> => {
    try { await delay(milliseconds, undefined, { signal }); return !signal?.aborted; }
    catch (error) { if (signal?.aborted) return false; throw error; }
  };
  return {
    async *stream(request, options) {
      if (!await pause(stepDelayMs, options?.signal)) return;
      yield { t: 'message_start', model: 'offline-script' };
      if (++calls === 1) {
        yield { t: 'block_start', index: 0, block: { t: 'tool_call', id: 'read-records', name: 'readRecords', args: {} } };
        yield { t: 'block_stop', index: 0 };
        yield { t: 'message_stop', stopReason: 'tool_use' };
        return;
      }
      const result = request.messages.flatMap(message => message.blocks).findLast(block => block.t === 'tool_result' && block.callId === 'read-records');
      if (!result || result.t !== 'tool_result' || result.isError) throw new ProductError('tool_failed', '业务工具未返回有效记录。');
      const content = typeof result.content === 'string' ? result.content : JSON.stringify(result.content);
      // defineTool's text result may be represented as IR text content.
      let payload: unknown = JSON.parse(content);
      if (Array.isArray(payload)) {
        const text = payload.find(item => item && typeof item === 'object' && typeof item.text === 'string')?.text;
        if (typeof text === 'string') payload = JSON.parse(text);
      }
      const records = (payload as { records?: BusinessRecord[] }).records;
      if (!Array.isArray(records) || !records.length) throw new ProductError('tool_failed', '离线脚本未收到实际工具数据。');
      const text = offlineSummary(records);
      yield { t: 'block_start', index: 0, block: { t: 'text', text: '' } };
      for (let index = 0; index < text.length; index += 80) {
        if (!await pause(stepDelayMs / 4, options?.signal)) return;
        yield { t: 'text_delta', index: 0, text: text.slice(index, index + 80) };
      }
      yield { t: 'block_stop', index: 0 };
      yield { t: 'message_stop', stopReason: 'end_turn' };
    },
  };
}
export function createSourceFactory(config: RuntimeConfig, fetchImpl: typeof fetch = fetch): SourceFactory {
  return async (signal, onFailure = () => {}) => {
    signal.throwIfAborted();
    if (config.mode === 'offline') return { client: scriptedClient(), model: { provider: 'offline', model: 'offline-script' } };
    const state = configuration(config);
    if (!state.ready) throw new ProductError('missing_credentials', state.message, 503);
    const boundedFetch: typeof fetch = (url, init) => fetchImpl(url, {
      ...init, redirect: 'error',
      signal: AbortSignal.any([signal, ...(init?.signal ? [init.signal] : [])]),
    });
    const mintFetch: typeof fetch = (url, init) => boundedFetch(url, {
      ...init,
      signal: AbortSignal.any([AbortSignal.timeout(15_000), ...(init?.signal ? [init.signal] : [])]),
    });
    // One new minter/session per short run; token remains solely in this closure.
    const minter = createAppTokenMinter({ apiBaseUrl: config.apiBaseUrl, appId: config.appId!, appKey: config.appKey!, fetchImpl: mintFetch, maxCachedTokens: 1 });
    const token = await minter.tokenFor(owner);
    signal.throwIfAborted();
    const transport = stopOnPlatformFailure(boundedFetch, signal, onFailure);
    return { token: () => token, baseUrl: config.apiBaseUrl, fetchImpl: transport.fetch, drain: transport.drain };
  };
}
