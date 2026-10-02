import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { setupNative } from '../factory/native/setup.mjs';
import { adoptInstalledService, pinInstalledRuntime, serviceManifest, manageNativeService } from '../factory/native/service.mjs';
import { ingressDigest } from '../factory/native/ingress.mjs';

function fixture(t,{targetVersion='0.18.4',targetReady=true,busy=false,unknownPrepare=false,
  startUncertain=false,newBridgeUnknown=false,newBridgeDisappears=false,newPrepareBusy=false,
  changeReceipts=false,wrongFragment=false,lingeringTasks=false,reloadNeeded=false,
  tasksUnset=false,groupRetained=false,groupUnknown=false,rollbackGate=true,oldName='factory-software-defence',afterPrepare=()=>{},afterStop=()=>{},afterNewPrepare=()=>{},afterOldStatus=()=>{},inspectBeforePrepare=()=>{},restartAfterCancel=false,oldRuntimeOnTargetStart=false,dropIns='',dropInsUnknown=false,
  ingress=false,oldIngressCapability=true,targetIngressCapability=true,targetIngressListening=true}={}) {
  const root=mkdtempSync(join(tmpdir(),'factory-adopt-'));
  t.after(()=>rmSync(root,{recursive:true,force:true}));
  const state=join(root,'state'),repo=join(root,'repo'),unitFolder=join(root,'systemd','user');
  for(const folder of [state,repo,unitFolder,join(state,'receipts'),join(state,'issue-submissions')])mkdirSync(folder,{recursive:true,mode:0o700});
  const config={repo,node:process.execPath};
  const ingressConfig={version:1,origin:'https://inbox.example.test',identity_header:'x-operator-identity',identities:['owner@example.test']};
  if(ingress)writeFileSync(join(state,'ingress.json'),JSON.stringify(ingressConfig),{mode:0o600});
  const makePackage=(directory,version,content,packageName='factory-software-defence')=>{
    const path=join(root,directory);mkdirSync(join(path,'node_modules','yaml'),{recursive:true});mkdirSync(join(path,'bin'));
    writeFileSync(join(path,'package.json'),JSON.stringify({name:packageName,version,
      dependencies:{yaml:'2.9.1'},bundleDependencies:['yaml'],...(rollbackGate?{factoryService:{adoptionGate:1,
        ...(ingress&&(directory==='old-package'?oldIngressCapability:targetIngressCapability)?{privateIngress:1}:{})}}:{})}));
    writeFileSync(join(path,'node_modules','yaml','package.json'),JSON.stringify({name:'yaml',version:'2.9.1'}));
    writeFileSync(join(path,'bin','software-defence-factory.mjs'),content);
    return path;
  };
  const oldPackage=makePackage('old-package','0.18.3','old installed package',oldName);
  const targetPackage=makePackage('target-package',targetVersion,'selected installed package');
  const runtime=pinInstalledRuntime(state,{root:oldPackage,version:'0.18.3'});
  const manifest=serviceManifest({state,config,root:oldPackage,runtime,folder:unitFolder,port:7332,allowLegacy:oldName==='software-defence-factory'});
  writeFileSync(manifest.file,manifest.definition,{mode:0o600});
  const oldRecord={version:1,id:manifest.id,unit:manifest.unit,port:7332,state,repo,node:config.node,
    runtime,runtime_sha256:manifest.runtime_sha256,release_version:'0.18.3',unit_file:manifest.file,
    definition_sha256:manifest.definition_sha256};
  writeFileSync(join(state,'service.json'),JSON.stringify(oldRecord),{mode:0o600});
  writeFileSync(join(state,'receipts','retained.json'),'prior native history',{mode:0o600});
  const calls=[];let enabled=true,active=true,pid=101,instance='old-instance',unknown=newBridgeUnknown,newConnections=0,newPrepares=0,loadedDropIns=dropIns;
  const selected=()=>JSON.parse(readFileSync(join(state,'service.json'),'utf8')).release_version;
  const systemctl=args=>{
    calls.push(args.join(' '));
    if(args[0]==='show') {
      if(args.includes('--property=ActiveState'))return active?'active':'inactive';
      if(args.includes('--property=MainPID'))return active?String(pid):'0';
      if(args.includes('--property=UnitFileState'))return enabled?'enabled':'disabled';
      if(args.includes('--property=FragmentPath'))return wrongFragment?join(root,'other.service'):manifest.file;
      if(args.includes('--property=TasksCurrent'))return active||lingeringTasks?'2':tasksUnset?'[not set]':'0';
      if(args.includes('--property=ControlGroup')) {if(groupUnknown)throw Error('Unknown cgroup');return active||groupRetained?'/user.slice/fixture':'';}
      if(args.includes('--property=NeedDaemonReload'))return reloadNeeded?'yes':'no';
      if(args.includes('--property=DropInPaths')){if(dropInsUnknown)throw Error('Drop-ins unavailable');return loadedDropIns;}
    }
    if(args[0]==='stop'){active=false;pid=0;instance=null;afterStop({file:manifest.file,version:selected(),setDropIns:value=>{loadedDropIns=value;}});return '';}
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
        if(owner==='old-instance')inspectBeforePrepare();
        if(busy&&owner==='old-instance')throw Object.assign(new Error('Native work is active'),{status:409});
        if(owner==='target-instance')newPrepares++;
        if(newPrepareBusy&&owner==='target-instance'&&newPrepares>=2)throw Object.assign(new Error('New native work is active'),{status:409});
        if(unknownPrepare&&owner==='old-instance')throw new Error('Response lost');
        if(owner==='target-instance')afterNewPrepare({count:newPrepares,file:manifest.file,restart:()=>{pid=999;instance='other-owner';}});
        if(owner==='old-instance')afterPrepare({file:manifest.file,disable:()=>{enabled=false;}});
        return {instance:owner,token:input.token,prepared:true};
      }
      if(path==='/api/v1/maintenance/cancel') {if(restartAfterCancel&&owner==='target-instance'){pid=999;instance='new-after-cancel';}return {instance:owner,prepared:false};}
      if(path==='/api/v1/status') {if(owner==='old-instance')afterOldStatus();return {native:true,native_instance:owner,repo,
        native_readiness:{ready:owner==='target-instance'?targetReady:true},
        ...(ingress?{operator_ingress:{configured:true,config_sha256:ingressDigest(ingressConfig),listening:owner==='target-instance'?targetIngressListening:true}}:{}),
        infrastructure:{native:{connected:true}},maintenance_prepared:false,jobs:[]};}
      throw new Error(`Unexpected bridge request ${path}`);
    }};
  };
  const run=(sourceRoot=targetPackage)=>adoptInstalledService(state,{read:()=>({state,config}),sourceRoot,
    systemctl,connect,processOwner:()=>active?{pid}:null,delay:async()=>{},startupAttempts:1,processCommand:()=>[config.node,join(state,'runtime',oldRuntimeOnTargetStart?'0.18.3':selected(),'bin/software-defence-factory.mjs'),'serve','--state',state,'--port','7332']});
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

test('canonical target verifies a legacy installed pin without replacing its state or unit identity',async t=>{
  const h=fixture(t,{oldName:'software-defence-factory'}),result=await h.run();
  assert.equal(result.status,'adopted',JSON.stringify(result));
  assert.equal(h.selected,'0.18.4');
  assert.equal(JSON.parse(readFileSync(join(h.oldRecord.runtime,'package.json'),'utf8')).name,'software-defence-factory');
  assert.equal(JSON.parse(readFileSync(join(h.state,'runtime','0.18.4','package.json'),'utf8')).name,'factory-software-defence');
  assert.equal(JSON.parse(readFileSync(join(h.state,'service.json'),'utf8')).unit,h.oldRecord.unit);
  const collision=fixture(t,{oldName:'software-defence-factory',targetVersion:'0.18.3'});
  await assert.rejects(collision.run(),/different release/);
  assert.equal(collision.calls.some(call=>call.startsWith('stop ')),false);
});

test('adoption refuses an arbitrary package identity before service mutation',async t=>{
  const h=fixture(t),pkg=JSON.parse(readFileSync(join(h.targetPackage,'package.json'),'utf8'));
  writeFileSync(join(h.targetPackage,'package.json'),JSON.stringify({...pkg,name:'unrelated-package'}));
  await assert.rejects(h.run(),/installed Factory package/);
  assert.equal(h.calls.some(call=>call.startsWith('stop ')),false);
  const legacyTarget=fixture(t),legacyPkg=JSON.parse(readFileSync(join(legacyTarget.targetPackage,'package.json'),'utf8'));
  writeFileSync(join(legacyTarget.targetPackage,'package.json'),JSON.stringify({...legacyPkg,name:'software-defence-factory'}));
  await assert.rejects(legacyTarget.run(),/installed Factory package/);
  assert.equal(legacyTarget.calls.some(call=>call.startsWith('stop ')),false);
});

test('same-version identical package is a no-op with no maintenance or systemd mutation',async t=>{
  const h=fixture(t);
  const result=await h.run(h.oldPackage);
  assert.deepEqual({status:result.status,old:result.old_version,next:result.new_version},
    {status:'no_op',old:'0.18.3',next:'0.18.3'});
  assert.equal(h.calls.some(call=>call.startsWith('bridge')||call.startsWith('stop')),false);
  assert.equal(existsSync(join(h.state,'service-adoption.json')),false);
});

test('adoption retains private ingress, refuses unsupported releases and never claims transport qualification',async t=>{
  const h=fixture(t,{ingress:true}),before=readFileSync(join(h.state,'ingress.json'),'utf8');
  const result=await h.run();assert.equal(result.status,'adopted',JSON.stringify(result));
  assert.equal(readFileSync(join(h.state,'ingress.json'),'utf8'),before);
  assert.equal(result.tls_qualified,undefined);assert.equal(result.access_policy_qualified,undefined);
  for(const options of [{oldIngressCapability:false},{targetIngressCapability:false}]) {
    const unsupported=fixture(t,{ingress:true,...options});
    await assert.rejects(unsupported.run(),/compatible prior and target/);
    assert.equal(unsupported.calls.some(call=>call.startsWith('stop ')),false);
  }
  const malformed=fixture(t,{ingress:true});writeFileSync(join(malformed.state,'ingress.json'),'{}',{mode:0o600});
  await assert.rejects(malformed.run(),/configuration is invalid/);
  assert.equal(malformed.calls.some(call=>call.startsWith('stop ')),false);
});

test('missing live ingress remains unresolved and a changed selected config cannot pass adoption',async t=>{
  const missing=fixture(t,{ingress:true,targetIngressListening:false});
  assert.equal((await missing.run()).status,'unresolved');
  assert.equal(existsSync(join(missing.state,'service-adoption.json')),true);
  const changed=fixture(t,{ingress:true,afterPrepare:()=>writeFileSync(join(changed.state,'ingress.json'),JSON.stringify({
    version:1,origin:'https://other.example.test',identity_header:'x-operator-identity',identities:['owner@example.test']}),{mode:0o600})});
  await assert.rejects(changed.run(),/ingress configuration changed/);
  assert.equal(changed.calls.some(call=>call.startsWith('stop ')),false);
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


test('a stopped unit with unset task accounting needs an absent control group',async t=>{
  const empty=fixture(t,{tasksUnset:true});assert.equal((await empty.run()).status,'adopted');
  for(const options of [{tasksUnset:true,groupRetained:true},{tasksUnset:true,groupUnknown:true}]) {
    const h=fixture(t,options),result=await h.run();assert.equal(result.status,'unresolved');
    assert.equal(h.calls.some(call=>call.startsWith('start ')),false);
  }
});

test('unsettled issue submission outcomes block adoption before stop',async t=>{
  for(const state of ['pending','uncertain','unexpected']) {
    const h=fixture(t);writeFileSync(join(h.state,'issue-submissions','retained-request.json'),JSON.stringify({state}));
    await assert.rejects(h.run(),/Issue submission.*unresolved/);
    assert.equal(h.calls.some(call=>call.startsWith('stop ')),false);
  }
  const settled=fixture(t);writeFileSync(join(settled.state,'issue-submissions','retained-request.json'),JSON.stringify({state:'created'}));
  assert.equal((await settled.run()).status,'adopted');
});

test('unit changes or disabled startup during preparation refuse the stop',async t=>{
  const changed=fixture(t,{afterPrepare:({file})=>writeFileSync(file,'operator changed unit')});
  await assert.rejects(changed.run(),/unit changed/);assert.equal(changed.calls.some(call=>call.startsWith('stop ')),false);
  const disabled=fixture(t,{afterPrepare:({disable})=>disable()});
  await assert.rejects(disabled.run(),/identity changed/);assert.equal(disabled.calls.some(call=>call.startsWith('stop ')),false);
});

test('unit changed after stop is preserved instead of overwritten',async t=>{
  const h=fixture(t,{afterStop:({file})=>writeFileSync(file,'operator changed after stop')}),result=await h.run();
  assert.equal(result.status,'unresolved');assert.equal(readFileSync(h.manifest.file,'utf8'),'operator changed after stop');
  assert.equal(h.selected,'0.18.3');assert.equal(h.calls.some(call=>call.startsWith('start ')),false);
});

test('status reports pending adoption when unit and record replacement was partial',async t=>{
  const root=mkdtempSync(join(tmpdir(),'factory-adoption-partial-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
  const repo=join(root,'repo'),state=join(root,'state'),folder=join(root,'systemd','user');mkdirSync(repo);mkdirSync(folder,{recursive:true});
  execFileSync('git',['init','-q',repo]);setupNative(repo,state,process.execPath);
  const unit='factory-native-partial.service',file=join(folder,unit);
  writeFileSync(file,'new unit written before record');
  writeFileSync(join(state,'service.json'),JSON.stringify({version:1,unit,unit_file:file,definition_sha256:'a'.repeat(64)}));
  writeFileSync(join(state,'service-adoption.json'),JSON.stringify({version:1,token:'partial-adoption-token',phase:'old_stopped',old_version:'0.18.3',new_version:'0.18.4'}),{mode:0o600});
  const result=await manageNativeService('status',state);
  assert.equal(result.ownership,'unresolved');assert.equal(result.healthy,false);assert.equal(result.adoption_pending.phase,'old_stopped');
  assert.equal(readFileSync(file,'utf8'),'new unit written before record');
  writeFileSync(join(state,'service-adoption.json'),'partial JSON',{mode:0o600});
  const unreadable=await manageNativeService('status',state);
  assert.equal(unreadable.ownership,'unresolved');assert.equal(unreadable.adoption_pending.phase,'unreadable');
  assert.equal(readFileSync(join(state,'service-adoption.json'),'utf8'),'partial JSON');
  writeFileSync(join(state,'service-adoption.json'),JSON.stringify({version:1,token:'structurally-partial-token',old_version:'0.18.3',new_version:'0.18.4'}),{mode:0o600});
  assert.equal((await manageNativeService('status',state)).adoption_pending.phase,'unreadable');
});


test('an older runtime without startup gating needs explicit migration before adoption',async t=>{
  const h=fixture(t,{targetReady:false,rollbackGate:false});
  await assert.rejects(h.run(),/startup admission gate.*migration/);
  assert.equal(h.active,true);assert.equal(h.selected,'0.18.3');assert.equal(h.calls.some(call=>call.startsWith('stop ')),false);
});

test('rollback refuses a different replacement owner after maintenance preparation',async t=>{
  const h=fixture(t,{targetReady:false,afterNewPrepare:({count,restart})=>{if(count===2)restart();}}),result=await h.run();
  assert.equal(result.status,'unresolved');assert.equal(h.calls.filter(call=>call.startsWith('stop ')).length,1);
  assert.equal(h.active,true);assert.equal(h.selected,'0.18.4');
});

test('rollback preserves a unit changed while stopping the replacement',async t=>{
  const h=fixture(t,{targetReady:false,afterStop:({file,version})=>{if(version==='0.18.4')writeFileSync(file,'operator changed rollback unit');}}),result=await h.run();
  assert.equal(result.status,'unresolved');assert.equal(readFileSync(h.manifest.file,'utf8'),'operator changed rollback unit');
  assert.equal(h.selected,'0.18.4');assert.equal(h.calls.filter(call=>call.startsWith('start ')).length,1);
});

test('selected target pin changed during idle preparation refuses stop',async t=>{
  const h=fixture(t,{afterPrepare:({file})=>{writeFileSync(join(h.state,'runtime','0.18.4','bin','software-defence-factory.mjs'),'changed target');}});
  await assert.rejects(h.run(),/Target pinned release changed/);assert.equal(h.calls.filter(call=>call.startsWith('stop ')).length,0);
});


test('the adoption startup gate is published before old bridge preparation',async t=>{
  const h=fixture(t,{inspectBeforePrepare:()=>assert.equal(JSON.parse(readFileSync(join(h.state,'service-adoption.json'))).phase,'preparing')});
  assert.equal((await h.run()).status,'adopted');
});

test('exclusive initial adoption receipt publication never overwrites another owner',async t=>{
  const other=JSON.stringify({version:1,token:'other-service-operation',phase:'preparing'});
  const h=fixture(t,{afterOldStatus:()=>writeFileSync(join(h.state,'service-adoption.json'),other,{mode:0o600})});
  await assert.rejects(h.run(),/EEXIST/);
  assert.equal(readFileSync(join(h.state,'service-adoption.json'),'utf8'),other);
  assert.equal(h.calls.some(call=>call.startsWith('stop ')),false);
});


test('a replacement restart during reopening cannot be reported as adopted',async t=>{
  const h=fixture(t,{restartAfterCancel:true}),result=await h.run();
  assert.equal(result.status,'unresolved');assert.equal(h.active,true);assert.equal(h.selected,'0.18.4');
  assert.equal(existsSync(join(h.state,'service-adoption.json')),true);
  assert.equal(h.calls.filter(call=>call.startsWith('stop ')).length,1);
});

test('an old runtime restarted under the new record cannot pass replacement readiness',async t=>{
  const h=fixture(t,{oldRuntimeOnTargetStart:true}),result=await h.run();
  assert.equal(result.status,'unresolved');assert.equal(h.active,true);
  assert.equal(h.calls.filter(call=>call.startsWith('stop ')).length,1,'mismatched active runtime must not be stopped for rollback');
  assert.equal(existsSync(join(h.state,'service-adoption.json')),true);
});

test('unowned or unreadable loaded drop-ins refuse stop and late overrides refuse replacement',async t=>{
  for(const options of [{dropIns:'/unowned/override.conf'},{dropInsUnknown:true}]) {
    const h=fixture(t,options);await assert.rejects(h.run(),/verified owning bridge/);
    assert.equal(h.calls.some(call=>call.startsWith('stop ')),false);
  }
  const h=fixture(t,{afterStop:({setDropIns})=>setDropIns('/unowned/late.conf')}),result=await h.run();
  assert.equal(result.status,'unresolved');assert.equal(h.selected,'0.18.3');
  assert.equal(h.calls.some(call=>call.startsWith('start ')),false);
});
