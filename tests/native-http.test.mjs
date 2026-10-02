import test from 'node:test';
import http from 'node:http';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createNativeServer } from '../factory/native/server.mjs';

test('native HTTP requires session for issue reads and writes and exposes no legacy actions',async t=>{
  const state=mkdtempSync(join(tmpdir(),'factory-native-http-'));
  t.after(()=>rmSync(state,{recursive:true,force:true}));
  mkdirSync(join(state,'receipts'));mkdirSync(join(state,'issue-submissions'));
  const config={repo:join(state,'repo')};
  const harness={name:'fixture',available:true,jobs:async()=>[],doctor:async()=>({ready:true,gaps:[]}),assertWorkspaceIdle:async()=>{}};
  const provider={id:'unsupported',label:'Test',repository:null,host:null,supported:false,capabilities:{issues:false,templates:false,create:false}};
  const {server}=createNativeServer(state,config,{harness,provider,instance:'fixture-instance'});
  await new Promise((resolve,reject)=>server.once('error',reject).listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  const root=`http://127.0.0.1:${server.address().port}`;
  const status=await fetch(`${root}/api/v1/status`);
  assert.equal(status.status,200);
  assert.match(status.headers.get('content-security-policy'),/https:\/\/avatars\.githubusercontent\.com/);
  const data=await status.json();
  const bridge=await (await fetch(`${root}/api/v1/bridge/status`)).json();
  assert.deepEqual(Object.keys(bridge).sort(),['csrf_token','native','native_instance','operator_ingress','repo','version']);
  assert.equal(bridge.operator_ingress.configured,false);
  assert.equal(bridge.operator_ingress.listening,false);
  assert.match(bridge.operator_ingress.transport_qualification,/not established/);
  assert.equal(data.native_instance,'fixture-instance');
  assert.equal(data.harness,'fixture');
  assert.equal(data.native_capabilities.local_request,false);
  assert.equal(data.native_capabilities.continue_turn,false);
  assert.equal(data.native_capabilities.interrupt,false);
  assert.equal(data.native_capabilities.issue_create,false);
  assert.equal((await fetch(`${root}/api/v1/issues`)).status,403);
  const options={method:'POST',headers:{'content-type':'application/json'},body:'{}'};
  assert.equal((await fetch(`${root}/api/v1/issues/start`,options)).status,403);
  const authorized={...options,headers:{...options.headers,'x-factory-session':data.csrf_token}};
  assert.equal((await fetch(`${root}/api/v1/jobs/job_abcdef/publish`,authorized)).status,404);
  assert.equal((await fetch(`${root}/api/v1/native/rpc`,authorized)).status,404);
  assert.equal((await fetch(`${root}/api/v1/jobs/job_abcdef/continue`,authorized)).status,404);
  const rejectedHost=await new Promise((resolve,reject)=>{
    const request=http.get(`${root}/api/v1/status`,{headers:{host:'evil.example'}},response=>{
      response.resume();response.on('end',()=>resolve(response.statusCode));
    });request.on('error',reject);
  });
  assert.equal(rejectedHost,403);
  assert.equal((await fetch(`${root}/api/v1/status`,{headers:{origin:'https://evil.example'}})).status,403);
});

test('maintenance prepare waits for admitted writes, then rejects new writes until cancel',async t=>{
  const state=mkdtempSync(join(tmpdir(),'factory-native-maintenance-'));
  t.after(()=>rmSync(state,{recursive:true,force:true}));
  mkdirSync(join(state,'receipts'));mkdirSync(join(state,'issue-submissions'));
  let finish,started,starts=0,idleChecks=0;
  const admitted=new Promise(resolve=>{started=resolve;});
  const work=new Promise(resolve=>{finish=resolve;});
  const harness={name:'fixture',available:true,jobs:async()=>[],doctor:async()=>({ready:true,gaps:[]}),
    assertWorkspaceIdle:async()=>{idleChecks++;},start:async()=>{starts++;started();await work;return {id:'job_abcdef'};}};
  const provider={id:'unsupported',label:'Test',repository:null,host:null,supported:false,capabilities:{create:false}};
  const {server}=createNativeServer(state,{repo:join(state,'repo')},{harness,provider,instance:'one'});
  await new Promise((resolve,reject)=>server.once('error',reject).listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  const root=`http://127.0.0.1:${server.address().port}`;
  const status=await (await fetch(`${root}/api/v1/status`)).json();
  const post=(path,input)=>fetch(`${root}${path}`,{method:'POST',headers:{'content-type':'application/json','x-factory-session':status.csrf_token},body:JSON.stringify(input)});
  const first=post('/api/v1/issues/start',{});await admitted;
  const prepare=post('/api/v1/maintenance/prepare',{instance:'one',token:'operation-token-one'});
  for(let count=0;count<50;count++) {
    if((await (await fetch(`${root}/api/v1/status`)).json()).maintenance_prepared)break;
    await new Promise(resolve=>setTimeout(resolve,5));
  }
  assert.equal((await (await fetch(`${root}/api/v1/status`)).json()).maintenance_prepared,true);
  assert.equal((await post('/api/v1/issues/start',{})).status,409);
  assert.equal(idleChecks,0);
  assert.equal((await post('/api/v1/maintenance/cancel',{instance:'one',token:'operation-token-one'})).status,409);
  assert.equal((await post('/api/v1/maintenance/prepare',{instance:'one',token:'operation-token-two'})).status,409);
  finish();assert.equal((await first).status,201);
  assert.equal((await prepare).status,200);
  assert.equal((await post('/api/v1/maintenance/prepare',{instance:'one',token:'operation-token-one'})).status,200);
  assert.equal(idleChecks,2,'idempotent preparation must recheck native idle state');
  assert.equal(starts,1);
  assert.equal((await post('/api/v1/maintenance/cancel',{instance:'one',token:'operation-token-two'})).status,409);
  assert.equal((await post('/api/v1/issues/start',{})).status,409);
  assert.equal((await post('/api/v1/maintenance/cancel',{instance:'one',token:'operation-token-one'})).status,200);
  assert.equal((await post('/api/v1/issues/start',{})).status,201);
  assert.equal(starts,2);
});

test('pending service adoption closes admissions before the replacement bridge is visible',async t=>{
  const state=mkdtempSync(join(tmpdir(),'factory-native-adoption-gate-'));
  t.after(()=>rmSync(state,{recursive:true,force:true}));
  mkdirSync(join(state,'receipts'));mkdirSync(join(state,'issue-submissions'));
  writeFileSync(join(state,'service-adoption.json'),'pending');
  let starts=0,idleChecks=0;
  const harness={name:'fixture',available:true,jobs:async()=>[],doctor:async()=>({ready:true,gaps:[]}),
    assertWorkspaceIdle:async()=>{idleChecks++;},start:async()=>{starts++;return {id:'job_abcdef'};}};
  const provider={id:'unsupported',label:'Test',repository:null,host:null,supported:false,capabilities:{create:false}};
  const {server}=createNativeServer(state,{repo:join(state,'repo')},
    {harness,provider,instance:'replacement',maintenanceToken:'adoption-token-one'});
  await new Promise((resolve,reject)=>server.once('error',reject).listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  const root=`http://127.0.0.1:${server.address().port}`;
  const status=await (await fetch(`${root}/api/v1/status`)).json();
  assert.equal(status.maintenance_prepared,true);
  const post=(path,input)=>fetch(`${root}${path}`,{method:'POST',headers:{'content-type':'application/json','x-factory-session':status.csrf_token},body:JSON.stringify(input)});
  assert.equal((await post('/api/v1/issues/start',{})).status,409);
  assert.equal(starts,0);
  assert.equal((await post('/api/v1/maintenance/prepare',{instance:'replacement',token:'adoption-token-one'})).status,200);
  assert.equal(idleChecks,1);
  assert.equal((await post('/api/v1/maintenance/cancel',{instance:'replacement',token:'adoption-token-one'})).status,200);
  writeFileSync(join(state,'service-adoption.json'),'pending');
  assert.equal((await post('/api/v1/issues/start',{})).status,409);
  rmSync(join(state,'service-adoption.json'));
  assert.equal((await post('/api/v1/issues/start',{})).status,201);
  assert.equal(starts,1);
});


test('a restarted startup gate releases when its adoption receipt is archived',async t=>{
  const state=mkdtempSync(join(tmpdir(),'factory-adoption-startup-release-'));t.after(()=>rmSync(state,{recursive:true,force:true}));
  mkdirSync(join(state,'receipts'));mkdirSync(join(state,'issue-submissions'));writeFileSync(join(state,'service-adoption.json'),'pending');
  let starts=0;const harness={name:'fixture',available:true,jobs:async()=>[],doctor:async()=>({ready:true,gaps:[]}),assertWorkspaceIdle:async()=>{},start:async()=>{starts++;return {id:'job_abcdef'};}};
  const provider={id:'unsupported',label:'Test',repository:null,host:null,supported:false,capabilities:{create:false}};
  const {server}=createNativeServer(state,{repo:join(state,'repo')},{harness,provider,instance:'restarted',maintenanceToken:'pending-adoption-token'});
  await new Promise((resolve,reject)=>server.once('error',reject).listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
  const root=`http://127.0.0.1:${server.address().port}`,before=await (await fetch(root+'/api/v1/status')).json();assert.equal(before.maintenance_prepared,true);
  const post=()=>fetch(root+'/api/v1/issues/start',{method:'POST',headers:{'content-type':'application/json','x-factory-session':before.csrf_token},body:'{}'});
  assert.equal((await post()).status,409);rmSync(join(state,'service-adoption.json'));
  assert.equal((await (await fetch(root+'/api/v1/status')).json()).maintenance_prepared,false);
  assert.equal((await post()).status,201);assert.equal(starts,1);
});

test('issue API returns catalogued source phase separately from native state and keeps off-page history',async t=>{
  const state=mkdtempSync(join(tmpdir(),'factory-native-lifecycle-http-'));
  t.after(()=>rmSync(state,{recursive:true,force:true}));
  mkdirSync(join(state,'receipts'));mkdirSync(join(state,'issue-submissions'));
  let starts=0,continues=0;
  const repository='https://github.com/example/project';
  const jobs=[
    {id:'job_abcdef',state:'needs_review',workflow:{name:'software'},task:{title:'Completed native turn',source_url:`${repository}/issues/1`},created_at:'2026-09-01T00:00:00Z'},
    {id:'job_bcdef0',state:'running',workflow:{name:'software'},task:{title:'Closed issue still running',source_url:`${repository}/issues/4`},created_at:'2026-09-02T00:00:00Z'},
  ];
  let reopened=false;
  const harness={name:'fixture',available:true,jobs:async()=>jobs,doctor:async()=>({ready:true,gaps:[]}),
    start:async()=>{starts++;},continue:async()=>{continues++;}};
  const provider={id:'github',label:'GitHub',repository,supported:true,capabilities:{issues:true,templates:false,create:false},
    list:async(page,sourceState)=>({repository,next_page:sourceState==='open'&&page===1?2:null,issues:sourceState==='closed'
      ?reopened?[]:[{number:2,title:'Completed closure',url:`${repository}/issues/2`,state:'closed',state_reason:'completed',labels:[{name:'factory:review'}]}]
      :page===2?[{number:5,title:'Second provider page',url:`${repository}/issues/5`,state:'open',state_reason:null,labels:[{name:'factory:spec'}]}]
      :[{number:1,title:'Ready for work',url:`${repository}/issues/1`,state:'open',state_reason:null,assignees:null,labels:[{name:'factory:ready'}]},
        {number:3,title:'Conflicting labels',url:`${repository}/issues/3`,state:'open',state_reason:null,labels:[{name:'factory:ready'},{name:'factory:review'}]},
        ...(reopened?[{number:2,title:'Reopened work',url:`${repository}/issues/2`,state:'open',state_reason:'reopened',labels:[{name:'factory:ready'}]}]:[])]})};
  const {server}=createNativeServer(state,{repo:join(state,'repo')},{harness,provider,instance:'lifecycle-api'});
  await new Promise((resolve,reject)=>server.once('error',reject).listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  const root=`http://127.0.0.1:${server.address().port}`;
  const status=await (await fetch(`${root}/api/v1/status`)).json();
  const get=async query=>(await fetch(`${root}/api/v1/issues?${query}`,{headers:{'x-factory-session':status.csrf_token}})).json();
  const open=await get('page=1&state=open');
  assert.equal(open.next_page,2);
  assert.equal(open.issues[0].phase.id,'ready_to_implement');
  assert.equal(open.issues[0].assignees,null,'issue API preserves unavailable assignment metadata');
  assert.equal(open.work_records.find(record=>record.identity?.number===1).phase.id,'ready_to_implement');
  assert.equal(open.work_records.find(record=>record.identity?.number===1).issue.assignees,null,'issue API work records preserve unavailable assignment metadata');
  assert.equal(open.work_records.find(record=>record.identity?.number===1).state,'needs_review');
  assert.equal(open.work_records.find(record=>record.identity?.number===1).native_state.label,'Native turn completed · needs review');
  assert.equal(open.issues[1].phase.resolution,'conflicting');
  assert.equal(open.work_records.find(record=>record.identity?.number===4).source_status,'not_loaded');
  assert.equal(open.work_records.find(record=>record.identity?.number===4).state,'running');
  const secondPage=await get('page=2&state=open');
  assert.equal(secondPage.page,2);
  assert.equal(secondPage.issues[0].identity.key,'github:https://github.com/example/project:5');
  assert.equal(secondPage.issues[0].phase.id,'ready_to_spec');
  assert.equal(secondPage.work_records.find(record=>record.identity?.number===4).state,'running','page changes preserve off-page native history');
  const closed=await get('page=1&state=closed');
  assert.equal(closed.issues[0].phase.id,'done');
  assert.equal(closed.work_records.find(record=>record.identity?.number===2).phase.id,'done');
  reopened=true;
  const freshOpen=await get('page=1&state=open');
  assert.equal(freshOpen.issues.find(issue=>issue.number===2).phase.id,'ready_to_implement','fresh provider data moves a reopened issue back to its open phase');
  assert.equal((await get('page=1&state=closed')).issues.length,0,'a real reopen removes the issue from closed history');
  assert.equal(starts,0);assert.equal(continues,0,'provider reads and phase projection do not write native work');
});
