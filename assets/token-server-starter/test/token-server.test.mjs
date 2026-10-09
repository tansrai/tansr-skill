import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request } from 'node:http';
import { createHash, createHmac } from 'node:crypto';
import { startTokenServer } from '../server.mjs';

const quiet = { log() {}, error() {} };
const post = (base, route, body, session) => fetch(base + route, {
  method: 'POST', headers: { 'content-type': 'application/json', ...(session ? { 'x-demo-session': session } : {}) },
  body: JSON.stringify(body), signal: AbortSignal.timeout(5000),
});
async function rawPost(base, route, body, headers) {
  return new Promise((resolve, reject) => {
    const req = request(new URL(route, base), { method: 'POST', headers: { 'content-type': 'application/json', ...headers } }, res => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.once('error', reject);
      res.once('end', () => resolve({ status: res.statusCode, json: async () => JSON.parse(Buffer.concat(chunks).toString()) }));
    });
    req.once('error', reject);
    req.setTimeout(3000, () => req.destroy(new Error('local request timeout')));
    req.end(JSON.stringify(body));
  });
}

async function login(base, username = 'alice') {
  const response = await post(base, '/api/login', { username, password: username + '123' });
  assert.equal(response.status, 200);
  return response.json();
}
async function upstream(t, handler) {
  const server = createServer(handler);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())));
  return 'http://127.0.0.1:' + server.address().port;
}
async function backend(t, env = {}, fetchImpl) {
  const service = await startTokenServer({ env: { PORT: '0', HOST: '127.0.0.1', ...env }, logger: quiet, ...(fetchImpl ? { fetchImpl } : {}) });
  t.after(service.close);
  return service;
}

test('real local startup without credentials: health, login and authenticated 503 without upstream calls', { timeout: 10000 }, async t => {
  let calls = 0;
  const service = await backend(t, {}, async () => { calls++; throw new Error('No upstream is permitted'); });
  const health = await fetch(service.url + '/healthz');
  assert.equal(health.status, 200);
  assert.deepEqual(await health.json(), { status: 'ok', mode: 'platform', configured: false, missingConfig: ['TANSR_APP_KEY_ID', 'TANSR_APP_KEY'] });
  assert.equal((await fetch(service.url + '/readyz')).status, 503);
  assert.equal((await post(service.url, '/api/token', {})).status, 401);
  assert.equal((await post(service.url, '/api/login', { username: 'alice', password: 'wrong' })).status, 401);
  const session = await login(service.url);
  const denied = await post(service.url, '/api/token', { endUserId: 'another-user' }, session.sessionId);
  assert.equal(denied.status, 503);
  assert.equal((await denied.json()).error, 'configuration_not_ready');
  const usage = await fetch(service.url + '/api/my-usage', { headers: { 'x-demo-session': session.sessionId } });
  assert.equal(usage.status, 503);
  assert.equal(calls, 0);
});

test('real TCP exchange preserves official signing, authenticated identity and minimal token response', { timeout: 10000 }, async t => {
  const requests = [];
  const expiry = new Date(Date.now() + 60_000).toISOString();
  const secret = 'synthetic-server-only-key';
  const base = await upstream(t, async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const raw = Buffer.concat(chunks).toString();
    requests.push({ url: req.url, method: req.method, headers: req.headers, raw });
    const body = JSON.parse(raw);
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ token: 'synthetic-' + body.endUserId, expiresAt: expiry, appId: 'private-upstream-field', endUserId: body.endUserId }));
  });
  const service = await backend(t, { TANSR_APP_KEY_ID: 'synthetic-app', TANSR_APP_KEY: secret, TANSR_API_BASE: base, TOKEN_TTL_SECONDS: '600' });
  assert.equal((await fetch(service.url + '/readyz')).status, 200);
  const publicHealth = await (await fetch(service.url + '/healthz')).text();
  assert.ok(!publicHealth.includes(secret));
  for (const username of ['alice', 'bob']) {
    const session = await login(service.url, username);
    const response = await post(service.url, '/api/token', { endUserId: 'spoofed-user' }, session.sessionId);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { token: 'synthetic-demo-' + username, expiresAt: expiry });
  }
  assert.equal(requests.length, 2);
  for (const [index, request] of requests.entries()) {
    assert.equal(request.url, '/v1/app-tokens');
    assert.equal(request.method, 'POST');
    assert.deepEqual(JSON.parse(request.raw), { endUserId: index ? 'demo-bob' : 'demo-alice', ttlSeconds: 600 });
    assert.equal(request.headers['x-tansr-key-id'], 'synthetic-app');
    assert.equal(request.headers['x-tansr-key'], secret);
    const signed = ['TWP1-HMAC-SHA256', 'POST', '/v1/app-tokens', request.headers['x-tansr-ts'], request.headers['x-tansr-nonce'], createHash('sha256').update(request.raw).digest('hex')].join('\n');
    const key = createHash('sha256').update(secret).digest();
    assert.equal(request.headers['x-tansr-sign'], createHmac('sha256', key).update(signed).digest('hex'));
  }
});

test('upstream errors, expired responses and redirects never become fallback tokens', { timeout: 10000 }, async t => {
  let mode = 'error';
  let redirected = 0;
  const base = await upstream(t, (req, res) => {
    res.setHeader('content-type', 'application/json');
    if (req.url === '/redirected') { redirected++; res.end('{}'); return; }
    if (mode === 'error') { res.writeHead(403); res.end(JSON.stringify({ error: { code: 'synthetic-secret-do-not-echo' } })); return; }
    if (mode === 'expired') { res.end(JSON.stringify({ token: 'expired-token', expiresAt: '2000-01-01T00:00:00Z' })); return; }
    res.writeHead(302, { location: '/redirected' }); res.end('{}');
  });
  const service = await backend(t, { TANSR_APP_KEY_ID: 'synthetic-app', TANSR_APP_KEY: 'synthetic-key', TANSR_API_BASE: base });
  const session = await login(service.url);
  for (mode of ['error', 'expired', 'redirect']) {
    const response = await post(service.url, '/api/token', {}, session.sessionId);
    assert.equal(response.status, 502);
    const body = await response.json();
    assert.equal(body.error, 'token_exchange_failed');
    assert.equal(Object.hasOwn(body, 'token'), false);
    assert.ok(!JSON.stringify(body).includes('synthetic-secret'));
  }
  assert.equal(redirected, 0);
});

test('real TCP rejects rebinding Host and foreign Origin before authenticated token exchange', { timeout: 10000 }, async t => {
  let upstreamCalls = 0;
  const service = await backend(t, { TANSR_APP_KEY_ID: 'synthetic-id', TANSR_APP_KEY: 'synthetic-key' },
    async () => { upstreamCalls++; throw new Error('Untrusted requests must never reach upstream'); });
  const session = await login(service.url);
  const port = new URL(service.url).port;
  const invalidHeaders = [
    { host: 'attacker.invalid:' + port },
    { host: '127.0.0.1.attacker.invalid:' + port },
    { host: '127.0.0.1:' + (Number(port) === 80 ? 81 : 80) },
    { origin: 'https://attacker.invalid' },
    { origin: 'null' },
    { origin: 'http://127.0.0.1:' + (Number(port) === 80 ? 81 : 80) },
  ];
  for (const extra of invalidHeaders) {
    // Node fetch can normalize a custom Host; raw HTTP sends the exact attack authority.
    const response = await rawPost(service.url, '/api/token', {}, { 'x-demo-session': session.sessionId, ...extra });
    assert.equal(response.status, 403, JSON.stringify(extra));
    assert.equal((await response.json()).error, 'untrusted_request_origin');
  }
  const loginFromRemote = await fetch(service.url + '/api/login', {
    method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://attacker.invalid' },
    body: JSON.stringify({ username: 'alice', password: 'alice123' }),
  });
  assert.equal(loginFromRemote.status, 403);
  const trusted = await fetch(service.url + '/api/login', {
    method: 'POST', headers: { 'content-type': 'application/json', origin: service.url },
    body: JSON.stringify({ username: 'alice', password: 'alice123' }),
  });
  assert.equal(trusted.status, 200);
  assert.equal(upstreamCalls, 0);
});
