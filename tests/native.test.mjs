import test from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { setupNative, readNative, nativePolicy } from '../factory/native/setup.mjs';
import { changeCodexApprovals } from '../factory/native/approval-config.mjs';
import { acquireProcessLock } from '../factory/native/process-lock.mjs';
import { AppServer, nativeReadiness } from '../factory/native/app-server.mjs';
import { NativeEngine } from '../factory/native/engine.mjs';
import { NativeIssueSubmissions } from '../factory/native/issue-submissions.mjs';

const url='https://github.com/example/project/issues/7';
const issue={url,title:'Fix useful behavior',spec:'Accepted scope and check',body:'Accepted scope and check',state:'open',labels:[],recommendation:{workflow:'software',reason:'Scoped issue'}};
const provider={preview:async()=>issue};
function fixture(t,mode='normal',approvals) {
  const root=mkdtempSync(join(tmpdir(),'factory-native-fixture-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
  const repo=join(root,'repo'),state=join(root,'state'),codex=join(root,'tools/codex/bin/codex');
  mkdirSync(repo);execFileSync('git',['init','-q',repo]);mkdirSync(dirname(codex),{recursive:true});
  writeFileSync(codex,`#!${process.execPath}\nconst readline=require('node:readline');\nlet cwd='',interrupted=false;\nconst send=x=>process.stdout.write(JSON.stringify(x)+'\\n');\nreadline.createInterface({input:process.stdin}).on('line',line=>{const m=JSON.parse(line);if(m.method==='initialized')return;if(m.id===900)return;if(m.id===undefined)return;let result={};\nswitch(m.method){\ncase 'initialize':result={codexHome:process.env.CODEX_HOME,platformOs:'linux',platformFamily:'unix',userAgent:'fixture'};break;\ncase 'account/read':result={account:'${mode}'==='no-login'?null:{type:'chatgpt'},requiresOpenaiAuth:true};break;\ncase 'config/read':{const policy=JSON.parse(require('node:fs').readFileSync(process.env.CODEX_HOME+'/fixture-policy.json','utf8'));const toml=require('node:fs').readFileSync(process.env.CODEX_HOME+'/config.toml','utf8');policy.approval_policy=toml.includes('on-request')?'on-request':'never';if(toml.includes('approvals_reviewer'))policy.approvals_reviewer=toml.includes('auto_review')?'auto_review':'user';else delete policy.approvals_reviewer;result={config:{...policy,tools:{},...('${mode}'==='reject-auto'&&policy.approval_policy==='on-request'?{approvals_reviewer:'user'}:{})},origins:{},layers:[{name:{type:'user',file:process.env.CODEX_HOME+'/config.toml'},version:'1',config:policy}]};break;}\ncase 'permissionProfile/list':result={data:[{id:'factory',allowed:true}],nextCursor:null};break;\ncase 'app/installed':result={apps:[]};break;\ncase 'mcpServerStatus/list':result={data:[],nextCursor:null};break;\ncase 'thread/list':result={data:[],nextCursor:null};break;\ncase 'thread/read':result={thread:{id:'thread-1',cwd}};break;\ncase 'thread/turns/list':result={data:[{id:'turn-1',status:interrupted?'interrupted':'completed',completedAt:1700000000,items:[]}]};break;\ncase 'thread/start':cwd=m.params.cwd;if('${mode}'==='disconnect')process.exit(0);if('${mode}'==='failure')return send({id:m.id,error:{code:-32000,message:'start failed'}});result={thread:{id:'thread-1'},cwd,approvalPolicy:'never',activePermissionProfile:{id:'factory'}};break;\ncase 'turn/start':result={turn:{id:'turn-1',status:'inProgress'}};break;\ncase 'turn/interrupt':interrupted=true;break;\ndefault:return send({id:m.id,error:{code:-32601,message:'unsupported'}});\n}\nsend({id:m.id,result});if(m.method==='turn/start'&&'${mode}'==='approval')send({id:900,method:'item/commandExecution/requestApproval',params:{threadId:'thread-1',turnId:'turn-1'}});\n});\n`,{mode:0o755});chmodSync(codex,0o755);
  setupNative(repo,state,codex,undefined,null,approvals);
  const installed=readNative(state);
  installed.config.writer_root=join(root,'locks'); // Keep fixture reservations in its disposable root.
  writeFileSync(join(installed.env.CODEX_HOME,'fixture-policy.json'),JSON.stringify(nativePolicy(installed.config,state)));
  return {repo,state,codex,...installed};
}
async function connected(t,mode='normal') {
  const env=fixture(t,mode),client=await new AppServer(env).connect();t.after(()=>client.close());
  return {client,...env,engine:new NativeEngine(env.state,env.config,client,provider)};
}
test('setup keeps a dedicated HOME and native profile, refuses overwrite and repo impostors',t=>{
  const f=fixture(t);
  assert.equal(f.env.HOME,join(f.state,'home'));
  assert.equal(f.env.CODEX_HOME,join(f.state,'home/.codex'));
  assert.equal(f.env.GITHUB_TOKEN,undefined);
  assert.match(readFileSync(join(f.env.CODEX_HOME,'config.toml'),'utf8'),/approval_policy = "never"/);
  assert.equal(readdirSync(join(f.env.CODEX_HOME,'skills')).length,6);
  assert.equal(existsSync(join(f.state,'jobs.sqlite')),false);
  assert.throws(()=>setupNative(f.repo,f.state,f.codex),/already exists/);
  const impostor=join(f.repo,'codex');writeFileSync(impostor,'#!/bin/sh\n',{mode:0o755});
  assert.throws(()=>setupNative(f.repo,join(dirname(f.state),'new-state'),impostor),/outside the repository/);
});
test('approval mode adoption requires a stopped bridge and restores the previous mode deliberately',async t=>{
  const f=fixture(t),before=nativePolicy(f.config,f.state);
  const release=acquireProcessLock(join(f.state,'serve.lock'));
  await assert.rejects(changeCodexApprovals(f.state,'auto-review'),/already running/);release();
  const changed=await changeCodexApprovals(f.state,'auto-review');
  assert.equal(changed.approvals,'auto-review');assert.equal(changed.readiness.ready,true);assert.equal(existsSync(changed.backup),true);
  const after=readNative(f.state);assert.equal(after.config.approvals,'auto-review');
  assert.deepEqual(nativePolicy(after.config,f.state).permissions,before.permissions);
  const reverted=await changeCodexApprovals(f.state,'never');assert.equal(reverted.approvals,'never');
  assert.equal((await changeCodexApprovals(f.state,'never')).changed,false);
});
test('returning to never does not require live account access and reports backup before mutation',async t=>{
  const f=fixture(t,'no-login','auto-review'),before=readFileSync(join(f.env.CODEX_HOME,'config.toml'),'utf8');let reported=false;
  const result=await changeCodexApprovals(f.state,'never',{onBackup:path=>{
    reported=true;assert.equal(readFileSync(join(path,'config.toml'),'utf8'),before);
    assert.equal(readFileSync(join(f.env.CODEX_HOME,'config.toml'),'utf8'),before);
    assert.equal(JSON.parse(readFileSync(join(path,'native.json'),'utf8')).approvals,'auto-review');
  }});
  assert.equal(reported,true);assert.equal(result.approvals,'never');assert.equal(result.readiness.account,'unavailable');
});
test('failed native mode verification restores both pinned files without starting a turn',async t=>{
  const f=fixture(t,'reject-auto'),profile=join(f.env.CODEX_HOME,'config.toml');
  const before=readFileSync(profile,'utf8'),config=JSON.parse(readFileSync(join(f.state,'native.json'),'utf8'));
  await assert.rejects(changeCodexApprovals(f.state,'auto-review'),/Previous pinned configuration restored/);
  assert.equal(readFileSync(profile,'utf8'),before);
  assert.deepEqual(readNative(f.state).config,config);
  assert.equal(readdirSync(join(f.state,'receipts')).length,0);
});
test('installed command grammar accepts the Codex-only auto-review setup option',t=>{
  const f=fixture(t),selected=join(dirname(f.state),'cli-state');
  execFileSync(process.execPath,[new URL('../bin/software-defence-factory.mjs',import.meta.url).pathname,'setup','--repo',f.repo,'--state',selected,'--codex',f.codex,'--approvals','auto-review']);
  assert.equal(readNative(selected).config.approvals,'auto-review');
});
test('setup auto-review is explicit and unsupported modes are rejected',t=>{
  const f=fixture(t,'normal','auto-review');
  assert.equal(nativePolicy(f.config,f.state).approval_policy,'on-request');
  assert.match(readFileSync(join(f.env.CODEX_HOME,'config.toml'),'utf8'),/approvals_reviewer = "auto_review"/);
  assert.throws(()=>setupNative(f.repo,join(dirname(f.state),'other'),f.codex,undefined,null,'full-access'),/Unsupported/);
});
test('personal bin executable grants only its file, and bundle reads need explicit narrow selection',t=>{
  const f=fixture(t),personal=join(dirname(f.state),'personal'),binary=join(personal,'bin','codex');
  mkdirSync(dirname(binary),{recursive:true});copyFileSync(f.codex,binary);chmodSync(binary,0o755);
  const selected=join(dirname(f.state),'selected-state');
  setupNative(f.repo,selected,binary);
  const profile=readFileSync(join(selected,'home','.codex','config.toml'),'utf8');
  assert.equal(profile.includes(`${JSON.stringify(binary)} = "read"`),true);
  assert.equal(profile.includes(`${JSON.stringify(personal)} = "read"`),false);
  assert.throws(()=>setupNative(f.repo,join(dirname(f.state),'bundle-state'),binary,process.env.HOME),/personal home/);
  const symlink=join(personal,'bin','codex-link');symlinkSync(binary,symlink);
  const linked=join(dirname(f.state),'linked-state');
  setupNative(f.repo,linked,symlink);
  assert.equal(readNative(linked).config.codex,symlink);
  const linkedProfile=readFileSync(join(linked,'home','.codex','config.toml'),'utf8');
  assert.equal(linkedProfile.includes(`${JSON.stringify(symlink)} = "read"`),true);
  assert.equal(linkedProfile.includes(`${JSON.stringify(binary)} = "read"`),true);
});
test('mock JSONL normal admission preserves one issue receipt and reads Codex history',async t=>{
  const {client,engine,state,repo}=await connected(t);
  assert.equal((await engine.doctor()).ready,true);
  const created=await engine.start({url,expected_spec:issue.spec,brief:'',workflow:'software'});
  assert.equal(created.thread_id,'thread-1');assert.equal(created.turn_id,'turn-1');
  assert.equal((await engine.jobs())[0].state,'needs_review');
  assert.equal(readdirSync(join(state,'receipts')).length,1);
  await assert.rejects(engine.start({url,expected_spec:issue.spec,brief:'',workflow:'software'}),/active or unresolved|native history/);
});
test('mock JSONL failed or disconnected start remains reserved and reports unknown',async t=>{
  for(const mode of ['failure','disconnect']) {
    const f=await connected(t,mode);
    await assert.rejects(f.engine.start({url,expected_spec:issue.spec,brief:'',workflow:'software'}));
    assert.equal((await f.engine.jobs())[0].state,'unknown');
    assert.equal(readdirSync(join(f.state,'receipts')).length,1);
  }
});
test('mock JSONL unexpected approval is refused and turn interrupted',async t=>{
  const {client,engine}=await connected(t,'approval');
  await engine.start({url,expected_spec:issue.spec,brief:'',workflow:'software'});
  await new Promise(resolve=>setTimeout(resolve,20));
  assert.equal(client.unexpectedApproval,true);
  assert.equal((await engine.jobs())[0].state,'interrupted');
  assert.equal((await nativeReadiness(client,engine.config)).ready,false);
});
test('GitHub creation uncertainty retains a receipt and reconciles without a second write',async t=>{
  const root=mkdtempSync(join(tmpdir(),'factory-native-write-'));t.after(()=>rmSync(root,{recursive:true,force:true}));mkdirSync(join(root,'issue-submissions'));
  let writes=0;
  const provider={id:'github',context:async()=>({repository:'https://github.com/example/project',actor:'operator',actor_id:7,available:true,labels_supported:true}),
    publish:async()=>{writes++;throw new Error('connection lost');},recover:async()=>({number:7,url})};
  const store=new NativeIssueSubmissions(root,provider);
  const input={request_id:'stable_request_1234',repository:'https://github.com/example/project',actor:'operator',title:'A bug',spec:'Reproduction',labels:[]};
  await assert.rejects(store.create(input),/may have succeeded/);
  assert.equal(store.list()[0].state,'uncertain');
  assert.equal((await store.create(input)).state,'created');
  assert.equal(writes,1);
});


test('different launch HOME values cannot create independent writers for one account/repository', async t => {
  const f=fixture(t), root=dirname(f.state), states=['first-account-state','second-account-state'].map(name=>join(root,name));
  const setupUrl=new URL('../factory/native/setup.mjs',import.meta.url).href;
  const configs=states.map((state,index)=>{
    const launchHome=join(root,`launch-home-${index}`);mkdirSync(launchHome);
    const script=`import {setupNative,readNative} from ${JSON.stringify(setupUrl)};
      setupNative(${JSON.stringify(f.repo)},${JSON.stringify(state)},${JSON.stringify(f.codex)});
      console.log(JSON.stringify(readNative(${JSON.stringify(state)}).config));`;
    return JSON.parse(execFileSync(process.execPath,['--input-type=module','-e',script],{encoding:'utf8',env:{...process.env,HOME:launchHome}}));
  });
  const client={available:true,onNotification:()=>{},call:async method=>{assert.equal(method,'thread/list');return {data:[]};}}, first=new NativeEngine(states[0],configs[0],client,provider);
  await first.withGate(()=>first.replaceWriter({id:'home-regression',created_at:new Date().toISOString()}));
  const {createHash}=await import('node:crypto');
  const key=createHash('sha256').update(f.repo).digest('hex');
  t.after(()=>rmSync(join(configs[0].writer_root,`${key}.lock`),{force:true}));
  await assert.rejects(new NativeEngine(states[1],configs[1],client,provider).replaceWriter({id:'second'}),/Another native installation owns this repository/);
});

test('bundle cannot grant the canonical account home when launch HOME is different or aliased', t => {
  const f=fixture(t),root=dirname(f.state),personal=join(root,'deep','account'),binary=join(personal,'bin','codex');
  mkdirSync(dirname(binary),{recursive:true});copyFileSync(f.codex,binary);chmodSync(binary,0o755);
  const alias=join(root,'home-alias');symlinkSync(personal,alias);
  const other=join(root,'other-home');mkdirSync(other);
  for(const [index,launchHome] of [other,alias].entries()) {
    const state=join(root,`broad-state-${index}`);
    // Model a deeper OS-account home without mutating the host account database.
    const script=`import os from 'node:os';import {syncBuiltinESMExports} from 'node:module';
      const original=os.userInfo;os.userInfo=()=>({...original(),homedir:${JSON.stringify(personal)}});syncBuiltinESMExports();
      const {setupNative}=await import(${JSON.stringify(new URL('../factory/native/setup.mjs',import.meta.url).href)});
      try {setupNative(${JSON.stringify(f.repo)},${JSON.stringify(state)},${JSON.stringify(binary)},${JSON.stringify(personal)});}
      catch(error){console.log(error.message);process.exit(0);}process.exit(3);`;
    const result=execFileSync(process.execPath,['--input-type=module','-e',script],{encoding:'utf8',env:{...process.env,HOME:launchHome}});
    assert.match(result,/never the personal home/);assert.equal(existsSync(state),false);
  }
});
