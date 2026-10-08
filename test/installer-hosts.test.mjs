import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve, join, parse } from 'node:path';
import { listHosts, resolveHostTarget } from '../installer/hosts.mjs';

test('Codex resolves exactly one project or user scope and does not mix their bases', async () => {
  const project = resolve('合成 project');
  const home = resolve('synthetic-home');
  assert.equal((await resolveHostTarget({host:'codex',scope:'project',project,home})).targetPath, join(project,'.agents','skills','tansr'));
  assert.equal((await resolveHostTarget({host:'codex',scope:'user',home})).targetPath, join(home,'.agents','skills','tansr'));
  await assert.rejects(resolveHostTarget({host:'codex',scope:'user',project,home}), {code:'project_scope_conflict'});
});

test('WorkBuddy uses its own documented project scope', async () => {
  const project = resolve('合成 WorkBuddy');
  assert.equal((await resolveHostTarget({host:'workbuddy',scope:'project',project})).targetPath, join(project,'.codebuddy','skills','tansr'));
  const home = resolve('synthetic-workbuddy-home');
  assert.equal((await resolveHostTarget({host:'workbuddy',scope:'user',home})).targetPath, join(home,'.codebuddy','skills','tansr'));
});

test('invalid host, scope and unsafe base are rejected; public descriptions cannot change the resolver', async () => {
  await assert.rejects(resolveHostTarget({host:'other',scope:'project'}), {code:'host_unknown'});
  await assert.rejects(resolveHostTarget({host:'codex',scope:'all'}), {code:'scope_invalid'});
  await assert.rejects(resolveHostTarget({host:'codex',scope:'project',project:'relative'}), {code:'project_path_relative'});
  await assert.rejects(resolveHostTarget({host:'codex',scope:'project',project:parse(process.cwd()).root}), {code:'filesystem_root_forbidden'});
  const copies = listHosts(); copies[0].directory = 'not-an-installation-path';
  assert.equal((await resolveHostTarget({host:'codex',scope:'project'})).targetPath, join(process.cwd(),'.agents','skills','tansr'));
});
