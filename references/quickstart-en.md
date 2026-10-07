# Build a product with Tansr

Help the user turn their idea into a working AI product, or add AI to an existing application. This development skill guides the coding assistant. The resulting product runs on the Tansr SDK/Serve or an appropriate published client; installing this skill does not create an account or deploy a service.

Start with the user's goal, target device and existing project. Ask only the few questions that affect implementation. Keep a short product brief with inputs, actions, outputs and observable acceptance criteria. Preserve existing code, data, login and lockfiles. See [product discovery](product-brief.md) and [application development](build.md).

For a new local web product, the bundled `assets/product-starter` provides editable records, real SDK tool execution, progress, cancellation and persisted history. Its default offline provider is clearly labelled and is not a live model. Platform mode requires server-side application configuration and never silently falls back to fake answers. Generate a new project with:

```text
node scripts/create-project.mjs --template web --target <new-absolute-directory> --name my-ai-product
```

Then follow the generated README to install locked dependencies, test, build and start it. The generator never overwrites an existing directory or installs software for the user. Adapt the data, screens and actual tools to the requested product; changing only the sample's name does not implement a new use case.

The starter is a local single-user application. A shared service requires actual authentication, data isolation and deployment work. Application keys remain on the server; the browser receives product state and results, not secrets. Check [published platform paths](platforms.md), [SDK integration](sdk.md) and [validation](validation.md) as needed.

Communicate in the user's language. Give the actual launch command, result location, verified behavior and remaining work. Distinguish generated code, a running local app, live platform validation and a deployed product. There is no published Tansr Skill npx installer in this first-stage candidate; do not invent a public command.
