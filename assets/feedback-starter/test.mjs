// Offline check of the real SDK with a scripted model; no account or model charge.
import assert from 'node:assert/strict';
import { runFeedback } from './agent.mjs';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createSession } from '@tansr/sdk';

function scripted(mode, onRequest = () => {}) {
  let calls = 0;
  return {
    async *stream(request) {
      calls++;
      onRequest();
      assert.deepEqual(request.tools.map(tool => tool.name), ['listFeedback']);
      yield { t: 'message_start', model: 'offline-test' };
      if (mode === 'failure') {
        yield { t: 'error', kind: 'auth', message: 'test failure', recoverable: false };
        return;
      }
      if ((calls === 1 || mode === 'limit') && mode !== 'no-tool') {
        if (mode === 'limit') {
          yield { t: 'block_start', index: 1, block: { t: 'text', text: '' } };
          yield { t: 'text_delta', index: 1, text: '尚未完成，继续读取。' };
          yield { t: 'block_stop', index: 1 };
        }
        yield { t: 'block_start', index: 0, block: { t: 'tool_call', id: `read-${calls}`, name: 'listFeedback', args: {} } };
        yield { t: 'block_stop', index: 0 };
        yield { t: 'message_stop', stopReason: 'tool_use' };
      } else {
        if (mode !== 'no-tool') {
          const history = JSON.stringify(request.messages);
          assert.ok(history.includes('F01') && history.includes('F06'), 'Actual tool result must reach the next model turn');
        }
        yield { t: 'block_start', index: 0, block: { t: 'text', text: '' } };
        yield { t: 'text_delta', index: 0, text: '离线测试文本：读取结果已进入模型上下文。' };
        yield { t: 'block_stop', index: 0 };
        yield { t: 'message_stop', stopReason: 'end_turn' };
      }
    },
  };
}
const source = mode => ({ client: scripted(mode), model: { provider: 'test', model: 'offline-test' } });
let log = '';
const result = await runFeedback(source('success'), text => { log += text; });
assert.equal(result.reads, 1);
assert.equal(result.cleanup.status, 'completed');
assert.ok(Object.values(result.cleanup.pending).every(count => count === 0));
assert.ok(log.includes('已读取 6 条反馈') && log.includes('[完成]'));
await assert.rejects(runFeedback(source('no-tool'), () => {}), /未完成/);
await assert.rejects(runFeedback(source('failure'), () => {}), /调用失败|任务已中止/);
await assert.rejects(runFeedback(source('limit'), () => {}), /任务未完成/);
let cancelledCalls = 0;
await assert.rejects(runFeedback({
  client: scripted('success', () => { cancelledCalls++; }),
  model: { provider: 'test', model: 'offline-test' },
  signal: AbortSignal.abort(),
}, () => {}), /任务已取消/);
assert.equal(cancelledCalls, 0, 'Pre-cancelled tasks must not enter the model client');
const controller = new AbortController();
let cancelledLog = '';
await assert.rejects(runFeedback({
  client: scripted('success', () => { controller.abort(); }),
  model: { provider: 'test', model: 'offline-test' },
  signal: controller.signal,
}, text => { cancelledLog += text; }), /中止|取消/);
assert.ok(!cancelledLog.includes('[完成]'), 'Cancellation during execution must not report success');
let failedLog = '';
await assert.rejects(runFeedback({ ...source('success'), onHistoryCommit: async () => { throw new Error('offline persistence failure'); } }, text => { failedLog += text; }), error => {
  assert.match(error.message, /收尾未完成/);
  assert.equal(error.cleanup.status, 'failed');
  assert.equal(typeof error.session.drain, 'function', 'Host must retain the handle needed to inspect unfinished cleanup');
  assert.equal(JSON.stringify(error), '{}', 'Recovery handles must not leak through ordinary JSON serialization');
  return true;
});
assert.ok(!failedLog.includes('[完成]'), 'A failed persistence receipt must not report success');
await assert.rejects(runFeedback({ ...source('no-tool'), onHistoryCommit: async () => { throw new Error('offline persistence failure'); } }, () => {}), error => {
  assert.match(error.message, /收尾未完成/);
  assert.match(error.cause.message, /未完成真实的读取/);
  assert.equal(error.cleanup.status, 'failed');
  return true;
});

// Load only the bundled example config, with a dummy key and no real user config.
const cwd = fileURLToPath(new URL('.', import.meta.url));
const session = await createSession({ model: 'main', cwd, env: { MODEL_API_KEY: 'offline-test-only' }, loadOptions: { homedir: cwd }, tools: { builtin: [] } });
assert.equal(session.currentModel().model, 'YOUR_TOOL_CAPABLE_MODEL_ID');
assert.equal((await session.closeAsync()).status, 'completed');
const rows = JSON.parse(await readFile(new URL('./feedback.json', import.meta.url), 'utf8'));
assert.equal(new Set(rows.map(row => row.id)).size, 6);
console.log('PASS: actual SDK tool loop, final text, missing-tool rejection, provider failure, terminal reason, cancellation, persistence failure with recovery handle and original cause, resource completion and bundled config. No live model was called.');
