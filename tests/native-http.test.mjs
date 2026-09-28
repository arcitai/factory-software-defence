import test from 'node:test';
import http from 'node:http';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createNativeServer } from '../factory/native/server.mjs';

test('native HTTP requires session for issue reads and writes and exposes no legacy actions',async t=>{
  const state=mkdtempSync(join(tmpdir(),'factory-native-http-'));
  t.after(()=>rmSync(state,{recursive:true,force:true}));
  mkdirSync(join(state,'receipts'));mkdirSync(join(state,'issue-submissions'));
  const config={repo:join(state,'repo')};
  const client={available:false,onNotification:()=>{}};
  const provider={id:'unsupported',label:'Test',repository:null,host:null,supported:false,capabilities:{issues:false,templates:false,create:false}};
  const {server}=createNativeServer(state,config,client,{provider});
  await new Promise((resolve,reject)=>server.once('error',reject).listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  const root=`http://127.0.0.1:${server.address().port}`;
  const status=await fetch(`${root}/api/v1/status`);
  assert.equal(status.status,200);
  const data=await status.json();
  assert.equal(data.native_capabilities.legacy_actions,false);
  assert.equal(data.native_capabilities.local_request,false);
  assert.equal(data.native_capabilities.follow_up_turn,false);
  assert.equal(data.native_capabilities.issue_create,false);
  assert.equal((await fetch(`${root}/api/v1/issues`)).status,403);
  const options={method:'POST',headers:{'content-type':'application/json'},body:'{}'};
  assert.equal((await fetch(`${root}/api/v1/issues/start`,options)).status,403);
  const authorized={...options,headers:{...options.headers,'x-factory-session':data.csrf_token}};
  assert.equal((await fetch(`${root}/api/v1/jobs/job_abcdef/publish`,authorized)).status,404);
  assert.equal((await fetch(`${root}/api/v1/native/rpc`,authorized)).status,404);
  const rejectedHost=await new Promise((resolve,reject)=>{
    const request=http.get(`${root}/api/v1/status`,{headers:{host:'evil.example'}},response=>{
      response.resume();response.on('end',()=>resolve(response.statusCode));
    });request.on('error',reject);
  });
  assert.equal(rejectedHost,403);
  assert.equal((await fetch(`${root}/api/v1/status`,{headers:{origin:'https://evil.example'}})).status,403);
});
