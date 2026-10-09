import { existsSync, readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { fileURLToPath } from 'node:url';
import { readConfig, startTokenServer } from './server.mjs';

process.chdir(fileURLToPath(new URL('.', import.meta.url)));
const envFile = new URL('.env', import.meta.url);
if (existsSync(envFile)) {
  const config = parseEnv(readFileSync(envFile, 'utf8'));
  for (const key of ['TANSR_APP_KEY_ID', 'TANSR_APP_KEY', 'TANSR_API_BASE', 'HOST', 'PORT', 'TOKEN_TTL_SECONDS']) {
    if (config[key]?.trim()) process.env[key] = config[key]; else delete process.env[key];
  }
}
if (process.argv.includes('--check-config')) {
  console.log(JSON.stringify({ ...readConfig().readiness, envFile: fileURLToPath(envFile) }));
} else {
  const service = await startTokenServer();
  console.log(JSON.stringify({ event: 'listening', url: service.url, ...service.readiness }));
  let stopping = false;
  const stop = async () => {
    if (stopping) return;
    stopping = true;
    try { await service.close(); } catch { process.exitCode = 1; }
  };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
}
