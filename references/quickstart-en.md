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

> Use Tansr Skill to build a study planner that records goals, schedules daily tasks, and reviews progress. Make a working first version and tell me which configuration steps remain.

Start with the user's goal, target device and existing project. If the product form is unknown, ask whether they want a desktop program, a phone app, or a website. Clarify the target operating system when it affects the build; preserve a platform already chosen. Recommend a suitable path in ordinary language instead of silently choosing the bundled web template. Keep a short product brief with inputs, actions, outputs and observable acceptance criteria. Preserve existing code, data, login and lockfiles. See [product discovery](product-brief.md) and [application development](build.md).

Only when a local web product is the chosen target, `assets/product-starter` provides editable records, SDK tool execution, progress, cancellation and persisted history. Its default offline provider is clearly labelled and is not a live model. Platform mode requires server-side application configuration and never silently falls back to fake answers. From the installed skill directory, generate a new project with:

```text
node scripts/create-project.mjs --template web --target <new-absolute-directory> --name my-ai-product
```

Follow the generated README to install locked dependencies, test, build and start. The generator never overwrites an existing directory or installs dependencies automatically. Adapt the data, screens and tools to the requested product; renaming the sample alone does not implement a new use case.

For a desktop product, use the published Electron SDK/Demo integration; for Android, iOS or native HarmonyOS, use the corresponding published client and an appropriate Serve backend. Preserve each distribution's compatibility constraints. A responsive webpage or backend alone is not a delivered native app. Use real SDK/Serve sessions, business tools, receipts, progress and terminal states as needed by the product; a logo or a direct model HTTP request is not a Harness integration. See [published platform paths](platforms.md).

## Help with application configuration

Proactively establish whether the user already has a Tansr application. Open [application management](https://www.tansr.com/console/apps) or [create an application](https://www.tansr.com/console/apps?create=1), where the user completes login. Creation or rotation displays the App ID / App Key once; an existing detail page only shows the key identifier or prefix. Do not replace an existing key just to retrieve it: rotation invalidates the old key immediately and requires updating affected backends.

Explain that `.env` is this product backend's local settings file, not an attachment to send to the assistant. Prepare it from `.env.example` only when absent, preserve existing settings, and let the user enter credentials in a local editor or their existing secret store. The assistant handles authorized setup: check effective assignments, remove comment markers when appropriate, resolve duplicate/empty/placeholders, set the requested mode, validate and restart only the owned project process. Do not leave a novice to discover these steps alone.

For application creation, desktop programs map to `desktop`, phone apps to `mobile`, and website backends/services to `server`. The product goal “web” is not a valid application API platform value; choose the matching control-panel option instead of passing a homepage label directly.

When available in the installed Skill, run `node scripts/configure-project.mjs --project <absolute-project-path> --mode platform` from the Skill directory for a dry run. Add `--apply` after the user has requested platform integration and entered valid values locally; then run `node scripts/doctor.mjs --project <absolute-project-path> --mode platform`. These tools take no secret arguments and do not make paid or network calls. Older releases may not include the helper: check actual files and use the project's existing safe configuration path instead of claiming it ran. See [configuration guidance](use.md#本机配置与凭据处理).

Routine diagnostics show variable names and status, not secret values. If disclosure is genuinely necessary for this specific diagnosis, use the smallest useful scope in the current controlled interface and remind the user to rotate the key and update affected services afterwards. This does not permit secrets in public logs, source control or client bundles, nor authorize automatic rotation. Do not request secrets in chat for ordinary setup.

The web starter is local and single-user; a shared service still needs authentication, isolation and deployment work. Missing credentials need a clear error in platform mode, never a fake offline success. Continue explicitly labelled offline development when appropriate; real model validation uses the user's existing authorization, without repeatedly requesting approval for routine work. See [SDK integration](sdk.md) and [validation](validation.md).

For maintenance, use `status`, `update --yes`, `rollback --yes` or `uninstall --yes` with the same exact package version, host and scope. Modified and unknown files are preserved; generated products are not uninstall targets.

Communicate in the user's language. Give the actual launch command, result location, verified behavior and remaining work. Distinguish a skill installation, a working local app, live platform validation and a deployed product. After completing the authorized task, offer relevant next directions for desktop, phone or web use, stating what already exists and what still needs implementation and platform validation. Do not promise a one-click platform conversion or present an already requested app as merely a future option.
