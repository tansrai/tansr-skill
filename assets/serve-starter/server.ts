import { randomBytes } from 'node:crypto';
import { AgentSessionCreateError, createAgentSessionFactory, createServeAgentSessionStore, registerBuiltinLocales, startServer } from '@tansr/serve';
import { bearerOf, verifyToken } from './auth.js';
import { isLocalServiceRequest } from './local-request.js';
import type { StarterConfiguration } from './configuration.js';

/** The platform assembly, auth protocol, HTTP routing and storage remain public Serve responsibilities. */
export async function startPlatformServe(config: StarterConfiguration) {
  registerBuiltinLocales();
  const store = createServeAgentSessionStore({ dir: config.storeDir });
  const build = config.status.configured ? createAgentSessionFactory({
    platform: { apiBaseUrl: config.apiBaseUrl, appId: config.appId, appKey: config.appKey, ttlSeconds: 3600 },
    store, cwd: config.cwd,
  }) : undefined;
  return startServer({
    host: config.host, port: config.port, token: randomBytes(32).toString('hex'),
    version: 'tansr-serve-starter/0.1.1',
    createSession: { create() { throw new Error('Only the authenticated multi-session API is enabled.'); } },
    observability: { readinessProbes: [() => config.status.configured ? true : {
      ready: false, reason: `configuration_not_ready: ${config.status.missingConfig.join(', ')}`,
    }] },
    v2: {
      authenticate(req) {
        if (!isLocalServiceRequest(req)) return null;
        const token = bearerOf(req.headers.authorization);
        const endUserId = token ? verifyToken(config.secret, token) : null;
        return endUserId ? { endUserId } : null;
      },
      createSession: build?.factory ?? { create() {
        throw new AgentSessionCreateError('upstream_unavailable', `configuration_not_ready: ${config.status.missingConfig.join(', ')}`);
      } },
      ...(build?.storeReader ? { store: build.storeReader } : {}),
    },
  });
}
