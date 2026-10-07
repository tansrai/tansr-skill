import { mkdir, open, readFile, rename, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { ProductError } from './errors.ts';
import type { Database, BusinessRecord, Run } from './types.ts';
import { terminal } from './types.ts';

const initial = (): Database => ({ version: 1, revision: 0, records: [], runs: [], requests: {} });
const isObject = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
export function requireObject(value: unknown): Record<string, unknown> {
  if (!isObject(value)) throw new ProductError('invalid_input', '请求必须是 JSON 对象。');
  return value;
}
function stringField(value: unknown, max: number, label: string, optional = false): string {
  if (optional && value === undefined) return '';
  if (typeof value !== 'string' || (!optional && !value.trim()) || value.trim().length > max) {
    throw new ProductError('invalid_input', `${label}必须是${optional ? '不超过' : '非空且不超过'} ${max} 字符的文本。`);
  }
  return value.trim();
}
export function recordFields(input: Record<string, unknown>): Pick<BusinessRecord, 'title' | 'content' | 'source' | 'status'> {
  const status = input.status ?? 'new';
  if (!['new', 'reviewed', 'resolved'].includes(String(status))) throw new ProductError('invalid_input', '记录状态无效。');
  return { title: stringField(input.title, 160, '标题'), content: stringField(input.content, 6000, '正文'), source: stringField(input.source, 200, '来源', true), status: status as BusinessRecord['status'] };
}
function validateDatabase(value: unknown): Database {
  const db = requireObject(value);
  if (db.version !== 1 || !Number.isSafeInteger(db.revision) || !Array.isArray(db.records) || !Array.isArray(db.runs) || !isObject(db.requests)) throw new Error('Unsupported database');
  if (db.records.length > 1000 || db.runs.length > 1000) throw new Error('Database limits');
  const ids = new Set<string>();
  for (const row of db.records) {
    const r = requireObject(row); recordFields(r);
    if (typeof r.id !== 'string' || ids.has(r.id) || typeof r.createdAt !== 'string' || typeof r.updatedAt !== 'string') throw new Error('Invalid record');
    ids.add(r.id);
  }
  const runIds = new Set<string>();
  for (const run of db.runs) {
    const r = requireObject(run);
    if (typeof r.id !== 'string' || runIds.has(r.id) || !['running', 'cancelling', 'completed', 'failed', 'cancelled', 'interrupted'].includes(String(r.status)) || !['offline', 'platform'].includes(String(r.mode)) || !Array.isArray(r.recordIds) || !Array.isArray(r.inputRecords) || typeof r.createdAt !== 'string') throw new Error('Invalid run');
    runIds.add(r.id);
    for (const row of r.inputRecords) recordFields(requireObject(row));
    if (r.result !== undefined && (!isObject(r.result) || typeof r.result.text !== 'string' || !Array.isArray(r.result.readIds) || !Number.isSafeInteger(r.result.toolCalls))) throw new Error('Invalid result');
    if (r.error !== undefined && (!isObject(r.error) || typeof r.error.code !== 'string' || typeof r.error.message !== 'string')) throw new Error('Invalid error');
  }
  if (Object.values(db.requests).some(value => typeof value !== 'string')) throw new Error('Invalid requests');
  return value as Database;
}

export class LocalStore {
  readonly dir: string;
  #state: Database = initial();
  #tail: Promise<unknown> = Promise.resolve();
  #lockToken = randomUUID();
  #closed = false;
  #locked = false;
  constructor(dir: string) { this.dir = dir; }

  async open(): Promise<void> {
    await mkdir(this.dir, { recursive: true, mode: 0o700 });
    const lockPath = join(this.dir, '.owner.lock');
    // Lock recovery is deliberately explicit. Never infer that an unknown lock is safe to delete.
    try {
      const lock = await open(lockPath, 'wx', 0o600);
      this.#locked = true;
      try { await lock.writeFile(JSON.stringify({ pid: process.pid, token: this.#lockToken })); }
      finally { await lock.close(); }
    } catch (error) {
      if (isObject(error) && error.code === 'EEXIST') throw new ProductError('store_locked', '数据目录已被占用或上次异常退出留下锁。确认没有使用该目录的服务后，按 README 恢复锁文件。', 503);
      throw error;
    }
    try {
      try { this.#state = validateDatabase(JSON.parse(await readFile(join(this.dir, 'state.json'), 'utf8'))); }
      catch (error) {
        if (!(isObject(error) && error.code === 'ENOENT')) throw new ProductError('store_corrupt', '存储文件损坏或版本不兼容；原文件已保留，请备份并按 README 恢复。', 503);
      }
      if (this.#state.runs.some(run => !terminal(run.status))) await this.update(db => {
        for (const run of db.runs) if (!terminal(run.status)) {
          run.status = 'interrupted'; run.finishedAt = new Date().toISOString();
          run.error = { code: 'process_interrupted', message: '上次服务意外停止；不会自动重放业务或模型调用，请核对后新建分析。' };
        }
      });
    } catch (error) { await this.close(); throw error; }
  }
  snapshot(): Database { return structuredClone(this.#state); }

  async update<T>(mutate: (db: Database) => T): Promise<T> {
    if (this.#closed) throw new ProductError('store_closed', '存储正在关闭。', 503);
    const operation = this.#tail.then(async () => {
      const next = structuredClone(this.#state);
      const result = mutate(next);
      next.revision++;
      const temp = join(this.dir, `state-${randomUUID()}.tmp`);
      try {
        const file = await open(temp, 'wx', 0o600);
        try { await file.writeFile(JSON.stringify(next, null, 2)); await file.sync(); }
        finally { await file.close(); }
        await rename(temp, join(this.dir, 'state.json'));
        this.#state = next;
      } catch {
        await unlink(temp).catch(() => {});
        throw new ProductError('storage_failed', '写入本地数据失败，未确认保存。请保留数据目录并检查磁盘空间和权限。', 503);
      }
      return structuredClone(result);
    });
    this.#tail = operation.catch(() => {});
    return operation;
  }
  async add(input: unknown): Promise<BusinessRecord> {
    const data = requireObject(input);
    const fields = recordFields(data);
    const requestId = data.clientRequestId;
    if (requestId !== undefined && (typeof requestId !== 'string' || !/^[a-zA-Z0-9_-]{8,100}$/.test(requestId))) throw new ProductError('invalid_input', 'clientRequestId 必须是 8–100 位字母、数字、下划线或连字符。');
    return this.update(db => {
      if (typeof requestId === 'string' && Object.hasOwn(db.requests, requestId)) {
        const old = db.records.find(row => row.id === db.requests[requestId]);
        if (!old || old.title !== fields.title || old.content !== fields.content || old.source !== fields.source) throw new ProductError('request_conflict', '此请求编号已使用且记录已修改或删除，请检查后使用新编号。', 409);
        return old;
      }
      if (db.records.length >= 1000 || Object.keys(db.requests).length >= 10000) throw new ProductError('record_limit', '本机基础工程已达记录或请求上限，请备份后整理数据。', 409);
      const now = new Date().toISOString();
      const row = { id: randomUUID(), ...fields, createdAt: now, updatedAt: now };
      db.records.push(row);
      if (typeof requestId === 'string') db.requests[requestId] = row.id;
      return row;
    });
  }
  async patch(id: string, input: unknown): Promise<BusinessRecord> {
    const data = requireObject(input);
    if (!Object.keys(data).length || Object.keys(data).some(key => !['title', 'content', 'source', 'status'].includes(key))) throw new ProductError('invalid_input', '只可修改标题、正文、来源和状态。');
    return this.update(db => {
      const row = db.records.find(row => row.id === id);
      if (!row) throw new ProductError('not_found', '记录不存在。', 404);
      Object.assign(row, recordFields({ ...row, ...data }), { updatedAt: new Date().toISOString() });
      return row;
    });
  }
  async delete(id: string): Promise<void> {
    await this.update(db => {
      if (!db.records.some(row => row.id === id)) throw new ProductError('not_found', '记录不存在。', 404);
      db.records = db.records.filter(row => row.id !== id);
      // Deletion removes copies in historical inputs/results as well; a report may quote this record.
      db.runs = db.runs.filter(run => !run.recordIds.includes(id));
    });
  }
  async saveRun(run: Run): Promise<void> {
    await this.update(db => {
      const index = db.runs.findIndex(item => item.id === run.id);
      if (index < 0) {
        if (db.runs.length >= 1000) throw new ProductError('run_limit', '分析历史已达 1000 条，请备份后清理数据目录。', 409);
        db.runs.push(run);
      } else db.runs[index] = run;
    });
  }
  async close(): Promise<void> {
    this.#closed = true; await this.#tail;
    if (this.#locked) {
      const path = join(this.dir, '.owner.lock');
      const lock = JSON.parse(await readFile(path, 'utf8')) as { token: string };
      if (lock.token === this.#lockToken) await unlink(path);
      this.#locked = false;
    }
  }
}
