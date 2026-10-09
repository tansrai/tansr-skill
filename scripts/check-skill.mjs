// @ts-check
import { readFile, access, readdir } from 'node:fs/promises';
import { dirname, resolve, join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { checkTemplateBaseline } from './build-installer.mjs';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const skill = await readFile(join(root, 'SKILL.md'), 'utf8');
if (!/^---\r?\nname: tansr\r?\ndescription: .+\r?\n/m.test(skill)) throw new Error('Invalid skill frontmatter');
const matrix = JSON.parse(await readFile(join(root, 'compatibility.json'), 'utf8'));
if (matrix.schemaVersion !== 1 || matrix.packages?.sdk?.version !== '0.18.1') throw new Error('Compatibility baseline missing or unexpected');
const paths = [join(root, 'SKILL.md'), ...(await readdir(join(root, 'references'))).filter(file => extname(file) === '.md').map(file => join(root, 'references', file))];
let references = 0;
for (const path of paths) {
  const text = await readFile(path, 'utf8');
  for (const match of text.matchAll(/\]\(([^\s)]+)\)/g)) {
    const href = match[1];
    if (/^(?:https?:|#|mailto:)/.test(href)) continue;
    await access(resolve(dirname(path), decodeURIComponent(href.split('#')[0])));
    references++;
  }
}
for (const template of matrix.templates) {
  const pkg = JSON.parse(await readFile(join(root, template.directory, 'package.json'), 'utf8'));
  const lock = JSON.parse(await readFile(join(root, template.directory, 'package-lock.json'), 'utf8'));
  checkTemplateBaseline(template, pkg, lock, [matrix.packages.sdk, matrix.packages.serve]);
  await access(join(root, template.directory, '.env.example'));
}
const iosRoot = join(root, 'assets', 'ios-app-host');
const provenance = JSON.parse(await readFile(join(iosRoot, 'provenance.json'), 'utf8'));
if (provenance.sdk.version !== '0.3.0') throw new Error('iOS host baseline drift');
for (const file of provenance.hostFiles) {
  const data = await readFile(join(iosRoot, 'host', file.path));
  if (data.length !== file.bytes || createHash('sha256').update(data).digest('hex') !== file.sha256) throw new Error(`iOS host asset drift: ${file.path}`);
}
console.log(JSON.stringify({ status: 'passed', documents: paths.length, resolvedReferences: references, boundary: 'Skill metadata/resource/package consistency, not assistant behavior or native runtime proof.' }));
