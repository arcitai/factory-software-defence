import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { adoptInstalledService, pinInstalledRuntime, serviceManifest } from '../factory/native/service.mjs';

function fixture(t,{targetVersion='0.18.4',targetReady=true,busy=false,unknownPrepare=false,
  startUncertain=false,newBridgeUnknown=false,newBridgeDisappears=false,newPrepareBusy=false,
  changeReceipts=false,wrongFragment=false,lingeringTasks=false,reloadNeeded=false}={}) {
  const root=mkdtempSync(join(tmpdir(),'factory-adopt-'));
  t.after(()=>rmSync(root,{recursive:true,force:true}));
  const state=join(root,'state'),repo=join(root,'repo'),unitFolder=join(root,'systemd','user');
  for(const folder of [state,repo,unitFolder,join(state,'receipts'),join(state,'issue-submissions')])mkdirSync(folder,{recursive:true,mode:0o700});
  const config={repo,node:process.execPath};
  const makePackage=(name,version,content)=>{
    const path=join(root,name);mkdirSync(join(path,'node_modules','yaml'),{recursive:true});mkdirSync(join(path,'bin'));
    writeFileSync(join(path,'package.json'),JSON.stringify({name:'software-defence-factory',version,
      dependencies:{yaml:'2.9.1'},bundleDependencies:['yaml']}));
    writeFileSync(join(path,'node_modules','yaml','package.json'),JSON.stringify({name:'yaml',version:'2.9.1'}));
    writeFileSync(join(path,'bin','software-defence-factory.mjs'),content);
    return path;
  };
  const oldPackage=makePackage('old-package','0.18.3','old installed package');
  const targetPackage=makePackage('target-package',targetVersion,'selected installed package');
  const runtime=pinInstalledRuntime(state,{root:oldPackage,version:'0.18.3'});
  const manifest=serviceManifest({state,config,root:oldPackage,runtime,folder:unitFolder,port:7332});
  writeFileSync(manifest.file,manifest.definition,{mode:0o600});
  const oldRecord={version:1,id:manifest.id,unit:manifest.unit,port:7332,state,repo,node:config.node,
    runtime,runtime_sha256:manifest.runtime_sha256,release_version:'0.18.3',unit_file:manifest.file,
    definition_sha256:manifest.definition_sha256};
  writeFileSync(join(state,'service.json'),JSON.stringify(oldRecord),{mode:0o600});
  writeFileSync(join(state,'receipts','retained.json'),'prior native history',{mode:0o600});
  const calls=[];let active=true,pid=101,instance='old-instance',unknown=newBridgeUnknown,newConnections=0;
  const selected=()=>JSON.parse(readFileSync(join(state,'service.json'),'utf8')).release_version;
  const systemctl=args=>{
    calls.push(args.join(' '));
    if(args[0]==='show') {
      if(args.includes('--property=ActiveState'))return active?'active':'inactive';
      if(args.includes('--property=MainPID'))return active?String(pid):'0';
      if(args.includes('--property=UnitFileState'))return 'enabled';
      if(args.includes('--property=FragmentPath'))return wrongFragment?join(root,'other.service'):manifest.file;
      if(args.includes('--property=TasksCurrent'))return active||lingeringTasks?'2':'0';
      if(args.includes('--property=NeedDaemonReload'))return reloadNeeded?'yes':'no';
    }
    if(args[0]==='stop'){active=false;pid=0;instance=null;return '';}
    if(args[0]==='daemon-reload')return '';
    if(args[0]==='start') {
      if(startUncertain)throw new Error('systemctl response lost');
      active=true;pid=selected()==='0.18.3'?303:202;instance=selected()==='0.18.3'?'restored-instance':'target-instance';
      if(changeReceipts&&selected()!=='0.18.3')writeFileSync(join(state,'receipts','new.json'),'new work');
      return '';
    }
    throw new Error(`Unexpected systemctl ${args.join(' ')}`);
  };
  const connect=async()=>{
    if(!active||!instance||(unknown&&selected()!=='0.18.3'))throw new Error('Bridge unavailable');
    if(selected()!=='0.18.3'&&newBridgeDisappears&&++newConnections>1)throw new Error('Bridge disappeared');
    const owner=instance;
    return {instance:owner,request:async(path,input)=>{
      calls.push(`bridge ${owner} ${path}`);
      if(path==='/api/v1/maintenance/prepare') {
        if(busy&&owner==='old-instance')throw Object.assign(new Error('Native work is active'),{status:409});
        if(newPrepareBusy&&owner==='target-instance')throw Object.assign(new Error('New native work is active'),{status:409});
        if(unknownPrepare&&owner==='old-instance')throw new Error('Response lost');
        return {instance:owner,token:input.token,prepared:true};
      }
      if(path==='/api/v1/maintenance/cancel')return {instance:owner,prepared:false};
      if(path==='/api/v1/status')return {native:true,native_instance:owner,repo,
        native_readiness:{ready:owner==='target-instance'?targetReady:true},
        infrastructure:{native:{connected:true}},jobs:[]};
      throw new Error(`Unexpected bridge request ${path}`);
    }};
  };
  const run=(sourceRoot=targetPackage)=>adoptInstalledService(state,{read:()=>({state,config}),sourceRoot,
    systemctl,connect,processOwner:()=>active?{pid}:null,delay:async()=>{},startupAttempts:1});
  return {root,state,repo,config,oldPackage,targetPackage,manifest,oldRecord,calls,run,
    get active(){return active;},get selected(){return selected();},set unknown(value){unknown=value;}};
}

test('adoption refuses mutable source, changed same-version bytes, downgrade and minor migration',async t=>{
  const h=fixture(t);
  mkdirSync(join(h.targetPackage,'.git'));
  await assert.rejects(h.run(),/mutable source checkout/);
  rmSync(join(h.targetPackage,'.git'),{recursive:true});
  assert.equal(h.calls.some(call=>call==='stop '+h.manifest.unit),false);
  const same=fixture(t,{targetVersion:'0.18.3'});
  await assert.rejects(same.run(),/runtime bytes differ/);
  const down=fixture(t,{targetVersion:'0.18.2'});
  await assert.rejects(down.run(),/downgrade/);
  const minor=fixture(t,{targetVersion:'0.19.0'});
  await assert.rejects(minor.run(),/minor release needs an explicit migration/);
});

test('same-version identical package is a no-op with no maintenance or systemd mutation',async t=>{
  const h=fixture(t);
  const result=await h.run(h.oldPackage);
  assert.deepEqual({status:result.status,old:result.old_version,next:result.new_version},
    {status:'no_op',old:'0.18.3',next:'0.18.3'});
  assert.equal(h.calls.some(call=>call.startsWith('bridge')||call.startsWith('stop')),false);
  assert.equal(existsSync(join(h.state,'service-adoption.json')),false);
});

test('busy and unknown old ownership refuse adoption before service stop',async t=>{
  const busy=fixture(t,{busy:true});
  await assert.rejects(busy.run(),/Native work is active/);
  assert.equal(busy.calls.includes(`stop ${busy.manifest.unit}`),false);
  const unknown=fixture(t,{unknownPrepare:true});
  await assert.rejects(unknown.run(),/Response lost/);
  assert.equal(unknown.calls.includes(`stop ${unknown.manifest.unit}`),false);
  assert.equal(existsSync(join(unknown.state,'maintenance.json')),true,'uncertain preparation keeps its token');
});

test('changed or unowned unit refuses adoption before stopping',async t=>{
  const h=fixture(t);
  writeFileSync(h.manifest.file,'changed unit');
  await assert.rejects(h.run(),/unit changed/);
  assert.equal(h.calls.includes(`stop ${h.manifest.unit}`),false);
  const unowned=fixture(t);
  writeFileSync(join(unowned.state,'service.json'),JSON.stringify({...unowned.oldRecord,id:'factory-native-other'}));
  await assert.rejects(unowned.run(),/Service identity differs/);
  assert.equal(unowned.calls.includes(`stop ${unowned.manifest.unit}`),false);
  const wrongProcess=fixture(t);
  await assert.rejects(adoptInstalledService(wrongProcess.state,{read:()=>({state:wrongProcess.state,config:wrongProcess.config}),
    sourceRoot:wrongProcess.targetPackage,systemctl:args=>{
      if(args.includes('--property=ActiveState'))return 'active';
      if(args.includes('--property=MainPID'))return '101';
      if(args.includes('--property=UnitFileState'))return 'enabled';
      if(args.includes('--property=FragmentPath'))return wrongProcess.manifest.file;
      if(args.includes('--property=TasksCurrent'))return '2';
      if(args.includes('--property=NeedDaemonReload'))return 'no';
      throw new Error('Unexpected service command');
    },connect:async()=>({instance:'old-instance'}),processOwner:()=>({pid:999})}),/verified owning bridge/);
  const wrongLoadedUnit=fixture(t,{wrongFragment:true});
  await assert.rejects(wrongLoadedUnit.run(),/verified owning bridge/);
  assert.equal(wrongLoadedUnit.calls.includes(`stop ${wrongLoadedUnit.manifest.unit}`),false);
  const staleLoadedUnit=fixture(t,{reloadNeeded:true});
  await assert.rejects(staleLoadedUnit.run(),/verified owning bridge/);
  assert.equal(staleLoadedUnit.calls.includes(`stop ${staleLoadedUnit.manifest.unit}`),false);
});

test('adoption switches one enabled unit, verifies native readiness and retains both pins and receipts',async t=>{
  const h=fixture(t),result=await h.run();
  assert.equal(result.status,'adopted',JSON.stringify(result));assert.equal(result.health,'native_ready');
  assert.equal(result.rollback,'not_needed');assert.equal(h.selected,'0.18.4');
  assert.equal(h.active,true);
  assert.equal(readFileSync(join(h.state,'receipts','retained.json'),'utf8'),'prior native history');
  assert.equal(existsSync(h.oldRecord.runtime),true);
  assert.equal(existsSync(join(h.state,'runtime','0.18.4')),true);
  assert.equal(existsSync(join(h.state,'service-adoption.json')),false);
  assert.equal(readdirSync(join(h.state,'service-adoptions')).length,1);
  assert.equal(h.calls.filter(call=>call===`stop ${h.manifest.unit}`).length,1);
  assert.equal(h.calls.filter(call=>call===`start ${h.manifest.unit}`).length,1);
});

test('failed new readiness restores a verified idle previous owner with failure disposition',async t=>{
  const h=fixture(t,{targetReady:false}),result=await h.run();
  assert.equal(result.status,'adoption_failed',JSON.stringify(result));assert.equal(result.rollback,'restored');
  assert.equal(result.health,'old_ready');assert.equal(h.selected,'0.18.3');
  assert.equal(h.active,true);
  assert.equal(readFileSync(h.manifest.file,'utf8'),h.manifest.definition);
  assert.equal(h.calls.filter(call=>call===`stop ${h.manifest.unit}`).length,2);
  assert.equal(existsSync(join(h.state,'runtime','0.18.4')),true);
});

test('uncertain start and unknown new owner preserve operation evidence without forced rollback',async t=>{
  const uncertain=fixture(t,{startUncertain:true}),first=await uncertain.run();
  assert.equal(first.status,'unresolved');assert.equal(first.rollback,'blocked');
  assert.equal(uncertain.selected,'0.18.4');
  assert.equal(existsSync(join(uncertain.state,'service-adoption.json')),true);
  assert.equal(uncertain.calls.filter(call=>call.startsWith('stop ')).length,1);
  const unknown=fixture(t,{newBridgeUnknown:true}),second=await unknown.run();
  assert.equal(second.status,'unresolved');assert.equal(second.rollback,'blocked');
  assert.equal(unknown.selected,'0.18.4');
  assert.equal(unknown.calls.filter(call=>call.startsWith('stop ')).length,1);
  const disappeared=fixture(t,{newBridgeDisappears:true}),third=await disappeared.run();
  assert.equal(third.status,'unresolved');assert.equal(third.rollback,'blocked');
  assert.equal(disappeared.calls.filter(call=>call.startsWith('stop ')).length,1);
});

test('new receipt during startup blocks rollback and preserves evidence',async t=>{
  const h=fixture(t,{targetReady:false,changeReceipts:true}),result=await h.run();
  assert.equal(result.status,'unresolved');assert.equal(result.rollback,'blocked');
  assert.equal(h.selected,'0.18.4');assert.equal(h.active,true);
  assert.equal(existsSync(join(h.state,'service-adoption.json')),true);
});

test('lingering systemd tasks leave stop outcome unresolved',async t=>{
  const h=fixture(t,{lingeringTasks:true}),result=await h.run();
  assert.equal(result.status,'unresolved');assert.equal(result.rollback,'blocked');
  assert.equal(h.selected,'0.18.3');
  assert.equal(existsSync(join(h.state,'service-adoption.json')),true);
  assert.equal(h.calls.some(call=>call.startsWith('start ')),false);
});

test('new native work during rollback preparation blocks service stop',async t=>{
  const h=fixture(t,{targetReady:false,newPrepareBusy:true}),result=await h.run();
  assert.equal(result.status,'unresolved');assert.equal(result.rollback,'blocked');
  assert.equal(h.active,true);assert.equal(h.selected,'0.18.4');
  assert.equal(h.calls.filter(call=>call===`stop ${h.manifest.unit}`).length,1);
  assert.equal(existsSync(join(h.state,'service-adoption.json')),true);
});
