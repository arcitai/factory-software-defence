import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { pinInstalledRuntime, serviceManifest, assertStoppedReconciled } from '../factory/native/service.mjs';
import { acquireProcessLock, inspectProcessLock } from '../factory/native/process-lock.mjs';

test('user systemd manifest pins an installed release and a loopback serve command',t=>{
  const root=mkdtempSync(join(tmpdir(),'factory-service-test-'));
  t.after(()=>rmSync(root,{recursive:true,force:true}));
  const installed=join(root,'installed'),state=join(root,'state'),repo=join(root,'repo');
  mkdirSync(installed);mkdirSync(state);mkdirSync(repo);
  writeFileSync(join(installed,'package.json'),JSON.stringify({name:'factory-software-defence',version:'0.18.0',dependencies:{yaml:'2.9.1'},bundleDependencies:['yaml']}));
  mkdirSync(join(installed,'node_modules','yaml'),{recursive:true});
  writeFileSync(join(installed,'node_modules','yaml','package.json'),JSON.stringify({name:'yaml',version:'2.9.1'}));
  const manifest=serviceManifest({state,config:{repo,node:process.execPath},root:installed,home:root,port:7332});
  assert.match(manifest.definition,/ExecStart=.*serve.*--state.*--port/);
  assert.match(manifest.definition,/bin\/software-defence-factory\.mjs/);
  assert.match(manifest.definition,/NoNewPrivileges=true/);
  assert.equal(manifest.runtime,join(state,'runtime','0.18.0'));
  assert.match(manifest.definition,/ExecStartPre=/);
  assert.ok(manifest.definition.includes('$${relative}'),'systemd must receive literal JS template interpolation, not an environment expansion');
  pinInstalledRuntime(state,{root:installed,version:'0.18.0'});
  const verify=()=>spawnSync(manifest.verification[0],manifest.verification.slice(1),{encoding:'utf8'});
  assert.equal(verify().status,0);
  writeFileSync(join(manifest.runtime,'node_modules','yaml','package.json'),'{"name":"yaml","version":"changed"}');
  assert.notEqual(verify().status,0);
  assert.match(verify().stderr,/integrity mismatch/);
  assert.throws(()=>serviceManifest({state,config:{repo,node:process.execPath},root:installed,port:80}),/loopback/);
  mkdirSync(join(installed,'.git'));
  assert.throws(()=>serviceManifest({state,config:{repo,node:process.execPath},root:installed}),/installed Factory package/);
});

test('a stale boot identity is recoverable but an active process lock is not',t=>{
  const root=mkdtempSync(join(tmpdir(),'factory-lock-test-'));
  t.after(()=>rmSync(root,{recursive:true,force:true}));
  const path=join(root,'serve.lock');
  writeFileSync(path,JSON.stringify({pid:process.pid,boot_id:'old-boot',start_time:'1'}));
  assert.equal(inspectProcessLock(path),'stale');
  const release=acquireProcessLock(path,'Factory dashboard');
  assert.equal(inspectProcessLock(path),'active');
  const owner=JSON.parse(readFileSync(path,'utf8'));
  assert.equal(owner.pid,process.pid);
  assert.throws(()=>acquireProcessLock(path,'Factory dashboard'),/already running/);
  release();assert.equal(inspectProcessLock(path),'absent');
});

test('same-version service pin refuses changed installed bytes',t=>{
  const root=mkdtempSync(join(tmpdir(),'factory-pin-test-'));
  t.after(()=>rmSync(root,{recursive:true,force:true}));
  const installed=join(root,'installed'),state=join(root,'state');mkdirSync(installed);mkdirSync(state);
  writeFileSync(join(installed,'package.json'),JSON.stringify({name:'factory-software-defence',version:'0.18.0',dependencies:{yaml:'2.9.1'},bundleDependencies:['yaml']}));
  mkdirSync(join(installed,'node_modules','yaml'),{recursive:true});
  writeFileSync(join(installed,'node_modules','yaml','package.json'),JSON.stringify({name:'yaml',version:'2.9.1'}));
  writeFileSync(join(installed,'entry.mjs'),'export const value = 1;');
  const source={root:installed,version:'0.18.0'};
  assert.equal(pinInstalledRuntime(state,source),join(state,'runtime','0.18.0'));
  writeFileSync(join(installed,'entry.mjs'),'export const value = 2;');
  assert.throws(()=>pinInstalledRuntime(state,source),/runtime bytes differ/);
});

test('retained history does not prevent starting a stopped bridge; a live process does',t=>{
 const state=mkdtempSync(join(tmpdir(),'factory-restart-history-'));
 t.after(()=>rmSync(state,{recursive:true,force:true}));
 mkdirSync(join(state,'receipts'));writeFileSync(join(state,'receipts','retained.json'),'{}');
 assert.doesNotThrow(()=>assertStoppedReconciled(state));
 const release=acquireProcessLock(join(state,'serve.lock'));t.after(release);
 assert.throws(()=>assertStoppedReconciled(state),/active or unknown/);
});

test('unresolved lock reconciliation preserves a stale lock instead of replacing it',t=>{
  const state=mkdtempSync(join(tmpdir(),'factory-lock-reconcile-'));
  t.after(()=>rmSync(state,{recursive:true,force:true}));
  const path=join(state,'serve.lock'),stale=JSON.stringify({pid:process.pid,boot_id:'old-boot',start_time:'1'});
  writeFileSync(path,stale);mkdirSync(`${path}.reconcile`);
  assert.throws(()=>assertStoppedReconciled(state),/unresolved process-lock reconciliation/);
  assert.throws(()=>acquireProcessLock(path),/reconciliation is in progress or unresolved/);
  assert.equal(readFileSync(path,'utf8'),stale);
  rmSync(`${path}.reconcile`,{recursive:true});
  acquireProcessLock(path)();
});
