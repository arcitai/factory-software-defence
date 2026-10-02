import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createNativeServer } from '../factory/native/server.mjs';
import { startNativeListeners } from '../factory/native/listeners.mjs';
import { ingressDigest, ingressFile, ingressSocket, prepareIngressSocket, readIngress, validateIngress } from '../factory/native/ingress.mjs';
import { manageNativeIngress } from '../factory/native/service.mjs';
import { acquireProcessLock } from '../factory/native/process-lock.mjs';
import { registerBridge } from '../factory/native/bridge-client.mjs';

const selected={version:1,origin:'https://inbox.example.test',identity_header:'x-operator-identity',identities:['owner@example.test']};
function stateFor(t) {
  const state=mkdtempSync(join(tmpdir(),'factory-ingress-'));
  t.after(()=>rmSync(state,{recursive:true,force:true}));
  mkdirSync(join(state,'receipts'));mkdirSync(join(state,'issue-submissions'));
  return state;
}
const writeConfig=(state,value=selected)=>writeFileSync(ingressFile(state),JSON.stringify(value),{mode:0o600});
function request(options,path='/api/v1/bridge/status',headers=[],input) {
  return new Promise((resolve,reject)=>{
    const req=http.request({...options,path,method:input===undefined?'GET':'POST',headers,agent:false},res=>{
      let text='';res.setEncoding('utf8');res.on('data',chunk=>{text+=chunk;});
      res.on('end',()=>resolve({status:res.statusCode,text,json:()=>JSON.parse(text)}));
    });
    req.on('error',reject);req.end(input===undefined?undefined:JSON.stringify(input));
  });
}
async function routeFixture(t,{ingress=selected}={}) {
  const state=stateFor(t);let drafts=0,writes=0;
  const provider={id:'fixture',label:'Test',repository:null,supported:true,capabilities:{create:true},
    list:async()=>({issues:[],next_page:null}),draft:async input=>{drafts++;return {title:input.title,spec:'Harmless draft'};},
    publish:async()=>{writes++;throw Error('No publication allowed');}};
  const harness={name:'fixture',available:true,jobs:async()=>[],doctor:async()=>({ready:true}),assertWorkspaceIdle:async()=>{},
    start:async()=>{writes++;throw Error('No native admission allowed');}};
  const listeners=createNativeServer(state,{repo:state},{harness,provider,instance:'ingress-test',ingress});
  const release=acquireProcessLock(join(state,'serve.lock'));
  let shutdown;
  try {shutdown=await startNativeListeners(listeners,state,0);}catch(error){release();throw error;}
  t.after(async()=>{await shutdown();release();});
  const port=listeners.server.address().port;
  const local=(path,headers=[],input)=>request({host:'127.0.0.1',port},path,['Host',`127.0.0.1:${port}`,...headers],input);
  const remote=(path,headers=[],input)=>request({socketPath:ingressSocket(state)},path,
    ['Host',new URL(ingress?.origin||selected.origin).host,'x-operator-identity','owner@example.test',...headers],input);
  return {state,port,listeners,shutdown,local,remote,get drafts(){return drafts;},get writes(){return writes;}};
}

test('private sidecar is strict, canonical, private and absent by default',t=>{
  const state=stateFor(t);assert.equal(readIngress(state),null);
  for(const value of [null,[],{...selected,version:2},{...selected,extra:true},{...selected,origin:'http://inbox.example.test'},
    {...selected,origin:'https://*.example.test'},{...selected,origin:'https://inbox.example.test/'},
    {...selected,origin:'https://inbox.example.test:443'},{...selected,origin:'https://INBOX.example.test'},
    {...selected,origin:'https://inbox.example.test.'},{...selected,origin:'https://inbox.example.test:0'},
    {...selected,origin:'https://user@inbox.example.test'},{...selected,origin:'https://inbox.example.test/#fragment'},
    {...selected,identity_header:'origin'},{...selected,identity_header:'x-forwarded-host'},
    {...selected,identity_header:'sec-fetch-site'},{...selected,identity_header:'x-factory-session'},
    {...selected,identities:[]},{...selected,identities:['*']},{...selected,identities:['*','*']},{...selected,identities:['owner,other']},
    {...selected,identities:[' owner']},{...selected,identities:['owner\nother']}])assert.throws(()=>validateIngress(value),/invalid/);
  assert.equal(validateIngress({...selected,origin:'https://inbox.example.test:8443'}).origin,'https://inbox.example.test:8443');
  assert.equal(validateIngress({...selected,identity_header:'tailscale-user-login'}).identity_header,'tailscale-user-login');
  writeConfig(state);assert.deepEqual(readIngress(state),selected);
  chmodSync(ingressFile(state),0o644);assert.throws(()=>readIngress(state),/invalid/);rmSync(ingressFile(state));
  const privateFile=join(state,'private.json');writeFileSync(privateFile,JSON.stringify(selected),{mode:0o600});
  symlinkSync(privateFile,ingressFile(state));assert.throws(()=>readIngress(state),/invalid/);
});

test('configured nondefault HTTPS port requires that exact Host and Origin',async t=>{
  const origin='https://inbox.example.test:8443',f=await routeFixture(t,{ingress:{...selected,origin}});
  assert.equal((await f.remote(undefined,['Origin',origin])).status,200);
  for(const [host,requestOrigin] of [['inbox.example.test',origin],['inbox.example.test:8443',selected.origin],
    ['inbox.example.test:8444',origin],['inbox.example.test:8443','https://inbox.example.test:8444']]) {
    assert.equal((await request({socketPath:ingressSocket(f.state)},'/api/v1/bridge/status',
      ['Host',host,'Origin',requestOrigin,'x-operator-identity','owner@example.test'])).status,403);
  }
});

test('TCP and Unix isolate authority and identity while sharing session, API and harmless draft',async t=>{
  const f=await routeFixture(t);
  const local=(await f.local()).json(),remote=(await f.remote()).json();
  assert.equal(local.csrf_token,remote.csrf_token);assert.equal(local.native_instance,remote.native_instance);
  assert.equal(remote.operator_ingress.listening,true);assert.equal(remote.operator_ingress.config_sha256,ingressDigest(selected));
  assert.equal(JSON.stringify(remote).includes(selected.identities[0]),false);
  const session=['x-factory-session',remote.csrf_token];
  assert.equal((await f.remote('/api/v1/issues',session)).status,200);
  assert.equal((await f.remote('/api/v1/issues')).status,403);
  assert.equal((await f.remote('/api/v1/issues',['x-factory-session','invalid'])).status,403);
  assert.equal((await f.remote('/api/v1/issues',[...session,...session])).status,403);
  const draftHeaders=[...session,'Origin',selected.origin,'Sec-Fetch-Site','same-origin','Content-Type','application/json'];
  assert.equal((await f.remote('/api/v1/issue-templates/draft',draftHeaders,{title:'Transport preview'})).status,200);
  assert.equal((await f.remote('/api/v1/issue-templates/draft',['Origin',selected.origin,'Content-Type','application/json'],{})).status,403);
  const maintenance={instance:'ingress-test',token:'transport-maintenance-token'};
  assert.equal((await f.local('/api/v1/maintenance/prepare',[...session,'Content-Type','application/json'],maintenance)).status,200);
  assert.equal((await f.remote('/api/v1/issue-templates/draft',draftHeaders,{title:'Blocked during shared maintenance'})).status,409);
  assert.equal((await f.remote('/api/v1/maintenance/cancel',draftHeaders,maintenance)).status,200);
  assert.equal((await f.local('/api/v1/issues',session)).status,200);
  const localHeaders=['Host',`localhost:${f.port}`,'Origin',`http://localhost:${f.port}`,...session];
  assert.equal((await request({host:'127.0.0.1',port:f.port},'/api/v1/issues',localHeaders)).status,200);
  assert.equal((await request({host:'127.0.0.1',port:f.port},'/api/v1/bridge/status',
    ['Host','inbox.example.test','Origin',selected.origin,'x-operator-identity','owner@example.test',
      'X-Forwarded-Host',`localhost:${f.port}`,'X-Forwarded-Origin',`http://localhost:${f.port}`])).status,403);
  assert.equal((await f.local(undefined,['Origin',selected.origin,'x-operator-identity','owner@example.test'])).status,403);
  assert.equal((await f.local(undefined,['X-Forwarded-Host','inbox.example.test','X-Forwarded-Origin',selected.origin])).status,200,
    'forwarded headers have no authority over the TCP route');
  for(const headers of [[],['x-operator-identity','other@example.test'],['x-operator-identity','owner@example.test,other@example.test'],
    ['x-operator-identity','owner@example.test','X-Operator-Identity','owner@example.test']]) {
    assert.equal((await request({socketPath:ingressSocket(f.state)},'/api/v1/bridge/status',['Host','inbox.example.test',...headers])).status,403);
  }
  for(const [host,origin,site] of [['localhost','https://inbox.example.test','same-origin'],
    ['inbox.example.test:443',selected.origin,'same-origin'],['inbox.example.test.evil',selected.origin,'same-origin'],
    ['inbox.example.test','https://evil.example.test','same-site'],['inbox.example.test',selected.origin+'/', 'same-origin'],
    ['inbox.example.test','null','same-origin'],['inbox.example.test',selected.origin,'cross-site'],
    ['inbox.example.test',selected.origin,'same-origin, cross-site']]) {
    assert.equal((await request({socketPath:ingressSocket(f.state)},'/api/v1/issues',
      ['Host',host,'Origin',origin,'Sec-Fetch-Site',site,'x-operator-identity','owner@example.test',...session,
        'X-Forwarded-Host','inbox.example.test','X-Forwarded-Origin',selected.origin])).status,403);
  }
  assert.equal((await f.remote(undefined,['Host','inbox.example.test'])).status,403);
  assert.equal((await f.remote(undefined,['Origin',selected.origin,'Origin',selected.origin])).status,403);
  assert.equal((await f.remote('https://evil.example.test/api/v1/status')).status,403);
  const index=await f.remote('/');assert.equal(index.status,200);
  const asset=index.text.match(/(?:src|href)="(\/assets\/[^\"]+\.(?:js|css))"/);
  assert.ok(asset,'installed/built UI must supply static assets');assert.equal((await f.remote(asset[1])).status,200);
  assert.equal(f.drafts,1);assert.equal(f.writes,0);
});

test('socket cleanup preserves replacements, unsafe paths and responding owners',async t=>{
  const f=await routeFixture(t),path=ingressSocket(f.state);
  assert.equal(lstatSync(path).mode&0o777,0o600);
  await assert.rejects(prepareIngressSocket(f.state),/active or unknown/);
  renameSync(path,join(f.state,'moved.sock'));writeFileSync(path,'preserve replacement',{mode:0o600});
  await f.shutdown();assert.equal(readFileSync(path,'utf8'),'preserve replacement');
  await assert.rejects(prepareIngressSocket(f.state),/not a private owned socket/);
  rmSync(path);symlinkSync(join(f.state,'moved.sock'),path);
  await assert.rejects(prepareIngressSocket(f.state),/not a private owned socket/);assert.equal(lstatSync(path).isSymbolicLink(),true);
});

test('a refused owned stale socket is recovered; failed second listener closes TCP and releases caller ownership',async t=>{
  const state=stateFor(t),temporary=join(state,'temporary.sock'),stale=net.createServer();
  await new Promise(resolve=>stale.listen(temporary,resolve));chmodSync(temporary,0o600);
  renameSync(temporary,ingressSocket(state));await new Promise(resolve=>stale.close(resolve));
  assert.equal(existsSync(ingressSocket(state)),true);await prepareIngressSocket(state);assert.equal(existsSync(ingressSocket(state)),false);
  let reads=0,partial;
  const harness={jobs:async()=>{reads++;return [];},doctor:async()=>({ready:true})};
  const {server,unixServer}=createNativeServer(state,{repo:state},{harness,provider:{supported:false},ingress:selected});
  const release=acquireProcessLock(join(state,'serve.lock'));
  unixServer.listen=()=>{
    const port=server.address().port;
    request({host:'127.0.0.1',port},'/api/v1/status',['Host',`127.0.0.1:${port}`]).then(response=>{
      partial=response;unixServer.emit('error',Object.assign(new Error('Synthetic Unix bind refusal'),{code:'EACCES'}));
    },error=>unixServer.emit('error',error));
    return unixServer;
  };
  try {await assert.rejects(startNativeListeners({server,unixServer},state,0),/Unix bind refusal/);}
  finally {release();}
  assert.equal(server.listening,false);assert.equal(unixServer.listening,false);assert.equal(existsSync(join(state,'serve.lock')),false);
  assert.equal(partial.status,503);assert.equal(reads,0,'partial startup must not expose bootstrap/native access');
  assert.equal(existsSync(ingressSocket(state)),false);
});

test('setup/status/removal preserve configuration privately and refuse active or unknown ownership',async t=>{
  const state=stateFor(t),input=join(state,'staged.json');writeFileSync(input,JSON.stringify(selected),{mode:0o600});
  const options={read:()=>({state,config:{repo:state}}),file:input};
  const release=acquireProcessLock(join(state,'serve.lock'));
  await assert.rejects(manageNativeIngress('setup',state,options),/active or unknown/);release();
  writeFileSync(join(state,'serve.lock'),'unknown owner');
  await assert.rejects(manageNativeIngress('setup',state,options),/active or unknown/);rmSync(join(state,'serve.lock'));
  const result=await manageNativeIngress('setup',state,options);assert.equal(result.configured,true);assert.equal(result.listening,null);
  assert.equal(readFileSync(ingressFile(state),'utf8').includes(selected.origin),true);
  const status=await manageNativeIngress('status',state,{...options,connect:async()=>({status:{operator_ingress:{configured:true,listening:true,config_sha256:ingressDigest(selected)}}})});
  assert.equal(status.matches_live,true);assert.equal(JSON.stringify(status).includes(selected.identities[0]),false);
  writeFileSync(join(state,'bridge.json'),'unresolved bridge');
  await assert.rejects(manageNativeIngress('remove',state,options),/active or unknown/);rmSync(join(state,'bridge.json'));
  const removed=await manageNativeIngress('remove',state,options);assert.equal(removed.configured,false);assert.equal(removed.previous_config_preserved,true);
  assert.equal(readIngress(state),null);
});

test('default loopback operation needs no sidecar/socket and retained unknown receipts are never replayed',async t=>{
  const f=await routeFixture(t,{ingress:null});
  writeFileSync(join(f.state,'receipts','unresolved.json'),'unknown outcome',{mode:0o600});
  const before=readFileSync(join(f.state,'receipts','unresolved.json'),'utf8');
  const status=(await f.local()).json();assert.equal(status.operator_ingress.configured,false);
  assert.equal(existsSync(ingressSocket(f.state)),false);
  const unregister=registerBridge(f.state,f.state,f.port,'ingress-test');t.after(unregister);
  await f.shutdown();assert.equal(readFileSync(join(f.state,'receipts','unresolved.json'),'utf8'),before);assert.equal(f.writes,0);
});
