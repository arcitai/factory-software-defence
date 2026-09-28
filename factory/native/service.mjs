import { createHash, randomUUID } from 'node:crypto';
import { cpSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { homedir } from 'node:os';
import { basename, dirname, isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readNative } from './setup.mjs';
import { connectBridge } from './bridge-client.mjs';
import { inspectProcessLock } from './process-lock.mjs';

const packageRoot=fileURLToPath(new URL('../../',import.meta.url));
const serviceHash=value=>createHash('sha256').update(value).digest('hex').slice(0,16);
const serviceID=(state,repo)=>`factory-native-${serviceHash(`${state}\n${repo}`)}`;
const quote=value=>`"${String(value).replaceAll('\\','\\\\').replaceAll('"','\\"').replaceAll('$','$$').replaceAll('%','%%').replaceAll('\n','\\n')}"`;
const validPort=port=>Number.isSafeInteger(port)&&port>=1024&&port<=65535;
const unitText=({state,repo,node,runtime,port,verification})=>`[Unit]\nDescription=Factory native Codex Inbox\nStartLimitIntervalSec=0\n\n[Service]\nType=exec\nWorkingDirectory=${quote(repo)}\nExecStartPre=${verification.map(quote).join(' ')}\nExecStart=${[node,join(runtime,'bin/software-defence-factory.mjs'),'serve','--state',state,'--port',String(port)].map(quote).join(' ')}\nRestart=on-failure\nRestartSec=10\nTimeoutStopSec=45\nKillMode=control-group\nUMask=0077\nNoNewPrivileges=true\n\n[Install]\nWantedBy=default.target\n`;
function callSystemctl(args) {
  return execFileSync('systemctl',['--user',...args],{encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:30000}).trim();
}
function atomicJSON(path,value) {
  const temp=`${path}.${randomUUID()}`;writeFileSync(temp,`${JSON.stringify(value,null,2)}\n`,{flag:'wx',mode:0o600});renameSync(temp,path);
}
function configPaths(state) {
  const xdg=process.env.XDG_CONFIG_HOME || join(homedir(),'.config');
  return {folder:join(xdg,'systemd','user'),record:join(state,'service.json')};
}
function verifyPackageRoot(root) {
  const resolved=realpathSync(root);
  const pkg=JSON.parse(readFileSync(join(resolved,'package.json'),'utf8'));
  if (existsSync(join(resolved,'.git')) || pkg.name!=='software-defence-factory' || !/^0\.\d+\.\d+$/.test(pkg.version || ''))
    throw new Error('Native services can only pin an installed Factory package, never a mutable source checkout.');
  const yamlPath=join(resolved,'node_modules','yaml','package.json');
  if(!pkg.bundleDependencies?.includes('yaml')||!existsSync(yamlPath))
    throw new Error('Installed Factory release is incomplete: bundled yaml is missing.');
  const yaml=JSON.parse(readFileSync(yamlPath,'utf8'));
  if(yaml.name!=='yaml'||yaml.version!==pkg.dependencies?.yaml)
    throw new Error('Installed Factory release has an unexpected bundled yaml version.');
  return {root:resolved,version:pkg.version};
}
function runtimeDigest(root) {
  const digest=createHash('sha256');
  const walk=(folder,prefix='')=>{
    for(const entry of readdirSync(folder).sort()) {
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
export function serviceManifest({state,config,root=packageRoot,port=7332,home=homedir(),folder=join(home,'.config','systemd','user'),runtime}) {
  if(process.platform!=='linux')throw new Error('Native services currently support Linux user systemd only.');
  if(!validPort(port))throw new Error('Choose a loopback dashboard port from 1024 to 65535.');
  const source=verifyPackageRoot(root),installed=runtime || join(state,'runtime',source.version);
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
  const expected=runtimeDigest(source.root);
  if(existsSync(target)) {
    const pkg=JSON.parse(readFileSync(join(target,'package.json'),'utf8'));
    if(pkg.name!=='software-defence-factory'||pkg.version!==source.version)throw new Error('Pinned Factory runtime path contains a different release; preserve and inspect it.');
    if(runtimeDigest(target)!==expected)throw new Error('Pinned Factory runtime bytes differ from this installed release; preserve and inspect both.');
    return target;
  }
  const staging=join(folder,`.install-${randomUUID()}`);
  try {
    cpSync(source.root,staging,{recursive:true,errorOnExist:true,filter:path=>!path.split('/').includes('.git')});
    const pkg=JSON.parse(readFileSync(join(staging,'package.json'),'utf8'));
    if(pkg.name!=='software-defence-factory'||pkg.version!==source.version)throw new Error('Factory runtime changed while it was being pinned.');
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
async function prepareIdle(state,repo) {
  const bridge=await connectBridge(state,repo);
  const token=randomUUID();
  const result=await bridge.request('/api/v1/maintenance/prepare',{instance:bridge.instance,token});
  if(result.instance!==bridge.instance || result.prepared!==true || result.token!==token)throw new Error('Native maintenance identity changed; operation refused.');
  return {...bridge,maintenanceToken:token};
}
export function assertStoppedReconciled(state) {
  const lock=inspectProcessLock(join(state,'serve.lock'));
  if(lock==='active'||lock==='unknown'||(lock==='absent'&&existsSync(join(state,'bridge.json'))))
    throw new Error('Stopped service still has an active or unknown process/bridge identity; reconcile it before changing service state.');
  // Starting the bridge only reconnects history. Receipts are deliberately
  // retained; admission still reconciles native ownership before a new turn.
}
async function snapshot(state,record) {
  let active='unknown',pid=0,enabled='unknown';
  try {active=callSystemctl(['show',record.unit,'--property=ActiveState','--value']);}catch {active='not_found';}
  try {pid=Number(callSystemctl(['show',record.unit,'--property=MainPID','--value']))||0;}catch {}
  try {enabled=callSystemctl(['show',record.unit,'--property=UnitFileState','--value']);}catch {enabled='unknown';}
  let healthy=false,native_instance=null;
  try {const bridge=await connectBridge(state,record.repo);healthy=true;native_instance=bridge.instance;}catch {}
  return {installed:true,id:record.id,unit:record.unit,state,runtime:record.runtime,version:record.release_version,
    port:record.port,loopback:`http://127.0.0.1:${record.port}`,active:active==='active',active_state:active,pid,enabled:enabled==='enabled',healthy,native_instance};
}
export async function manageNativeService(action,statePath,port=7332) {
  if(process.platform!=='linux')throw new Error('Native services currently support Linux user systemd only.');
  if(!['install','status','start','stop','restart','remove'].includes(action))throw new Error('Use service install|status|start|stop|restart|remove.');
  const {state,config}=readNative(statePath),{folder,record:recordPath}=configPaths(state);
  if(action==='status') {
    const existing=ownedRecord(state);
    return existing ? snapshot(state,existing) : {installed:false,state,repository:config.repo};
  }
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
    callSystemctl(['disable','--now',record.unit]);
    rmSync(record.file);
    rmSync(recordPath);
    callSystemctl(['daemon-reload']);
    return {installed:false,state,preserved:true,runtime:record.runtime};
  }
  } catch(error) {
    if(bridge)await bridge.request('/api/v1/maintenance/cancel',{instance:bridge.instance,token:bridge.maintenanceToken}).catch(()=>{});
    throw error;
  }
  return snapshot(state,record);
}
