import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createProductServer } from '../src/server.ts';
import { createSourceFactory } from '../src/source.ts';
import { product } from '../src/product.ts';
import type { RuntimeConfig } from '../src/config.ts';
import type { RunEvent } from '../src/types.ts';
import { analyze, CleanupError } from '../src/agent.ts';
import { stopOnPlatformFailure } from '../src/platform-transport.ts';

const marker = 'SYNTHETIC-RAW-SECRET';
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
const frame = (event: string, value: unknown) => `event: ${event}\ndata: ${JSON.stringify(value)}\n\n`;
const encoder = new TextEncoder();
async function fixture(exchange: (init: RequestInit, count: number) => Response | Promise<Response>, mintStatus?: number) {
  const dir = await mkdtemp(join(tmpdir(), 'tansr-platform-test-'));
  let exchanges = 0; const requests: string[] = [];
  const fakeFetch: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    assert.equal(url.origin, 'https://api.tansr.com');
    assert.equal(init?.redirect, 'error');
    requests.push(url.pathname);
    switch (url.pathname) {
      case '/v1/app-tokens': return mintStatus ? json({ error: { code: mintStatus === 401 ? 'app_key_invalid' : mintStatus === 402 ? 'insufficient_balance' : 'forbidden', message: marker } }, mintStatus) : json({ token: 'synthetic-only', expiresAt: new Date(Date.now() + 3600000).toISOString() });
      case '/t1/heartbeat': return json({ features: [], configVersion: 'synthetic-v1', configStale: false });
      case '/t1/config': return json({ models: [{ handle: 'synthetic-main', modelId: 'synthetic-model', displayName: 'Synthetic Main', protocol: 'twp', capabilities: {}, contextWindow: 128000 }], aliases: { main: 'synthetic-main' }, platformModels: { imageGen: [], videoGen: [] }, configVersion: 'synthetic-v1' });
      case '/t1/exchange': return exchange(init!, ++exchanges);
      default: throw new Error('Unexpected fixture endpoint');
    }
  };
  const config: RuntimeConfig = { mode: 'platform', port: 0, dataDir: dir, publicDir: '', product, apiBaseUrl: 'https://api.tansr.com', appId: 'synthetic-app', appKey: 'synthetic-key' };
  // No acceptance transport guard: the product itself must stop retries.
  const sourceFor = createSourceFactory(config, fakeFetch);
  const app = await createProductServer(config, sourceFor);
  const origin = await app.listen(0);
  const http = (path: string, method = 'GET', body?: unknown) => fetch(origin + path, { method, headers: { Origin: origin, 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const row = (await (await http('/api/records', 'POST', { title: '合成测试', content: '工具实际读取的合成业务记录' })).json()).record;
  const start = async () => (await (await http('/api/runs', 'POST', { recordIds: [row.id] })).json()).run;
  const events = async (id: string) => {
    const text = await (await http(`/api/runs/${id}/events`)).text();
    assert.ok(!text.includes(marker));
    const state = await (await http('/api/state')).text();
    assert.ok(!state.includes(marker));
    return text.split('\n').filter(line => line.startsWith('data: ')).map(line => JSON.parse(line.slice(6)) as RunEvent);
  };
  return { app, http, start, events, row, requests, sourceFor, exchanges: () => exchanges, async close() { await app.close(); await rm(dir, { recursive: true, force: true }); } };
}
function successfulFrames(count: number): string {
  return frame('t.open', { exchangeId: 'synthetic-' + count, model: 'synthetic-main', protocol: 'twp/1' })
    + (count === 1 ? frame('t.delta', { i: 0, t: 'tool_use', id: 'synthetic-read', name: 'readRecords', vJson: '{}' }) : frame('t.delta', { i: 0, t: 'text', v: '已完成合成记录分析' }))
    + frame('t.usage', { inTokens: 20, outTokens: 5 }) + frame('t.close', { stop: count === 1 ? 'tool_use' : 'end' });
}

for (const [status, expected] of [[401, 'credentials_rejected'], [402, 'account_limit'], [403, 'permission_denied']] as const) test(`published minter HTTP ${status} reaches safe backend failure with zero model requests`, async () => {
  const f = await fixture(() => { throw new Error('Model must not run after mint rejection'); }, status);
  try {
    const events = await f.events((await f.start()).id);
    assert.equal(events.at(-1)?.status, 'failed');
    assert.equal(events.find(event => event.type === 'error')?.error?.code, expected);
    assert.deepEqual(f.requests, ['/v1/app-tokens']);
    assert.equal(f.exchanges(), 0);
  } finally { await f.close(); }
});

for (const [status, code, expected] of [[401, 'unauthorized', 'credentials_rejected'], [403, 'model_not_authorized', 'permission_denied'], [402, 'insufficient_balance', 'account_limit'], [503, 'upstream_error', 'model_failed']] as const) {
  for (const transport of ['http', 'sse'] as const) test(`real SDK ${transport} ${code}: first failure stops, safe actionable error, no replay`, { timeout: 5000 }, async () => {
    const payload = { code, message: marker, ...(status === 401 ? { detail: { reason: 'expired' } } : {}) };
    const f = await fixture(() => transport === 'http' ? json({ error: payload }, status) : new Response(frame('t.open', { exchangeId: 'synthetic', model: 'synthetic-main', protocol: 'twp/1' }) + frame('t.err', payload) + frame('t.err', payload), { headers: { 'Content-Type': 'text/event-stream' } }));
    try {
      const run = await f.start(); const events = await f.events(run.id);
      assert.equal(events.at(-1)?.status, 'failed');
      assert.equal(events.find(event => event.type === 'error')?.error?.code, expected);
      assert.equal(events.filter(event => event.type === 'done').length, 1);
      assert.equal(f.exchanges(), 1);
      assert.ok(!events.some(event => event.type === 'result' || event.type === 'tool'));
      assert.equal(f.app.runs.activeRunId, null, 'Cleanup releases the active session');
      assert.equal((await (await f.http(`/api/runs/${run.id}/cancel`, 'POST', {})).json()).run.status, 'failed');
    } finally { await f.close(); }
  });
}

for (const failure of ['network', 'stream-error', 'incomplete-eof', 'in-progress', 'empty-body'] as const) test(`real SDK ${failure} stops without hidden retry or test cancellation`, { timeout: 5000 }, async () => {
  const f = await fixture(() => {
    if (failure === 'network') throw new Error(marker);
    if (failure === 'in-progress') return json({ status: 'in_progress', requestId: 'synthetic', retryAfterMs: 1 }, 202);
    if (failure === 'empty-body') return new Response(null);
    const body = new ReadableStream<Uint8Array>({ start(controller) {
      controller.enqueue(encoder.encode(frame('t.open', { exchangeId: 'synthetic', model: 'synthetic-main', protocol: 'twp/1' })));
      if (failure === 'incomplete-eof') controller.close();
      else setTimeout(() => controller.error(new Error(marker)), 10);
    } });
    return new Response(body, { headers: { 'Content-Type': 'text/event-stream' } });
  });
  try {
    const run = await f.start(); const events = await f.events(run.id);
    assert.equal(events.at(-1)?.status, 'failed');
    assert.equal(events.find(event => event.type === 'error')?.error?.code, 'model_failed');
    assert.equal(f.exchanges(), 1);
    assert.ok(!events.some(event => event.type === 'result'));
    assert.equal(f.app.runs.activeRunId, null);
  } finally { await f.close(); }
});

test('real SDK successful tool loop cancels held-open terminal bodies without false error', { timeout: 5000 }, async () => {
  let cancellations = 0;
  const f = await fixture((init, count) => {
    const body = JSON.parse(String(init.body)); assert.equal(body.params.maxTokens, 4000);
    if (count === 2) assert.ok(String(init.body).includes('工具实际读取的合成业务记录'));
    const text = successfulFrames(count);
    return new Response(new ReadableStream({ start(controller) { controller.enqueue(encoder.encode(text)); }, cancel() { cancellations++; } }), { headers: { 'Content-Type': 'text/event-stream' } });
  });
  try {
    const run = await f.start(); const events = await f.events(run.id);
    assert.equal(events.at(-1)?.status, 'completed');
    assert.deepEqual(events.find(event => event.type === 'result')?.result?.readIds, [f.row.id]);
    assert.equal(f.exchanges(), 2); assert.equal(cancellations, 2);
    assert.equal(events.filter(event => event.type === 'done').length, 1);
    assert.equal(f.app.runs.activeRunId, null);
  } finally { await f.close(); }
});

for (const variant of ['cr-only', 'split-crlf', 'last-event-wins', 'after-terminal', 'mixed-case-mime'] as const) test(`public SSE ${variant} success matches real SDK framing`, { timeout: 5000 }, async () => {
  const f = await fixture((_init, count) => {
    let text = successfulFrames(count);
    if (variant === 'cr-only') text = text.replaceAll('\n', '\r');
    if (variant === 'split-crlf') text = text.replaceAll('\n', '\r\n');
    if (variant === 'last-event-wins') text = text.replace('event: t.close', 'event: ignored\nevent: t.close');
    if (variant === 'after-terminal') text += frame('t.err', { code: 'insufficient_balance', message: marker });
    return new Response(new ReadableStream({ start(controller) {
      const chunks = variant === 'split-crlf' ? text.split(/(?<=\r)/) : [text];
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
    } }), { headers: { 'Content-Type': variant === 'mixed-case-mime' ? 'Text/Event-Stream' : 'text/event-stream' } });
  });
  try { const events = await f.events((await f.start()).id); assert.equal(events.at(-1)?.status, 'completed'); assert.equal(f.exchanges(), 2); }
  finally { await f.close(); }
});

for (const variant of ['mixed-case-error', 'missing-mime-eof', 'json-invalid', 'json-stream-error', 'eof-undispatched', 'empty-close-then-error', 'malformed-close-then-error'] as const) test(`public response ${variant} stops before SDK retry`, { timeout: 5000 }, async () => {
  const f = await fixture(() => {
    const data = frame('t.err', { code: 'model_not_authorized', message: marker });
    if (variant === 'mixed-case-error') return new Response(data, { headers: { 'Content-Type': 'Text/Event-Stream' } });
    if (variant === 'empty-close-then-error') return new Response('event: t.close\n\n' + data, { headers: { 'Content-Type': 'text/event-stream' } });
    if (variant === 'malformed-close-then-error') return new Response('event: t.close\ndata: not-json\n\n' + data, { headers: { 'Content-Type': 'text/event-stream' } });
    if (variant === 'missing-mime-eof') return new Response(encoder.encode(frame('t.open', {})));
    if (variant === 'eof-undispatched') return new Response('event: t.close\ndata: {"stop":"end"}', { headers: { 'Content-Type': 'text/event-stream' } });
    if (variant === 'json-invalid') return new Response('{malformed', { headers: { 'Content-Type': 'Application/Json' } });
    return new Response(new ReadableStream({ start(controller) { controller.error(new Error(marker)); } }), { headers: { 'Content-Type': 'application/json' } });
  });
  try {
    const events = await f.events((await f.start()).id);
    assert.equal(events.at(-1)?.status, 'failed');
    assert.equal(events.find(event => event.type === 'error')?.error?.code, variant === 'mixed-case-error' || variant.endsWith('then-error') ? 'permission_denied' : 'model_failed');
    assert.equal(f.exchanges(), 1);
  } finally { await f.close(); }
});

test('success waits for both upstream body cancellation promises', { timeout: 5000 }, async () => {
  const releases: Array<() => void> = []; let cancelled!: () => void;
  const bothCancelled = new Promise<void>(resolve => { cancelled = resolve; });
  const f = await fixture((_init, count) => new Response(new ReadableStream({
    start(controller) { controller.enqueue(encoder.encode(successfulFrames(count))); },
    cancel() { return new Promise<void>(resolve => { releases.push(resolve); if (releases.length === 2) cancelled(); }); },
  }), { headers: { 'Content-Type': 'text/event-stream' } }));
  try {
    const run = await f.start(); let done = false;
    const events = f.events(run.id).then(value => { done = true; return value; });
    await bothCancelled;
    assert.equal(done, false); assert.equal(f.app.runs.getRun(run.id).status, 'running');
    releases.forEach(resolve => resolve());
    assert.equal((await events).at(-1)?.status, 'completed');
  } finally { releases.forEach(resolve => resolve()); await f.close(); }
});

test('upstream cancellation rejection retains a failed host cleanup receipt', { timeout: 5000 }, async () => {
  const f = await fixture((_init, count) => new Response(new ReadableStream({
    start(controller) { controller.enqueue(encoder.encode(successfulFrames(count))); },
    cancel() { return Promise.reject(new Error(marker)); },
  }), { headers: { 'Content-Type': 'text/event-stream' } }));
  try {
    await assert.rejects(analyze({ records: [f.row], sourceFor: f.sourceFor, product, signal: new AbortController().signal, emit: () => {} }), error => {
      assert.ok(error instanceof CleanupError);
      assert.equal(error.cleanup.status, 'completed', 'SDK resources completed independently');
      assert.equal(error.transportCleanup?.status, 'failed', 'Host resource failure is retained');
      assert.equal(typeof error.transportDrain, 'function');
      assert.ok(!JSON.stringify(error).includes(marker));
      return true;
    });
  } finally { await f.close(); }
});

test('SSE error plus upstream cancellation rejection retains both failure causes', { timeout: 5000 }, async () => {
  const f = await fixture(() => new Response(new ReadableStream({
    start(controller) { controller.enqueue(encoder.encode(frame('t.err', { code: 'insufficient_balance', message: marker }))); },
    cancel() { return Promise.reject(new Error(marker)); },
  }), { headers: { 'Content-Type': 'text/event-stream' } }));
  try {
    await assert.rejects(analyze({ records: [f.row], sourceFor: f.sourceFor, product, signal: new AbortController().signal, emit: () => {} }), error => {
      assert.ok(error instanceof CleanupError);
      assert.equal(error.cleanup.status, 'completed');
      assert.equal(error.transportCleanup?.status, 'failed');
      assert.equal((error.cause as { code?: string }).code, 'account_limit');
      assert.ok(!JSON.stringify(error).includes(marker));
      return true;
    });
  } finally { await f.close(); }
});

test('late user cancel cannot erase the first platform error during host cleanup', { timeout: 5000 }, async () => {
  let release!: () => void; let entered!: () => void;
  const cancelling = new Promise<void>(resolve => { entered = resolve; });
  const f = await fixture(() => new Response(new ReadableStream({ cancel() { entered(); return new Promise<void>(resolve => { release = resolve; }); } }), { status: 401 }));
  try {
    const run = await f.start(); const events = f.events(run.id);
    await cancelling;
    await f.http(`/api/runs/${run.id}/cancel`, 'POST', {});
    release();
    const finished = await events;
    assert.equal(finished.at(-1)?.status, 'failed');
    assert.equal(finished.find(event => event.type === 'error')?.error?.code, 'credentials_rejected');
  } finally { release?.(); await f.close(); }
});

test('host drain timeout retains its pending cancellation and can later settle', async () => {
  let release!: () => void;
  const transport = stopOnPlatformFailure(async () => new Response(new ReadableStream({
    start(controller) { controller.enqueue(encoder.encode(frame('t.close', { stop: 'end' }))); },
    cancel() { return new Promise<void>(resolve => { release = resolve; }); },
  }), { headers: { 'Content-Type': 'text/event-stream' } }), new AbortController().signal, () => {});
  const reader = (await transport.fetch('https://api.tansr.com/t1/exchange')).body!.getReader();
  await reader.read(); await reader.cancel();
  assert.equal((await transport.drain(5)).status, 'timeout');
  release();
  assert.equal((await transport.drain(1000)).status, 'completed');
});

test('cancellation exactly as source returns does not start an SDK query', async () => {
  const user = new AbortController(); let queried = false;
  await assert.rejects(analyze({ records: [], product, signal: user.signal, emit: () => {}, sourceFor: async () => {
    user.abort();
    return { client: { async *stream() { queried = true; yield { t: 'message_stop', stopReason: 'end_turn' }; } }, model: { provider: 'offline', model: 'unused' } };
  } }), error => (error as { code?: string }).code === 'cancelled');
  assert.equal(queried, false);
});

for (const cause of ['user', 'timeout'] as const) test(`real SDK ${cause} cancellation keeps its identity and closes pending fetch`, { timeout: 5000 }, async t => {
  const timers: Array<{ milliseconds: number; controller: AbortController }> = [];
  t.mock.method(AbortSignal, 'timeout', (milliseconds: number) => {
    const controller = new AbortController(); timers.push({ milliseconds, controller }); return controller.signal;
  });
  let ready!: () => void; const entered = new Promise<void>(resolve => { ready = resolve; });
  const f = await fixture(init => new Promise((_resolve, reject) => {
    init.signal!.addEventListener('abort', () => reject(init.signal!.reason), { once: true }); ready();
  }));
  try {
    const run = await f.start(); await entered;
    if (cause === 'user') await f.http(`/api/runs/${run.id}/cancel`, 'POST', {});
    else timers.find(timer => timer.milliseconds === 120000)!.controller.abort(new DOMException('Synthetic task timeout', 'TimeoutError'));
    const events = await f.events(run.id);
    assert.equal(events.at(-1)?.status, cause === 'user' ? 'cancelled' : 'failed');
    assert.equal(events.find(event => event.type === 'error')?.error?.code, cause === 'user' ? 'cancelled' : 'run_aborted');
    assert.equal(f.exchanges(), 1); assert.equal(f.app.runs.activeRunId, null);
    assert.ok(!events.some(event => event.type === 'result'));
  } finally { await f.close(); }
});
