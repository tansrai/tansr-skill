// @ts-check
import { access } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { inspectConfiguration, configurationFailure } from './configure-project.mjs';

/** @param {string} path */
async function exists(path) { try { await access(path); return true; } catch { return false; } }

/** 检查文件与配置状态，不返回凭据或文件原文、不请求平台。 @param {string} project @param {string} [expectedMode] */
export async function inspectProject(project, expectedMode) {
  const configuration = await inspectConfiguration(project, expectedMode);
  const root = resolve(project);
  const [major, minor] = process.versions.node.split('.').map(Number);
  const nodeSupported = major > 22 || (major === 22 && minor >= 19);
  return {
    node: process.versions.node, nodeSupported, ...configuration,
    dependenciesInstalled: await exists(join(root, 'node_modules', '@tansr', 'sdk', 'package.json')),
    lockfilePresent: await exists(join(root, 'package-lock.json')),
    scope: '仅本工程文件与配置状态；不反映进程环境覆盖，不证明网络、账号授权、模型调用或完整功能通过。',
    next: nodeSupported ? configuration.next : '使用满足正式包要求的 Node.js 版本，再检查本工程配置。',
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const args = process.argv.slice(2);
    if (![2, 4].includes(args.length) || args[0] !== '--project' || args.length === 4 && args[2] !== '--mode') {
      console.error(JSON.stringify({ status: 'refused', code: 'arguments', next: '用法：node scripts/doctor.mjs --project <工程绝对路径> [--mode offline|platform|managed]' }));
      process.exitCode = 1;
    } else console.log(JSON.stringify(await inspectProject(args[1], args[3]), null, 2));
  } catch (error) { console.error(JSON.stringify(configurationFailure(error))); process.exitCode = 1; }
}
