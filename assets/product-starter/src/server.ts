import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import type { RuntimeConfig } from './config.ts';
import { configuration, owner } from './config.ts';
import { ProductError, safeError } from './errors.ts';
import { LocalStore } from './store.ts';
import { RunManager } from './runs.ts';
import { createSourceFactory } from './source.ts';
import type { SourceFactory } from './source.ts';

function json(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(body));
}
async function readJson(request: IncomingMessage): Promise<unknown> {
  if (!/^application\/json(?:\s*;.*)?$/i.test(request.headers['content-type'] ?? '')) throw new ProductError('content_type', '写操作必须使用 application/json。', 415);
  if (request.headers['content-encoding']) throw new ProductError('content_encoding', '不支持压缩请求体。', 415);
  if (Number(request.headers['content-length'] ?? 0) > 32768) throw new ProductError('body_too_large', '请求体不能超过 32 KiB。', 413);
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    size += Buffer.byteLength(chunk as Buffer);
    if (size > 32768) throw new ProductError('body_too_large', '请求体不能超过 32 KiB。', 413);
    chunks.push(Buffer.from(chunk as Buffer));
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new ProductError('invalid_json', '请求体不是有效 JSON。'); }
}

export async function createProductServer(config: RuntimeConfig, sourceFor?: SourceFactory) {
  const store = new LocalStore(config.dataDir);
  await store.open();
  const runs = new RunManager(store, config, sourceFor ?? createSourceFactory(config));
  let origin = '';
  let stopping = false;
  let activeRequests = 0;
  const eventClients = new Set<ServerResponse>();
  const server = createServer((request, response) => {
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    void handle(request, response).catch(error => {
      if (!response.headersSent) json(response, error instanceof ProductError ? error.status : 500, { error: safeError(error) });
      else response.end();
    });
  });
  server.requestTimeout = 15_000;
  server.headersTimeout = 10_000;
  server.keepAliveTimeout = 2000;
  server.maxConnections = 32;
  async function handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    if (request.headers.host !== origin.slice('http://'.length)) throw new ProductError('host_rejected', '仅接受当前 127.0.0.1 地址。', 403);
    if (request.headers['sec-fetch-site'] === 'cross-site') throw new ProductError('origin_rejected', '拒绝跨站请求。', 403);
    if (request.headers.origin && request.headers.origin !== origin) throw new ProductError('origin_rejected', '请求来源不匹配。', 403);
    const method = request.method ?? 'GET';
    if (!['GET', 'HEAD'].includes(method) && request.headers.origin !== origin) throw new ProductError('origin_required', '写操作必须来自本机工作台同源页面。', 403);
    if (stopping) throw new ProductError('shutting_down', '服务正在停止。', 503);
    const url = new URL(request.url ?? '/', origin);
    const path = url.pathname;
    if (method === 'GET' && path === '/api/state') {
      const state = store.snapshot();
      json(response, 200, {
        product: { name: config.product.name, description: config.product.description, domain: config.product.domain, mode: config.mode, owner, configuration: configuration(config) },
        revision: state.revision, records: state.records, runs: runs.snapshot(), activeRunId: runs.activeRunId,
      });
      return;
    }
    if (method === 'GET' && /^\/api\/runs\/[^/]+\/events$/.test(path)) {
      if (eventClients.size >= 8) throw new ProductError('stream_limit', '事件连接过多，请关闭多余页面。', 429);
      const id = path.split('/')[3];
      runs.getRun(id);
      const rawAfter = request.headers['last-event-id'] ?? url.searchParams.get('after') ?? '0';
      const after = Number(rawAfter);
      if (!Number.isSafeInteger(after) || after < 0) throw new ProductError('invalid_cursor', '事件游标无效。');
      response.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
      response.write('retry: 1500\n\n');
      eventClients.add(response);
      let done = false;
      const unsubscribe = runs.subscribe(id, after, event => {
        if (response.destroyed || done) return;
        if (response.writableLength > 512_000) { response.destroy(); return; }
        response.write(`id: ${event.id}\ndata: ${JSON.stringify(event)}\n\n`);
        if (event.type === 'done') { done = true; response.end(); }
      });
      const heartbeat = setInterval(() => { if (!done) response.write(': heartbeat\n\n'); }, 15_000);
      heartbeat.unref();
      const release = () => { clearInterval(heartbeat); unsubscribe(); eventClients.delete(response); };
      response.once('close', release);
      if (done) release();
      return;
    }
    const recordMatch = /^\/api\/records\/([^/]+)$/.exec(path);
    const cancelMatch = /^\/api\/runs\/([^/]+)\/cancel$/.exec(path);
    if (method !== 'GET' && method !== 'HEAD') {
      if (activeRequests >= 16) throw new ProductError('request_limit', '正在处理的请求过多，请稍后重试。', 429);
      activeRequests++;
      try {
        if (method === 'POST' && path === '/api/records') {
          json(response, 201, { record: await store.add(await readJson(request)) }); return;
        }
        if (method === 'PATCH' && recordMatch) {
          json(response, 200, { record: await store.patch(recordMatch[1], await readJson(request)) }); return;
        }
        if (method === 'DELETE' && recordMatch) {
          await runs.deleteRecord(recordMatch[1]);
          json(response, 200, { deleted: true }); return;
        }
        if (method === 'POST' && path === '/api/runs') {
          json(response, 202, { run: await runs.start(await readJson(request)) }); return;
        }
        if (method === 'POST' && cancelMatch) {
          await readJson(request);
          json(response, 200, { run: await runs.cancel(cancelMatch[1]) }); return;
        }
      } finally { activeRequests--; }
    }
    // Explicit public-file allowlist prevents .env, source and business data exposure.
    const files: Record<string, { name: string; type: string }> = {
      '/': { name: 'index.html', type: 'text/html; charset=utf-8' },
      '/index.html': { name: 'index.html', type: 'text/html; charset=utf-8' },
      '/app.js': { name: 'app.js', type: 'text/javascript; charset=utf-8' },
      '/styles.css': { name: 'styles.css', type: 'text/css; charset=utf-8' },
    };
    if ((method === 'GET' || method === 'HEAD') && files[path]) {
      const file = files[path];
      let body: Buffer;
      try { body = await readFile(join(config.publicDir, file.name)); }
      catch { throw new ProductError('asset_missing', '界面文件未构建，请运行 npm run build 或检查 public 目录。', 503); }
      response.writeHead(200, { 'Content-Type': file.type });
      response.end(method === 'HEAD' ? undefined : body); return;
    }
    throw new ProductError('not_found', '接口或资源不存在。', 404);
  }
  return {
    store, runs,
    async listen(port = config.port): Promise<string> {
      try {
        await new Promise<void>((resolve, reject) => {
          server.once('error', reject);
          server.listen(port, '127.0.0.1', () => { server.off('error', reject); resolve(); });
        });
      } catch (error) { await store.close(); throw error; }
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('No local address');
      origin = `http://127.0.0.1:${address.port}`;
      return origin;
    },
    async close(): Promise<void> {
      stopping = true;
      while (activeRequests) await delay(10);
      await runs.close();
      for (const response of eventClients) response.end();
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
      await store.close();
    },
  };
}
