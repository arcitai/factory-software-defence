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
  const data=await status.json();
  const bridge=await (await fetch(`${root}/api/v1/bridge/status`)).json();
  assert.deepEqual(Object.keys(bridge).sort(),['csrf_token','native','native_instance','repo','version']);
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
