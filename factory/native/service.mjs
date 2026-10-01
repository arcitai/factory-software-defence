import { createHash, randomUUID } from 'node:crypto';
import { cpSync, existsSync, lstatSync, linkSync, mkdirSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { homedir } from 'node:os';
import { basename, dirname, isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readNative } from './setup.mjs';
import { connectBridge } from './bridge-client.mjs';
import { acquireProcessLock, activeProcessLock, inspectProcessLock } from './process-lock.mjs';

const packageRoot=fileURLToPath(new URL('../../',import.meta.url));
const canonicalPackage='factory-software-defence';
const legacyPackage='software-defence-factory';
const adoptionPhases=new Set(['preparing','prepared','old_stop_requested','old_stopped','new_unit_written','new_start_requested','new_ready','rollback_stopping_new','rollback_restoring_old','reopening','unresolved','adopted','rolled_back','aborted_before_stop']);
const adoptionFile=state=>join(state,'service-adoption.json');
const recovery='Preserve service-adoption.json, service.json, both pinned releases and native receipts. Inspect the user unit, process identity and owning bridge before any manual recovery; never replay a native turn.';
const serviceHash=value=>createHash('sha256').update(value).digest('hex').slice(0,16);
const serviceID=(state,repo)=>`factory-native-${serviceHash(`${state}\n${repo}`)}`;
const quote=value=>`"${String(value).replaceAll('\\','\\\\').replaceAll('"','\\"').replaceAll('$',()=> '$$').replaceAll('%','%%').replaceAll('\n','\\n')}"`;
const validPort=port=>Number.isSafeInteger(port)&&port>=1024&&port<=65535;
const unitText=({state,repo,node,runtime,port,verification})=>`[Unit]\nDescription=Factory native Codex Inbox\nStartLimitIntervalSec=0\n\n[Service]\nType=exec\nExecStartPre=${verification.map(quote).join(' ')}\nExecStart=${[node,join(runtime,'bin/software-defence-factory.mjs'),'serve','--state',state,'--port',String(port)].map(quote).join(' ')}\nRestart=on-failure\nRestartSec=10\nTimeoutStopSec=45\nKillMode=control-group\nUMask=0077\nNoNewPrivileges=true\n\n[Install]\nWantedBy=default.target\n`;
function callSystemctl(args) {
  return execFileSync('systemctl',['--user',...args],{encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:30000}).trim();
}
function atomicJSON(path,value) {
  const temp=`${path}.${randomUUID()}`;writeFileSync(temp,`${JSON.stringify(value,null,2)}\n`,{flag:'wx',mode:0o600});renameSync(temp,path);
}
function atomicText(path,value) {
  const temp=`${path}.${randomUUID()}`;writeFileSync(temp,value,{flag:'wx',mode:0o600});renameSync(temp,path);
}
function publishAdoption(state,operation) {
  const staged=join(state,`.service-adoption-${randomUUID()}.json`);
  writeFileSync(staged,`${JSON.stringify(operation,null,2)}\n`,{flag:'wx',mode:0o600});
  // Publish complete bytes exclusively; a torn staging write never becomes a gate.
  try {linkSync(staged,adoptionFile(state));}finally {rmSync(staged,{force:true});}
}
function readAdoption(state) {
  const path=adoptionFile(state);
  if(!existsSync(path))return null;
  const stat=lstatSync(path);
  if(!stat.isFile()||(stat.mode&0o077))throw new Error(`Private service adoption record is unsafe. ${recovery}`);
  let value;try {value=JSON.parse(readFileSync(path,'utf8'));}catch {throw new Error(`Private service adoption record is unreadable. ${recovery}`);}
  if(value?.version!==1||typeof value.token!=='string'||!/^[a-zA-Z0-9-]{16,100}$/.test(value.token)
    ||!adoptionPhases.has(value.phase)||!/^0\.\d+\.\d+$/.test(value.old_version||'')||!/^0\.\d+\.\d+$/.test(value.new_version||''))
    throw new Error(`Private service adoption record is invalid. ${recovery}`);
  return value;
}
export function pendingServiceAdoptionToken(state) {return readAdoption(state)?.token || null;}
function configPaths(state) {
  const xdg=process.env.XDG_CONFIG_HOME || join(homedir(),'.config');
  return {folder:join(xdg,'systemd','user'),record:join(state,'service.json')};
}
function verifyPackageRoot(root,{allowLegacy=false}={}) {
  const resolved=realpathSync(root);
  const pkg=JSON.parse(readFileSync(join(resolved,'package.json'),'utf8'));
  if (existsSync(join(resolved,'.git')) || !(pkg.name===canonicalPackage || (allowLegacy&&pkg.name===legacyPackage))
    || !/^0\.\d+\.\d+$/.test(pkg.version || ''))
    throw new Error('Native services can only pin an installed Factory package, never a mutable source checkout.');
  const yamlPath=join(resolved,'node_modules','yaml','package.json');
  if(!pkg.bundleDependencies?.includes('yaml')||!existsSync(yamlPath))
    throw new Error('Installed Factory release is incomplete: bundled yaml is missing.');
  const yaml=JSON.parse(readFileSync(yamlPath,'utf8'));
  if(yaml.name!=='yaml'||yaml.version!==pkg.dependencies?.yaml)
    throw new Error('Installed Factory release has an unexpected bundled yaml version.');
  return {root:resolved,name:pkg.name,version:pkg.version};
}
function runtimeDigest(root) {
  const digest=createHash('sha256');
  const walk=(folder,prefix='')=>{
    for(const entry of readdirSync(folder).sort()) {
      // npm's generated executable shims are not used by the Node service.
      if(entry==='.bin' && folder.endsWith('/node_modules'))continue;
      if(entry==='.git')throw new Error('Mutable checkout content cannot be pinned as a service release.');
      const relative=prefix+entry,path=join(folder,entry),stat=lstatSync(path);
      if(stat.isSymbolicLink())throw new Error('Pinned service release cannot contain symbolic links.');
      if(stat.isDirectory())walk(path,`${relative}/`);
      else if(stat.isFile()){digest.update(relative);digest.update('\0');digest.update(readFileSync(path));digest.update('\0');}
      else throw new Error('Pinned service release contains an unsupported file.');
    }
  };
  walk(root);return digest.digest('hex');
}
export function serviceManifest({state,config,root=packageRoot,port=7332,home=homedir(),folder=join(home,'.config','systemd','user'),runtime,allowLegacy=false}) {
  if(process.platform!=='linux')throw new Error('Native services currently support Linux user systemd only.');
  if(!validPort(port))throw new Error('Choose a loopback dashboard port from 1024 to 65535.');
  const source=verifyPackageRoot(root,{allowLegacy}),installed=runtime || join(state,'runtime',source.version);
  const id=serviceID(state,config.repo),unit=`${id}.service`;
  const runtime_sha256=runtimeDigest(source.root);
  // The verifier is embedded in the owned unit, outside the package it checks.
  // systemd runs it on every start, including automatic failure/boot restarts.
  const verifier=`import {createHash} from 'node:crypto';import {readdirSync,lstatSync,readFileSync} from 'node:fs';import {join} from 'node:path';\n${runtimeDigest.toString()}\nif(runtimeDigest(process.argv[1])!==process.argv[2])throw new Error('Pinned Factory runtime integrity mismatch; preserve and reconcile the release.');`;
  const verification=[config.node,'--input-type=module','-e',verifier,installed,runtime_sha256];
  const definition=unitText({state,repo:config.repo,node:config.node,runtime:installed,port,verification});
  return {id,unit,port,state,repo:config.repo,node:config.node,version:source.version,runtime:installed,
    folder,file:join(folder,unit),verification,runtime_sha256,definition,definition_sha256:createHash('sha256').update(definition).digest('hex')};
}
export function pinInstalledRuntime(state,source) {
  const folder=join(state,'runtime'),target=join(folder,source.version);
  mkdirSync(folder,{recursive:true,mode:0o700});
  const verified=verifyPackageRoot(source.root,{allowLegacy:true});
  if(verified.version!==source.version)throw new Error('Installed Factory release identity changed while pinning.');
  const expected=runtimeDigest(source.root);
  if(existsSync(target)) {
    const pkg=JSON.parse(readFileSync(join(target,'package.json'),'utf8'));
    if(pkg.name!==verified.name||pkg.version!==source.version)throw new Error('Pinned Factory runtime path contains a different release; preserve and inspect it.');
    if(runtimeDigest(target)!==expected)throw new Error('Pinned Factory runtime bytes differ from this installed release; preserve and inspect both.');
    return target;
  }
  const staging=join(folder,`.install-${randomUUID()}`);
  try {
    cpSync(source.root,staging,{recursive:true,errorOnExist:true,filter:path=>!path.split('/').includes('.git')&&!path.endsWith('/node_modules/.bin')});
    const pkg=JSON.parse(readFileSync(join(staging,'package.json'),'utf8'));
    if(pkg.name!==verified.name||pkg.version!==source.version)throw new Error('Factory runtime changed while it was being pinned.');
    if(runtimeDigest(staging)!==expected)throw new Error('Factory runtime bytes changed while it was being pinned.');
    renameSync(staging,target);
  } catch(error) {rmSync(staging,{recursive:true,force:true});throw error;}
  return target;
}
function ownedRecord(state) {
  const {record}=configPaths(state);
  if(!existsSync(record))return null;
  let value;try {value=JSON.parse(readFileSync(record,'utf8'));}catch {throw new Error('Native service record is unreadable; preserve it before changing systemd.');}
  if(value.version!==1||typeof value.unit!=='string'||!/^[a-z0-9-]+\.service$/.test(value.unit)||typeof value.definition_sha256!=='string')
    throw new Error('Native service record is invalid; preserve it before changing systemd.');
  const file=value.unit_file || join(configPaths(state).folder,value.unit);
  if(!isAbsolute(file)||basename(file)!==value.unit||!dirname(file).endsWith('/systemd/user'))
    throw new Error('Native systemd unit path is invalid; preserve and reconcile it before operating the service.');
  if(!existsSync(file)||createHash('sha256').update(readFileSync(file)).digest('hex')!==value.definition_sha256)
    throw new Error('Native systemd unit changed; preserve and reconcile it before operating the service.');
  return {...value,file};
}
async function prepareIdle(state,repo,{connect=connectBridge,maintenanceToken}={}) {
  const bridge=await connect(state,repo);
  const path=join(state,'maintenance.json');
  let operation=existsSync(path)?JSON.parse(readFileSync(path,'utf8')):null;
  if(!operation||operation.instance!==bridge.instance) {
    operation={instance:bridge.instance,token:maintenanceToken || randomUUID()};
    atomicJSON(path,operation);
  }
  const {token}=operation;
  if(typeof token!=='string'||!/^[a-zA-Z0-9-]{16,100}$/.test(token))throw new Error('Native maintenance record is invalid; preserve it before recovery.');
  const result=await bridge.request('/api/v1/maintenance/prepare',{instance:bridge.instance,token});
  if(result.instance!==bridge.instance || result.prepared!==true || result.token!==token)throw new Error('Native maintenance identity changed; operation refused.');
  return {...bridge,maintenanceToken:token};
}
export function assertStoppedReconciled(state) {
  if(existsSync(join(state,'serve.lock.reconcile')))
    throw new Error('Stopped service has unresolved process-lock reconciliation; preserve it before changing service state.');
  const lock=inspectProcessLock(join(state,'serve.lock'));
  if(lock==='active'||lock==='unknown'||(lock==='absent'&&existsSync(join(state,'bridge.json'))))
    throw new Error('Stopped service still has an active or unknown process/bridge identity; reconcile it before changing service state.');
  // Starting the bridge only reconnects history. Receipts are deliberately
  // retained; admission still reconciles native ownership before a new turn.
}
const readProcessCommand=pid=>readFileSync(`/proc/${pid}/cmdline`,'utf8').split('\0').filter(Boolean);
async function snapshot(state,record,{systemctl=callSystemctl,connect=connectBridge,processOwner=activeProcessLock,processCommand=readProcessCommand}={}) {
  const unitFile=record.file || record.unit_file;
  let active='unknown',pid=0,enabled='unknown',fragment='',tasks=null,controlGroup=null,reloadNeeded='unknown',dropIns=null;
  try {active=systemctl(['show',record.unit,'--property=ActiveState','--value']);}catch {active='unknown';}
  try {pid=Number(systemctl(['show',record.unit,'--property=MainPID','--value']))||0;}catch {}
  try {enabled=systemctl(['show',record.unit,'--property=UnitFileState','--value']);}catch {enabled='unknown';}
  try {fragment=systemctl(['show',record.unit,'--property=FragmentPath','--value']);}catch {}
  try {const value=systemctl(['show',record.unit,'--property=TasksCurrent','--value']);tasks=/^\d+$/.test(value)?Number(value):null;}catch {}
  try {controlGroup=systemctl(['show',record.unit,'--property=ControlGroup','--value']);}catch {}
  try {reloadNeeded=systemctl(['show',record.unit,'--property=NeedDaemonReload','--value']);}catch {}
  try {dropIns=systemctl(['show',record.unit,'--property=DropInPaths','--value']);}catch {}
  let healthy=false,native_instance=null;
  try {
    const bridge=await connect(state,record.repo),owner=processOwner(join(state,'serve.lock'));
    const expected=[record.node,join(record.runtime,'bin/software-defence-factory.mjs'),'serve','--state',state,'--port',String(record.port)];
    const executing=pid>0?processCommand(pid):[];
    native_instance=bridge.instance;healthy=active==='active'&&pid>0&&owner?.pid===pid&&fragment===unitFile&&reloadNeeded==='no'&&dropIns===''
      &&JSON.stringify(executing)===JSON.stringify(expected);
  }catch {}
  return {installed:true,id:record.id,unit:record.unit,state,runtime:record.runtime,version:record.release_version,
    port:record.port,loopback:`http://127.0.0.1:${record.port}`,active:active==='active',active_state:active,pid,
    fragment,tasks,control_group:controlGroup,reload_needed:reloadNeeded,drop_ins:dropIns,enabled:enabled==='enabled',healthy,native_instance};
}
function receiptDigest(state) {
  const digest=createHash('sha256');
  for(const folderName of ['receipts','issue-submissions']) {
    const folder=join(state,folderName);
    if(!existsSync(folder))continue;
    for(const name of readdirSync(folder).sort()) {
      const path=join(folder,name),stat=lstatSync(path);
      if(!stat.isFile())throw new Error('Native receipt identity is not a regular file; adoption refused.');
      digest.update(folderName);digest.update('\0');digest.update(name);digest.update('\0');digest.update(readFileSync(path));digest.update('\0');
    }
  }
  return digest.digest('hex');
}
function assertSettledIssueReceipts(state) {
  const folder=join(state,'issue-submissions');
  if(!existsSync(folder))return;
  for(const name of readdirSync(folder).filter(name=>name.endsWith('.json'))) {
    const path=join(folder,name);
    let record;
    try {if(!lstatSync(path).isFile())throw Error();record=JSON.parse(readFileSync(path,'utf8'));}catch {
      throw new Error('Issue submission state is unresolved; preserve and reconcile it before adoption.');
    }
    if(!['created','rejected'].includes(record?.state))
      throw new Error('Issue submission outcome is unresolved; reconcile it before adoption.');
  }
}
function assertOwnedAdoption(state,config,record) {
  if(record.id!==serviceID(state,config.repo)||record.unit!==`${record.id}.service`||record.state!==state
    ||record.repo!==config.repo||record.node!==config.node||!validPort(record.port)
    ||record.runtime!==join(state,'runtime',record.release_version)
    ||!isAbsolute(record.file)||!lstatSync(record.file).isFile()
    ||typeof record.runtime_sha256!=='string'||!/^[a-f0-9]{64}$/.test(record.runtime_sha256))
    throw new Error('Service identity differs from the selected native state; adoption refused.');
  const expected=serviceManifest({state,config,root:record.runtime,port:record.port,runtime:record.runtime,folder:dirname(record.file),allowLegacy:true});
  if(expected.definition_sha256!==record.definition_sha256||expected.runtime_sha256!==record.runtime_sha256
    ||expected.file!==record.file)
    throw new Error('Owned unit or prior pinned release identity changed; adoption refused.');
}
function assertServiceRecord(state,config,prior) {
  const current=ownedRecord(state);
  if(!current)throw new Error('Prior owned unit disappeared during adoption.');
  assertOwnedAdoption(state,config,current);
  if(current.definition_sha256!==prior.definition_sha256||current.runtime_sha256!==prior.runtime_sha256
    ||current.release_version!==prior.release_version||current.file!==(prior.file||prior.unit_file))
    throw new Error('Prior unit or installed release changed during adoption.');
}
const recordData=record=>{const {file,...value}=record;return value;};
function versionDecision(previous,next) {
  const old=previous.split('.').map(Number),target=next.split('.').map(Number);
  if(old.length!==3||target.length!==3||old.some(value=>!Number.isSafeInteger(value))||target.some(value=>!Number.isSafeInteger(value)))
    throw new Error('Service release version is invalid.');
  if(target[0]!==old[0]||target[1]!==old[1])throw new Error('A different 0.x minor release needs an explicit migration policy; adoption refused.');
  if(target[2]<old[2])throw new Error('Service adoption refuses a downgrade.');
  return target[2]===old[2]?'same':'newer';
}
function updateAdoption(state,operation,phase,extra={}) {
  const next={...operation,...extra,phase,updated_at:new Date().toISOString()};
  atomicJSON(adoptionFile(state),next);return next;
}
function archiveAdoption(state,operation,phase,extra={}) {
  const final=updateAdoption(state,operation,phase,extra),folder=join(state,'service-adoptions');
  mkdirSync(folder,{recursive:true,mode:0o700});
  const destination=join(folder,`${final.token}.json`);
  if(existsSync(destination))throw new Error(`Service adoption evidence path already exists. ${recovery}`);
  renameSync(adoptionFile(state),destination);
  return final;
}
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function waitForOwner(state,record,operation,ops,previousInstance) {
  const {connect,delay=pause,startupAttempts=20}=ops;
  let reason='The owning bridge did not become ready.';
  for(let attempt=0;attempt<startupAttempts;attempt++) {
    const current=await snapshot(state,record,ops);
    if(current.active_state==='failed'&&current.pid===0&&!current.healthy)
      return {ready:false,reason:'The selected service failed before its bridge became ready.'};
    if(current.active&&current.pid>0&&current.healthy&&current.native_instance!==previousInstance) {
      let bridge;
      try {bridge=await connect(state,record.repo);}
      catch {return {ready:false,unsafe:true,reason:'Owning bridge identity became unavailable during startup.'};}
      if(bridge.instance!==current.native_instance)return {ready:false,unsafe:true,reason:'Owning bridge identity changed during startup.'};
      atomicJSON(join(state,'maintenance.json'),{instance:bridge.instance,token:operation.token});
      try {
        const prepared=await bridge.request('/api/v1/maintenance/prepare',{instance:bridge.instance,token:operation.token});
        if(prepared.instance!==bridge.instance||prepared.token!==operation.token||prepared.prepared!==true)
          return {ready:false,unsafe:true,reason:'New owner did not confirm maintenance ownership.'};
        const status=await bridge.request('/api/v1/status');
        if(status.native_instance!==bridge.instance||status.repo!==record.repo||status.native!==true)
          return {ready:false,unsafe:true,reason:'Native status does not belong to the selected service.'};
        if(!Array.isArray(status.jobs)||status.jobs.some(job=>job.state==='running'||job.state==='unknown'))
          return {ready:false,unsafe:true,reason:'Native history became active or unknown during adoption.'};
        if(receiptDigest(state)!==operation.receipts_sha256)
          return {ready:false,unsafe:true,reason:'Native or issue receipts changed during adoption.'};
        if(status.native_readiness?.ready===true&&status.infrastructure?.native?.connected===true)
          return {ready:true,current,bridge};
        return {ready:false,reason:'The owning bridge is connected but native readiness is not confirmed.'};
      } catch(error) {
        if(error.status===409)return {ready:false,unsafe:true,reason:'Owning bridge refused idle maintenance reconciliation.'};
        return {ready:false,unsafe:true,reason:'Owning bridge or native readiness response is unavailable.'};
      }
    } else if(current.active&&current.native_instance===previousInstance) {
      return {ready:false,unsafe:true,reason:'The previous bridge instance still owns the service port.'};
    }
    if(attempt+1<startupAttempts)await delay(500);
  }
  return {ready:false,reason};
}
function stoppedOwner(state,record,ops) {
  return snapshot(state,record,ops).then(current=>{
    // Inactive systemd units may have unset task accounting after their cgroup
    // is released. An unavailable read or a retained group is not a stopped proof.
    const empty=current.tasks===0||(current.tasks===null&&current.control_group==='');
    if(!['inactive','failed'].includes(current.active_state)||current.pid!==0||!empty||current.healthy)
      throw new Error('Service stop outcome is not a reconciled inactive process.');
    assertStoppedReconciled(state);
    return current;
  });
}
function adoptionResult(status,operation,extra={}) {
  return {status,old_version:operation.old_version,new_version:operation.new_version,
    health:extra.health || 'unknown',rollback:extra.rollback || 'not_attempted',
    ...(extra.reason?{reason:extra.reason}:{}),...(extra.recovery?{recovery:extra.recovery}:{}),
    ...(extra.native_instance?{native_instance:extra.native_instance}:{}),
    evidence:status==='unresolved'?adoptionFile(operation.state):join(operation.state,'service-adoptions',`${operation.token}.json`)};
}
function unresolvedAdoption(state,operation,reason,rollback='blocked') {
  updateAdoption(state,operation,'unresolved',{reason,rollback});
  return adoptionResult('unresolved',operation,{reason,rollback,recovery,health:'unknown'});
}
async function finishAdoption(state,config,record,operation,owner,phase,extra,ops) {
  const confirm=async()=>{
    assertServiceRecord(state,config,record);
    const current=await snapshot(state,record,ops);
    if(!current.healthy||!current.enabled||current.pid!==owner.current.pid||current.native_instance!==owner.bridge.instance)
      throw new Error('Service owner changed during admission reopening.');
    const bridge=await ops.connect(state,config.repo),status=await bridge.request('/api/v1/status');
    if(bridge.instance!==owner.bridge.instance||status.native_instance!==bridge.instance||status.repo!==config.repo
      ||status.native_readiness?.ready!==true||status.infrastructure?.native?.connected!==true||status.maintenance_prepared!==false)
      throw new Error('Current bridge admission or readiness is unconfirmed.');
  };
  let archived=false;
  try {
    await confirm();
    rmSync(join(state,'maintenance.json'),{force:true});
    archiveAdoption(state,operation,'reopening',extra);archived=true;
    await confirm();
    atomicJSON(join(state,'service-adoptions',`${operation.token}.json`),
      {...operation,...extra,phase,updated_at:new Date().toISOString()});
    return null;
  } catch(error) {
    // A changed owner is preserved, never stopped or replayed to force success.
    if(archived&&!existsSync(adoptionFile(state)))publishAdoption(state,operation);
    return unresolvedAdoption(state,operation,error.message,phase==='rolled_back'?'incomplete':'blocked');
  }
}
async function rollbackAdoption(state,config,oldRecord,newRecord,operation,reason,ops) {
  let owned;
  try {owned=ownedRecord(state);}catch {return unresolvedAdoption(state,operation,`${reason} Replacement unit ownership is unknown.`);}
  if(!owned||owned.definition_sha256!==newRecord.definition_sha256||owned.runtime!==newRecord.runtime
    ||owned.runtime_sha256!==newRecord.runtime_sha256)
    return unresolvedAdoption(state,operation,`${reason} Replacement unit or pin changed before rollback.`);
  let current=await snapshot(state,newRecord,ops);
  if(current.active) {
    if(!current.healthy||current.pid<=0||current.native_instance===operation.old_instance)
      return unresolvedAdoption(state,operation,`${reason} New process ownership is unknown; rollback cannot stop it.`);
    const bridge=await ops.connect(state,config.repo).catch(()=>null);
    if(!bridge||bridge.instance!==current.native_instance)
      return unresolvedAdoption(state,operation,`${reason} New bridge identity cannot be confirmed.`);
    try {
      const prepared=await bridge.request('/api/v1/maintenance/prepare',{instance:bridge.instance,token:operation.token});
      if(prepared.instance!==bridge.instance||prepared.token!==operation.token||prepared.prepared!==true)
        return unresolvedAdoption(state,operation,`${reason} New bridge did not confirm idle ownership.`);
    } catch {
      return unresolvedAdoption(state,operation,`${reason} New native work is active or unknown; rollback refused.`);
    }
    if(receiptDigest(state)!==operation.receipts_sha256)
      return unresolvedAdoption(state,operation,`${reason} Receipts changed after new startup; rollback refused.`);
    try {
      assertServiceRecord(state,config,newRecord);
      const boundary=await snapshot(state,newRecord,ops);
      if(!boundary.healthy||!boundary.enabled||boundary.pid!==current.pid||boundary.native_instance!==current.native_instance)throw Error();
    } catch {return unresolvedAdoption(state,operation,`${reason} Replacement owner or unit changed before rollback stop.`);}
    operation=updateAdoption(state,operation,'rollback_stopping_new',{reason});
    try {ops.systemctl(['stop',newRecord.unit]);}
    catch {return unresolvedAdoption(state,operation,`${reason} New service stop outcome is uncertain.`);}
    try {await stoppedOwner(state,newRecord,ops);}
    catch {return unresolvedAdoption(state,operation,`${reason} New service did not confirm a stopped process.`);}
  } else {
    try {await stoppedOwner(state,newRecord,ops);}
    catch {return unresolvedAdoption(state,operation,`${reason} New process state is unknown.`);}
  }
  if(receiptDigest(state)!==operation.receipts_sha256)
    return unresolvedAdoption(state,operation,`${reason} Receipts changed; prior service remains stopped.`);
  if(runtimeDigest(oldRecord.runtime)!==oldRecord.runtime_sha256
    ||createHash('sha256').update(operation.old_definition).digest('hex')!==oldRecord.definition_sha256)
    return unresolvedAdoption(state,operation,`${reason} Prior unit or pin no longer matches its verified backup.`);
  try {
    assertServiceRecord(state,config,newRecord);
    const stopped=await stoppedOwner(state,newRecord,ops);
    if(!stopped.enabled||stopped.fragment!==newRecord.unit_file||stopped.reload_needed!=='no'||stopped.drop_ins!=='')throw Error();
  } catch {return unresolvedAdoption(state,operation,`${reason} Replacement unit changed before restoring the prior definition.`);}
  operation=updateAdoption(state,operation,'rollback_restoring_old',{reason});
  atomicText(oldRecord.file,operation.old_definition);
  atomicJSON(join(state,'service.json'),recordData(oldRecord));
  try {ops.systemctl(['daemon-reload']);}
  catch {return unresolvedAdoption(state,operation,`${reason} Prior unit reload outcome is uncertain.`,'incomplete');}
  try {ops.systemctl(['start',oldRecord.unit]);}
  catch {return unresolvedAdoption(state,operation,`${reason} Prior service restart outcome is uncertain.`,'incomplete');}
  const restored=await waitForOwner(state,oldRecord,operation,ops,operation.old_instance);
  if(!restored.ready)return unresolvedAdoption(state,operation,`${reason} Prior service readiness remains unconfirmed: ${restored.reason}`,'incomplete');
  try {
    const cancelled=await restored.bridge.request('/api/v1/maintenance/cancel',{instance:restored.bridge.instance,token:operation.token});
    if(cancelled.instance!==restored.bridge.instance||cancelled.prepared!==false)throw new Error('Maintenance cancel was ambiguous.');
  } catch {return unresolvedAdoption(state,operation,`${reason} Prior service was restored but admission reopening is uncertain.`,'incomplete');}
  const reopening=await finishAdoption(state,config,oldRecord,operation,restored,'rolled_back',
    {reason,rollback:'restored',restored_instance:restored.bridge.instance},ops);
  if(reopening)return reopening;
  return adoptionResult('adoption_failed',operation,{reason,rollback:'restored',health:'old_ready',native_instance:restored.bridge.instance});
}

// The executing installed package is the only candidate. No registry lookup,
// download, harness change, or native turn operation is part of adoption.
export async function adoptInstalledService(statePath,{read=readNative,sourceRoot=packageRoot,
  systemctl=callSystemctl,connect=connectBridge,processOwner=activeProcessLock,processCommand=readProcessCommand,delay=pause,startupAttempts=20}={}) {
  if(process.platform!=='linux')throw new Error('Native services currently support Linux user systemd only.');
  const {state,config}=read(statePath),release=acquireProcessLock(join(state,'service-operation.lock'),'Factory service operation');
  const ops={systemctl,connect,processOwner,processCommand,delay,startupAttempts};
  try {
    if(readAdoption(state))throw new Error(`A prior service adoption is unresolved. ${recovery}`);
    if(existsSync(join(state,'maintenance.json')))throw new Error('Existing maintenance needs explicit reconciliation before adoption.');
    const oldRecord=ownedRecord(state);
    if(!oldRecord)throw new Error('No owned Factory user service is installed.');
    assertOwnedAdoption(state,config,oldRecord);
    const source=verifyPackageRoot(sourceRoot),decision=versionDecision(oldRecord.release_version,source.version);
    const runtime=pinInstalledRuntime(state,source);
    const manifest=serviceManifest({state,config,root:runtime,port:oldRecord.port,runtime,folder:dirname(oldRecord.file)});
    const before=await snapshot(state,oldRecord,ops);
    if(!before.active||!before.healthy||!before.enabled||before.pid<=0||!before.native_instance)
      throw new Error('Prior service is not an active, enabled, verified owning bridge; adoption refused.');
    if(decision==='same')return {status:'no_op',old_version:oldRecord.release_version,new_version:source.version,
      health:'bridge_connected',rollback:'not_needed',native_instance:before.native_instance};
    if(JSON.parse(readFileSync(join(oldRecord.runtime,'package.json'),'utf8')).factoryService?.adoptionGate!==1)
      throw new Error('Prior runtime has no startup admission gate; an explicit migration is required before adoption.');
    const bridge=await connect(state,config.repo);
    if(bridge.instance!==before.native_instance)throw new Error('Prior service bridge instance changed before maintenance.');
    assertSettledIssueReceipts(state);
    const oldStatus=await bridge.request('/api/v1/status');
    if(oldStatus.native_instance!==bridge.instance||oldStatus.native_readiness?.ready!==true)
      throw new Error('Prior native readiness is not confirmed; adoption refused.');
    const token=randomUUID();
    const newRecord={version:1,id:oldRecord.id,unit:oldRecord.unit,port:oldRecord.port,state,repo:config.repo,node:config.node,
      runtime,runtime_sha256:manifest.runtime_sha256,release_version:source.version,
      unit_file:oldRecord.file,definition_sha256:manifest.definition_sha256};
    let operation={version:1,token,state,phase:'preparing',old_version:oldRecord.release_version,new_version:source.version,
      old_instance:before.native_instance,old_pid:before.pid,old_record:recordData(oldRecord),old_definition:readFileSync(oldRecord.file,'utf8'),
      new_record:newRecord,new_definition:manifest.definition,receipts_sha256:null,created_at:new Date().toISOString()};
    // Gate admission and automatic restart before preparing the current owner.
    publishAdoption(state,operation);
    let prepared;
    try {prepared=await prepareIdle(state,config.repo,{connect,maintenanceToken:token});}
    catch(error) {
      if(error.status===409) {
        try {
          assertServiceRecord(state,config,oldRecord);
          const current=await snapshot(state,oldRecord,ops);
          if(!current.healthy||current.pid!==before.pid||current.native_instance!==bridge.instance)throw Error();
          const cancelled=await bridge.request('/api/v1/maintenance/cancel',{instance:bridge.instance,token});
          if(cancelled.instance!==bridge.instance||cancelled.prepared!==false)throw Error();
          rmSync(join(state,'maintenance.json'),{force:true});
          archiveAdoption(state,operation,'aborted_before_stop',{rollback:'not_needed'});
        } catch {updateAdoption(state,operation,'unresolved',{reason:'Prior maintenance refusal could not be reconciled.',rollback:'blocked'});}
      } else updateAdoption(state,operation,'unresolved',{reason:'Prior maintenance outcome is unknown.',rollback:'blocked'});
      throw error;
    }
    if(prepared.instance!==before.native_instance||prepared.maintenanceToken!==token)
      throw new Error(`Prior service instance changed during maintenance. ${recovery}`);
    assertSettledIssueReceipts(state);
    assertServiceRecord(state,config,oldRecord);
    if(runtimeDigest(runtime)!==manifest.runtime_sha256)throw new Error('Target pinned release changed before stop; adoption refused.');
    const current=await snapshot(state,oldRecord,ops);
    if(!current.active||!current.healthy||!current.enabled||current.pid!==before.pid||current.native_instance!==prepared.instance)
      throw new Error(`Prior service identity changed after maintenance preparation. ${recovery}`);
    operation=updateAdoption(state,operation,'prepared',{receipts_sha256:receiptDigest(state)});
    try {
      assertServiceRecord(state,config,oldRecord);
      if(runtimeDigest(runtime)!==manifest.runtime_sha256)throw Error();
      const boundary=await snapshot(state,oldRecord,ops);
      if(!boundary.healthy||!boundary.enabled||boundary.pid!==before.pid||boundary.native_instance!==prepared.instance)throw Error();
    } catch {return unresolvedAdoption(state,operation,'Prior unit or startup ownership changed before stop.');}
    operation=updateAdoption(state,operation,'old_stop_requested');
    try {systemctl(['stop',oldRecord.unit]);}
    catch {return unresolvedAdoption(state,operation,'Prior service stop outcome is uncertain.');}
    try {
      const stopped=await stoppedOwner(state,oldRecord,ops);
      assertServiceRecord(state,config,oldRecord);
      if(!stopped.enabled||stopped.fragment!==oldRecord.file||stopped.reload_needed!=='no'||stopped.drop_ins!=='')throw Error();
    } catch {return unresolvedAdoption(state,operation,'Prior stopped owner or unit identity could not be confirmed.');}
    operation=updateAdoption(state,operation,'old_stopped');
    if(receiptDigest(state)!==operation.receipts_sha256)
      return unresolvedAdoption(state,operation,'Native or issue receipts changed while stopping the prior service.');
    try {atomicText(oldRecord.file,manifest.definition);atomicJSON(join(state,'service.json'),newRecord);}
    catch {return unresolvedAdoption(state,operation,'New unit or record replacement is incomplete; prior service remains stopped.');}
    operation=updateAdoption(state,operation,'new_unit_written');
    try {systemctl(['daemon-reload']);}
    catch {return rollbackAdoption(state,config,oldRecord,newRecord,operation,'New unit reload failed.',ops);}
    operation=updateAdoption(state,operation,'new_start_requested');
    try {systemctl(['start',oldRecord.unit]);}
    catch {return unresolvedAdoption(state,operation,'New service start outcome is uncertain.');}
    const started=await waitForOwner(state,newRecord,operation,ops,before.native_instance);
    if(!started.ready) {
      if(started.unsafe)return unresolvedAdoption(state,operation,started.reason);
      return rollbackAdoption(state,config,oldRecord,newRecord,operation,started.reason,ops);
    }
    operation=updateAdoption(state,operation,'new_ready',{new_instance:started.bridge.instance});
    try {
      const cancelled=await started.bridge.request('/api/v1/maintenance/cancel',{instance:started.bridge.instance,token});
      if(cancelled.instance!==started.bridge.instance||cancelled.prepared!==false)throw new Error('Maintenance cancel was ambiguous.');
    } catch {return unresolvedAdoption(state,operation,'New service is ready but admission reopening is uncertain.');}
    const reopening=await finishAdoption(state,config,newRecord,operation,started,'adopted',
      {rollback:'not_needed',new_instance:started.bridge.instance},ops);
    if(reopening)return reopening;
    return adoptionResult('adopted',operation,{health:'native_ready',rollback:'not_needed',native_instance:started.bridge.instance});
  } finally {release();}
}
export async function manageNativeService(action,statePath,port=7332) {
  if(action==='adopt')return adoptInstalledService(statePath);
  if(action==='status')return serviceAction(action,statePath,port);
  const {state}=readNative(statePath);
  const release=acquireProcessLock(join(state,'service-operation.lock'),'Factory service operation');
  try {return await serviceAction(action,statePath,port);}finally {release();}
}
async function serviceAction(action,statePath,port) {
  if(process.platform!=='linux')throw new Error('Native services currently support Linux user systemd only.');
  if(!['install','status','start','stop','restart','remove','cancel-maintenance'].includes(action))throw new Error('Use service install|status|start|stop|restart|remove|cancel-maintenance.');
  const {state,config}=readNative(statePath),{folder,record:recordPath}=configPaths(state);
  if(action==='status') {
    let pending;
    try {pending=readAdoption(state);}catch {
      return {installed:null,state,healthy:false,ownership:'unresolved',adoption_pending:{phase:'unreadable'},recovery};
    }
    const adoption_pending=pending?{phase:pending.phase,old_version:pending.old_version,new_version:pending.new_version}:null;
    let existing;
    try {existing=ownedRecord(state);}catch(error) {
      if(!pending)throw error;
      return {installed:null,state,healthy:false,ownership:'unresolved',adoption_pending,recovery};
    }
    return existing ? {...await snapshot(state,existing),adoption_pending}
      : {installed:false,state,repository:config.repo,adoption_pending};
  }
  if(readAdoption(state))throw new Error(`Service adoption is unresolved. ${recovery}`);
  if(action==='install') {
    if(existsSync(recordPath))throw new Error('Native service is already installed; use service status first.');
    assertStoppedReconciled(state);
    const source=verifyPackageRoot(packageRoot),runtime=pinInstalledRuntime(state,source);
    const manifest=serviceManifest({state,config,root:source.root,port,runtime,folder});
    mkdirSync(folder,{recursive:true,mode:0o700});
    if(existsSync(manifest.file))throw new Error(`Refusing to overwrite an unregistered systemd unit: ${manifest.file}`);
    callSystemctl(['--version']);
    writeFileSync(manifest.file,manifest.definition,{flag:'wx',mode:0o600});
    const record={version:1,id:manifest.id,unit:manifest.unit,port:manifest.port,state,repo:config.repo,node:config.node,
      runtime,runtime_sha256:manifest.runtime_sha256,release_version:manifest.version,unit_file:manifest.file,definition_sha256:manifest.definition_sha256};
    try {
      atomicJSON(recordPath,record);
      callSystemctl(['daemon-reload']);callSystemctl(['enable','--now',manifest.unit]);
    } catch(error) {
      // Keep the unit and record if systemd may have acted; status/reconciliation
      // can inspect them without losing the pinned runtime.
      throw new Error(`Native service installation is unresolved; preserve its pinned runtime and inspect ${manifest.unit}: ${error.message}`);
    }
    return snapshot(state,record);
  }
  const record=ownedRecord(state);
  if(!record) {
    if(action==='remove')return {installed:false,state,preserved:true};
    throw new Error('Native service is not installed.');
  }
  if(action==='cancel-maintenance') {
    const path=join(state,'maintenance.json');
    if(!existsSync(path))throw new Error('No recorded service maintenance to reconcile.');
    const operation=JSON.parse(readFileSync(path,'utf8')),bridge=await connectBridge(state,record.repo);
    if(operation.instance===bridge.instance)
      await bridge.request('/api/v1/maintenance/cancel',operation);
    rmSync(path);
    return {cancelled:true,state,instance:bridge.instance};
  }
  const before=await snapshot(state,record);
  if(action==='start') {
    if(before.active)throw new Error('Native service is already active.');
    assertStoppedReconciled(state);callSystemctl(['start',record.unit]);return snapshot(state,record);
  }
  let bridge=null;
  if(before.active) {
    if(!before.healthy)throw new Error('Active service has no matching owning bridge; native state is unknown.');
    bridge=await prepareIdle(state,record.repo);
    if(bridge.instance!==before.native_instance)throw new Error('Native service instance changed; operation refused.');
  } else {
    if(action==='stop')throw new Error('Native service is already stopped.');
    assertStoppedReconciled(state);
  }
  try {
  if(bridge) {
    const current=await snapshot(state,record);
    if(!current.active || current.pid!==before.pid || current.native_instance!==bridge.instance)
      throw new Error('Native service process changed after maintenance preparation; operation refused.');
  }
  if(action==='stop')callSystemctl(['stop',record.unit]);
  if(action==='restart')callSystemctl(['restart',record.unit]);
  if(action==='remove') {
    callSystemctl(['disable',...(before.active?['--now']:[]),record.unit]);
    rmSync(record.file);
    rmSync(recordPath);
    rmSync(join(state,'maintenance.json'),{force:true});
    callSystemctl(['daemon-reload']);
    return {installed:false,state,preserved:true,runtime:record.runtime};
  }
  } catch(error) {
    if(bridge)await bridge.request('/api/v1/maintenance/cancel',{instance:bridge.instance,token:bridge.maintenanceToken}).then(()=>rmSync(join(state,'maintenance.json'),{force:true})).catch(()=>{});
    throw error;
  }
  rmSync(join(state,'maintenance.json'),{force:true});
  return snapshot(state,record);
}
