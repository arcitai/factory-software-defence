import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NativeEngine } from '../factory/native/engine.mjs';
import { nativeEnvironment, nativePolicy } from '../factory/native/setup.mjs';
import { nativeReadiness } from '../factory/native/app-server.mjs';

function harness(t) {
  const state=mkdtempSync(join(tmpdir(),'factory-native-guards-'));
  t.after(()=>rmSync(state,{recursive:true,force:true}));
  const repo=join(state,'project');
  mkdirSync(join(state,'receipts'));mkdirSync(join(state,'home','.codex'),{recursive:true});
  const config={repo,codex:'/usr/bin/codex',node:process.execPath,profile:'factory',runtime_reads:['/usr/bin/codex',process.execPath],writer_root:join(state,'locks')};
  const profile='pinned profile';
  writeFileSync(join(state,'home','.codex','config.toml'),profile,{mode:0o600});
  config.config_sha256=createHash('sha256').update(profile).digest('hex');
  const env=nativeEnvironment(config,state),policy=nativePolicy(config,state);
  const effective={approval_policy:'never',default_permissions:'factory',cli_auth_credentials_store:'file',web_search:'disabled',
    apps:{_default:{enabled:false}},tools:{},permissions:policy.permissions,features:policy.features,
    shell_environment_policy:policy.shell_environment_policy};
  const turns=new Map();let starts=0;
  const client={available:true,unexpectedApproval:false,env,onNotification:()=>{},
    call:async(method,params)=>{
      switch(method) {
        case 'account/read':return {account:{type:'chatgpt'}};
        case 'config/read':return {config:effective,layers:[{name:{type:'user',file:`${env.CODEX_HOME}/config.toml`},config:policy}]};
        case 'permissionProfile/list':return {data:[{id:'factory',allowed:true}],nextCursor:null};
        case 'app/installed':return {apps:[]};
        case 'mcpServerStatus/list':return {data:[],nextCursor:null};
        case 'thread/list':return {data:[],nextCursor:null};
        case 'thread/start':starts++;return {thread:{id:`thread-${starts}`},cwd:repo,approvalPolicy:'never',activePermissionProfile:{id:'factory'}};
        case 'turn/start':assert.equal(Object.hasOwn(params,'environments'),false,'Omitting environments retains native workspace tools');turns.set(params.threadId,[{id:`turn-${starts}`,status:'inProgress',items:[]}]);return {turn:{id:`turn-${starts}`,status:'inProgress',items:[]}};
        case 'thread/read':return {thread:{id:params.threadId,cwd:repo}};
        case 'thread/turns/list':return {data:turns.get(params.threadId)||[]};
        case 'thread/resume':return {thread:{id:params.threadId},cwd:repo,approvalPolicy:'never',activePermissionProfile:{id:'factory'}};
        case 'turn/interrupt':return {};
        default:throw Error(`Unexpected method ${method}`);
      }
    }};
  const provider={preview:async url=>({url,title:'A scoped issue',spec:'Check behavior',body:'Check behavior',state:'open',labels:[]})};
  const engine=()=>new NativeEngine(state,config,client,provider);
  const start=(instance,number)=>instance.start({url:`https://github.com/example/project/issues/${number}`,expected_spec:'Check behavior',brief:'',workflow:'software'});
  return {state,config,env,policy,effective,client,engine,start,turns,get starts(){return starts;}};
}

test('project writer receipt spans engine instances and distinct issues',async t=>{
  const h=harness(t),first=h.engine(),second=h.engine();
  const [a,b]=await Promise.allSettled([h.start(first,7),h.start(second,8)]);
  assert.equal([a,b].filter(item=>item.status==='fulfilled').length,1);
  assert.equal(h.starts,1);
  await assert.rejects(h.start(second,9),/active or unresolved/);
  h.turns.get('thread-1')[0].status='completed';
  h.turns.get('thread-1')[0].items=[{type:'commandExecution',command:'private command'},
    {type:'agentMessage',text:'private response'}];
  assert.equal(JSON.stringify(await first.jobs()).includes('private'),false);
  const source=await first.issue({url:'https://github.com/example/project/issues/7'});
  assert.equal(source.state,'open');
  assert.equal(source.active_execution.state,'needs_review');
  const next=await h.start(second,9);
  assert.equal(next.state,'running');
  assert.equal(h.starts,2);
  assert.equal((await first.jobs()).find(job=>job.thread_id==='thread-1').state,'needs_review');
});

test('a second native state for the same repository cannot claim its writer',async t=>{
  const first=harness(t),second=harness(t);
  second.config.repo=first.config.repo;
  second.policy.projects={[first.config.repo]:{trust_level:'trusted'}};
  second.config.writer_root=first.config.writer_root;
  await first.start(first.engine(),7);
  await assert.rejects(second.start(second.engine(),8),/Another native installation owns this repository/);
  assert.equal(second.starts,0);
});

test('stale turn identity and disconnected native state block writer release',async t=>{
  const h=harness(t),engine=h.engine();
  await h.start(engine,7);
  h.turns.set('thread-1',[{id:'different-turn',status:'completed',items:[]}]);
  assert.equal((await engine.jobs())[0].state,'unknown');
  await assert.rejects(h.start(h.engine(),8),/active or unresolved/);
  h.client.available=false;
  await assert.rejects(h.start(h.engine(),8),/Native state unavailable/);
});

test('profile file changes and widened effective layers fail readiness before admission',async t=>{
  const h=harness(t),engine=h.engine();
  assert.equal((await engine.doctor()).ready,true);
  writeFileSync(join(h.env.CODEX_HOME,'config.toml'),'modified profile');
  assert.match((await engine.doctor()).gaps.join(';'),/configuration changed/);
  await assert.rejects(h.start(engine,7),/readiness failed/i);
  writeFileSync(join(h.env.CODEX_HOME,'config.toml'),'pinned profile');
  const original=h.client.call;
  h.client.call=(method,params)=>method==='config/read'
    ? Promise.resolve({config:h.effective,
      layers:[{name:{type:'user',file:`${h.env.CODEX_HOME}/config.toml`},config:h.policy},
        {name:{type:'project'},config:{features:{computer_use:true}}}]})
    : original(method,params);
  assert.match((await nativeReadiness(h.client,h.config,h.state)).gaps.join(';'),/Unreviewed effective configuration layer/);
  await assert.rejects(h.start(engine,7),/readiness failed/i);
  h.client.call=(method,params)=>method==='config/read'
    ? Promise.resolve({config:{...h.effective,permissions:{factory:{filesystem:{':root':'write'}}},tools:{web_search:{enabled:true}}},
      layers:[{name:{type:'user',file:`${h.env.CODEX_HOME}/config.toml`},config:h.policy}]})
    : original(method,params);
  assert.match((await nativeReadiness(h.client,h.config,h.state)).gaps.join(';'),/Effective Codex capabilities changed/);
  assert.equal(existsSync(join(h.config.writer_root,`${createHash('sha256').update(h.config.repo).digest('hex')}.lock`)),false);
});


test('native follow-up activity prevents releasing an older completed turn',async t=>{
  const h=harness(t),engine=h.engine();
  await h.start(engine,7);
  h.turns.set('thread-1',[
    {id:'later-native-turn',status:'inProgress',items:[]},
    {id:'turn-1',status:'completed',items:[]}
  ]);
  assert.equal((await engine.jobs())[0].state,'unknown');
  await assert.rejects(h.start(h.engine(),8),/active or unresolved/);
  assert.equal(h.starts,1);
});

test('native model preferences do not widen access and missing permissions block',async t=>{
  const h=harness(t),original=h.client.call;
  h.client.call=async(method,params)=>{
    const result=await original(method,params);
    if(method==='config/read') result.layers[0].config={...h.policy,model:'gpt-6-luna',model_reasoning_effort:'max'};
    return result;
  };
  assert.equal((await h.engine().doctor()).ready,true);
  delete h.effective.permissions;
  assert.equal((await h.engine().doctor()).ready,false);
});
