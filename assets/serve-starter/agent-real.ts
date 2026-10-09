import { readConfiguration } from './configuration.js';
import { startPlatformServe } from './server.js';
import { createDemoShutdown } from './shutdown.js';

const config = readConfiguration();
const server = await startPlatformServe(config);
console.log(`[serve] ${server.url}; configured=${config.status.configured}`);
if (!config.status.configured) console.log(`[serve] configuration_not_ready: ${config.status.missingConfig.join(', ')}; see the login service /configuration`);
const shutdown = createDemoShutdown(server, { drainTimeoutMs: 30_000 });
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => {
  void shutdown.settle().catch(() => { console.error('[serve] shutdown_failed'); process.exitCode = 1; });
});
