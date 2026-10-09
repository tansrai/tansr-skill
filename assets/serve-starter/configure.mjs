// Local secret preparation only; never accesses the platform or prints credentials.
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';

function inspectAssignments(text) {
  const parts = text.split(/(\r\n|\n|\r)/);
  const entries = new Map();
  if (text.includes('\0')) throw new Error('configuration_not_ready: ambiguous .env syntax; file preserved');
  for (let index = 0; index < parts.length; index += 2) {
    const line = parts[index].replace(/^\uFEFF/, '');
    if (!line.trim() || line.trimStart().startsWith('#')) continue;
    const match = /^[ \t]*(?:export[ \t]+)?([A-Za-z_][A-Za-z0-9_]*)[ \t]*=(.*)$/.exec(line);
    if (!match) throw new Error('configuration_not_ready: ambiguous .env syntax; file preserved');
    const [, name, value] = match;
    if (entries.has(name)) throw new Error(`configuration_not_ready: duplicate ${name}; file preserved`);
    const rhs = value.trimStart();
    if (['"', "'", '`'].includes(rhs[0])) {
      const end = rhs.indexOf(rhs[0], 1);
      if (end < 0 || !/^[ \t]*(?:#.*)?$/.test(rhs.slice(end + 1))) {
        throw new Error(`configuration_not_ready: ambiguous ${name}; use one complete assignment per line; file preserved`);
      }
    }
    const parsed = parseEnv(line);
    if (Object.keys(parsed).length !== 1 || !Object.hasOwn(parsed, name)) {
      throw new Error(`configuration_not_ready: ambiguous ${name}; file preserved`);
    }
    entries.set(name, { index });
  }
  return { parts, entries };
}

export function configure(root = path.dirname(fileURLToPath(import.meta.url))) {
  const file = path.join(root, '.env');
  const existed = fs.existsSync(file);
  let text = fs.readFileSync(existed ? file : path.join(root, '.env.example'), 'utf8');
  // Validate the entire existing file before generating or writing any value. parseEnv alone uses last-wins duplicates.
  const { parts, entries } = inspectAssignments(text);
  const local = parseEnv(text);
  const secret = local.DEMO_AUTH_SECRET?.trim();
  if (secret && (secret.length < 32 || /^REPLACE_/i.test(secret) || secret === 'demo-secret-change-me')) {
    throw new Error('configuration_not_ready: DEMO_AUTH_SECRET must be an existing valid secret of at least 32 characters; file preserved');
  }
  if (/^REPLACE_/i.test(local.DEMO_LOGIN_PASSWORD?.trim() ?? '')) {
    throw new Error('configuration_not_ready: DEMO_LOGIN_PASSWORD contains a placeholder; file preserved');
  }
  const additions = [];
  let changed = false;
  for (const name of ['DEMO_AUTH_SECRET', 'DEMO_LOGIN_PASSWORD']) {
    if (local[name]?.trim()) continue;
    const value = randomBytes(32).toString('hex');
    const entry = entries.get(name);
    if (entry) {
      const line = parts[entry.index];
      const equal = line.indexOf('=');
      const comment = line.slice(equal + 1).match(/#.*$/)?.[0];
      parts[entry.index] = `${line.slice(0, equal + 1)}${value}${comment ? ` ${comment}` : ''}`;
    } else additions.push(`${name}=${value}`);
    changed = true;
  }
  text = parts.join('');
  const newline = text.includes('\r\n') ? '\r\n' : '\n';
  for (const line of additions) text += `${text && !/[\r\n]$/.test(text) ? newline : ''}${line}${newline}`;
  if (changed || !existed) fs.writeFileSync(file, text, { mode: 0o600, flag: existed ? 'w' : 'wx' });
  fs.chmodSync(file, 0o600);
  return { changed };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    configure();
    console.log('Local authentication configuration is ready. Existing application credentials are preserved; secrets are not displayed.');
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'configuration_not_ready');
    process.exitCode = 1;
  }
}
