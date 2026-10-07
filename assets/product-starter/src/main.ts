import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { loadConfig } from './config.ts';
import { safeError } from './errors.ts';
import { createProductServer } from './server.ts';

// Both dev and built entry points read configuration from the product project.
const built = import.meta.url.endsWith('/dist/src/main.js');
const root = resolve(dirname(fileURLToPath(import.meta.url)), built ? '../..' : '..');
try {
  const config = await loadConfig(root, process.env);
  if (built) config.publicDir = resolve(root, 'dist/public');
  const app = await createProductServer(config);
  const origin = await app.listen();
  console.log(`${config.product.name}: ${origin} (${config.mode === 'offline' ? '离线 SDK 验证，未调用模型' : '平台模式'})`);
  let stopping = false;
  const stop = () => {
    if (stopping) return;
    stopping = true;
    console.log('正在等待任务、连接和存储关闭。');
    void app.close().then(() => { process.exitCode = 0; }).catch(() => {
      console.error('资源收尾未完成；服务保留资源句柄与数据锁。请检查数据和进程，不要另起同目录实例。');
      process.exitCode = 1;
      stopping = false;
    });
  };
  process.on('SIGINT', stop); process.on('SIGTERM', stop);
} catch (error) {
  console.error(safeError(error).message);
  process.exitCode = 1;
}
