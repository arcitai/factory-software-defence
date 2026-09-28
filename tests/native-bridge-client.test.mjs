import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import http from 'node:http';
import test from 'node:test';
import { registerBridge, connectBridge } from '../factory/native/bridge-client.mjs';

async function fixture(t, handle) {
  const state=mkdtempSync(join(tmpdir(),'factory-bridge-'));
  const server=http.createServer(handle);
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const port=server.address().port;
  const unregister=registerBridge(state,'/project',port,'instance-one');
  t.after(async()=>{
    unregister(); server.closeAllConnections();
    await new Promise(resolve=>server.close(resolve));
    rmSync(state,{recursive:true,force:true});
  });
  return {state,port,server,unregister};
}
const status = extra => ({native:true,repo:'/project',native_instance:'instance-one',csrf_token:'a'.repeat(64),jobs:[],...extra});
const send = (response, value, code=200) => {response.writeHead(code,{'content-type':'application/json'});response.end(JSON.stringify(value));};

test('CLI binds to the owning bridge and sends a single authenticated operation',async t=>{
  const calls=[];
  const f=await fixture(t,(req,res)=>{
    calls.push(req.url);
    if(req.url==='/api/v1/bridge/status')return send(res,status());
    assert.equal(req.headers['x-factory-session'],'a'.repeat(64));
    assert.equal(req.method,'POST');
    send(res,{thread_id:'native-thread'});
  });
  const client=await connectBridge(f.state,'/project');
  assert.equal(client.status.csrf_token,undefined);
  assert.deepEqual(await client.request('/api/v1/issues/start',{brief:'bounded'}),{thread_id:'native-thread'});
  assert.deepEqual(calls,['/api/v1/bridge/status','/api/v1/issues/start']);
});

test('a stale bridge instance cannot start work on another service',async t=>{
  let calls=0;
  const f=await fixture(t,(_req,res)=>{calls++;send(res,status({native_instance:'replacement'}));});
  await assert.rejects(connectBridge(f.state,'/project'),/not connected/);
  assert.equal(calls,1);
});

test('unconfirmed operation failure is never retried',async t=>{
  let mutations=0;
  const f=await fixture(t,(req,res)=>{
    if(req.url==='/api/v1/bridge/status')return send(res,status());
    mutations++;req.socket.destroy();
  });
  const client=await connectBridge(f.state,'/project');
  await assert.rejects(client.request('/api/v1/issues/start',{}),/outcome may be unknown/);
  assert.equal(mutations,1);
});

test('a prior bridge cleanup preserves its replacement reference',async t=>{
  const f=await fixture(t,(_req,res)=>send(res,status()));
  const file=join(f.state,'bridge.json');
  const record=JSON.parse(readFileSync(file));
  writeFileSync(file,JSON.stringify({...record,instance:'replacement'}));
  f.unregister();
  assert.equal(JSON.parse(readFileSync(file)).instance,'replacement');
});

test('provider or server rejection stays visible without fallback',async t=>{
  const f=await fixture(t,(req,res)=>req.url==='/api/v1/bridge/status'?send(res,status()):send(res,{error:'Native work is active'},409));
  const client=await connectBridge(f.state,'/project');
  await assert.rejects(client.request('/api/v1/maintenance/prepare',{}),/Native work is active/);
});
