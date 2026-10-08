// @ts-check
import path from 'node:path';
import { hostname } from 'node:os';
import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { mkdir, open, rename, unlink, rmdir } from 'node:fs/promises';
import { InstallerError, asInstallerError, isFsError } from './errors.mjs';
import { resolvePaths, validateDirectoryChain, validateRelative, readRegular, maybeStat, assertNode, scanTree, portableKey, directoryIdentity } from './paths.mjs';
import { loadManifest, validateManifest, verifyPayload } from './manifest.mjs';
import { inspectLayout, prepareLayout } from './migration.mjs';

/** @typedef {import('./manifest.mjs').FileEntry} FileEntry */
/** @typedef {{id:string,version:string,name?:string}} Baseline */
/** @typedef {{packageName?:string,packageVersion?:string,skillVersion?:string,templateBaseline?:string,host?:string,scope?:string,templateBaselines?:Baseline[],runtimeBaselines?:Baseline[]}} Metadata */
/** @typedef {{schemaVersion:1,name:'tansr',version:string|null,managedFiles:FileEntry[],metadata:Metadata,complete:boolean,installedAt:string,lastTransactionId:string|null}} InstallRecord */
/** @typedef {{path:string,before:FileEntry|null,after:FileEntry|null}} Operation */
/** @typedef {{path:string,dev:string,ino:string,birthtimeNs:string}} CreatedDirectory */
/** @typedef {{schemaVersion:1,txId:string,targetPath:string,action:string,phase:'prepared'|'applying'|'committed',beforeRecord:InstallRecord|null,afterRecord:InstallRecord,operations:Operation[],createdDirectories:CreatedDirectory[]}} Journal */
/** @typedef {{targetPath:string,payloadRoot?:string,manifest?:unknown,metadata?:Metadata,_onStep?:(step:string,detail:Record<string,unknown>)=>void|Promise<void>}} Options */
/** @typedef {{path:string,reason:string}} Preserved */
/** @typedef {Awaited<ReturnType<typeof resolvePaths>>} Paths */
/** @typedef {{schemaVersion:1,action:string,ok:boolean,exitCode:number,status:string,targetPath:string,statePath:string,legacyStatePath:string,stateLayout:'legacy'|'outside-skills-v2',migrationRequired:boolean,version:string|null,filesInstalled:boolean,staticStructureValid:boolean,changes:{added:string[],updated:string[],removed:string[]},preserved:Preserved[],warnings:string[],recoveryRequired:boolean}} Result */
const ownerName = 'tansr-installer';
const processStartedAt = new Date(Date.now() - process.uptime() * 1000).toISOString();
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
/** @param {string} p */
async function json(p) { const text=(await readRegular(p)).bytes.toString('utf8');try{return JSON.parse(text);}catch{throw new InstallerError('STATE_CORRUPT','State JSON is incomplete or malformed',{path:p},4);} }
/** State JSON replacement is atomic per file, not a promise of power-loss durability. @param {string} p @param {unknown} value */
async function writeJson(p, value) {
  await validateDirectoryChain(path.dirname(p)); const old = await maybeStat(p); if (old) assertNode(p, old);
  const temporary = `${p}.${randomUUID()}.tmp`, h = await open(temporary, 'wx', 0o600);
  try { await h.writeFile(`${JSON.stringify(value, null, 2)}\n`); await h.sync(); } finally { await h.close(); }
  await validateDirectoryChain(path.dirname(p)); const current = await maybeStat(p); if (current) assertNode(p, current);
  await rename(temporary, p);
}
/** @param {unknown} raw @returns {InstallRecord|null} */
function validateRecord(raw) {
  if (raw === null) return null;
  if (!raw || typeof raw !== 'object') throw new InstallerError('STATE_CORRUPT', 'Installation record is invalid');
  const r = /** @type {InstallRecord} */ (raw);
  if (r.schemaVersion !== 1 || r.name !== 'tansr' || (r.version !== null && typeof r.version !== 'string') || !Array.isArray(r.managedFiles) || typeof r.complete !== 'boolean' || typeof r.installedAt !== 'string' || (r.lastTransactionId !== null && !uuid.test(r.lastTransactionId))) throw new InstallerError('STATE_CORRUPT', 'Installation record is invalid');
  if (r.managedFiles.length) validateManifest({schemaVersion:1,name:'tansr',version:r.version ?? '0.0.0',files:r.managedFiles});
  r.metadata = validateMetadata(r.metadata); return r;
}
/** @param {Metadata|undefined} metadata @returns {Metadata} */
function validateMetadata(metadata = {}) {
  const allowed = new Set(['packageName','packageVersion','skillVersion','templateBaseline','host','scope','templateBaselines','runtimeBaselines']);
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) throw new InstallerError('INVALID_METADATA', 'Metadata must contain public release and host values');
  for (const [key,value] of Object.entries(metadata)) {
    if(!allowed.has(key))throw new InstallerError('INVALID_METADATA','Unsupported installation metadata field',{key});
    if(key==='templateBaselines'||key==='runtimeBaselines'){
      if(!Array.isArray(value)||value.length>32)throw new InstallerError('INVALID_METADATA','Baseline list must be a bounded array',{key});const ids=new Set();
      for(const item of value){if(!item||typeof item!=='object'||Array.isArray(item)||Object.keys(item).some(k=>!['id','version','name'].includes(k))||typeof item.id!=='string'||!/^[a-z0-9][a-z0-9._-]{0,63}$/.test(item.id)||ids.has(item.id)||typeof item.version!=='string'||!/^[0-9]+\.[0-9]+\.[0-9]+(?:[-+][0-9A-Za-z.+-]+)?$/.test(item.version)||(key==='runtimeBaselines'&&typeof item.name!=='string')||(item.name!==undefined&&(typeof item.name!=='string'||item.name.length>128||!/^(?:@[a-z0-9._-]+\/)?[a-z0-9._-]+$/.test(item.name))))throw new InstallerError('INVALID_METADATA','Invalid or duplicate public baseline',{key});ids.add(item.id);}
    } else if(typeof value!=='string'||value.length>512||/[\x00-\x1f]/.test(value))throw new InstallerError('INVALID_METADATA','Invalid public installation metadata',{key});
  }
  return structuredClone(metadata);
}
/** @param {Paths} paths */
async function readState(paths) {
  const exists = await maybeStat(paths.state);
  if (!exists) return {record: /** @type {InstallRecord|null} */ (null), journal: false};
  await validateDirectoryChain(paths.state); await scanTree(paths.state);
  let owner;try{owner=await json(path.join(paths.state,'owner.json'));}catch(error){if(isFsError(error,'ENOENT'))throw new InstallerError('STATE_CONFLICT','State directory has no verified ownership marker; it is not adopted',{statePath:paths.state});throw error;}
  if (owner.schemaVersion !== 1 || owner.name !== ownerName || owner.targetPath !== paths.target || typeof owner.id !== 'string' || !uuid.test(owner.id)) throw new InstallerError('STATE_CONFLICT','State directory is not owned by this target',{statePath:paths.state});
  const recordPath = path.join(paths.state,'record.json');
  return {record: await maybeStat(recordPath) ? validateRecord(await json(recordPath)) : null, journal: Boolean(await maybeStat(path.join(paths.state,'journal.json')))};
}
/** @param {Paths} paths */
async function readLayoutState(paths){
  const layout=await inspectLayout(paths);
  if(layout.kind==='pending')return{record:null,journal:true,layout};
  const state=await readState(layout.kind==='legacy'?{...paths,state:paths.legacyState}:paths);return{...state,layout};
}
/** @param {Result} value @param {Awaited<ReturnType<typeof inspectLayout>>} layout @returns {Result} */
function describeLayout(value,layout){
  if(layout.kind==='legacy'||layout.kind==='pending')return{...value,stateLayout:'legacy',migrationRequired:true,warnings:[...value.warnings,'Legacy installer state must move outside the host skills directory. Run a confirmed mutation, or recover for an interrupted transaction.']};
  return value;
}
/** @param {number} pid */
function processAlive(pid) { try { process.kill(pid,0); return true; } catch (error) { if (isFsError(error,'ESRCH')) return false; return true; } }
/** Claims are never unlinked or reused. A live claimant serializes takeover of one dead nonce.
 * A claimant that crashes leaves a PID-stamped successor slot; an incomplete slot is refused.
 * @param {Paths} paths @param {string} lockNonce */
async function claimRecovery(paths,lockNonce) {
  const directory=path.join(paths.state,'recovery-claims');await validateDirectoryChain(directory,true);
  for(let index=0;index<10000;index++){
    const file=path.join(directory,`${lockNonce}-${index}.json`);let h;
    try{h=await open(file,'wx',0o600);}catch(error){if(!isFsError(error,'EEXIST'))throw error;}
    if(h){try{await h.writeFile(JSON.stringify({schemaVersion:1,lockNonce,pid:process.pid,processStartedAt,hostname:hostname()}));await h.sync();}finally{await h.close();}return;}
    let previous;try{previous=await json(file);}catch{throw new InstallerError('LOCK_UNVERIFIABLE','Incomplete recovery claim is preserved for operator inspection',{path:file},3);}
    if(previous.schemaVersion!==1||previous.lockNonce!==lockNonce||previous.hostname!==hostname()||!Number.isSafeInteger(previous.pid)||previous.pid<=0)throw new InstallerError('LOCK_UNVERIFIABLE','Recovery claim ownership is invalid',{path:file},3);
    if(processAlive(previous.pid))throw new InstallerError('LOCKED','Another live process claimed recovery of this lock',{path:file,pid:previous.pid},3);
  }
  throw new InstallerError('LOCK_UNVERIFIABLE','Too many abandoned recovery claims; retain state for inspection',{},3);
}
/** @param {Paths} paths @param {boolean} recover @param {(()=>Promise<void>)|undefined} [onClaim] */
async function acquireLock(paths,recover,onClaim) {
  const lockPath = path.join(paths.state,'lock.json');
  await validateDirectoryChain(paths.state);
  if (await maybeStat(lockPath)) {
    let previous;try{previous=await json(lockPath);}catch{throw new InstallerError('LOCK_UNVERIFIABLE','Lock is incomplete or malformed; preserve it for operator inspection',{lockPath},3);}
    if (previous.schemaVersion !== 1 || !uuid.test(previous.nonce) || !Number.isSafeInteger(previous.pid) || previous.pid <= 0 || typeof previous.processStartedAt !== 'string' || previous.hostname !== hostname() || previous.targetPath !== paths.target) throw new InstallerError('LOCK_UNVERIFIABLE','Lock ownership is incomplete or belongs to another host; preserve it for explicit operator inspection',{lockPath},3);
    if (processAlive(previous.pid)) throw new InstallerError('LOCKED','Another installer process may still own this lock; a reused PID is conservatively treated as live',{lockPath,pid:previous.pid},3);
    if (!recover) throw new InstallerError('RECOVERY_REQUIRED','A stopped installer left a lock; run recover explicitly',{lockPath},4);
    await claimRecovery(paths,previous.nonce);
    await onClaim?.();
    const again = await json(lockPath); if (again.nonce !== previous.nonce) throw new InstallerError('LOCK_CHANGED','Lock owner changed',{lockPath},3);
    await validateDirectoryChain(paths.state); await unlink(lockPath);
  }
  const nonce = randomUUID(); let h;
  try { h = await open(lockPath,'wx',0o600); } catch(error) { if(isFsError(error,'EEXIST')) throw new InstallerError('LOCKED','Another installer acquired the lock',{lockPath},3); throw error; }
  try { await h.writeFile(JSON.stringify({schemaVersion:1,nonce,pid:process.pid,processStartedAt,hostname:hostname(),targetPath:paths.target,createdAt:new Date().toISOString()})); await h.sync(); } finally { await h.close(); }
  return async () => { const current = await json(lockPath); if (current.nonce !== nonce) throw new InstallerError('LOCK_CHANGED','Cannot release another owner’s lock',{lockPath},3); await validateDirectoryChain(paths.state); await unlink(lockPath); };
}
/** @param {Paths} paths @param {boolean} recover @param {()=>Promise<Result>} operation @param {Options} [options] */
async function locked(paths,recover,operation,options) {
  await prepareLayout(paths,recover,{writeJson,acquireLock,validateLegacy,step:async(name,detail)=>{if(options)await step(options,name,detail);}});
  await readState(paths);await validateDirectoryChain(paths.parent,true);
  const release = await acquireLock(paths,recover,options?()=>step(options,'recovery-claimed',{}):undefined);
  try { return await operation(); } catch (error) { throw asInstallerError(error); } finally { await release(); }
}
/** @param {Paths} paths @param {string} action @param {string} state @param {InstallRecord|null} record @param {Operation[]} [ops] @param {Preserved[]} [preserved] @returns {Result} */
function result(paths,action,state,record,ops=[],preserved=[]) {
  const verified=Boolean(record?.version)&&record?.complete===true&&preserved.length===0&&['installed','up-to-date','rolled-back','commit-recovered'].includes(state);
  return {schemaVersion:1,action,ok:preserved.length===0,exitCode:preserved.length ? 2 : 0,status:state,targetPath:paths.target,statePath:paths.state,legacyStatePath:paths.legacyState,stateLayout:'outside-skills-v2',migrationRequired:false,version:record?.version ?? null,filesInstalled:verified,staticStructureValid:verified,changes:{added:ops.filter(o=>!o.before&&o.after).map(o=>o.path),updated:ops.filter(o=>o.before&&o.after).map(o=>o.path),removed:ops.filter(o=>o.before&&!o.after).map(o=>o.path)},preserved,warnings:preserved.length?['User changes or unknown files were preserved; this is not a complete replacement/removal.']:[],recoveryRequired:false};
}
/** @param {string} root @param {FileEntry} entry */
async function matches(root,entry) {
  const p = path.join(root,entry.path), s = await maybeStat(p); if (!s) return false; assertNode(p,s);
  const actual = await readRegular(p); return actual.bytes.length === entry.bytes && actual.sha256 === entry.sha256 && (process.platform === 'win32' || entry.mode === undefined || actual.mode === entry.mode);
}
/** @param {Paths} paths @param {InstallRecord|null} record @param {FileEntry[]} desired */
async function plan(paths,record,desired) {
  const nodes = await scanTree(paths.target), exists = Boolean(await maybeStat(paths.target));
  if (!record && exists) throw new InstallerError('TARGET_CONFLICT','An unregistered target directory already exists; it will not be adopted',{targetPath:paths.target});
  const old = new Map((record?.managedFiles ?? []).map(f=>[f.path,f])), wanted = new Map(desired.map(f=>[f.path,f]));
  /** @type {Operation[]} */ const operations=[]; /** @type {Preserved[]} */ const preserved=[];
  /** @type {Map<string,FileEntry>} */ const managed=new Map(old);
  for (const [p,kind] of nodes) if (kind==='file'&&!old.has(p)) preserved.push({path:p,reason:'unknown'});
  for (const [p,kind] of nodes) if(kind==='directory'&&![...old.keys()].some(f=>f.startsWith(`${p}/`))) preserved.push({path:p,reason:'unknown-directory'});
  for (const [p,before] of old) {
    const after = wanted.get(p) ?? null;
    if (!nodes.has(p)) { managed.delete(p); preserved.push({path:p,reason:'user-deleted'}); continue; }
    if (nodes.get(p)!=='file' || !await matches(paths.target,before)) { preserved.push({path:p,reason:'user-modified'}); continue; }
    if (after && before.sha256===after.sha256 && before.bytes===after.bytes && before.mode===after.mode) continue;
    operations.push({path:p,before,after}); if(after) managed.set(p,after); else managed.delete(p);
  }
  for (const [p,after] of wanted) {
    if(old.has(p)) continue;
    const folded=portableKey(p);
    const blocked=preserved.some(item=>item.reason==='unknown-directory'&&folded.startsWith(`${portableKey(item.path)}/`))||[...nodes].some(([n,kind])=>portableKey(n)===folded || (kind==='file' && folded.startsWith(`${portableKey(n)}/`)) || portableKey(n).startsWith(`${folded}/`) || (folded.startsWith(`${portableKey(n)}/`) && !p.startsWith(`${n}/`)));
    if(blocked) { if(!preserved.some(x=>x.path===p)) preserved.push({path:p,reason:'unknown-path-conflict'}); continue; }
    operations.push({path:p,before:null,after}); managed.set(p,after);
  }
  return {operations,preserved,managedFiles:[...managed.values()]};
}
/** @param {Options} options */
async function payload(options) {
  if(!options.payloadRoot || options.manifest===undefined) throw new InstallerError('PAYLOAD_REQUIRED','This action requires payloadRoot and manifest');
  const manifest=await loadManifest(options.manifest); await verifyPayload(options.payloadRoot,manifest); return {manifest,root:options.payloadRoot};
}
/** @param {Options} options */
export async function preview(options) {
  const paths=await resolvePaths(options.targetPath), bundle=await payload(options),state=await readLayoutState(paths);
  if(state.journal) throw new InstallerError('RECOVERY_REQUIRED','An unfinished transaction requires recover',{statePath:paths.state},4);
  const p=await plan(paths,state.record,bundle.manifest.files);return describeLayout(result(paths,'preview',p.preserved.length?'conflicts':'ready',state.record,p.operations,p.preserved),state.layout);
}
/** @param {Options} options */
export async function status(options) {
  const paths=await resolvePaths(options.targetPath),state=await readLayoutState(paths);
  if(state.journal) return describeLayout({...result(paths,'status','recovery-required',state.record),ok:false,exitCode:4,recoveryRequired:true},state.layout);
  if(!state.record) { if(await maybeStat(paths.target)) return describeLayout({...result(paths,'status','unmanaged',null),ok:false,exitCode:2},state.layout);return describeLayout(result(paths,'status','not-installed',null),state.layout); }
  const p=await plan(paths,state.record,state.record.managedFiles);if(!state.record.complete&&!p.preserved.length)p.preserved.push({path:'',reason:'incomplete-installation-record'});return describeLayout(result(paths,'status',p.preserved.length?'modified':state.record.version?'installed':'uninstalled',state.record,[],p.preserved),state.layout);
}
/** @param {Options} options @param {string} name @param {Record<string,unknown>} detail */
async function step(options,name,detail) { await options._onStep?.(name,detail); }
/** @param {Paths} paths @param {Journal} journal */
function transactionPaths(paths,journal) { return {root:path.join(paths.state,'transactions',journal.txId),stage:path.join(paths.state,'transactions',journal.txId,'stage'),backup:path.join(paths.state,'transactions',journal.txId,'backup')}; }
/** @param {string} destination @param {string} source @param {FileEntry} entry */
async function stageFile(destination,source,entry) {
  const value=await readRegular(source);if(value.sha256!==entry.sha256||value.bytes.length!==entry.bytes) throw new InstallerError('PAYLOAD_INTEGRITY','Source changed before staging',{path:entry.path});
  await validateDirectoryChain(path.dirname(destination),true);const h=await open(destination,'wx',entry.mode??0o644);
  try{await h.writeFile(value.bytes);await h.chmod(entry.mode??0o644);await h.sync();}finally{await h.close();}
}
/** @param {Paths} paths @param {Journal} journal @param {string} relative */
async function ensureTargetParent(paths,journal,relative) {
  const parts=relative.split('/');parts.pop();let cursor=paths.target;
  for(const part of ['',...parts]) {
    if(part) cursor=path.join(cursor,part); const s=await maybeStat(cursor);
    if(s) {assertNode(cursor,s,true);continue;}
    const rel=path.relative(paths.target,cursor).split(path.sep).join('/');
    await validateDirectoryChain(path.dirname(cursor)); await mkdir(cursor,{mode:0o755});
    journal.createdDirectories.push({path:rel,...await directoryIdentity(cursor)});await writeJson(path.join(paths.state,'journal.json'),journal);
  }
}
/** @param {Paths} paths @param {Journal} journal */
async function rollbackPending(paths,journal) {
  const tx=transactionPaths(paths,journal);await validateDirectoryChain(tx.root);await scanTree(tx.root);
  for(const op of [...journal.operations].reverse()) {
    await validateDirectoryChain(path.dirname(path.join(paths.target,op.path)));
    const target=path.join(paths.target,op.path),backup=path.join(tx.backup,op.path),hasBackup=Boolean(await maybeStat(backup)),hasTarget=Boolean(await maybeStat(target));
    if(hasBackup) {
      if(!op.before || !await matches(tx.backup,op.before)) throw new InstallerError('RECOVERY_CONFLICT','Backup does not match original file',{path:op.path},4);
      if(hasTarget) {if(!op.after || !await matches(paths.target,op.after)) throw new InstallerError('RECOVERY_CONFLICT','User change prevents automatic rollback',{path:op.path},4);await unlink(target);}
      await validateDirectoryChain(path.dirname(target));await rename(backup,target);
    } else if(!op.before && hasTarget) {
      if(!op.after || !await matches(paths.target,op.after)) throw new InstallerError('RECOVERY_CONFLICT','New target changed after transaction',{path:op.path},4);await unlink(target);
    } else if(op.before && !await matches(paths.target,op.before)) throw new InstallerError('RECOVERY_CONFLICT','Original and backup do not match the journal',{path:op.path},4);
  }
  if(journal.beforeRecord) await writeJson(path.join(paths.state,'record.json'),journal.beforeRecord);
  else if(await maybeStat(path.join(paths.state,'record.json'))) await unlink(path.join(paths.state,'record.json'));
  for(const created of [...journal.createdDirectories].reverse()) {const directory=created.path?path.join(paths.target,created.path):paths.target;if(await maybeStat(directory)){await validateDirectoryChain(directory);const s=await directoryIdentity(directory);if(s.dev!==created.dev||s.ino!==created.ino||s.birthtimeNs!==created.birthtimeNs)throw new InstallerError('RECOVERY_CONFLICT','Created directory was replaced; preserving it',{path:directory},4);try{await rmdir(directory);}catch(error){if(!isFsError(error,'ENOTEMPTY')&&!isFsError(error,'EEXIST'))throw error;}}}
  await writeJson(path.join(tx.root,'outcome.json'),{status:'rolled-back',at:new Date().toISOString()});await unlink(path.join(paths.state,'journal.json'));
}
/** @param {Paths} paths @param {Options} options @param {string} action @param {InstallRecord|null} before @param {InstallRecord} after @param {Operation[]} operations @param {Preserved[]} preserved @param {string|null} sourceRoot @param {boolean} [payloadSources] */
async function transact(paths,options,action,before,after,operations,preserved,sourceRoot,payloadSources=false) {
  const id=randomUUID();after.lastTransactionId=id;
  /** @type {Journal} */ const journal={schemaVersion:1,txId:id,targetPath:paths.target,action,phase:'prepared',beforeRecord:before,afterRecord:after,operations,createdDirectories:[]};
  validateJournal(journal,paths);
  const tx=transactionPaths(paths,journal);await validateDirectoryChain(tx.stage,true);await validateDirectoryChain(tx.backup,true);
  for(const op of operations) if(op.after) {if(!sourceRoot)throw new InstallerError('INVALID_SOURCE','Transaction has no source');await stageFile(path.join(tx.stage,op.path),path.join(sourceRoot,payloadSources?(op.after.source??op.path):op.path),op.after);}
  await writeJson(path.join(tx.root,'transaction.json'),journal);await writeJson(path.join(paths.state,'journal.json'),journal);
  try {
    await step(options,'prepared',{txId:id});journal.phase='applying';await writeJson(path.join(paths.state,'journal.json'),journal);
    for(const op of operations) {
      await step(options,'before-file',{txId:id,path:op.path});await resolvePaths(paths.target);await scanTree(tx.root);
      const target=path.join(paths.target,op.path),backup=path.join(tx.backup,op.path),staged=path.join(tx.stage,op.path);
      if(op.before) {if(!await matches(paths.target,op.before))throw new InstallerError('USER_CHANGED','Managed file changed before mutation',{path:op.path});}
      else if(await maybeStat(target)) throw new InstallerError('USER_CHANGED','A new path appeared before mutation',{path:op.path});
      await ensureTargetParent(paths,journal,op.path);
      if(op.before) {await validateDirectoryChain(path.dirname(backup),true);await validateDirectoryChain(path.dirname(target));await rename(target,backup);await step(options,'backed-up',{txId:id,path:op.path});}
      if(op.after) {if(!await matches(tx.stage,op.after))throw new InstallerError('STAGING_CHANGED','Staged file changed',{path:op.path});await validateDirectoryChain(path.dirname(target));if(await maybeStat(target))throw new InstallerError('USER_CHANGED','Target reappeared before publish',{path:op.path});await rename(staged,target);}
      await step(options,'published-file',{txId:id,path:op.path});
    }
    await step(options,'before-commit',{txId:id});for(const op of operations)if(op.after?!await matches(paths.target,op.after):Boolean(await maybeStat(path.join(paths.target,op.path))))throw new InstallerError('USER_CHANGED','Published file changed before commit',{path:op.path});for(const file of after.managedFiles)if(!preserved.some(p=>p.path===file.path)&&!await matches(paths.target,file))throw new InstallerError('USER_CHANGED','Unchanged managed file changed before commit',{path:file.path});await writeJson(path.join(paths.state,'record.json'),after);journal.phase='committed';await writeJson(path.join(paths.state,'journal.json'),journal);await writeJson(path.join(tx.root,'transaction.json'),journal);await step(options,'committed',{txId:id});await unlink(path.join(paths.state,'journal.json'));
    return result(paths,action,preserved.length?'partial':action==='uninstall'?'uninstalled':action==='rollback'?'rolled-back':'installed',after,operations,preserved);
  } catch(error) {
    if(journal.phase!=='committed') {try{await rollbackPending(paths,journal);}catch(recoveryError){throw new InstallerError('RECOVERY_REQUIRED','Transaction stopped; conflicting recovery state was preserved',{txId:id,cause:asInstallerError(error).toJSON(),recovery:asInstallerError(recoveryError).toJSON()},4);}}
    else throw new InstallerError('RECOVERY_REQUIRED','Transaction committed but cleanup needs recover',{txId:id,cause:asInstallerError(error).toJSON()},4);
    throw asInstallerError(error);
  }
}
/** @param {Options} options @param {'install'|'update'} action */
async function put(options,action) {
  const paths=await resolvePaths(options.targetPath),bundle=await payload(options),metadata=validateMetadata(options.metadata);
  const initial=await readLayoutState(paths);if(!initial.journal&&!initial.record&&await maybeStat(paths.target))throw new InstallerError('TARGET_CONFLICT','Unregistered target already exists',{targetPath:paths.target});
  return locked(paths,false,async()=>{
    const current=await readState(paths);if(current.journal)throw new InstallerError('RECOVERY_REQUIRED','Run recover before another mutation',{statePath:paths.state},4);
    if(action==='update'&&!current.record?.version)throw new InstallerError('NOT_INSTALLED','Cannot update before installation');
    if(action==='install'&&current.record?.version&&current.record.version!==bundle.manifest.version)throw new InstallerError('UPDATE_REQUIRED','Use update to replace another installed version',{version:current.record.version});
    const p=await plan(paths,current.record,bundle.manifest.files);
    if(!p.operations.length&&current.record?.version===bundle.manifest.version&&current.record.complete)return result(paths,action,p.preserved.length?'partial':'up-to-date',current.record,[],p.preserved);
    const record={schemaVersion:/** @type {const} */(1),name:/** @type {const} */('tansr'),version:bundle.manifest.version,managedFiles:p.managedFiles,metadata:{...current.record?.metadata,...metadata},complete:p.preserved.length===0,installedAt:new Date().toISOString(),lastTransactionId:null};
    return transact(paths,options,action,current.record,record,p.operations,p.preserved,bundle.root,true);
  },options);
}
/** @param {Options} options */
export async function install(options) {return put(options,'install');}
/** @param {Options} options */
export async function update(options) {return put(options,'update');}
/** @param {Options} options */
export async function uninstall(options) {
  const paths=await resolvePaths(options.targetPath),initial=await readLayoutState(paths);
  if(!initial.record&&!initial.journal&&initial.layout.kind!=='legacy') {if(await maybeStat(paths.target))throw new InstallerError('TARGET_CONFLICT','Unregistered target cannot be uninstalled');return result(paths,'uninstall','not-installed',null);}
  return locked(paths,false,async()=>{const state=await readState(paths);if(state.journal)throw new InstallerError('RECOVERY_REQUIRED','Run recover first',{},4);const p=await plan(paths,state.record,[]);
    const record={schemaVersion:/** @type {const} */(1),name:/** @type {const} */('tansr'),version:null,managedFiles:p.managedFiles,metadata:state.record?.metadata??{},complete:p.preserved.length===0,installedAt:new Date().toISOString(),lastTransactionId:null};
    const answer=await transact(paths,options,'uninstall',state.record,record,p.operations,p.preserved,null);
    // Only empty directories can be removed, never recursively delete a skill root.
    if(await maybeStat(paths.target)){await scanTree(paths.target);const directories=new Set();for(const op of p.operations){const parts=op.path.split('/');parts.pop();while(parts.length){directories.add(parts.join('/'));parts.pop();}}for(const directory of [...directories].sort((a,b)=>b.length-a.length))try{await validateDirectoryChain(path.join(paths.target,directory));await rmdir(path.join(paths.target,directory));}catch(error){if(!isFsError(error,'ENOTEMPTY')&&!isFsError(error,'EEXIST')&&!isFsError(error,'ENOENT'))throw error;}try{await rmdir(paths.target);}catch(error){if(!isFsError(error,'ENOTEMPTY')&&!isFsError(error,'EEXIST'))throw error;}}
    return answer;
  },options);
}
/** @param {unknown} raw @param {Paths} paths @returns {Journal} */
function validateJournal(raw,paths) {
  const j=/** @type {Journal} */(raw);
  if(!j||j.schemaVersion!==1||!uuid.test(j.txId)||j.targetPath!==paths.target||!['prepared','applying','committed'].includes(j.phase)||!Array.isArray(j.operations)||!Array.isArray(j.createdDirectories))throw new InstallerError('STATE_CORRUPT','Invalid transaction journal',{},4);
  validateRecord(j.beforeRecord);validateRecord(j.afterRecord);if(j.afterRecord.lastTransactionId!==j.txId)throw new InstallerError('STATE_CORRUPT','Transaction ID does not match resulting record',{},4);const seen=new Set();
  for(const op of j.operations){validateRelative(op.path);if(seen.has(portableKey(op.path)))throw new InstallerError('STATE_CORRUPT','Duplicate transaction path',{},4);seen.add(portableKey(op.path));if(!op.before&&!op.after)throw new InstallerError('STATE_CORRUPT','Empty transaction operation',{},4);for(const file of[op.before,op.after])if(file){if(file.path!==op.path)throw new InstallerError('STATE_CORRUPT','Transaction entry path mismatch',{},4);validateManifest({schemaVersion:1,name:'tansr',version:'0.0.0',files:[file]});}}
  const allowedDirectories=new Set(['']);for(const op of j.operations){const parts=op.path.split('/');parts.pop();while(parts.length){allowedDirectories.add(parts.join('/'));parts.pop();}}
  for(const directory of j.createdDirectories){if(!directory||typeof directory!=='object'||typeof directory.path!=='string'||![directory.dev,directory.ino,directory.birthtimeNs].every(v=>typeof v==='string'&&/^[0-9]+$/.test(v)))throw new InstallerError('STATE_CORRUPT','Created directory identity is invalid',{},4);if(directory.path!=='')validateRelative(directory.path);if(!allowedDirectories.has(directory.path))throw new InstallerError('STATE_CORRUPT','Journal cannot claim unrelated directories',{path:directory.path},4);}
  const before=new Map((j.beforeRecord?.managedFiles??[]).map(f=>[f.path,f])),after=new Map(j.afterRecord.managedFiles.map(f=>[f.path,f]));
  for(const op of j.operations)if(!sameEntry(op.before,before.get(op.path)??null)||!sameEntry(op.after,after.get(op.path)??null))throw new InstallerError('STATE_CORRUPT','Operation differs from installation ownership records',{path:op.path},4);
  for(const [p,file]of after)if(!seen.has(portableKey(p))&&!sameEntry(file,before.get(p)??null))throw new InstallerError('STATE_CORRUPT','Record claims a file without a transaction operation',{path:p},4);
  for(const p of before.keys())if(!after.has(p)&&!seen.has(portableKey(p))&&j.afterRecord.complete)throw new InstallerError('STATE_CORRUPT','Complete record dropped a managed file without an operation',{path:p},4);return j;
}
/** @param {FileEntry|null} a @param {FileEntry|null} b */
function sameEntry(a,b){return a===null||b===null?a===b:a.path===b.path&&a.bytes===b.bytes&&a.sha256===b.sha256&&a.mode===b.mode;}
/** Prove ownership by transaction facts before reading or moving any payload. Unknown names are never adopted.
 * @param {Paths} paths */
async function validateLegacy(paths){
  await readState(paths);const nodes=await scanTree(paths.state);
  /** @type {Map<string,'file'|'directory'>} */const allowed=new Map([['owner.json','file'],['record.json','file'],['journal.json','file'],['lock.json','file'],['transactions','directory'],['recovery-claims','directory']]);
  /** @type {Map<string,FileEntry>} */const payloads=new Map();
  const transactions=[...nodes].filter(([p,kind])=>kind==='directory'&&/^transactions\/[^/]+$/.test(p));
  for(const [root]of transactions){
    const id=root.slice('transactions/'.length);if(!uuid.test(id))throw new InstallerError('STATE_CONFLICT','Unknown transaction directory is preserved',{path:root});
    allowed.set(root,'directory');allowed.set(`${root}/transaction.json`,'file');allowed.set(`${root}/outcome.json`,'file');allowed.set(`${root}/stage`,'directory');allowed.set(`${root}/backup`,'directory');
    if(nodes.get(`${root}/transaction.json`)!=='file')throw new InstallerError('STATE_CONFLICT','Unregistered transaction contents are preserved',{path:root});
    const j=validateJournal(await json(path.join(paths.state,root,'transaction.json')),paths);if(j.txId!==id)throw new InstallerError('STATE_CORRUPT','Transaction directory differs from its journal',{path:root},4);
    for(const op of j.operations)for(const [area,file]of /** @type {const} */([['backup',op.before],['stage',op.after]]))if(file){
      const relative=`${root}/${area}/${file.path}`;allowed.set(relative,'file');payloads.set(relative,file);
      const parts=relative.split('/');parts.pop();while(parts.length){allowed.set(parts.join('/'),'directory');parts.pop();}
    }
  }
  for(const [relative,kind]of nodes){
    if(/^recovery-claims\/[0-9a-f-]+-[0-9]+\.json$/.test(relative)&&kind==='file'){allowed.set(relative,'file');continue;}
    if(allowed.get(relative)!==kind)throw new InstallerError('STATE_CONFLICT','Unknown installer state content is preserved',{path:relative});
  }
  if(nodes.has('journal.json')){const j=validateJournal(await json(path.join(paths.state,'journal.json')),paths);await verifyJournalCopy(paths,j);}
  for(const [relative,file]of payloads)if(nodes.has(relative)){const actual=await readRegular(path.join(paths.state,relative));if(actual.sha256!==file.sha256||actual.bytes.length!==file.bytes||(process.platform!=='win32'&&file.mode!==undefined&&actual.mode!==file.mode))throw new InstallerError('MIGRATION_CONFLICT','Managed migration data was changed; it is preserved',{path:relative},4);}
  for(const [relative]of nodes)if(relative.endsWith('/outcome.json')){const outcome=await json(path.join(paths.state,relative));if(outcome.status!=='rolled-back'||typeof outcome.at!=='string')throw new InstallerError('STATE_CORRUPT','Transaction outcome is invalid',{path:relative},4);}
  return new Set(nodes.keys());
}
/** @param {Paths} paths @param {Journal} journal */
async function verifyJournalCopy(paths,journal){const original=validateJournal(await json(path.join(transactionPaths(paths,journal).root,'transaction.json')),paths);if(original.txId!==journal.txId||JSON.stringify(original.operations)!==JSON.stringify(journal.operations)||JSON.stringify(original.beforeRecord)!==JSON.stringify(journal.beforeRecord)||JSON.stringify(original.afterRecord)!==JSON.stringify(journal.afterRecord))throw new InstallerError('STATE_CORRUPT','Active and archived transaction facts differ',{},4);}
/** @param {Options} options */
export async function recover(options) {
  const paths=await resolvePaths(options.targetPath);if((await inspectLayout(paths)).kind==='empty')return result(paths,'recover','nothing-to-recover',null);
  return locked(paths,true,async()=>{const state=await readState(paths);if(!state.journal)return result(paths,'recover','nothing-to-recover',state.record);const j=validateJournal(await json(path.join(paths.state,'journal.json')),paths);await verifyJournalCopy(paths,j);if(!isDeepStrictEqual(state.record,j.beforeRecord)&&!isDeepStrictEqual(state.record,j.afterRecord))throw new InstallerError('STATE_CORRUPT','Journal does not belong to the current installation record',{},4);
    if(j.phase==='committed') {for(const op of j.operations){if(op.after?!await matches(paths.target,op.after):Boolean(await maybeStat(path.join(paths.target,op.path))))throw new InstallerError('RECOVERY_CONFLICT','Committed target changed; retain journal',{path:op.path},4);}if(j.afterRecord.complete)for(const file of j.afterRecord.managedFiles)if(!await matches(paths.target,file))throw new InstallerError('RECOVERY_CONFLICT','Unchanged managed file changed after commit',{path:file.path},4);await writeJson(path.join(paths.state,'record.json'),j.afterRecord);await writeJson(path.join(transactionPaths(paths,j).root,'transaction.json'),j);await unlink(path.join(paths.state,'journal.json'));return result(paths,'recover','commit-recovered',j.afterRecord,[],j.afterRecord.complete?[]:[{path:'',reason:'incomplete-installation-record'}]);}
    await rollbackPending(paths,j);return result(paths,'recover','recovered',j.beforeRecord);
  },options);
}
/** Rollback refuses any changed operation path; unrelated unknown files remain untouched. @param {Options} options */
export async function rollback(options) {
  const paths=await resolvePaths(options.targetPath);await readLayoutState(paths);
  return locked(paths,false,async()=>{const state=await readState(paths);if(state.journal)throw new InstallerError('RECOVERY_REQUIRED','Run recover first',{},4);if(!state.record?.lastTransactionId)throw new InstallerError('NO_ROLLBACK','There is no managed rollback point');
    const old=validateJournal(await json(path.join(paths.state,'transactions',state.record.lastTransactionId,'transaction.json')),paths);if(old.phase!=='committed'||old.txId!==state.record.lastTransactionId||!isDeepStrictEqual(old.afterRecord,state.record))throw new InstallerError('STATE_CORRUPT','Rollback point is not the current committed transaction',{},4);
    const tx=transactionPaths(paths,old);/** @type {Operation[]} */const reverse=[];
    for(const op of old.operations){if(op.after?!await matches(paths.target,op.after):Boolean(await maybeStat(path.join(paths.target,op.path))))throw new InstallerError('USER_CHANGED','Rollback would overwrite a user change',{path:op.path});if(op.before&&!await matches(tx.backup,op.before))throw new InstallerError('RECOVERY_CONFLICT','Rollback backup was changed',{path:op.path},4);reverse.push({path:op.path,before:op.after,after:op.before});}
    const record=old.beforeRecord?{...old.beforeRecord,managedFiles:[...old.beforeRecord.managedFiles]}:{schemaVersion:/** @type {const} */(1),name:/** @type {const} */('tansr'),version:null,managedFiles:[],metadata:{},complete:true,installedAt:new Date().toISOString(),lastTransactionId:null};
    for(const file of record.managedFiles)if(!reverse.some(o=>o.path===file.path)&&!sameEntry(file,state.record.managedFiles.find(f=>f.path===file.path)??null))throw new InstallerError('ROLLBACK_CONFLICT','Previous ownership cannot be restored without replacing a user-deleted or unregistered file',{path:file.path});
    const current=await plan(paths,state.record,state.record.managedFiles);if(current.preserved.length)record.complete=false;return transact(paths,options,'rollback',state.record,record,reverse,current.preserved,tx.backup);
  },options);
}
