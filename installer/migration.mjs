// @ts-check
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { mkdir, rename } from 'node:fs/promises';
import { isDeepStrictEqual } from 'node:util';
import { InstallerError, isFsError } from './errors.mjs';
import { maybeStat, readRegular, scanTree, validateDirectoryChain, directoryIdentity } from './paths.mjs';

/** @typedef {Awaited<ReturnType<import('./paths.mjs').resolvePaths>>} Paths */
/** @typedef {{schemaVersion:1,name:string,targetPath:string,id:string,migrationId?:string}} Owner */
/** @typedef {{path:string,kind:'file'|'directory',sha256?:string,bytes?:number,mode?:number,dev:string,ino:string,birthtimeNs:string}} Node */
/** @typedef {{name:string,nodes:Node[]}} Item */
/** @typedef {{schemaVersion:1,name:'tansr-installer-migrated',targetPath:string,id:string,migrationId:string,destinationPath:string,phase:'pending'|'complete',sourceOwner:Owner,inventory:Item[]}} Marker */
/** @typedef {{kind:'empty'|'legacy'|'pending'|'current',marker?:Marker}} Layout */
/** @typedef {{writeJson:(p:string,value:unknown)=>Promise<void>,acquireLock:(paths:Paths,recover:boolean,onClaim?:()=>Promise<void>)=>Promise<()=>Promise<void>>,validateLegacy:(paths:Paths)=>Promise<Set<string>>,step:(name:string,detail:Record<string,unknown>)=>Promise<void>}} Hooks */
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const movedNames=new Set(['record.json','journal.json','transactions']);
/** @param {string} p */
async function json(p){try{return JSON.parse((await readRegular(p)).bytes.toString('utf8'));}catch(error){if(isFsError(error,'ENOENT'))throw new InstallerError('STATE_CONFLICT','State has no verified ownership marker; it is not adopted',{path:p});if(error instanceof SyntaxError)throw new InstallerError('STATE_CORRUPT','Migration state JSON is malformed',{path:p},4);throw error;}}
/** @param {unknown} raw @param {Paths} paths @returns {Owner} */
function owner(raw,paths){const o=/** @type {Owner} */(raw);if(!o||o.schemaVersion!==1||o.name!=='tansr-installer'||o.targetPath!==paths.target||!uuid.test(o.id))throw new InstallerError('STATE_CONFLICT','State ownership does not match this target',{statePath:paths.state});return o;}
/** @param {unknown} raw @param {Paths} paths @returns {Marker} */
function marker(raw,paths){
  const m=/** @type {Marker} */(raw);
  if(!m||m.schemaVersion!==1||m.name!=='tansr-installer-migrated'||m.targetPath!==paths.target||!uuid.test(m.id)||!uuid.test(m.migrationId)||m.destinationPath!==paths.state||!['pending','complete'].includes(m.phase)||!Array.isArray(m.inventory))throw new InstallerError('STATE_CONFLICT','Legacy migration marker does not match this target',{legacyStatePath:paths.legacyState});
  owner(m.sourceOwner,paths);if(m.sourceOwner.id!==m.id)throw new InstallerError('STATE_CONFLICT','Migration source owner differs');
  const names=new Set();for(const item of m.inventory){if(!item||!movedNames.has(item.name)||names.has(item.name)||!Array.isArray(item.nodes)||!item.nodes.length)throw new InstallerError('STATE_CORRUPT','Migration inventory is invalid',{},4);names.add(item.name);const seen=new Set();for(const n of item.nodes){if(!n||typeof n.path!=='string'||(n.path!==item.name&&!n.path.startsWith(`${item.name}/`))||n.path.split('/').some(p=>!p||p==='.'||p==='..'||p.includes('\\'))||seen.has(n.path)||!['file','directory'].includes(n.kind)||![n.dev,n.ino,n.birthtimeNs].every(v=>typeof v==='string'&&/^[0-9]+$/.test(v))||(n.kind==='file'&&(!/^[0-9a-f]{64}$/.test(n.sha256??'')||!Number.isSafeInteger(n.bytes)||/** @type {number} */(n.bytes)<0||!Number.isInteger(n.mode))))throw new InstallerError('STATE_CORRUPT','Migration node inventory is invalid',{},4);seen.add(n.path);}if(item.nodes[0].path!==item.name)throw new InstallerError('STATE_CORRUPT','Migration root is missing',{},4);}
  return m;
}
/** No writes and no adoption. A current state is authoritative only after the legacy barrier commits.
 * @param {Paths} paths @returns {Promise<Layout>} */
export async function inspectLayout(paths){
  const legacy=await maybeStat(paths.legacyState),current=await maybeStat(paths.state);
  if(!legacy){if(current)throw new InstallerError('STATE_CONFLICT','Current state has no legacy-version barrier; preserve both locations for inspection',{statePath:paths.state,legacyStatePath:paths.legacyState});return{kind:'empty'};}
  await validateDirectoryChain(paths.legacyState);await scanTree(paths.legacyState);
  const raw=await json(path.join(paths.legacyState,'owner.json'));
  if(raw?.name!=='tansr-installer-migrated'){owner(raw,paths);if(current)throw new InstallerError('STATE_CONFLICT','Legacy and current state both exist; neither is adopted',{statePath:paths.state,legacyStatePath:paths.legacyState});return{kind:'legacy'};}
  const m=marker(raw,paths);await validateSentinel(paths,m);
  if(m.phase==='pending')return{kind:'pending',marker:m};
  if(!current)throw new InstallerError('STATE_CONFLICT','Migrated state is missing; the old layout will not be recreated',{statePath:paths.state});
  const actual=owner(await json(path.join(paths.state,'owner.json')),paths);if(actual.id!==m.id||actual.migrationId!==m.migrationId)throw new InstallerError('STATE_CONFLICT','Current state differs from the migration barrier',{statePath:paths.state});
  return{kind:'current',marker:m};
}
/** @param {Paths} paths @param {Marker} m */
async function validateSentinel(paths,m){
  for(const [name,kind]of await scanTree(paths.legacyState)){
    if(name==='owner.json'||name==='lock.json'){if(kind!=='file')throw new InstallerError('STATE_CONFLICT','Migration control path is not a file',{path:name});continue;}
    if(name==='recovery-claims'&&kind==='directory'||/^recovery-claims\/[0-9a-f-]+-[0-9]+\.json$/.test(name)&&kind==='file')continue;
    if(m.phase==='pending'&&m.inventory.some(item=>name===item.name||name.startsWith(`${item.name}/`)))continue;
    throw new InstallerError('STATE_CONFLICT','Unknown legacy state content is preserved',{path:name});
  }
}
/** @param {string} root @param {string} name @param {Set<string>} approved @returns {Promise<Item>} */
async function snapshot(root,name,approved){
  const full=path.join(root,name),stat=await maybeStat(full);if(!stat)throw new InstallerError('MIGRATION_CONFLICT','Migration item disappeared',{path:full},4);
  const nodes=new Map([[name,/** @type {'file'|'directory'} */(stat.isDirectory()?'directory':'file')]]);
  if(stat.isDirectory())for(const [relative,kind]of await scanTree(full))nodes.set(`${name}/${relative}`,kind);
  // Re-scan names before reading: a file introduced after validation is still unknown data.
  for(const relative of nodes.keys())if(!approved.has(relative))throw new InstallerError('MIGRATION_CONFLICT','Unknown content appeared during migration; it is preserved without reading',{path:relative},4);
  /** @type {Node[]} */const entries=[];
  for(const [relative,kind]of nodes){const file=path.join(root,relative);if(kind==='directory')entries.push({path:relative,kind,...await directoryIdentity(file)});else{const read=await readRegular(file);entries.push({path:relative,kind,sha256:read.sha256,bytes:read.bytes.length,mode:read.mode,dev:String(read.stat.dev),ino:String(read.stat.ino),birthtimeNs:String(read.stat.birthtimeNs)});}}
  return{name,nodes:entries.sort((a,b)=>a.path.localeCompare(b.path))};
}
/** @param {string} root @param {Item} item */
async function verify(root,item){if(!isDeepStrictEqual(await snapshot(root,item.name,new Set(item.nodes.map(n=>n.path))),item))throw new InstallerError('MIGRATION_CONFLICT','Migration data changed; both locations are preserved',{path:path.join(root,item.name)},4);}
/** @param {Paths} paths @param {Marker} m */
async function validateDestination(paths,m){
  const actual=owner(await json(path.join(paths.state,'owner.json')),paths);if(actual.id!==m.id||actual.migrationId!==m.migrationId)throw new InstallerError('STATE_CONFLICT','Migration destination belongs to another operation',{statePath:paths.state});
  for(const [name,kind]of await scanTree(paths.state))if(!(name==='owner.json'&&kind==='file')&&!m.inventory.some(item=>name===item.name||name.startsWith(`${item.name}/`)))throw new InstallerError('STATE_CONFLICT','Unknown migration destination content is preserved',{path:name});
}
/** Keeps the old compatible lock at its original path throughout migration. No target file is changed.
 * @param {Paths} paths @param {boolean} recover @param {Hooks} hooks */
export async function prepareLayout(paths,recover,hooks){
  let layout=await inspectLayout(paths);
  const legacyPaths={...paths,state:paths.legacyState};
  if(layout.kind==='current'){
    // A crash after the authority switch can leave the old lock behind. Explicit recover releases it.
    if(await maybeStat(path.join(paths.legacyState,'lock.json'))){const release=await hooks.acquireLock(legacyPaths,recover,()=>hooks.step('recovery-claimed',{statePath:paths.legacyState}));await release();}
    return;
  }
  if(layout.kind==='pending'&&!recover)throw new InstallerError('RECOVERY_REQUIRED','State migration is incomplete; run recover explicitly',{statePath:paths.state,legacyStatePath:paths.legacyState},4);
  if(layout.kind==='legacy'){
    if(!recover&&await maybeStat(path.join(paths.legacyState,'journal.json')))throw new InstallerError('RECOVERY_REQUIRED','The legacy transaction requires recover before migration',{legacyStatePath:paths.legacyState},4);
    // Refuse unknown data before even creating a transient lock. Revalidate under the lock below.
    await hooks.validateLegacy(legacyPaths);
  }
  if(layout.kind==='empty'){
    await validateDirectoryChain(paths.parent,true);
    // Exclusive creation refuses another installer's directory, including a partially written owner.
    try{await mkdir(paths.legacyState,{mode:0o700});}catch(error){if(isFsError(error,'EEXIST'))throw new InstallerError('STATE_CONFLICT','Another installer created the legacy barrier; retry after inspecting its state');throw error;}
    const id=randomUUID();await hooks.writeJson(path.join(paths.legacyState,'owner.json'),{schemaVersion:1,name:'tansr-installer-migrated',targetPath:paths.target,id,migrationId:randomUUID(),destinationPath:paths.state,phase:'pending',sourceOwner:{schemaVersion:1,name:'tansr-installer',targetPath:paths.target,id},inventory:[]});
  }
  const release=await hooks.acquireLock(legacyPaths,recover,()=>hooks.step('recovery-claimed',{statePath:paths.legacyState}));
  try{
    layout=await inspectLayout(paths);if(layout.kind==='current')return;
    /** @type {Marker} */let m;
    if(layout.kind==='legacy'){
      if(!recover&&await maybeStat(path.join(paths.legacyState,'journal.json')))throw new InstallerError('RECOVERY_REQUIRED','The legacy transaction requires recover before migration',{legacyStatePath:paths.legacyState},4);
      const approved=await hooks.validateLegacy(legacyPaths);
      const sourceOwner=owner(await json(path.join(paths.legacyState,'owner.json')),paths),inventory=[];
      for(const name of movedNames)if(await maybeStat(path.join(paths.legacyState,name)))inventory.push(await snapshot(paths.legacyState,name,approved));
      m={schemaVersion:1,name:'tansr-installer-migrated',targetPath:paths.target,id:sourceOwner.id,migrationId:randomUUID(),destinationPath:paths.state,phase:'pending',sourceOwner,inventory};
      await hooks.writeJson(path.join(paths.legacyState,'owner.json'),m);
    }else if(layout.kind==='pending'&&layout.marker)m=layout.marker;else throw new InstallerError('STATE_CONFLICT','Migration ownership changed before locking');
    await hooks.step('migration-prepared',{migrationId:m.migrationId,statePath:paths.state,legacyStatePath:paths.legacyState});
    await validateDirectoryChain(paths.stateParent,true);
    if(!await maybeStat(paths.state)){
      try{await mkdir(paths.state,{mode:0o700});}catch(error){if(isFsError(error,'EEXIST'))throw new InstallerError('STATE_CONFLICT','Migration destination appeared concurrently');throw error;}
      await hooks.writeJson(path.join(paths.state,'owner.json'),{...m.sourceOwner,migrationId:m.migrationId});
    }
    await validateDestination(paths,m);
    for(const item of m.inventory){
      await validateSentinel(paths,m);await validateDestination(paths,m);
      const source=path.join(paths.legacyState,item.name),destination=path.join(paths.state,item.name),a=await maybeStat(source),b=await maybeStat(destination);
      if(Boolean(a)===Boolean(b))throw new InstallerError('MIGRATION_CONFLICT','Migration requires exactly one copy of each item; nothing is overwritten',{source,destination},4);
      if(a){await verify(paths.legacyState,item);await validateDirectoryChain(paths.legacyState);await validateDirectoryChain(paths.state);if(await maybeStat(destination))throw new InstallerError('MIGRATION_CONFLICT','Migration destination appeared',{destination},4);await rename(source,destination);}
      await verify(paths.state,item);await hooks.step('migration-moved',{migrationId:m.migrationId,item:item.name});
    }
    await validateDestination(paths,m);for(const item of m.inventory)await verify(paths.state,item);
    // Publishing the barrier is the authority switch; before this point only recover may continue.
    m.phase='complete';await validateSentinel(paths,m);await hooks.writeJson(path.join(paths.legacyState,'owner.json'),m);
    await hooks.step('migration-committed',{migrationId:m.migrationId,statePath:paths.state});
  }finally{await release();}
}
