// @ts-check
import { lstat, readFile, readdir, realpath, mkdir, writeFile, rm, chmod } from 'node:fs/promises';
import { dirname, resolve, relative, join, sep, isAbsolute, posix } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';

export const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const BUILD_RECEIPT = '.tansr-package-build.json';
export const INSTALLER_FILES = Object.freeze(['installer/cli.mjs', 'installer/engine.mjs', 'installer/errors.mjs',
  'installer/hosts.mjs', 'installer/manifest.mjs', 'installer/paths.mjs']);
// Publication is opt-in per file. A tracked file added under assets does not
// silently become public merely because it is in a template directory.
export const PAYLOAD_FILES = Object.freeze([
  'SKILL.md', 'LICENSE', 'NOTICE', 'compatibility.json', 'agents/openai.yaml',
  'assets/demo-repairs/ANDROID-LICENSE.txt', 'assets/demo-repairs/ELECTRON-LICENSE.txt',
  'assets/demo-repairs/HARMONY-SOURCE-NOTICE.txt', 'assets/demo-repairs/android.json',
  'assets/demo-repairs/electron.json', 'assets/demo-repairs/harmony.json',
  'assets/feedback-starter/.env.example', 'assets/feedback-starter/.gitignore',
  'assets/feedback-starter/.tansr/settings.json', 'assets/feedback-starter/README.md',
  'assets/feedback-starter/agent.mjs', 'assets/feedback-starter/feedback.json',
  'assets/feedback-starter/package-lock.json', 'assets/feedback-starter/package.json',
  'assets/feedback-starter/test.mjs',
  'assets/ios-app-host/README.md', 'assets/ios-app-host/demo-repairs.json',
  'assets/ios-app-host/host/Info.plist', 'assets/ios-app-host/host/LICENSE',
  'assets/ios-app-host/host/OrderAssistant.xcodeproj/project.pbxproj',
  'assets/ios-app-host/host/OrderAssistant.xcodeproj/xcshareddata/xcschemes/OrderAssistant.xcscheme',
  'assets/ios-app-host/prepare.mjs', 'assets/ios-app-host/provenance.json',
  'assets/ios-app-host/public-demo-files.json',
  'assets/product-starter/.env.example', 'assets/product-starter/.gitignore',
  'assets/product-starter/README.md', 'assets/product-starter/eslint.config.mjs',
  'assets/product-starter/package-lock.json', 'assets/product-starter/package.json',
  'assets/product-starter/product.config.json', 'assets/product-starter/public/app.js',
  'assets/product-starter/public/index.html', 'assets/product-starter/public/styles.css',
  'assets/product-starter/scripts/build.mjs', 'assets/product-starter/src/agent.ts',
  'assets/product-starter/src/config.ts', 'assets/product-starter/src/errors.ts',
  'assets/product-starter/src/http-contract.md', 'assets/product-starter/src/main.ts',
  'assets/product-starter/src/platform-transport.ts', 'assets/product-starter/src/product.ts',
  'assets/product-starter/src/runs.ts', 'assets/product-starter/src/server.ts',
  'assets/product-starter/src/source.ts', 'assets/product-starter/src/store.ts',
  'assets/product-starter/src/types.ts', 'assets/product-starter/test/platform.test.ts',
  'assets/product-starter/test/runtime.test.ts', 'assets/product-starter/tsconfig.build.json',
  'assets/product-starter/tsconfig.json',
  'references/assistant-setup.md', 'references/build.md', 'references/platforms.md',
  'references/product-brief.md', 'references/product.md', 'references/quickstart-en.md',
  'references/sdk.md', 'references/serve-mobile.md', 'references/troubleshoot.md',
  'references/use.md', 'references/validation.md',
  'scripts/create-project.mjs', 'scripts/doctor.mjs', 'scripts/prepare-demo.mjs',
].sort());

/** npm excludes/renames .gitignore; the installer restores its logical path.
 * The mapping is narrow, reversible, and does not alter the source bytes.
 * @param {string} path
 */
export function payloadSourcePath(path) {
  return path.endsWith('/.gitignore') ? path.slice(0, -'.gitignore'.length) + 'tansr.gitignore' : path;
}

/** @typedef {{schemaVersion: number, packageName: string, binName: string, version: string, node: string, license: string, homepage: string, repository: string, skillVersion: string, templateBaselines: {id: string, version: string}[], runtimeBaselines: {id: string, name: string, version: string}[]}} Release */
/** @typedef {{path: string, bytes: number, sha256: string, mode: number}} InventoryEntry */
/** @typedef {{bytes: Buffer, mode: number}} PackageFile */
/** @param {Buffer} bytes */
export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

/** @param {string} path */
export function validateRelativePath(path) {
  if (typeof path !== 'string' || !path || path.length > 240 || /[\\:\x00-\x1f\x7f]/.test(path)
    || path.split('/').some(part => !part || part === '.' || part === '..' || /[. ]$/.test(part)
      || /[<>"|?*]/.test(part) || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part))) {
    throw new Error(`Unsafe package path: ${String(path)}`);
  }
}

/** Reject reparse points and hard links, including ancestors. @param {string} path */
export async function assertUnlinkedPath(path) {
  const absolute = resolve(path);
  let current = absolute;
  for (;;) {
    try {
      const stat = await lstat(current);
      if (stat.isSymbolicLink() || (stat.isFile() && stat.nlink !== 1)) throw new Error('Refusing linked package path.');
      const canonical = await realpath(current);
      const compare = process.platform === 'win32' ? (/** @type {string} */ value) => value.toLowerCase() : (/** @type {string} */ value) => value;
      if (compare(canonical) !== compare(current)) throw new Error('Refusing redirected package path.');
    } catch (error) {
      if (/** @type {NodeJS.ErrnoException} */ (error).code !== 'ENOENT') throw error;
    }
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
}

/** @param {string} path */
export async function readRegularFile(path) {
  await assertUnlinkedPath(path);
  const before = await lstat(path);
  if (!before.isFile() || before.nlink !== 1) throw new Error('Package input must be a regular unlinked file.');
  const bytes = await readFile(path);
  const after = await lstat(path);
  if (after.isSymbolicLink() || after.nlink !== 1 || before.dev !== after.dev || before.ino !== after.ino
    || before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs) {
    throw new Error('Package file changed while reading.');
  }
  return bytes;
}

/** @param {unknown} input @returns {Release} */
export function validateRelease(input) {
  const release = /** @type {Release} */ (input);
  if (!release || release.schemaVersion !== 1 || release.packageName !== '@tansr/skill'
    || release.binName !== 'tansr-skill' || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(release.version)
    || release.node !== '>=22.19' || release.license !== 'Apache-2.0'
    || release.homepage !== 'https://tansr.com/' || release.repository !== 'https://github.com/cpple/tansr-skill'
    || typeof release.skillVersion !== 'string' || !Array.isArray(release.templateBaselines) || !Array.isArray(release.runtimeBaselines)) {
    throw new Error('Invalid public release configuration.');
  }
  return release;
}

/** Release metadata is a checked projection of the shipped compatibility facts.
 * @param {Release} release @param {Map<string, PackageFile>} files @param {string} [prefix]
 */
export function checkReleaseBaselines(release, files, prefix = '') {
  /** @param {string} path */
  function json(path) {
    const file = files.get(prefix + path);
    if (!file) throw new Error(`Missing version baseline: ${path}`);
    return JSON.parse(file.bytes.toString('utf8'));
  }
  const compatibility = json('compatibility.json');
  if (release.skillVersion !== compatibility.skill?.version || !Array.isArray(compatibility.templates)) {
    throw new Error('Release skill version differs from compatibility.json.');
  }
  /** @param {unknown[]} list @param {string[]} fields */
  function normalize(list, fields) {
    const seen = new Set();
    const projected = list.map(item => {
      const value = /** @type {Record<string, unknown>} */ (item);
      if (!value || fields.some(field => typeof value[field] !== 'string') || seen.has(value.id)) throw new Error('Invalid or duplicate release version baseline.');
      seen.add(value.id);
      return fields.map(field => value[field]).join('\0');
    });
    return projected.sort().join('\n');
  }
  const runtimes = ['sdk', 'serve'].map(id => ({ id, name: compatibility.packages?.[id]?.name, version: compatibility.packages?.[id]?.version }));
  if (normalize(release.templateBaselines, ['id', 'version']) !== normalize(compatibility.templates, ['id', 'version'])
    || normalize(release.runtimeBaselines, ['id', 'name', 'version']) !== normalize(runtimes, ['id', 'name', 'version'])) {
    throw new Error('Release template/runtime versions differ from compatibility.json.');
  }
  for (const template of compatibility.templates) {
    validateRelativePath(template.directory);
    const pkg = json(`${template.directory}/package.json`);
    if (pkg.version !== template.version || pkg.dependencies?.[compatibility.packages.sdk.name] !== compatibility.packages.sdk.version) {
      throw new Error(`Template package differs from compatibility.json: ${template.id}`);
    }
  }
}

/** @param {Map<string, PackageFile>} files @returns {InventoryEntry[]} */
function inventory(files) {
  return [...files].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
    .map(([path, file]) => ({ path, bytes: file.bytes.length, sha256: sha256(file.bytes), mode: file.mode }));
}

/** Also checks local Markdown links and literal module imports inside the delivered tree.
 * @param {Map<string, PackageFile>} files
 */
export function checkLocalReferences(files) {
  let checked = 0;
  for (const [file, content] of files) {
    const text = content.bytes.toString('utf8');
    /** @type {string[]} */ const references = [];
    if (/\.md$/i.test(file)) for (const match of text.matchAll(/\]\(([^\s)]+)\)/g)) references.push(match[1]);
    if (/\.(?:mjs|js|ts)$/.test(file)) {
      for (const match of text.matchAll(/(?:\bfrom\s*|\bimport\s*(?:\(\s*)?)['"](\.[^'"]+)['"]/g)) references.push(match[1]);
      // Literal file resources only: directory URLs also name generated output
      // such as dist/public, which intentionally does not ship in templates.
      for (const match of text.matchAll(/new URL\(\s*['"](\.[^'"]+\.[a-z]+)['"]\s*,\s*import\.meta\.url\s*\)/g)) references.push(match[1]);
    }
    for (const reference of references) {
      if (/^(?:[a-z][a-z\d+.-]*:|#|\/\/)/i.test(reference)) continue;
      const href = decodeURIComponent(reference.split('#')[0]);
      if (!href) continue;
      if (href.startsWith('/') || href.includes('\\')) throw new Error(`Nonportable local reference in ${file}`);
      const target = posix.normalize(posix.join(posix.dirname(file), href)).replace(/\/$/, '');
      const exists = files.has(target) || [...files.keys()].some(path => path.startsWith(`${target}/`))
        || (/\.ts$/.test(file) && /\.js$/.test(target) && files.has(target.slice(0, -3) + '.ts'));
      if (!exists || target.startsWith('../')) throw new Error(`Missing packaged local reference: ${file} -> ${reference}`);
      checked++;
    }
  }
  return checked;
}

/** Reject concrete credential material, without including values in errors.
 * Template environment assignments may contain empty values or placeholders.
 * @param {Map<string, PackageFile>} files
 */
export function checkPublicContent(files) {
  for (const [path, content] of files) {
    const text = content.bytes.toString('utf8');
    if (/-----BEGIN (?:[A-Z ]+ )?PRIVATE KEY-----|\bnpm_[A-Za-z0-9]{30,}|\bsk-proj-[A-Za-z0-9_-]{30,}/.test(text)) {
      throw new Error(`Credential material is forbidden in package input: ${path}`);
    }
    if (!path.endsWith('/.env.example')) continue;
    for (const match of text.matchAll(/^[ \t]*(?:#[ \t]*)?([A-Z][A-Z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD))[ \t]*=[ \t]*(.*?)[ \t\r]*$/gm)) {
      const value = match[2].replace(/^(['"])(.*)\1$/, '$2');
      if (value && !/^(?:REPLACE_|YOUR_)[A-Z0-9_]+$/.test(value)) {
        throw new Error(`Template credential must be empty or a placeholder: ${path} (${match[1]})`);
      }
    }
  }
}

/** @param {string} directory @returns {Promise<Map<string, PackageFile>>} */
export async function readPackageTree(directory) {
  await assertUnlinkedPath(directory);
  /** @type {Map<string, PackageFile>} */ const files = new Map();
  /** @param {string} subdirectory */
  async function visit(subdirectory) {
    for (const entry of await readdir(join(directory, subdirectory), { withFileTypes: true })) {
      const path = subdirectory ? `${subdirectory}/${entry.name}` : entry.name;
      validateRelativePath(path);
      if (entry.isSymbolicLink()) throw new Error('Refusing linked generated package.');
      if (entry.isDirectory()) {
        if ((await readdir(join(directory, path))).length === 0) throw new Error('Unexpected empty generated package directory; preserved.');
        await visit(path);
      }
      else if (entry.isFile()) {
        const absolute = join(directory, path);
        files.set(path, { bytes: await readRegularFile(absolute), mode: (await lstat(absolute)).mode & 0o777 });
      } else throw new Error('Refusing special generated package file.');
    }
  }
  await visit('');
  return files;
}

/** Existing output is replaceable only when all recorded files are unchanged.
 * @param {string} directory
 */
export async function inspectGeneratedPackage(directory) {
  const files = await readPackageTree(directory);
  const receiptFile = files.get(BUILD_RECEIPT);
  if (!receiptFile) throw new Error('Existing output is not an owned generated package; preserved.');
  const receipt = JSON.parse(receiptFile.bytes.toString('utf8'));
  files.delete(BUILD_RECEIPT);
  if (receipt.schemaVersion !== 1 || receipt.generator !== 'tansr-skill-build' || !Array.isArray(receipt.files)
    || receipt.files.length !== files.size) throw new Error('Generated output ownership mismatch; preserved.');
  const seen = new Set();
  for (const item of receipt.files) {
    validateRelativePath(item.path);
    const actual = files.get(item.path);
    if (seen.has(item.path) || !actual || actual.bytes.length !== item.bytes || sha256(actual.bytes) !== item.sha256
      || (process.platform !== 'win32' && actual.mode !== item.mode)) {
      throw new Error('Generated output was modified; preserved.');
    }
    seen.add(item.path);
  }
  return files;
}

/** @param {{sourceRoot?: string, outputDir?: string}} [options] */
export async function buildInstaller(options = {}) {
  const sourceRoot = resolve(options.sourceRoot ?? repositoryRoot);
  const outputDir = resolve(options.outputDir ?? join(sourceRoot, 'dist', 'npm'));
  const outputRelative = relative(join(sourceRoot, 'dist'), outputDir);
  if (!outputRelative || isAbsolute(outputRelative) || outputRelative === '..' || outputRelative.startsWith(`..${sep}`)) {
    throw new Error('Package output must be a child of the source dist directory.');
  }
  await assertUnlinkedPath(sourceRoot);
  await assertUnlinkedPath(outputDir);
  const trackedText = execFileSync('git', ['ls-files', '--stage', '-z'], { cwd: sourceRoot, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
  /** @type {Map<string, number>} */ const tracked = new Map();
  for (const line of trackedText.split('\0').filter(Boolean)) {
    const match = /^(\d{6}) [a-f\d]+ (\d)\t(.+)$/s.exec(line);
    if (!match || match[2] !== '0') throw new Error('Source index contains unresolved entries.');
    tracked.set(match[3], Number.parseInt(match[1], 8));
  }
  /** @param {string} path @returns {Promise<PackageFile>} */
  async function source(path) {
    validateRelativePath(path);
    const mode = tracked.get(path);
    if (mode !== 0o100644 && mode !== 0o100755) throw new Error(`Package source must be Git-tracked regular content: ${path}`);
    return { bytes: await readRegularFile(join(sourceRoot, path)), mode: mode & 0o777 };
  }
  const releaseFile = await source('release.json');
  const release = validateRelease(JSON.parse(releaseFile.bytes.toString('utf8')));
  const installerPaths = [...tracked.keys()].filter(path => path.startsWith('installer/')).sort();
  if (installerPaths.length !== INSTALLER_FILES.length || installerPaths.some(path => !INSTALLER_FILES.includes(path))) {
    throw new Error('Installer sources differ from the explicit public module list.');
  }
  /** @type {Map<string, PackageFile>} */ const payload = new Map();
  for (const path of PAYLOAD_FILES) payload.set(path, await source(path));
  checkReleaseBaselines(release, payload);
  const resolvedReferences = checkLocalReferences(payload);
  /** @type {Map<string, PackageFile>} */ const files = new Map();
  for (const path of installerPaths) files.set(path, await source(path));
  const cli = files.get('installer/cli.mjs');
  if (!cli) throw new Error('Missing installer CLI.');
  cli.mode = 0o755;
  files.set('release.json', releaseFile);
  files.set('README.md', await source('INSTALL.md'));
  files.set('LICENSE', await source('LICENSE'));
  files.set('NOTICE', await source('NOTICE'));
  for (const [path, content] of payload) files.set(`skill/${payloadSourcePath(path)}`, content);
  const manifest = { schemaVersion: 1, name: 'tansr', version: release.version, files: inventory(payload).map(entry => {
    const source = payloadSourcePath(entry.path);
    return source === entry.path ? entry : { ...entry, source };
  }) };
  const json = (/** @type {unknown} */ object) => ({ bytes: Buffer.from(JSON.stringify(object, null, 2) + '\n'), mode: 0o644 });
  const manifestFile = json(manifest);
  files.set('manifest.json', manifestFile);
  files.set('package.json', json({ name: release.packageName, version: release.version,
    description: 'Install Tansr Skill for your coding assistant to build AI products.', type: 'module',
    license: release.license, engines: { node: release.node }, bin: { [release.binName]: 'installer/cli.mjs' },
    homepage: release.homepage, repository: { type: 'git', url: release.repository },
    publishConfig: { access: 'public' }, files: [...files.keys()].sort(),
  }));
  checkLocalReferences(files);
  checkPublicContent(files);
  const receipt = json({ schemaVersion: 1, generator: 'tansr-skill-build', files: inventory(files) });
  let existing = false;
  try { await lstat(outputDir); existing = true; }
  catch (error) { if (/** @type {NodeJS.ErrnoException} */ (error).code !== 'ENOENT') throw error; }
  if (existing) {
    await inspectGeneratedPackage(outputDir);
    // outputDir is bounded inside this source tree's dist and has no links;
    // every file was verified against the generator's exact inventory.
    await rm(outputDir, { recursive: true });
  }
  await mkdir(outputDir, { recursive: true });
  const outputFiles = new Map(files);
  outputFiles.set(BUILD_RECEIPT, receipt);
  for (const [path, file] of outputFiles) {
    const destination = join(outputDir, path);
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, file.bytes, { flag: 'wx', mode: file.mode });
    await chmod(destination, file.mode);
  }
  return { status: 'built', packageDir: outputDir, packageName: release.packageName, version: release.version,
    payloadFiles: payload.size, packageFiles: files.size, resolvedReferences, manifestSha256: sha256(manifestFile.bytes) };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    if (process.argv.length !== 2) throw new Error('Usage: node scripts/build-installer.mjs');
    console.log(JSON.stringify(await buildInstaller(), null, 2));
  } catch (error) { console.error(error instanceof Error ? error.message : 'Package build failed.'); process.exitCode = 1; }
}
