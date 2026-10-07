import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, readFile, rm, writeFile, rename } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { request as httpRequest } from 'node:http';
import type { ModelClient, IRStreamEvent } from '@tansr/sdk';
import { AppTokenMintError } from '@tansr/serve';
import { createProductServer } from '../src/server.ts';
import { loadConfig } from '../src/config.ts';
import type { RuntimeConfig } from '../src/config.ts';
import { createSourceFactory, scriptedClient } from '../src/source.ts';
import type { SourceFactory } from '../src/source.ts';
import { LocalStore } from '../src/store.ts';
import { analyze, CleanupError } from '../src/agent.ts';
import { safeError } from '../src/errors.ts';
import { product } from '../src/product.ts';
import type { BusinessRecord, Run, RunEvent } from '../src/types.ts';

const root = fileURLToPath(new URL('../', import.meta.url));
const offline: SourceFactory = async () => ({ client: scriptedClient(1), model: { provider: 'offline', model: 'scripted-test' } });
async function fixture(sourceFor: SourceFactory = offline, changes: Partial<RuntimeConfig> = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'tansr-product-test-'));
  const config: RuntimeConfig = { mode: 'offline', port: 0, dataDir: dir, publicDir: join(root, 'public'), product, apiBaseUrl: 'https://api.tansr.com', ...changes };
  const app = await createProductServer(config, sourceFor);
  const origin = await app.listen(0);
  const request = (path: string, method = 'GET', body?: unknown, headers: Record<string, string> = {}) => fetch(origin + path, {
    method, headers: { ...(method === 'GET' ? {} : { Origin: origin, 'Content-Type': 'application/json' }), ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { app, origin, dir, config, request, async close() { await app.close(); await rm(dir, { recursive: true, force: true }); } };
}
async function add(f: Awaited<ReturnType<typeof fixture>>, title = '页面加载很慢', content = '提交后加载约十秒，需要优化', requestId?: string): Promise<BusinessRecord> {
  const response = await f.request('/api/records', 'POST', { title, content, clientRequestId: requestId });
  assert.equal(response.status, 201);
  return ((await response.json()) as { record: BusinessRecord }).record;
}
async function run(f: Awaited<ReturnType<typeof fixture>>, ids: string[]): Promise<Run> {
  const response = await f.request('/api/runs', 'POST', { recordIds: ids });
  assert.equal(response.status, 202);
  return ((await response.json()) as { run: Run }).run;
}
async function events(f: Awaited<ReturnType<typeof fixture>>, id: string): Promise<RunEvent[]> {
  const response = await f.request(`/api/runs/${id}/events`);
  assert.equal(response.status, 200);
  const text = await response.text();
  return text.split('\n').filter(line => line.startsWith('data: ')).map(line => JSON.parse(line.slice(6)) as RunEvent);
}
function model(events: IRStreamEvent[]): SourceFactory {
  const client: ModelClient = { async *stream() { for (const event of events) yield event; } };
  return async () => ({ client, model: { provider: 'offline', model: 'test-failure' } });
}

test('HTTP → real SDK tool → streamed result → durable history, selected ownership and edit/delete semantics', async () => {
  const f = await fixture();
  try {
    const first = await add(f);
    const hidden = await add(f, '未选择的记录', 'PRIVATE-NOT-SELECTED');
    const started = await run(f, [first.id]);
    const stream = await events(f, started.id);
    assert.equal(stream.at(-1)?.status, 'completed');
    assert.ok(stream.some(event => event.type === 'tool' && event.recordIds?.[0] === first.id));
    assert.ok(stream.some(event => event.type === 'progress' && event.text));
    const result = stream.find(event => event.type === 'result')!.result!;
    assert.ok(result.text.includes(first.content));
    assert.ok(!result.text.includes(hidden.content));
    assert.deepEqual(result.readIds, [first.id]);
    assert.equal(result.toolCalls, 1);
    assert.match(result.text, /离线验证/);
    assert.equal((await f.request(`/api/records/${first.id}`, 'PATCH', { content: '已更新的业务事实', status: 'reviewed' })).status, 200);
    const saved = JSON.parse(await readFile(join(f.dir, 'state.json'), 'utf8'));
    assert.equal(saved.records[0].status, 'reviewed');
    assert.equal(saved.runs[0].inputRecords[0].content, first.content, 'History preserves original input after edits');
    assert.equal(saved.runs[0].result.text, result.text);
    assert.equal((await f.request(`/api/records/${first.id}`, 'DELETE')).status, 200);
    const state = await (await f.request('/api/state')).json();
    assert.equal(state.records.length, 1); assert.equal(state.runs.length, 0);
    assert.equal((await f.request(`/api/runs/${started.id}/events`)).status, 404);
  } finally { await f.close(); }
});

test('idempotent concurrent writes, validation, same-origin and static secret boundaries', async () => {
  const f = await fixture();
  try {
    const responses = await Promise.all(Array.from({ length: 4 }, () => f.request('/api/records', 'POST', { title: '重复请求', content: '同一业务数据', clientRequestId: 'unique-request-123' })));
    assert.ok(responses.every(response => response.status === 201));
    assert.equal(f.app.store.snapshot().records.length, 1);
    assert.equal((await f.request('/api/records', 'POST', { title: '改变', content: '不同数据', clientRequestId: 'unique-request-123' })).status, 409);
    assert.equal((await f.request('/api/records', 'POST', { title: '', content: 'x' })).status, 400);
    assert.equal((await f.request('/api/records', 'POST', { title: 'x', content: 'x'.repeat(40000) })).status, 413);
    assert.equal((await f.request('/api/records', 'POST', {}, { Origin: 'https://evil.invalid' })).status, 403);
    const badHostStatus = await new Promise<number | undefined>((resolve, reject) => {
      const request = httpRequest(f.origin + '/api/state', { headers: { Host: 'evil.invalid' } }, response => { response.resume(); resolve(response.statusCode); });
      request.on('error', reject); request.end();
    });
    assert.equal(badHostStatus, 403);
    assert.equal((await f.request('/api/state', 'GET', undefined, { 'Sec-Fetch-Site': 'cross-site' })).status, 403);
    assert.equal((await fetch(f.origin + '/api/records', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).status, 403);
    assert.equal((await f.request('/api/records', 'POST', {}, { 'Content-Type': 'text/plain' })).status, 415);
    assert.equal((await f.request('/.env')).status, 404);
    assert.equal((await f.request('/src/source.ts')).status, 404);
    assert.equal((await f.request('/api/runs', 'POST', { recordIds: [], owner: 'another-user' })).status, 400);
  } finally { await f.close(); }
});

test('one active run, cancellation settles resources, then a fresh run succeeds', async () => {
  const f = await fixture(async () => ({ client: scriptedClient(400), model: { provider: 'offline', model: 'slow' } }));
  try {
    const row = await add(f);
    const responses = await Promise.all([f.request('/api/runs', 'POST', { recordIds: [row.id] }), f.request('/api/runs', 'POST', { recordIds: [row.id] })]);
    assert.deepEqual(responses.map(response => response.status).sort(), [202, 409]);
    const started = (await responses.find(response => response.status === 202)!.json()).run as Run;
    assert.equal((await f.request(`/api/records/${row.id}`, 'DELETE')).status, 409);
    const cancelled = await f.request(`/api/runs/${started.id}/cancel`, 'POST', {});
    assert.equal((await cancelled.json()).run.status, 'cancelling');
    const stream = await events(f, started.id);
    assert.equal(stream.at(-1)?.status, 'cancelled');
    assert.ok(!stream.some(event => event.type === 'result'));
    assert.equal(f.app.runs.activeRunId, null);
    const next = await run(f, [row.id]);
    assert.equal((await events(f, next.id)).at(-1)?.status, 'completed');
    assert.equal((await (await f.request(`/api/runs/${next.id}/cancel`, 'POST', {})).json()).run.status, 'completed');
  } finally { await f.close(); }
});

for (const [kind, detail, expected] of [['auth', undefined, 'credentials_rejected'], ['policy_denied', undefined, 'permission_denied'], ['server', { scope: 'plan' }, 'account_limit'], ['network', undefined, 'model_failed']] as const) {
  test(`provider ${kind} becomes explicit safe failure; never offline success`, async () => {
    const f = await fixture(model([{ t: 'error', kind, message: 'SECRET-RAW-PROVIDER-ERROR', recoverable: false, ...(detail ? { detail } : {}) }]));
    try {
      const row = await add(f); const started = await run(f, [row.id]);
      const stream = await events(f, started.id);
      assert.equal(stream.at(-1)?.status, 'failed');
      assert.equal(stream.find(event => event.type === 'error')?.error?.code, expected);
      assert.ok(!JSON.stringify(stream).includes('SECRET-RAW-PROVIDER-ERROR'));
      assert.ok(!stream.some(event => event.type === 'result'));
    } finally { await f.close(); }
  });
}

test('an answer without actual tool evidence cannot be success', async () => {
  const f = await fixture(model([{ t: 'message_start', model: 'test' }, { t: 'block_start', index: 0, block: { t: 'text', text: '我声称已经完成' } }, { t: 'block_stop', index: 0 }, { t: 'message_stop', stopReason: 'end_turn' }]));
  try {
    const started = await run(f, [(await add(f)).id]);
    const stream = await events(f, started.id);
    assert.equal(stream.at(-1)?.status, 'failed');
    assert.equal(stream.find(event => event.type === 'error')?.error?.code, 'missing_evidence');
  } finally { await f.close(); }
});

test('missing platform credentials disables runs without invoking any provider; secrets absent from state', async () => {
  let called = 0;
  const f = await fixture(async () => { called++; return offline(AbortSignal.abort()); }, { mode: 'platform', appKey: 'SERVER-SECRET-NOT-FOR-BROWSER' });
  try {
    const row = await add(f);
    const response = await f.request('/api/runs', 'POST', { recordIds: [row.id] });
    assert.equal(response.status, 503); assert.equal((await response.json()).error.code, 'missing_credentials');
    assert.equal(called, 0);
    const state = await (await f.request('/api/state')).text();
    assert.ok(!state.includes('SERVER-SECRET-NOT-FOR-BROWSER'));
    assert.equal(JSON.parse(state).product.configuration.ready, false);
  } finally { await f.close(); }
});

test('published minter uses fixed server owner, signed headers, bounded fetch, and synchronous SDK token getter', async () => {
  const config: RuntimeConfig = { mode: 'platform', port: 0, dataDir: '', publicDir: '', product, apiBaseUrl: 'https://example.invalid', appId: 'offline-app-id', appKey: 'offline-test-key-only' };
  let calls = 0;
  const fakeFetch: typeof fetch = async (url, init) => {
    calls++;
    assert.equal(String(url), 'https://example.invalid/v1/app-tokens');
    const body = JSON.parse(String(init?.body));
    assert.equal(body.endUserId, 'local-owner');
    const headers = new Headers(init?.headers);
    assert.ok(headers.get('x-tansr-ts')); assert.ok(headers.get('x-tansr-nonce')); assert.ok(headers.get('x-tansr-sign'));
    assert.equal(init?.redirect, 'error'); assert.ok(init?.signal);
    return new Response(JSON.stringify({ token: 'offline-short-token', expiresAt: new Date(Date.now() + 3600000).toISOString() }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  const source = await createSourceFactory(config, fakeFetch)(new AbortController().signal);
  assert.equal(calls, 1); assert.equal(typeof source.token, 'function');
  assert.equal((source.token as () => string)(), 'offline-short-token');
  for (const [status, code] of [[401, 'credentials_rejected'], [403, 'permission_denied'], [402, 'account_limit']] as const) {
    assert.equal(safeError(new AppTokenMintError('rejected', 'do-not-leak', { status })).code, code);
  }
  await assert.rejects(createSourceFactory(config, async () => { throw new Error('private-network-error'); })(new AbortController().signal), error => safeError(error).code === 'platform_unavailable');
});

test('mint-only 15s timeout cannot cancel model streams; task and SDK request signals still cancel them', async t => {
  const timeouts: Array<{ milliseconds: number; controller: AbortController }> = [];
  t.mock.method(AbortSignal, 'timeout', (milliseconds: number) => {
    const controller = new AbortController();
    timeouts.push({ milliseconds, controller });
    return controller.signal;
  });
  const calls: Array<{ signal: AbortSignal; redirect?: RequestRedirect }> = [];
  const fakeFetch: typeof fetch = async (_url, init) => {
    assert.ok(init?.signal);
    calls.push({ signal: init.signal, redirect: init.redirect });
    return new Response(JSON.stringify({ token: 'synthetic-token', expiresAt: new Date(Date.now() + 3600000).toISOString() }), { status: 200 });
  };
  const config: RuntimeConfig = { mode: 'platform', port: 0, dataDir: '', publicDir: '', product, apiBaseUrl: 'https://example.invalid', appId: 'synthetic-app', appKey: 'synthetic-key' };
  const task = new AbortController();
  const source = await createSourceFactory(config, fakeFetch)(task.signal);
  const sdkRequest = new AbortController();
  await source.fetchImpl!('https://example.invalid/exchange', { signal: sdkRequest.signal });
  await source.fetchImpl!('https://example.invalid/features');
  assert.deepEqual(timeouts.map(timeout => timeout.milliseconds), [15000], 'Only minting creates the extra 15s timer');
  assert.ok(calls.every(call => call.redirect === 'error'));
  timeouts[0].controller.abort();
  assert.equal(calls[0].signal.aborted, true);
  assert.equal(calls[1].signal.aborted, false, 'Long-running model stream must survive the mint timer');
  assert.equal(calls[2].signal.aborted, false, 'Directory request uses the task signal, not the mint timer');
  sdkRequest.abort();
  assert.equal(calls[1].signal.aborted, true, 'SDK request-level cancellation is preserved');
  assert.equal(calls[2].signal.aborted, false);
  task.abort();
  assert.equal(calls[2].signal.aborted, true, 'Task timeout/cancellation still reaches every request');
});

test('durable records/runs survive restart and stale active runs become interrupted without replay', async () => {
  const f = await fixture();
  const row = await add(f);
  const started = await run(f, [row.id]);
  await events(f, started.id);
  await f.app.close();
  const path = join(f.dir, 'state.json');
  const db = JSON.parse(await readFile(path, 'utf8'));
  db.runs.push({ id: 'previous-crash', status: 'running', mode: 'offline', recordIds: [row.id], inputRecords: [row], createdAt: new Date().toISOString() });
  await writeFile(path, JSON.stringify(db));
  let calls = 0;
  const reopened = await createProductServer(f.config, async signal => { calls++; return offline(signal); });
  try {
    await reopened.listen(0);
    const state = reopened.store.snapshot();
    assert.equal(state.records[0].content, row.content);
    assert.equal(state.runs[0].status, 'completed');
    assert.equal(state.runs[1].status, 'interrupted');
    assert.equal(calls, 0);
  } finally { await reopened.close(); await rm(f.dir, { recursive: true, force: true }); }
});

test('corrupt state and competing owner preserve files; persistence failure preserves prior in-memory data', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tansr-store-test-'));
  try {
    const path = join(dir, 'state.json');
    await writeFile(path, '{bad-json');
    await assert.rejects(new LocalStore(dir).open(), /损坏/);
    assert.equal(await readFile(path, 'utf8'), '{bad-json');
    await rm(path);
    const store = new LocalStore(dir); await store.open();
    try {
      await assert.rejects(new LocalStore(dir).open(), /占用/);
      const row = await store.add({ title: '保留', content: '仍然有效' });
      await rename(path, join(dir, 'saved.json'));
      await writeFile(path + '.blocking-file', 'owned test fixture');
      // A directory at the commit target forces atomic replacement to fail on all hosts.
      const { mkdir } = await import('node:fs/promises'); await mkdir(path);
      await assert.rejects(store.patch(row.id, { content: '不能保存' }), /写入/);
      assert.equal(store.snapshot().records[0].content, '仍然有效');
      await rm(path, { recursive: true }); await rename(join(dir, 'saved.json'), path);
    } finally { await store.close(); }
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('SDK persistence failure retains host recovery handle and original failure; cannot report result', async () => {
  const row: BusinessRecord = { id: 'record-1', title: 'SDK数据', content: '真实工具数据', source: '', status: 'new', createdAt: '', updatedAt: '' };
  await assert.rejects(analyze({ records: [row], product, sourceFor: offline, signal: new AbortController().signal, emit: () => {}, onHistoryCommit: async () => { throw new Error('offline persistence fault'); } }), error => {
    assert.ok(error instanceof CleanupError);
    assert.equal(error.cleanup.status, 'failed');
    assert.equal(typeof error.session.drain, 'function');
    assert.ok(!JSON.stringify(error).includes('offline persistence fault'));
    return true;
  });
});

test('project configuration can change domain without changing saved business data', async () => {
  const config = await loadConfig(root, {});
  assert.equal(config.mode, 'offline'); assert.equal(config.product.name, '反馈工作台');
  await assert.rejects(loadConfig(root, { TANSR_MODE: 'silent-fallback' }), /TANSR_MODE/);
  await assert.rejects(loadConfig(root, { TANSR_API_BASE_URL: 'http://example.invalid' }), /HTTPS/);
});
