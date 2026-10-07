// @ts-check
import { mkdir, readdir, readFile, writeFile, lstat, realpath, copyFile, rename, rm } from 'node:fs/promises';
import { dirname, resolve, relative, isAbsolute, basename, join, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';

const skillRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const templates = { web: 'product-starter', node: 'feedback-starter' };

/** @param {string} root @param {string} path */
function contains(root, path) {
  const rel = relative(root, path);
  return !isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${sep}`);
}

/** @param {string} path */
async function assertNoLinks(path) {
  let current = resolve(path);
  for (;;) {
    try {
      const info = await lstat(current);
      if (info.isSymbolicLink()) throw new Error('目标路径包含符号链接或 junction，请选择独立目录。');
    } catch (error) {
      if (/** @type {NodeJS.ErrnoException} */ (error).code !== 'ENOENT') throw error;
    }
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
}

/** @param {{template: 'web'|'node', target: string, name: string}} options */
export async function createProject(options) {
  if (!Object.hasOwn(templates, options.template)) throw new Error('template 必须是 web 或 node。');
  if (!isAbsolute(options.target)) throw new Error('target 必须是新工程的绝对路径。');
  if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(options.name)) throw new Error('name 请使用 1–63 个小写英文字母、数字或连字符，首尾不能为连字符。');
  const target = resolve(options.target);
  if (contains(skillRoot, target)) throw new Error('请在 Skill 源码目录外创建独立工程。');
  await assertNoLinks(target);
  try { await lstat(target); throw new Error('目标已存在；为保护已有项目，请选择新的目录。'); }
  catch (error) { if (/** @type {NodeJS.ErrnoException} */ (error).code !== 'ENOENT') throw error; }
  const source = await realpath(join(skillRoot, 'assets', templates[options.template]));
  // 只新建目标；不合并未知文件，也不安装或执行模板中的依赖。
  await mkdir(dirname(target), { recursive: true });
  const staging = join(dirname(target), `.${basename(target)}-tansr-${randomUUID()}.tmp`);
  await mkdir(staging, { recursive: false });
  /** @type {string[]} */
  const copied = [];
  /** @param {string} from @param {string} to */
  async function copyTree(from, to) {
    for (const entry of await readdir(from, { withFileTypes: true })) {
      if (['node_modules', '.git', 'dist', 'data', '.data', 'coverage'].includes(entry.name) || (entry.name.startsWith('.env') && entry.name !== '.env.example')) continue;
      const input = join(from, entry.name);
      const output = join(to, entry.name);
      if (entry.isSymbolicLink() || !contains(source, await realpath(input))) throw new Error('模板含外部链接，停止复制。');
      if (entry.isDirectory()) { await mkdir(output); await copyTree(input, output); }
      else if (entry.isFile()) { await copyFile(input, output); copied.push(relative(staging, output).replaceAll('\\', '/')); }
    }
  }
  try {
    await copyTree(source, staging);
    const packagePath = join(staging, 'package.json');
    const pkg = JSON.parse(await readFile(packagePath, 'utf8'));
    pkg.name = options.name;
    pkg.private = true;
    await writeFile(packagePath, JSON.stringify(pkg, null, 2) + '\n');
    try {
      const lockPath = join(staging, 'package-lock.json');
      const lock = JSON.parse(await readFile(lockPath, 'utf8'));
      lock.name = options.name;
      if (lock.packages?.['']) lock.packages[''].name = options.name;
      await writeFile(lockPath, JSON.stringify(lock, null, 2) + '\n');
    } catch (error) { if (/** @type {NodeJS.ErrnoException} */ (error).code !== 'ENOENT') throw error; }
    const receipt = { template: options.template, createdAt: new Date().toISOString(), package: options.name, skillVersion: '0.1.0', installedDependencies: false, actualModelVerified: false };
    await writeFile(join(staging, 'tansr-project.json'), JSON.stringify(receipt, null, 2) + '\n');
    await assertNoLinks(target);
    // rename 前再次拒绝已存在目标；竞态下操作系统也不得替换非空目录。
    try { await lstat(target); throw new Error('目标在生成期间已出现，停止以保护现有内容。'); }
    catch (error) { if (/** @type {NodeJS.ErrnoException} */ (error).code !== 'ENOENT') throw error; }
    await rename(staging, target);
    return { target, template: options.template, files: copied.length + 1, dependenciesInstalled: false, next: ['进入生成目录', 'npm ci --ignore-scripts', 'npm test', ...(options.template === 'web' ? ['npm run build', 'npm start（默认本机离线模式，参阅 README）'] : ['参阅 README 配置后 npm start'])] };
  } catch (error) {
    // staging 为本函数在已检查父目录下创建的唯一目录，不处理任何用户目标。
    if (contains(dirname(target), staging) && basename(staging).includes('-tansr-')) await rm(staging, { recursive: true, force: true });
    throw error;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const args = process.argv.slice(2);
    if (args.length !== 6 || new Set(args.filter((_, index) => index % 2 === 0)).size !== 3) throw new Error('用法：node scripts/create-project.mjs --template web|node --target <绝对路径> --name <项目名>');
    /** @type {Record<string,string>} */ const options = {};
    for (let i = 0; i < args.length; i += 2) {
      if (!['--template', '--target', '--name'].includes(args[i])) throw new Error('未知参数。');
      options[args[i].slice(2)] = args[i + 1];
    }
    if (!['web', 'node'].includes(options.template)) throw new Error('template 必须是 web 或 node。');
    console.log(JSON.stringify(await createProject({ template: /** @type {'web'|'node'} */ (options.template), target: options.target, name: options.name }), null, 2));
  } catch (error) { console.error(error instanceof Error ? error.message : '生成失败。'); process.exitCode = 1; }
}
