# Local Token Server starter

Adapted from the official Token Server 0.1.1 inside the published Electron ZIP.
See SOURCE.json and LICENSE. The original npm dependency lock is preserved.
Requires Node.js >=22.19; this starter is a local companion backend, not a public user service.

## Start and configure

1. Run `npm ci` in this backend directory.
2. Copy `.env.example` to this directory's `.env` if it does not already exist.
3. Run `npm start`. The server binds only loopback; the default is http://127.0.0.1:8788.
4. Fill `TANSR_APP_KEY_ID` and `TANSR_APP_KEY` in this **backend** .env, then restart.
   Keep these values out of desktop/mobile bundles, renderer code and logs.

The backend starts without platform credentials. This is a real HTTP service with the
original local login contract, but it cannot mint a platform token until configured.
It never creates a fake token and never switches a platform request to offline output.
Configuration presence does not prove valid credentials, a wallet or model access.

`GET /healthz` returns HTTP 200 with
`{status:"ok",mode:"platform",configured:false,missingConfig:[...]}` when credentials
are absent. `GET /readyz` returns 503 until configuration is present.
Only field names are exposed. `node launch.mjs --check-config` checks local settings
without starting the HTTP server or printing secrets.

The launcher reads .env relative to its own directory, independent of the calling
directory. When .env exists, its supported fields replace inherited values, including
blank values. Without .env, the same variables may be supplied as process parameters.
No startup script updates dependencies. Use Ctrl+C to stop; the launcher also handles SIGTERM.

| Setting | Default |
| --- | --- |
| TANSR_APP_KEY_ID / TANSR_APP_KEY | Empty; configuration not ready |
| TANSR_API_BASE | https://api.tansr.com |
| HOST | 127.0.0.1; this local starter accepts only loopback |
| PORT | 8788; 0 selects an available local test port |
| TOKEN_TTL_SECONDS | 3600; valid range 60–86400 |

## Connect the desktop client

The original authentication contract is unchanged:

1. POST /api/login with JSON `{"username":"alice","password":"alice123"}`.
   It returns `{sessionId,endUserId}`; bob/bob123 is the other official demo account.
2. POST /api/token with the `x-demo-session` header. It returns only
   `{token,expiresAt}`; expiresAt is the upstream ISO date string.
3. Keep the login session and platform short token in desktop **main-process memory**.
   Refresh through the same authenticated endpoint before expiry; pass the current
   token synchronously to the public SDK. The renderer must not receive an App Key.
4. Use the actual platform gateway as SDK baseUrl, not this Token Server URL.

Requests must use the loopback Host and port of this server. Browser Origin, when present, must belong to this local service; foreign or null origins are rejected before login or token exchange. Native/Electron main-process requests without Origin remain supported.

An unauthenticated token or usage request is 401 even when platform configuration is
missing. After valid local login, missing credentials produce 503
`configuration_not_ready`. Body-supplied endUserId is ignored: the server uses the
logged-in user's identity. Upstream failures remain errors; they never mint fallback tokens.

GET /api/my-usage?window=7d retains the same authenticated demo contract.
This starter is not the Serve login service and does not expose agent session APIs.
Demo accounts and sessions are the original in-memory sample. A client logout clears
its local session/token; server sessions disappear on restart. Public deployment must
reuse the application's real login/revocation controls and TLS instead of exposing
these demo accounts. No extra authorization or billing protocol is implemented.

## Verify

`npm test` uses real loopback TCP servers and a synthetic upstream. It verifies
readiness, authenticated refusal, server-bound identity, original signed request shape,
response minimization and upstream failure handling. It makes no platform/model calls.
`npm run check` checks JavaScript syntax.

Start the companion client as well and verify its actual login/connection status.
A local health check or synthetic token response is not a successful platform/model
call. After real credentials are supplied, verify token exchange and any authorized
model call separately, then record the backend/client paths, ports and stop commands.
