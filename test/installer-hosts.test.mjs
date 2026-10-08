import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve, join, parse } from 'node:path';
import { tmpdir } from 'node:os';
import { mkdtemp, realpath, mkdir, rm, writeFile } from 'node:fs/promises';
import { listHosts, findHost, resolveHostTarget } from '../installer/hosts.mjs';

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
  const copies = listHosts(); copies[0].directories.project = 'not-an-installation-path';
  assert.equal((await resolveHostTarget({host:'codex',scope:'project'})).targetPath, join(process.cwd(),'.agents','skills','tansr'));
});

test('documented native roots stay separate for each product, region and scope', async () => {
  // Independent expected contracts catch accidental brand/region directory conflation.
  const expected = [
    ['generic','.agents/skills','.agents/skills'], ['codex','.agents/skills','.agents/skills'],
    ['workbuddy','.codebuddy/skills','.codebuddy/skills'], ['claude-code','.claude/skills','.claude/skills'],
    ['cursor','.cursor/skills','.cursor/skills'], ['trae','.trae/skills','.trae-cn/skills'],
    ['trae-cli','.traecli/skills','.traecli/skills'], ['qoder','.qoder/skills','.qoder/skills'],
    ['qoder-cn','.lingma/skills','.lingma/skills'], ['zcode',null,'.zcode/skills'],
    ['kimi','.kimi-code/skills','.kimi-code/skills'], ['minimax','.minimax/skills','.minimax/skills'],
    ['qwen-code','.qwen/skills','.qwen/skills'],
  ];
  const project = resolve(tmpdir(),'synthetic-multi-project'), home = resolve('synthetic-multi-home');
  for (const [host, projectRoot, userRoot] of expected) {
    if (projectRoot) assert.equal((await resolveHostTarget({host,scope:'project',project,home,env:{}})).targetPath,join(project,projectRoot,'tansr'));
    else await assert.rejects(resolveHostTarget({host,scope:'project',project,home,env:{}}),{code:'scope_unsupported'});
    assert.equal((await resolveHostTarget({host,scope:'user',home,env:{}})).targetPath,join(home,userRoot,'tansr'));
  }
});

test('aliases resolve to detached canonical profiles without accepting paths or colliding identities', async () => {
  assert.equal(findHost('  CLAUDE ')?.id,'claude-code');
  assert.equal(findHost('千问')?.id,'qwen-code');
  assert.equal(findHost('agents')?.id,'generic');
  assert.equal(findHost('../codex'),undefined);
  const identifiers = listHosts().flatMap(host=>[host.id,...host.aliases]);
  assert.equal(new Set(identifiers).size,identifiers.length);
  const host = findHost('cursor'); host.directories.user='outside';host.scopes.length=0;
  assert.equal((await resolveHostTarget({host:'cursor',scope:'user',home:resolve('isolated-home'),env:{}})).targetPath,join(resolve('isolated-home'),'.cursor','skills','tansr'));
});

test('cloud and unverified brands give actionable manual guidance before any scope resolution', async () => {
  for (const host of ['feishu','doubao','yuanbao','volcengine','trae-global']) {
    await assert.rejects(resolveHostTarget({host,scope:'',project:'not-absolute'}),error=>error.code==='host_manual_setup_required'&&error.message.includes('https://'));
    assert.deepEqual(findHost(host).scopes,[]);
  }
});

test('verified configuration roots affect only their documented user scope', async () => {
  const home=resolve('synthetic-home'), project=resolve(tmpdir(),'synthetic-project'), custom=resolve('synthetic-custom');
  for (const [host,key] of [['kimi','KIMI_CODE_HOME'],['minimax','MINIMAX_DATA_DIR'],['minimax','MAVIS_DATA_DIR']]) {
    const env = {[key]:custom};
    assert.equal((await resolveHostTarget({host,scope:'user',home,env})).targetPath,join(custom,'skills','tansr'));
    const projectResult=await resolveHostTarget({host,scope:'project',project,home,env});
    assert.equal(projectResult.targetPath,join(project,findHost(host).directories.project,'tansr'));
    await assert.rejects(resolveHostTarget({host,scope:'user',home,env:{[key]:'relative'}}),{code:'project_path_relative'});
    await assert.rejects(resolveHostTarget({host,scope:'user',home,env:{[key]:parse(project).root}}),{code:'filesystem_root_forbidden'});
  }
});

test('unverified custom config roots are explicit failures rather than silent unused installations', async () => {
  const home=resolve('synthetic-home'), project=resolve('synthetic-project');
  for (const [host,key] of [['claude-code','CLAUDE_CONFIG_DIR'],['qoder','QODER_CONFIG_DIR']]) {
    await assert.rejects(resolveHostTarget({host,scope:'user',home,env:{[key]:resolve('another-root')}}),{code:'host_custom_configuration_unsupported'});
    assert.ok((await resolveHostTarget({host,scope:'project',project,home,env:{[key]:resolve('another-root')}})).targetPath.startsWith(project));
  }
  assert.equal((await resolveHostTarget({host:'codex',scope:'user',home,env:{CODEX_HOME:resolve('codex-state')}})).targetPath,join(home,'.agents','skills','tansr'));
});

test('MiniMax data-root precedence follows the official trimmed override and does not guess named profiles', async () => {
  const home=resolve('minimax-home'), preferred=resolve('minimax-primary'), legacy=resolve('minimax-legacy');
  assert.equal((await resolveHostTarget({host:'minimax',scope:'user',home,env:{MINIMAX_DATA_DIR:`  ${preferred}  `,MAVIS_DATA_DIR:legacy}})).targetPath,join(preferred,'skills','tansr'));
  assert.equal((await resolveHostTarget({host:'minimax',scope:'user',home,env:{MINIMAX_DATA_DIR:'  ',MAVIS_DATA_DIR:legacy}})).targetPath,join(legacy,'skills','tansr'));
  await assert.rejects(resolveHostTarget({host:'minimax',scope:'user',home,env:{__MAVIS_RUNTIME_PROFILE:'business'}}),{code:'host_custom_profile_unsupported'});
  await assert.rejects(resolveHostTarget({host:'minimax',scope:'user',home,env:{__MAVIS_RUNTIME_PROFILE:'default'}}),{code:'host_custom_profile_unsupported'});
  await assert.rejects(resolveHostTarget({host:'minimax',scope:'user',home,env:{__MAVIS_RUNTIME_PROFILE:'  '}}),{code:'host_custom_profile_unsupported'});
  assert.equal((await resolveHostTarget({host:'minimax',scope:'user',home,env:{__MAVIS_RUNTIME_PROFILE:'business',MINIMAX_DATA_DIR:preferred}})).targetPath,join(preferred,'skills','tansr'));
});

test('Kimi project installation rejects nested cwd and guides to the actual Git discovery root', async t => {
  const parent=await realpath(tmpdir());
  const root=await mkdtemp(join(parent,'tansr-kimi-root-'));
  t.after(async()=>{assert.ok(root.startsWith(join(parent,'tansr-kimi-root-')));await rm(root,{recursive:true,force:true});});
  await mkdir(join(root,'.git'));
  const nested=join(root,'packages','app');await mkdir(nested,{recursive:true});
  await assert.rejects(resolveHostTarget({host:'kimi',scope:'project',project:nested,env:{}}),error=>error.code==='host_project_root_required'&&error.message.includes(root));
  assert.equal((await resolveHostTarget({host:'kimi',scope:'project',project:root,env:{}})).targetPath,join(root,'.kimi-code','skills','tansr'));
  const worktree=join(root,'linked-worktree');await mkdir(worktree);await writeFile(join(worktree,'.git'),'gitdir: synthetic-only');
  assert.equal((await resolveHostTarget({host:'kimi',scope:'project',project:worktree,env:{}})).targetPath,join(worktree,'.kimi-code','skills','tansr'));
});
