import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, writeFile, copyFile, rm } from 'node:fs/promises';
import { createServer, request } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { parseEnv } from 'node:util';
import test from 'node:test';
import { configure } from './configure.mjs';
import { readConfiguration } from './configuration.ts';
import { createDemoLoginService } from './developer-login.ts';
import { issueToken, verifyToken } from './auth.ts';
import { startPlatformServe } from './server.ts';
import { createDemoShutdown } from './shutdown.ts';

const syntheticSecret = 'synthetic-local-auth-secret-only-0123456789';
const syntheticPassword = 'synthetic-local-password';
async function temporary(t) {
  const root = await mkdtemp(path.join(tmpdir(), 'tansr-serve-starter-'));
  t.after(async () => { await rm(root, { recursive: true, force: true }); });
  return root;
}
function configuration(root, extra = {}) {
  return readConfiguration({ DEMO_AUTH_SECRET: syntheticSecret, DEMO_LOGIN_PASSWORD: syntheticPassword,
    DEMO_PORT: '0', DEMO_LOGIN_PORT: '0', DEMO_SERVE_ONLY: '1', ...extra }, root);
}
async function listen(server) {
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', () => { server.off('error', reject); resolve(); }); });
  return `http://127.0.0.1:${server.address().port}`;
}
function http(url, method = 'GET', body, headers = {}) {
  return new Promise((resolve, reject) => {
    const encoded = body === undefined ? undefined : JSON.stringify(body);
    const req = request(url, { method, agent: false, headers: { ...(encoded ? { 'content-type': 'application/json' } : {}), ...headers } }, res => {
      const chunks = [];
      res.on('data', data => chunks.push(data));
      res.on('error', reject);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, headers: res.headers, body: JSON.parse(Buffer.concat(chunks).toString('utf8')) }); }
        catch (error) { reject(error); }
      });
    });
    req.on('error', reject);
    req.setTimeout(5000, () => req.destroy(new Error('test_request_timeout')));
    req.end(encoded);
  });
}
async function close(server) {
  await new Promise((resolve, reject) => { server.close(error => error ? reject(error) : resolve()); server.closeIdleConnections(); });
}

test('local configuration generates secrets once and preserves existing application settings', async t => {
  const root = await temporary(t);
  await copyFile(new URL('.env.example', import.meta.url), path.join(root, '.env.example'));
  assert.equal(configure(root).changed, true);
  const first = parseEnv(await readFile(path.join(root, '.env'), 'utf8'));
  assert.equal(first.DEMO_AUTH_SECRET.length, 64);
  assert.equal(first.DEMO_LOGIN_PASSWORD.length, 64);
  assert.equal(first.TANSR_APP_KEY, '');
  assert.equal(first.DEMO_SERVE_ONLY, '1');
  assert.equal(configure(root).changed, false);
  assert.deepEqual(parseEnv(await readFile(path.join(root, '.env'), 'utf8')), first);
  const custom = '# keep this operator setting\nTANSR_APP_KEY_ID=synthetic-id\nTANSR_APP_KEY=synthetic-key\nDEMO_AUTH_SECRET=\nDEMO_LOGIN_PASSWORD=kept-password\n';
  await writeFile(path.join(root, '.env'), custom);
  configure(root);
  const changed = await readFile(path.join(root, '.env'), 'utf8');
  const current = parseEnv(changed);
  assert.ok(changed.startsWith('# keep this operator setting\n'));
  assert.equal(current.TANSR_APP_KEY, 'synthetic-key');
  assert.equal(current.DEMO_LOGIN_PASSWORD, 'kept-password');
  assert.equal(current.DEMO_AUTH_SECRET.length, 64);
  assert.equal(changed.match(/^DEMO_AUTH_SECRET=/gm).length, 1);
  assert.throws(() => configuration(root, { DEMO_SERVE_ONLY: '0' }), /DEMO_SERVE_ONLY/);
  for (const TANSR_API_BASE of ['http://example.com', 'https://example.com/api', 'https://user:pass@example.com', 'https://example.com/?key=test', 'https://example.com/#key']) {
    assert.throws(() => configuration(root, { TANSR_API_BASE }), /TANSR_API_BASE/);
  }
  assert.throws(() => configuration(root, { DEMO_HOST: '0.0.0.0' }), /loopback/);
  assert.throws(() => configuration(root, { DEMO_LOGIN_HOST: '192.168.1.1' }), /loopback/);
});

test('no platform credentials: real TCP health, readiness, login, refresh and authenticated failure', { timeout: 15000 }, async t => {
  const root = await temporary(t);
  const config = configuration(root);
  const login = createDemoLoginService({ secret: config.secret, username: config.username, password: config.password,
    endUserId: config.endUserId, configuration: () => config.status });
  const loginUrl = await listen(login.server);
  let loginClosed = false;
  t.after(async () => { if (!loginClosed) await login.close(); });
  const serve = await startPlatformServe(config);
  let serveClosed = false;
  t.after(async () => { if (!serveClosed) await createDemoShutdown(serve, { drainTimeoutMs: 1000 }).settle(); });
  const serveUrl = `http://127.0.0.1:${serve.port}`;
  assert.equal((await http(`${serveUrl}/healthz`)).status, 200);
  const readiness = await http(`${serveUrl}/readyz`);
  assert.equal(readiness.status, 503);
  assert.equal(readiness.body.ready, false);
  assert.ok(readiness.body.reasons.some(reason => reason.includes('configuration_not_ready') && reason.includes('TANSR_APP_KEY')));
  const state = await http(`${loginUrl}/configuration`);
  assert.equal(state.status, 200);
  assert.deepEqual(state.body, { status: 'ok', configured: false, mode: 'platform', missingConfig: ['TANSR_APP_KEY_ID', 'TANSR_APP_KEY'] });
  assert.equal((await http(`${loginUrl}/login`, 'POST', { username: 'demo', password: 'wrong' })).status, 401);
  assert.equal((await http(`${loginUrl}/login`, 'POST', { username: 'demo', password: syntheticPassword }, { authorization: 'Bearer wrong-domain' })).status, 400);
  const loggedIn = await http(`${loginUrl}/login`, 'POST', { username: 'demo', password: syntheticPassword });
  assert.equal(loggedIn.status, 200);
  assert.equal(loggedIn.body.tokenType, 'Bearer');
  assert.equal(verifyToken(syntheticSecret, loggedIn.body.accessToken), 'u-alice');
  for (const header of [undefined, 'Bearer invalid', `Bearer ${issueToken(syntheticSecret, 'u-alice', 1, Date.now() - 10000)}`]) {
    const reply = await http(`${serveUrl}/api/sessions`, 'POST', {}, header ? { authorization: header } : {});
    assert.equal(reply.status, 401);
  }
  const auth = { authorization: `Bearer ${loggedIn.body.accessToken}` };
  for (const route of ['/api/sessions', '/v2/sessions']) {
    const unavailable = await http(`${serveUrl}${route}`, 'POST', {}, auth);
    assert.equal(unavailable.status, 503);
    if (route.startsWith('/api/')) {
      assert.equal(unavailable.body.contract, 'unified-v1');
      assert.equal(unavailable.body.code, 'upstream_unavailable');
      assert.equal(unavailable.body.status, 503);
    } else assert.equal(unavailable.body.error.code, 'upstream_unavailable');
    assert.ok(!JSON.stringify(unavailable.body).includes(syntheticSecret));
  }
  const refreshed = await http(`${loginUrl}/refresh`, 'POST', { refreshToken: loggedIn.body.refreshToken });
  assert.equal(refreshed.status, 200);
  assert.notEqual(refreshed.body.refreshToken, loggedIn.body.refreshToken);
  assert.equal((await http(`${loginUrl}/refresh`, 'POST', { refreshToken: loggedIn.body.refreshToken })).status, 401);
  await login.close(); loginClosed = true;
  await createDemoShutdown(serve, { drainTimeoutMs: 1000 }).settle(); serveClosed = true;
  await assert.rejects(http(`${loginUrl}/configuration`));
  await assert.rejects(http(`${serveUrl}/healthz`));
});

test('configured assembly reaches the public platform factory through a synthetic loopback upstream only', { timeout: 15000 }, async t => {
  const root = await temporary(t);
  const requests = [];
  const upstream = createServer((req, res) => {
    const chunks = [];
    req.on('data', data => chunks.push(data));
    req.on('end', () => {
      requests.push({ method: req.method, url: req.url, body: JSON.parse(Buffer.concat(chunks).toString('utf8')) });
      // Refuse token minting before any model or bundle operation; this is a synthetic upstream failure.
      res.writeHead(503, { 'content-type': 'application/json', 'retry-after': '1' });
      res.end(JSON.stringify({ error: { code: 'synthetic_unavailable', message: 'Synthetic TCP fixture only.' } }));
    });
  });
  const upstreamUrl = await listen(upstream);
  t.after(() => close(upstream));
  const config = configuration(root, { TANSR_APP_KEY_ID: 'synthetic-id', TANSR_APP_KEY: 'synthetic-key', TANSR_API_BASE: upstreamUrl });
  assert.deepEqual(config.status, { status: 'ok', configured: true, mode: 'platform', missingConfig: [] });
  const serve = await startPlatformServe(config);
  t.after(() => createDemoShutdown(serve, { drainTimeoutMs: 1000 }).settle());
  const url = `http://127.0.0.1:${serve.port}`;
  assert.equal((await http(`${url}/healthz`)).status, 200);
  assert.equal((await http(`${url}/readyz`)).status, 200);
  assert.equal(requests.length, 0, 'startup must not mint tokens or run a smoke prompt');
  const result = await http(`${url}/api/sessions`, 'POST', {}, { authorization: `Bearer ${issueToken(syntheticSecret, 'u-alice')}` });
  assert.equal(result.status, 503);
  assert.equal(result.body.contract, 'unified-v1');
  assert.equal(result.body.code, 'upstream_unavailable');
  assert.equal(requests.length, 1);
  assert.deepEqual(requests[0], { method: 'POST', url: '/v1/app-tokens', body: { endUserId: 'u-alice', ttlSeconds: 3600 } });
});

test('identity routes reject rebinding Host and foreign Origin before issuing or using login tickets', { timeout: 15000 }, async t => {
  const root = await temporary(t);
  const config = configuration(root);
  const login = createDemoLoginService({ secret: config.secret, username: config.username, password: config.password,
    endUserId: config.endUserId, configuration: () => config.status });
  const loginUrl = await listen(login.server);
  t.after(() => login.close());
  const serve = await startPlatformServe(config);
  t.after(() => createDemoShutdown(serve, { drainTimeoutMs: 1000 }).settle());
  const serveUrl = `http://127.0.0.1:${serve.port}`;
  const body = { username: config.username, password: config.password };
  const loggedIn = await http(`${loginUrl}/login`, 'POST', body);
  assert.equal(loggedIn.status, 200, 'Node clients without Origin retain the original login contract');
  assert.equal((await http(`${loginUrl}/login`, 'POST', body, { origin: loginUrl })).status, 200);
  const invalidHeaders = url => {
    const { port } = new URL(url);
    const wrongPort = Number(port) === 65535 ? 65534 : Number(port) + 1;
    return [
      { host: `rebind.example:${port}`, origin: `http://rebind.example:${port}` },
      { host: `rebind.example:${port}` },
      { origin: 'https://foreign.example' },
      { origin: 'null' },
      { origin: `http://127.0.0.1:${wrongPort}` },
      { host: `127.0.0.1:${wrongPort}`, origin: `http://127.0.0.1:${wrongPort}` },
      { origin: `https://127.0.0.1:${port}` },
      { origin: [url, url] },
    ];
  };
  for (const headers of invalidHeaders(loginUrl)) {
    const loginReply = await http(`${loginUrl}/login`, 'POST', body, headers);
    assert.equal(loginReply.status, 403, `login must reject ${JSON.stringify(headers)}`);
    assert.equal(loginReply.body.error.code, 'forbidden');
    assert.equal(loginReply.body.accessToken, undefined);
    const refreshReply = await http(`${loginUrl}/refresh`, 'POST', { refreshToken: loggedIn.body.refreshToken }, headers);
    assert.equal(refreshReply.status, 403);
    assert.equal(refreshReply.body.refreshToken, undefined);
  }
  // Rejected requests do not consume the real refresh credential.
  assert.equal((await http(`${loginUrl}/refresh`, 'POST', { refreshToken: loggedIn.body.refreshToken }, { origin: loginUrl })).status, 200);
  const auth = { authorization: `Bearer ${loggedIn.body.accessToken}` };
  for (const route of ['/api/sessions', '/v2/sessions']) {
    assert.equal((await http(`${serveUrl}${route}`, 'GET', undefined, auth)).status, 200);
    assert.equal((await http(`${serveUrl}${route}`, 'GET', undefined, { ...auth, origin: serveUrl })).status, 200);
    for (const headers of invalidHeaders(serveUrl)) {
      for (const method of ['GET', 'POST']) {
        const result = await http(`${serveUrl}${route}`, method, method === 'POST' ? {} : undefined, { ...auth, ...headers });
        assert.equal(result.status, 401, `authenticated ${method} ${route} must reject ${JSON.stringify(headers)}`);
        if (route.startsWith('/api/')) {
          assert.equal(result.body.contract, 'unified-v1');
          assert.equal(result.body.code, 'unauthorized');
        } else assert.equal(result.body.error.code, 'unauthorized');
      }
    }
  }
});

test('local configuration refuses duplicate or ambiguous assignments without changing any bytes', async t => {
  const root = await temporary(t);
  const file = path.join(root, '.env');
  const fixtures = [
    `DEMO_AUTH_SECRET=${syntheticSecret}\nDEMO_AUTH_SECRET=\nDEMO_LOGIN_PASSWORD=\n`,
    `DEMO_AUTH_SECRET=\nexport DEMO_AUTH_SECRET=${syntheticSecret}\nDEMO_LOGIN_PASSWORD=\n`,
    `DEMO_AUTH_SECRET=${syntheticSecret}\nDEMO_LOGIN_PASSWORD=kept\n  export DEMO_LOGIN_PASSWORD=\n`,
    `TANSR_APP_KEY=synthetic-existing\nTANSR_APP_KEY=\nDEMO_AUTH_SECRET=\nDEMO_LOGIN_PASSWORD=\n`,
    'DEMO_AUTH_SECRET="unterminated\nDEMO_LOGIN_PASSWORD=\n',
    'DEMO_AUTH_SECRET="" trailing-data\nDEMO_LOGIN_PASSWORD=\n',
    'DEMO_AUTH_SECRET="" "second-value"\nDEMO_LOGIN_PASSWORD=\n',
  ];
  for (const text of fixtures) {
    const original = Buffer.from(text);
    await writeFile(file, original);
    assert.throws(() => configure(root), /configuration_not_ready/);
    assert.deepEqual(await readFile(file), original, 'rejection must preserve the complete file byte-for-byte');
  }
});

test('local configuration reports short existing secrets as non-ready and never rotates them', async t => {
  const root = await temporary(t);
  const file = path.join(root, '.env');
  for (const secret of ['short-secret', 'REPLACE_WITH_SECRET', 'REPLACE_' + 'x'.repeat(40)]) {
    const original = Buffer.from(`# preserve CRLF\r\nDEMO_AUTH_SECRET=${secret}\r\nDEMO_LOGIN_PASSWORD=\r\n`);
    await writeFile(file, original);
    assert.throws(() => configure(root), /configuration_not_ready: DEMO_AUTH_SECRET/);
    assert.deepEqual(await readFile(file), original);
  }
  // Verify the actual configure CLI status/output rather than only the function result.
  await copyFile(new URL('./configure.mjs', import.meta.url), path.join(root, 'configure.mjs'));
  const original = Buffer.from('DEMO_AUTH_SECRET=short-secret\nDEMO_LOGIN_PASSWORD=\n');
  await writeFile(file, original);
  const child = spawnSync(process.execPath, [path.join(root, 'configure.mjs')], { encoding: 'utf8', timeout: 5000 });
  assert.equal(child.error, undefined);
  assert.equal(child.status, 1);
  assert.match(child.stderr, /configuration_not_ready: DEMO_AUTH_SECRET/);
  assert.doesNotMatch(child.stdout, /ready/i);
  assert.doesNotMatch(child.stderr, /short-secret/);
  assert.deepEqual(await readFile(file), original);
  // A unique, valid quoted/exported setting is preserved while only an empty password is filled.
  await writeFile(file, `# preserve\r\nexport DEMO_AUTH_SECRET="${syntheticSecret}" # existing\r\nDEMO_LOGIN_PASSWORD='' # fill\r\n`);
  configure(root);
  const after = await readFile(file, 'utf8');
  assert.ok(after.includes(`export DEMO_AUTH_SECRET="${syntheticSecret}" # existing\r\n`));
  assert.equal(parseEnv(after).DEMO_AUTH_SECRET, syntheticSecret);
  assert.equal(parseEnv(after).DEMO_LOGIN_PASSWORD.length, 64);
});
