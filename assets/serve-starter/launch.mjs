// Derived from the official standalone launcher. Startup uses the existing lock; no automatic update or smoke run.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseEnv } from 'node:util';

const root = path.dirname(fileURLToPath(import.meta.url));
const entries = { start: 'agent-real.ts', login: 'login-server.ts' };
const entry = entries[process.argv[2] ?? 'start'];
if (!entry) throw new Error('Usage: node launch.mjs start|login');
const file = path.join(root, '.env');
if (!fs.existsSync(file)) throw new Error('Missing local .env; run npm run configure first.');
const managed = name => /^(?:TANSR_|DEMO_)/.test(name) || name === 'TOKEN_TTL_SECONDS' || name === 'PORT';
const local = parseEnv(fs.readFileSync(file, 'utf8'));
for (const name of Object.keys(process.env)) if (managed(name)) delete process.env[name];
for (const [name, value] of Object.entries(local)) if (managed(name)) process.env[name] = value;
process.env.DEMO_SERVE_ONLY ??= '1';
process.chdir(root);
process.argv = [process.execPath, path.join(root, entry)];
const { register } = await import('tsx/esm/api');
register({ tsconfig: path.join(root, 'tsconfig.json') });
await import(pathToFileURL(path.join(root, entry)).href);
