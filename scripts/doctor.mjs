// @ts-check
import { readFile, access } from 'node:fs/promises';
import { resolve, join, isAbsolute } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseEnv } from 'node:util';

/** @param {string} path */
async function exists(path) { try { await access(path); return true; } catch { return false; } }

/** 检查文件与配置名，不显示凭据值、不请求平台。 @param {string} project */
export async function inspectProject(project) {
  if (!isAbsolute(project)) throw new Error('project 必须为工程绝对路径。');
  const root = resolve(project);
  const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
  const [major, minor] = process.versions.node.split('.').map(Number);
  const nodeSupported = major > 22 || (major === 22 && minor >= 19);
  let envText = '';
  try { envText = await readFile(join(root, '.env'), 'utf8'); }
  catch (error) { if (/** @type {NodeJS.ErrnoException} */ (error).code !== 'ENOENT') throw error; }
  // 与 Node --env-file 使用同一格式语义，但不修改当前进程环境。
  const configured = new Map(Object.entries(parseEnv(envText)));
  const isWeb = await exists(join(root, 'product.config.json'));
  const mode = isWeb ? configured.get('TANSR_MODE') ?? 'offline' : 'managed';
  if (isWeb && !['offline', 'platform'].includes(mode)) throw new Error('TANSR_MODE 只支持 offline 或 platform；请更正配置，不会自动回落。');
  const required = mode === 'platform' ? ['TANSR_APP_ID', 'TANSR_APP_KEY'] : mode === 'managed' ? ['MODEL_API_KEY'] : [];
  const missing = required.filter(key => !configured.get(key) || /^REPLACE_|^YOUR_/.test(configured.get(key) ?? ''));
  const dependenciesInstalled = await exists(join(root, 'node_modules', '@tansr', 'sdk', 'package.json'));
  return { project: root, package: pkg.name, node: process.versions.node, nodeSupported, mode, dependenciesInstalled, lockfilePresent: await exists(join(root, 'package-lock.json')), environmentFilePresent: Boolean(envText), missingConfigurationNames: missing, scope: '文件/环境静态检查，不证明网络、账号授权、模型调用或完整功能通过。进程环境变量应在实际启动时核验。', next: !nodeSupported ? '使用满足正式包要求的 Node.js 版本。' : !dependenciesInstalled ? '在工程目录按锁文件安装依赖。' : missing.length ? '在本机安全配置所列变量，勿发到聊天。' : '运行工程测试并启动；真实平台验证按 README 完成。' };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    if (process.argv.length !== 4 || process.argv[2] !== '--project') throw new Error('用法：node scripts/doctor.mjs --project <工程绝对路径>');
    console.log(JSON.stringify(await inspectProject(process.argv[3]), null, 2));
  } catch (error) { console.error(error instanceof Error ? error.message : '检查失败。'); process.exitCode = 1; }
}
