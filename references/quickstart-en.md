# Build a product with Tansr

Install the skill into your coding assistant, then describe the product you want. The skill guides development; the resulting product uses Tansr SDK / Serve or a published client. Installation does not create accounts, call a model, or deploy a service.

## Choose one assistant

You need Node.js ≥22.19, npm and an existing assistant installation.

**Release snapshot, 2026-10-08:** public version `0.1.0` supports the Codex and WorkBuddy installation targets. The registry also points `latest` at that version, an already recorded candidate-tag isolation issue; the tag does not prove full host acceptance. The multi-host `0.1.1` version is a candidate awaiting publication. **Use the commands below only after that exact version is published.** Check the [npm versions and tags](https://www.npmjs.com/package/@tansr/skill) first.

```sh
# For use after the 0.1.1 candidate is published
npx --yes @tansr/skill@0.1.1 hosts
npx --yes @tansr/skill@0.1.1 preview --host codex --scope project
npx --yes @tansr/skill@0.1.1 install --host codex --scope project --yes
```

Replace `codex` with one supported ID. These are directory installation contracts, not a claim that every assistant has passed actual loading tests.

| Product | Host ID | Scopes |
| --- | --- | --- |
| Codex | `codex` | project, user |
| WorkBuddy / CodeBuddy | `workbuddy` | project, user |
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

Start with the user's goal, target device and existing project. Ask only questions that affect implementation. Keep a short product brief with inputs, actions, outputs and observable acceptance criteria. Preserve existing code, data, login and lockfiles. See [product discovery](product-brief.md) and [application development](build.md).

For a new local web product, `assets/product-starter` provides editable records, SDK tool execution, progress, cancellation and persisted history. Its default offline provider is clearly labelled and is not a live model. Platform mode requires server-side application configuration and never silently falls back to fake answers. From the installed skill directory, generate a new project with:

```text
node scripts/create-project.mjs --template web --target <new-absolute-directory> --name my-ai-product
```

Follow the generated README to install locked dependencies, test, build and start. The generator never overwrites an existing directory or installs dependencies automatically. Adapt the data, screens and tools to the requested product; renaming the sample alone does not implement a new use case.

The starter is a local single-user application. A shared service needs authentication, data isolation and deployment work. Keep application keys on the server and complete account/application setup through the actual platform's manual entry points. See [published platform paths](platforms.md), [SDK integration](sdk.md) and [validation](validation.md).

For maintenance, use `status`, `update --yes`, `rollback --yes` or `uninstall --yes` with the same exact package version, host and scope. Modified and unknown files are preserved; generated products are not uninstall targets.

Communicate in the user's language. Give the actual launch command, result location, verified behavior and remaining work. Distinguish a skill installation, a working local app, live platform validation and a deployed product.
