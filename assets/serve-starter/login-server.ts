import { readConfiguration } from './configuration.js';
import { createDemoLoginService } from './developer-login.js';

const config = readConfiguration();
const service = createDemoLoginService({
  secret: config.secret, username: config.username, password: config.password, endUserId: config.endUserId,
  configuration: () => config.status,
});
await new Promise<void>((resolve, reject) => {
  service.server.once('error', reject);
  service.server.listen(config.loginPort, config.loginHost, () => { service.server.off('error', reject); resolve(); });
});
const address = service.server.address();
console.log(`[login] ${config.loginHost}:${typeof address === 'object' && address ? address.port : config.loginPort}; /login /refresh /configuration`);
let closing = false;
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => {
  if (closing) return;
  closing = true;
  void service.close().catch(() => { console.error('[login] shutdown_failed'); process.exitCode = 1; });
});
