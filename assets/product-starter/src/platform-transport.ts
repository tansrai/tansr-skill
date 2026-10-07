import { platformFailure, ProductError } from './errors.ts';

export interface TransportDrain { status: 'completed' | 'failed' | 'timeout' }

// This local product stops a run on its first platform failure. The public SDK
// session API has no retry switch; aborting the host-owned signal prevents its
// internal retry/fallback loop without implementing a second retry policy.
export function stopOnPlatformFailure(fetchImpl: typeof fetch, signal: AbortSignal, onFailure: (error: ProductError) => void): { fetch: typeof fetch; drain: (timeoutMs: number) => Promise<TransportDrain> } {
  let failure: ProductError | undefined;
  let cleanupFailed = false;
  const pending = new Set<Promise<void>>();
  const track = (promise: Promise<void>): void => {
    const settled = promise.finally(() => pending.delete(settled));
    pending.add(settled);
  };
  const stop = (error = platformFailure()): ProductError => {
    if (!signal.aborted && !failure) { failure = error; onFailure(error); }
    return failure ?? error;
  };
  const guarded: typeof fetch = async (input, init) => {
    if (failure) throw failure;
    signal.throwIfAborted();
    let response: Response;
    try { response = await fetchImpl(input, init); }
    catch (error) { if (signal.aborted) throw error; throw stop(); }
    const modelResponse = new URL(input instanceof Request ? input.url : String(input)).pathname === '/t1/exchange';
    if ((!response.ok && response.status !== 304) || response.status === 202 || (modelResponse && !response.body)) {
      const error = stop(platformFailure(response.status));
      if (response.body) track(response.body.cancel().catch(() => { cleanupFailed = true; }));
      throw error;
    }
    if (!modelResponse || !response.body) return response;
    const isJson = (response.headers.get('content-type') ?? '').toLowerCase().includes('application/json');
    // Observe only the public SSE error/terminal boundary. SDK remains the sole
    // decoder/executor of deltas, tool calls, usage, and the rest of TWP.
    let buffer = ''; let terminal = false; let bytes = 0;
    let eventName = ''; let data: string[] = [];
    let partialLine = ''; let skipLF = false;
    const decoder = new TextDecoder();
    const dispatch = (): void => {
      if (terminal) return;
      const event = eventName; const hasData = data.length > 0; const text = data.join('\n');
      eventName = ''; data = [];
      if (!hasData) return;
      if (event === 't.close') {
        try { const value: unknown = JSON.parse(text); terminal = !!value && typeof value === 'object' && !Array.isArray(value); } catch { /* SDK ignores an invalid close payload */ }
      }
      if (event !== 't.err') return;
      let code: string | undefined;
      try { const value: unknown = JSON.parse(text); if (value && typeof value === 'object' && 'code' in value && typeof value.code === 'string') code = value.code; } catch { /* malformed error still stops */ }
      throw stop(platformFailure(undefined, code));
    };
    // Standard SSE line framing only: CR/LF/CRLF, last event field wins,
    // multi-line data, and no dispatch of an unterminated EOF frame.
    const lines = (): void => {
      const chunk = buffer; buffer = '';
      for (const char of chunk) {
        if (terminal) break;
        if (skipLF) { skipLF = false; if (char === '\n') continue; }
        if (char !== '\r' && char !== '\n') { partialLine += char; continue; }
        skipLF = char === '\r';
        const line = partialLine; partialLine = '';
        if (!line) { dispatch(); continue; }
        const colon = line.indexOf(':');
        const field = colon < 0 ? line : line.slice(0, colon);
        const value = colon < 0 ? '' : line.slice(colon + 1).replace(/^ /, '');
        if (field === 'event') eventName = value;
        if (field === 'data') data.push(value);
      }
    };
    const observer = new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        bytes += chunk.byteLength;
        if (bytes > 2 * 1024 * 1024) throw stop(new ProductError('output_limit', '平台响应超过本机安全上限，任务已停止。'));
        buffer += decoder.decode(chunk, { stream: true });
        if (!isJson) lines();
        controller.enqueue(chunk);
      },
      flush() {
        buffer += decoder.decode();
        if (isJson) {
          // JSON replay is decoded by SDK. Catch only an unreadable/invalid
          // document here; this host does not implement the TWP result schema.
          try { JSON.parse(buffer); terminal = true; } catch { if (!signal.aborted) throw stop(); }
        } else lines();
        if (!terminal && !signal.aborted) throw stop();
      },
    });
    // SDK cancellation after t.close is expected even if TCP remains open.
    // Native piping owns cancellation; never close a cancelled manual reader.
    const upstream = response.body;
    track(upstream.pipeTo(observer.writable).catch(async error => {
      // A failed source read and a rejected upstream cancel both reject pipeTo.
      // After native pipe settlement has released its lock, reader.closed
      // distinguishes an errored source from an already-closed cancelled one.
      // No read, extra cancel, or second pipe is performed by this state probe.
      if (error !== undefined && error !== failure) {
        const probe = upstream.getReader();
        let sourceErrored = false;
        try { await probe.closed; } catch { sourceErrored = true; }
        finally { probe.releaseLock(); }
        if (!sourceErrored) cleanupFailed = true;
      }
      if (!terminal && !signal.aborted) stop();
    }));
    return new Response(observer.readable, { status: response.status, statusText: response.statusText, headers: response.headers });
  };
  return { fetch: guarded, async drain(timeoutMs) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const done = async (): Promise<TransportDrain> => {
      while (pending.size) await Promise.all([...pending]);
      return { status: cleanupFailed ? 'failed' : 'completed' };
    };
    try { return await Promise.race([done(), new Promise<TransportDrain>(resolve => { timer = setTimeout(() => resolve({ status: 'timeout' }), timeoutMs); })]); }
    finally { if (timer) clearTimeout(timer); }
  } };
}
