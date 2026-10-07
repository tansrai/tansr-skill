// Offline check of the real SDK with a scripted model; no account or model charge.
import assert from 'node:assert/strict';
import { managedFeedbackSource, runFeedback } from './agent.mjs';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { tmpdir } from 'node:os';
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
const finalText = '离线测试文本：读取结果已进入模型上下文。';
let log = '';
const result = await runFeedback(source('success'), text => { log += text; });
assert.equal(result.reads, 1);
assert.equal(result.output, finalText, 'The final result must come from the completed turn history');
assert.equal(result.cleanup.status, 'completed');
assert.ok(Object.values(result.cleanup.pending).every(count => count === 0));
assert.ok(log.includes('已读取 6 条反馈') && log.includes('[完成]'));
const resumed = await runFeedback({
  ...source('success'),
  initialMessages: [{ role: 'user', blocks: [{ t: 'text', text: '之前的任务。' }] }, { role: 'assistant', blocks: [{ t: 'text', text: '旧轮回答，不能作为本轮结果。' }] }],
}, () => {});
assert.equal(resumed.output, finalText, 'Prior assistant history must not be reported as the new turn result');

// 持久化尚未完成时，业务函数与成功输出都必须继续等待真实收尾。
let releaseCommit;
let observeCommit;
const commitGate = new Promise(resolve => { releaseCommit = resolve; });
const commitStarted = new Promise(resolve => { observeCommit = resolve; });
let delayedFinished = false;
let delayedLog = '';
const delayed = runFeedback({
  ...source('success'),
  onHistoryCommit: async history => {
    assert.ok(JSON.stringify(history).includes(finalText));
    observeCommit();
    await commitGate;
  },
}, text => { delayedLog += text; }).finally(() => { delayedFinished = true; });
try {
  await commitStarted;
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(delayedFinished, false, 'A pending history commit must keep the business operation unfinished');
  assert.ok(!delayedLog.includes('[完成]') && !delayedLog.includes(finalText), 'No successful result may escape before persistence settles');
} finally {
  releaseCommit();
}
assert.equal((await delayed).cleanup.status, 'completed');
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

// 配置测试只读随包模板；所有用户、上级与托管配置经公开 fs 缝提供合成内容。
// homedir 不能等于 cwd：SDK 有意排除家目录作为项目锚，避免用户层双重入账。
const cwd = path.resolve(fileURLToPath(new URL('.', import.meta.url)));
const sharedFile = path.join(cwd, '.tansr', 'settings.json');
const localFile = path.join(cwd, '.tansr', 'settings.local.json');
const parentFile = path.join(path.dirname(cwd), '.tansr', 'settings.json');
const syntheticHome = path.join(cwd, '__synthetic-home__');
const userFile = path.join(syntheticHome, '.tansr', 'settings.json');
const managedFile = path.join(cwd, '__synthetic-managed__.json');
const configFor = name => JSON.stringify({
  $schemaVersion: 1,
  providers: { [name]: { protocol: 'openai', baseUrl: 'https://unused.invalid/v1', models: { probe: `${name}-model` }, auth: { env: 'SYNTHETIC_KEY' } } },
  modelAliases: { main: `${name}/probe` },
});
const configFiles = new Map([
  [sharedFile, await readFile(sharedFile, 'utf8')],
  [parentFile, configFor('syntheticParent')],
  [userFile, configFor('syntheticUser')],
]);
const configReads = [];
const configFs = {
  async readFile(file) {
    configReads.push(file);
    const value = configFiles.get(file);
    if (value === undefined) throw Object.assign(new Error('Synthetic file missing'), { code: 'ENOENT' });
    return value;
  },
  async directoryExists(dir) {
    return [path.dirname(sharedFile), path.dirname(parentFile), path.dirname(userFile)].includes(dir);
  },
};
const previousCwd = process.cwd();
let cliSource;
try {
  process.chdir(tmpdir());
  cliSource = managedFeedbackSource();
} finally {
  process.chdir(previousCwd);
}
assert.equal(path.resolve(cliSource.cwd), cwd, 'CLI configuration must be anchored to its own project even when called from elsewhere');
async function configuredModel(loadOptions) {
  const session = await createSession({
    ...cliSource,
    env: { MODEL_API_KEY: 'offline-test-only', SYNTHETIC_KEY: 'offline-test-only' },
    loadOptions: { homedir: syntheticHome, boundary: cwd, managedPaths: [managedFile], fs: configFs, ...loadOptions },
    tools: { builtin: [] },
    fetchImpl: async () => { throw new Error('Configuration tests must not call a network'); },
  });
  try { return session.currentModel().model; }
  finally { assert.equal((await session.closeAsync()).status, 'completed'); }
}
assert.equal(await configuredModel(), 'YOUR_TOOL_CAPABLE_MODEL_ID', 'Project shared config must win over a conflicting synthetic user');
assert.ok(!configReads.includes(parentFile), 'The example project must prevent accidental ancestor configuration discovery');
assert.ok(configReads.every(file => [sharedFile, localFile, userFile, managedFile].includes(file)), 'Only declared synthetic layers may be read');
configFiles.set(localFile, configFor('syntheticLocal'));
assert.equal(await configuredModel(), 'syntheticLocal-model', 'Normal project-local precedence must remain effective');
configFiles.set(managedFile, configFor('syntheticManaged'));
assert.equal(await configuredModel(), 'syntheticManaged-model', 'Managed configuration must retain precedence over project layers');
const rows = JSON.parse(await readFile(new URL('./feedback.json', import.meta.url), 'utf8'));
assert.equal(new Set(rows.map(row => row.id)).size, 6);
console.log('PASS: actual SDK tool loop, final history with prior turns, delayed persistence, missing-tool rejection, provider failure, terminal reason, cancellation, persistence failure with recovery handle and original cause, resource completion, CLI project anchoring and synthetic config precedence. No live model or real user configuration was used.');
