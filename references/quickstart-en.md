# Build a product with Tansr

Install the skill into your coding assistant, then describe the product you want. The skill guides development; the resulting product uses Tansr SDK / Serve or a published client. Installation does not create accounts, call a model, or deploy a service.

## Choose one assistant

You need Node.js ≥22.19, npm and an existing assistant installation.

Use the published [npm version and tags](https://www.npmjs.com/package/@tansr/skill) and the installed [compatibility snapshot](../compatibility.json). Version `0.1.3` has been published and verified through the stable entry point; a newer source candidate does not become published merely because its files exist. The commands below select the public stable tag. File installation and actual assistant loading remain separate checks.

Starting with 0.1.2, state, staging and backups live outside the host's `skills` directory. Confirmed management operations migrate owned legacy state while preserving its history; `status` and `preview` remain read-only. A metadata-only marker prevents old installers from recreating the faulty layout. Use 0.1.2 or newer for subsequent updates, recovery and removal. Reload your assistant after migration; never select a Skill entry under a transaction backup. User-edited Skill files are preserved and explicitly reported as a partial removal.

```sh
npx --yes @tansr/skill@latest hosts
npx --yes @tansr/skill@latest preview --host codex --scope project
npx --yes @tansr/skill@latest install --host codex --scope project --yes
```

Replace `codex` with one supported ID. These are directory installation contracts, not a claim that every assistant has passed actual loading tests.

| Product | Host ID | Scopes |
| --- | --- | --- |
| Codex | `codex` | project, user |
| WorkBuddy | `workbuddy` | project, user |
| CodeBuddy | `codebuddy` | project, user |
| Claude Code | `claude-code` (alias `claude`) | project, user |
| Cursor | `cursor` | project, user |
| TRAE China / TraeCode | `trae` | project, user |
| TraeCode CLI | `trae-cli` | project, user |
| Qoder international IDE / CLI | `qoder` | project, user |
| Qoder China IDE | `qoder-cn` | project, user |
| ZCode Agent | `zcode` | user only |
| Kimi Code | `kimi` (alias `kimi-code`) | project, user |
| MiniMax Code CLI | `minimax` (alias `mcode`) | project, user |
| Qwen Code | `qwen-code` (aliases `qwen`, `qianwen`) | project, user |
| Shared Agent Skills directory | `generic` (alias `agents`) | project, user |

Choose project scope for one application or explicitly select user scope for all your projects. Each command manages one location. `--project <absolute-path>` is only for project scope. `generic` shares `.agents/skills/tansr` with Codex; some other clients can also read it, but it is not universal discovery or an install-all command.

The profiles `feishu`, `yuanbao`, `doubao`, `volcengine` and `trae-global` provide manual guidance without local installation. Cloud agents and ordinary chat products need their own verified import process.

Updates, rollbacks and removal in the shared generic/Codex directory affect every assistant reading that location. Kimi project installs must target the nearest Git root; nested paths are rejected with the root path shown, without writing to the parent automatically. For MiniMax, any nonempty `__MAVIS_RUNTIME_PROFILE` value, including `default` or whitespace, requires an explicit absolute data root. Environment data-root overrides are trimmed before evaluation.

Custom user roots also matter: non-default `CLAUDE_CONFIG_DIR` / `QODER_CONFIG_DIR` are currently rejected; use project scope or the host's official import flow. Kimi honors `KIMI_CODE_HOME`; MiniMax honors `MINIMAX_DATA_DIR` then `MAVIS_DATA_DIR`, with `skills/tansr` below that absolute root. Named MiniMax profiles are not inferred automatically. The installer does not change configuration or cloud sync settings. See [assistant setup](assistant-setup.md) for exact paths and boundaries.

Return to your assistant, reload as directed, and confirm that it actually reads the installed `SKILL.md` and needed references. Codex can use `$tansr`; Claude Code and Cursor can use `/tansr`. File installation, visible discovery, explicit invocation and automatic selection are separate checks.

## Describe the product

For example:

> Build a study planner that records goals, schedules daily tasks, and reviews progress.

A plain request is enough; platform, configuration and delivery guidance belong in the Skill, without extra instructions appended by the homepage. Start with the user's goal, target device and existing project, preserving choices already made. When key information is missing, make one brief inquiry or invite the user to add it. If they have no preference, ask you to decide, decline to provide it or do not add it, explain a suitable, revisable default based on the use case and available environment, then continue authorized local development. An unknown platform alone must not block progress or silently make every product a basic web app. Keep a short brief with facts, assumptions, inputs, actions, outputs and observable acceptance criteria. Preserve existing code, data, login and lockfiles. Defaults do not grant permission for paid calls, publication, account changes or credential rotation. See [product discovery](product-brief.md) and [application development](build.md).

Only when a local web product is the chosen target, `assets/product-starter` provides editable records, SDK tool execution, progress, cancellation and persisted history. Its default offline provider is clearly labelled and is not a live model. Platform mode requires server-side application configuration and never silently falls back to fake answers. From the installed skill directory, generate a new project with:

```text
node scripts/create-project.mjs --template web --target <new-absolute-directory> --name my-ai-product
```

Follow the generated README to install locked dependencies, test, build and start. The generator never overwrites an existing directory or installs dependencies automatically. Adapt the data, screens and tools to the requested product; renaming the sample alone does not implement a new use case.

For a desktop product, use the published Electron SDK/Demo integration; for Android, iOS or native HarmonyOS, use the corresponding published client and an appropriate Serve backend. Deliver the required backend as part of the task: reuse an existing controlled service or create the missing Serve/token-server from official assets, wire the client, start both sides and check their health and end-to-end behavior. Do not leave a placeholder token URL or ask a novice to build the backend separately. Choose the components required by the architecture; not every product needs both servers, and Electron keeps the full SDK in its main process. Preserve each distribution's compatibility constraints. A responsive webpage or backend alone is not a delivered native app. Use real SDK/Serve sessions, business tools, receipts, progress and terminal states as needed by the product; a logo or a direct model HTTP request is not a Harness integration. See [published platform paths](platforms.md) and [backend delivery](build.md#把所需后端一起交付).

## Help with application configuration

Proactively establish whether the user already has a Tansr application. Open [application management](https://www.tansr.com/console/apps) or [create an application](https://www.tansr.com/console/apps?create=1), where the user completes login. The creation dialog displays `ApiKeyId` (the App ID) and App Key. Only the full App Key is shown once on creation or rotation; the existing detail page shows `ApiKeyId` and the key prefix, not the full secret. Do not replace an existing key just to retrieve it: rotation invalidates the old key immediately and requires updating affected backends.

Explain that `.env` is this product backend's local settings file, not an attachment to send to the assistant. Prepare it from the actual backend's `.env.example` only when absent, preserve existing settings, and provide a clickable absolute file link or the existing secret-store entry; open the local file when the host supports it. Links contain locations, never credential values. The user enters credentials there. The assistant handles authorized setup: check effective assignments, remove comment markers when appropriate, resolve duplicate/empty/placeholders, apply configuration supported by this project, validate and restart only owned project processes. Check the client and required backend separately, then verify their end-to-end connection. Do not leave a novice to discover these steps alone.

For application creation, desktop programs map to `desktop`, phone apps to `mobile`, and website backends/services to `server`. The product goal “web” is not a valid application API platform value; choose the matching control-panel option instead of passing a homepage label directly.

For Web starter and official token-server / Serve projects recognized by the installed helpers, run `node scripts/configure-project.mjs --project <absolute-project-path> --mode platform` from the Skill directory for a dry run. Add `--apply` after platform integration is requested and valid values have been entered locally, then run `node scripts/doctor.mjs --project <absolute-project-path> --mode platform`. Web uses `TANSR_APP_ID` / `TANSR_APP_KEY` and `TANSR_MODE`; the supported backends use `TANSR_APP_KEY_ID` / `TANSR_APP_KEY` with fixed platform mode, never add `TANSR_MODE`, and reject `--mode offline`. `TANSR_APP_ID` and `TANSR_APP_KEY_ID` take the same target application identifier displayed as `ApiKeyId` (App ID) in its creation dialog or details; only the template variable names differ. Do not infer the identifier from a secret prefix or put the identifier in `TANSR_APP_KEY`. The helpers update only verified assignments in an existing `.env`, preserving other contents and permissions; they do not create the file, change login settings, take secret arguments, make network or paid calls, or start services. Doctor provides the configuration location and startup hints. For the official Serve project, first follow its README to run its own `npm run configure`, initializing only missing local login material and preserving existing settings, then start Serve and its login service separately. That project command is different from the Skill's `configure-project` helper. Other backends use their own configuration path, and older Skill releases may lack this support: check actual files instead of claiming a helper ran. See [configuration guidance](use.md#本机配置与凭据处理).

Routine diagnostics show variable names and status, not secret values. If disclosure is genuinely necessary for this specific diagnosis, use the smallest useful scope in the current controlled interface and remind the user to rotate the key and update affected services afterwards. This does not permit secrets in public logs, source control or client bundles, nor authorize automatic rotation. Do not request secrets in chat for ordinary setup.

The web starter is local and single-user; a shared service still needs authentication, isolation and deployment work. Even without an account or credentials, build and start the required local backend and client, provide the safe configuration link, and validate an explicitly labelled offline flow. An unconfigured token endpoint must fail clearly, not issue a fake platform token; platform mode never silently falls back to offline answers. Mark live token/model calls as unverified until they actually run, rather than reporting platform integration as complete. Local development defaults do not authorize paid calls or public deployment; real model validation uses the user's existing authorization, without repeatedly requesting approval for routine work. See [SDK integration](sdk.md) and [validation](validation.md).

For maintenance, use `status`, `update --yes`, `rollback --yes` or `uninstall --yes` with the same exact package version, host and scope. Modified and unknown files are preserved; generated products are not uninstall targets.

Communicate in the user's language. Give launch commands and working directories covering the client and required backend, their addresses and health results, the safe configuration link, verified end-to-end behavior and remaining work. An existing combined launcher is fine if it starts every required process. Distinguish a skill installation, a working local app, live platform validation and a deployed product. After completing the authorized task, offer relevant next directions for desktop, phone or web use, stating what already exists and what still needs implementation and platform validation. Do not promise a one-click platform conversion or present an already requested app as merely a future option.
