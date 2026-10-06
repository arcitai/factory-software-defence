import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { createHash } from 'node:crypto';
import { appendFileSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ClaudeEngine, claudeReadiness } from '../factory/native/claude.mjs';
import { CLAUDE_TOOLS, FACTORY_SKILLS, claudeEnvironment, claudeLoginEnvironment, claudeInventoryArgs, claudeSettings, claudeSettingsPath } from '../factory/native/claude-setup.mjs';

import { projectHistory } from '../factory/native/claude-history.mjs';

const sha=value=>createHash('sha256').update(value).digest('hex');
const ISSUE='https://github.com/acme/app/issues/7';
const settle=()=>new Promise(resolve=>setTimeout(resolve,20));

// A fake native child: `script(frame, child)` reacts to each stdin frame.
function fakeSpawn(script) {
  const spawned=[];
  const spawnImpl=(command,args)=>{
    const child=new EventEmitter();
    Object.assign(child,{command,args,frames:[],exitCode:null,stdout:new PassThrough(),stderr:new PassThrough(),stdin:new PassThrough()});
    child.emitLine=value=>child.stdout.write(typeof value==='string'?value:`${JSON.stringify(value)}\n`);
    child.exit=(code=0)=>{if(child.exitCode!==null)return;child.exitCode=code;setImmediate(()=>child.emit('close',code));};
    child.kill=()=>child.exit(143);
    let buffer='';
    child.stdin.on('data',chunk=>{buffer+=chunk;let index;while((index=buffer.indexOf('\n'))>=0){const frame=JSON.parse(buffer.slice(0,index));buffer=buffer.slice(index+1);child.frames.push(frame);script(frame,child);}});
    child.stdin.on('finish',()=>script({type:'factory/stdin-closed'},child));
    spawned.push(child);
    return child;
  };
  return {spawnImpl,spawned};
}
// Native 2.1.289 shapes: pending lists are envelope siblings of `response`.
const ok=(frame,response={},envelope={})=>({type:'control_response',response:{subtype:'success',request_id:frame.request_id,response,...envelope}});
const initialized=frame=>ok(frame,{commands:[],models:[],account:{apiProvider:'firstParty'}},{pending_permission_requests:[],pending_user_dialog_requests:[]});
const liveInit=(repo,session,overrides={})=>({type:'system',subtype:'init',uuid:'init-1',session_id:session,cwd:repo,model:'claude-opus-5-5',
  permissionMode:'dontAsk',tools:[...CLAUDE_TOOLS],mcp_servers:[],effort:'medium',
  plugins:[{name:'cc-plugin-agents-md',path:'builtin',source:'cc-plugin-agents-md@builtin'},{name:'cc-plugin-plugin-authoring',path:'builtin',source:'cc-plugin-plugin-authoring@builtin'}],
  skills:[...FACTORY_SKILLS,'doctor','plugin-authoring'],...overrides});
const success=(frame,session,extra={})=>({type:'result',subtype:'success',is_error:false,result:'Done; checks pass.',uuid:'r-1',
  user_message_uuid:frame.uuid,session_id:session,usage:{input_tokens:3,output_tokens:4},total_cost_usd:0.5,...extra});

// Normal native behavior with optional overrides.
function nativeScript({init={},initEnvelope,onPrompt,onUser,onInterrupt,onClose}={}) {
  return (frame,child)=>{
    if(frame.type==='control_request'&&frame.request.subtype==='initialize')return child.emitLine(initEnvelope?initEnvelope(frame):initialized(frame));
    if(frame.type==='control_request'&&frame.request.subtype==='interrupt'){child.emitLine(ok(frame,{}));return onInterrupt?.(frame,child);}
    if(frame.type==='user'){
      const session=child.args[child.args.indexOf(child.args.includes('--resume')?'--resume':'--session-id')+1];
      child.session=session;onPrompt?.(frame,child);
      child.emitLine(liveInit(child.cwd,session,init));
      child.emitLine({type:'user',uuid:frame.uuid,session_id:session,message:frame.message});
      return onUser ? onUser(frame,child,session) : child.emitLine(success(frame,session));
    }
    if(frame.type==='factory/stdin-closed')return onClose ? onClose(child) : child.exit(0);
  };
}
// A pinned private profile with a small stand-in executable whose bytes are hashed.
function pinned(t) {
  const root=realpathSync(mkdtempSync(join(tmpdir(),'factory-claude-'))),hooks=[];
  t.after(async()=>{for (const hook of hooks) await hook();rmSync(root,{recursive:true,force:true});});
  const state=join(root,'state'),repo=join(root,'repo'),profile=join(state,'profile'),writers=join(root,'writers'),claude=join(root,'claude');
  for (const dir of [join(state,'receipts'),join(profile,'skills'),repo,writers]) mkdirSync(dir,{recursive:true,mode:0o700});
  writeFileSync(claude,'native-binary-v1',{mode:0o700});
  const config={version:1,harness:'claude',repo,claude,claude_target:claude,claude_sha256:sha('native-binary-v1'),node:process.execPath,
    model:'claude-opus-5-5',effort:'medium',config_dir:profile,account_home:root,runtime_reads:[],writer_root:writers,instructions:'AGENTS.md',
    claude_version:'2.1.289 (Claude Code)',skills:{}};
  for (const name of FACTORY_SKILLS) {mkdirSync(join(profile,'skills',name));writeFileSync(join(profile,'skills',name,'SKILL.md'),name);config.skills[name]=sha(name);}
  const settings=`${JSON.stringify(claudeSettings(config,state),null,2)}\n`;
  writeFileSync(claudeSettingsPath(state),settings,{mode:0o600});config.settings_sha256=sha(settings);
  return {root,state,config,settings,hooks,claude};
}
function fixture(t,{script,ready=true}={}) {
  const {state,config,hooks,claude}=pinned(t);
  const history={},inventory={value:[]},provider={supported:true,preview:async url=>({url,title:'Fix it',spec:'Fix it.\n',state:'open',labels:[]})};
  const recordFor=(session,uuid)=>{history[session]={session:{id:session,cwd:config.repo},input:{uuid,session_id:session},tip_uuid:`native-tail-${uuid}`};};
  const behavior=script||nativeScript();
  const {spawnImpl:base,spawned}=fakeSpawn((frame,child)=>{
    if(frame.type==='user')recordFor(child.args[child.args.indexOf(child.args.includes('--resume')?'--resume':'--session-id')+1],frame.uuid);
    behavior(frame,child);
  });
  const spawnImpl=(command,args,options)=>{const child=base(command,args,options);child.cwd=options.cwd;return child;};
  const options={spawnImpl,confirmTimeout:300,readiness:async()=>({ready,gaps:ready?[]:['Native login required or auth status unavailable']}),
    history:async(_config,_state,session)=>{const value=history[session];if(value instanceof Error)throw value;return value||null;},
    inventory:async()=>{if(inventory.value instanceof Error)throw inventory.value;return inventory.value;}};
  const engine=new ClaudeEngine(state,config,provider,options);
  hooks.push(async()=>{engine.close();await settle();});
  // Simulate native history for the latest session's prompts.
  const record=uuid=>recordFor(spawned.at(-1).session,uuid);
  return {engine,state,config,spawned,history,inventory,record,options,provider,claude};
}
const receipts=state=>readdirSync(join(state,'receipts')).map(name=>JSON.parse(readFileSync(join(state,'receipts',name),'utf8')));
const start=engine=>engine.start({url:ISSUE,expected_spec:'Fix it.\n',brief:''});

test('native user-role interruption notices do not replace the confirmed operator input',()=>{
  const info={sessionId:'session',cwd:'/repo'};
  const messages=[{type:'user',uuid:'input',session_id:'session',message:{role:'user',content:'Work.'}},
    {type:'user',uuid:'tool-result',session_id:'session',message:{role:'user',content:[{type:'tool_result',is_error:true}]}},
    {type:'user',uuid:'interrupt-notice',session_id:'session',message:{role:'user',content:[{type:'text',text:'[Request interrupted by user for tool use]'}]}}];
  assert.deepEqual(projectHistory(info,messages,'input'),{session:{id:'session',cwd:'/repo'},input:{uuid:'input',session_id:'session'},tip_uuid:'interrupt-notice'});
  assert.equal(projectHistory(info,[...messages,messages[0]],'input').input,null,'duplicate input identity is ambiguous');
});

test('desktop environment is available only to interactive login and never to agent tools',t=>{
  const f=pinned(t),host={DISPLAY:':0',WAYLAND_DISPLAY:'wayland-0',DBUS_SESSION_BUS_ADDRESS:'unix:path=/run/user/1000/bus',BROWSER:'xdg-open',GITHUB_TOKEN:'synthetic',ANTHROPIC_API_KEY:'synthetic'};
  const login=claudeLoginEnvironment(f.config,f.state,host),agent=claudeEnvironment(f.config,f.state);
  assert.equal(login.DISPLAY,':0');assert.equal(login.BROWSER,'xdg-open');
  assert.equal(agent.DISPLAY,undefined);assert.equal(agent.BROWSER,undefined);
  assert.equal(login.GITHUB_TOKEN,undefined);assert.equal(login.ANTHROPIC_API_KEY,undefined);
  assert.equal(login.CLAUDE_CONFIG_DIR,agent.CLAUDE_CONFIG_DIR);
});

test('a success result followed by an unsuccessful process exit remains unknown',async t=>{
  const f=fixture(t,{script:nativeScript({onClose:child=>child.exit(1)})});
  await start(f.engine);await settle();
  assert.equal((await f.engine.jobs())[0].state,'unknown');
  await assert.rejects(f.engine.assertWorkspaceIdle(),/active or unresolved/);
});

test('start persists the receipt before the prompt, verifies startup and ends as needs_review, never accepted', async t => {
  let atPrompt;
  const f=fixture(t,{script:nativeScript({onPrompt:()=>{atPrompt=receipts(f.state)[0];}})});
  const job=await start(f.engine);
  assert.equal(atPrompt.phase,'sent');assert.equal(atPrompt.session_id,job.thread_id);
  const args=f.spawned[0].args;
  for (const flag of ['-p','--replay-user-messages','--strict-mcp-config','--no-chrome']) assert.ok(args.includes(flag),flag);
  assert.equal(args[args.indexOf('--setting-sources')+1],'user');
  assert.equal(args[args.indexOf('--tools')+1],CLAUDE_TOOLS.join(','));
  assert.ok(!args.includes('--bg') && !args.includes('--restricted') && !args.includes('--bare'));
  assert.equal(f.spawned[0].frames.filter(frame=>frame.type==='user').length,1);
  await settle();
  // Losing native history invalidates a completed receipt everywhere.
  f.history[job.thread_id]=null;
  assert.equal((await f.engine.jobs())[0].state,'unknown');
  assert.equal((await f.engine.issue({url:ISSUE})).start_block_reason!==undefined,true);
  f.record(job.turn_id);
  const [done]=await f.engine.jobs();
  assert.equal(done.state,'needs_review');assert.equal(done.native_result.response,'Done; checks pass.');
  // A live native process holding the session also makes the result unresolved.
  f.inventory.value=[{pid:1,cwd:f.config.repo,kind:'interactive',sessionId:job.thread_id,status:'busy'}];
  assert.equal((await f.engine.result(job.id)).state,'unknown');
  f.inventory.value=new Error('unavailable');
  assert.equal((await f.engine.jobs())[0].state,'unknown');
});

test('malformed or foreign native history stays unknown', async t => {
  const f=fixture(t);
  const job=await start(f.engine);await settle();
  for (const value of [new Error('read failed'),{session:{id:job.thread_id,cwd:f.config.repo},input:null,tip_uuid:'tail'},
    {session:{id:job.thread_id,cwd:'/elsewhere'},input:{uuid:job.turn_id,session_id:job.thread_id},tip_uuid:`native-tail-${job.turn_id}`},
    {session:{id:job.thread_id,cwd:f.config.repo},input:{uuid:job.turn_id,session_id:'other'},tip_uuid:`native-tail-${job.turn_id}`},
    {session:{id:job.thread_id,cwd:f.config.repo},input:{uuid:job.turn_id,session_id:job.thread_id},tip_uuid:'later-native-message'},
    {session:{id:job.thread_id,cwd:f.config.repo},input:'nope'}]) {
    f.history[job.thread_id]=value;
    assert.equal((await f.engine.result(job.id)).state,'unknown');
  }
});

test('explicit continuation resumes the same session only from the expected reconciled terminal turn', async t => {
  const f=fixture(t);
  const first=await start(f.engine);await settle();f.record(first.turn_id);
  await assert.rejects(f.engine.continue(first.id,'stale-turn','Next step.'),/Expected terminal turn changed/);
  f.inventory.value=[{pid:2,cwd:f.config.repo,kind:'interactive',sessionId:'another',status:'idle'}];
  await assert.rejects(f.engine.continue(first.id,first.turn_id,'Next step.'),/active or unresolved/);
  f.inventory.value=[];
  const next=await f.engine.continue(first.id,first.turn_id,'Next step.');
  const args=f.spawned.at(-1).args;
  assert.equal(args[args.indexOf('--resume')+1],first.thread_id);
  assert.equal(next.thread_id,first.thread_id);assert.notEqual(next.turn_id,first.turn_id);
  await settle();f.record(next.turn_id);
  assert.deepEqual((await f.engine.jobs())[0].native_turns.map(turn=>turn.state),['needs_review','needs_review']);
});

test('initialize pending state in the envelope refuses before any prompt, in launch and doctor', async t => {
  for (const envelope of [{pending_permission_requests:[{request_id:'held'}],pending_user_dialog_requests:[]},
    {pending_permission_requests:[],pending_user_dialog_requests:[{request_id:'dialog'}]},
    {pending_permission_requests:[],pending_user_dialog_requests:[],session_state:'requires_action'},
    {pending_permission_requests:[]}]) {
    const f=fixture(t,{script:nativeScript({initEnvelope:frame=>ok(frame,{account:{}},envelope)})});
    await assert.rejects(start(f.engine),/did not initialize cleanly; no prompt was sent/);
    assert.equal(f.spawned[0].frames.filter(frame=>frame.type==='user').length,0);
    await settle();
    assert.equal((await f.engine.jobs())[0].state,'unknown');
  }
  const r=readinessFixture(t,{initEnvelope:{pending_permission_requests:[],pending_user_dialog_requests:[{request_id:'dialog'}]}});
  assert.match((await r.run()).gaps.join(),/pending permission or dialog/);
});

test('a live startup that differs from the pinned inventory is refused and never recognized', async t => {
  for (const init of [{tools:[...CLAUDE_TOOLS,'WebFetch']},{mcp_servers:[{name:'x',status:'connected'}]},{permissionMode:'bypassPermissions'},
    {plugins:[{name:'personal',path:'/x'}]},{skills:[...FACTORY_SKILLS,'personal-skill']},{model:'claude-other'},{cwd:'/elsewhere'},{effort:'high'}]) {
    const f=fixture(t,{script:nativeScript({init,onUser:()=>{}})});
    await assert.rejects(start(f.engine),/did not match the pinned profile/);
    assert.ok(f.spawned[0].frames.some(frame=>frame.request?.subtype==='interrupt'));
    f.spawned[0].exit(0);await settle();
    const [job]=await f.engine.jobs();
    assert.equal(job.state,'unknown');assert.match(job.native_state_note,/startup identity or tool inventory/);
    assert.equal((await f.engine.doctor()).ready,false);
  }
});

test('a process that ends before confirming the input stays unknown, blocks the writer and is never replayed', async t => {
  const g=fixture(t,{script:(frame,child)=>{if(frame.type==='user')return child.exit(1);return nativeScript()(frame,child);}});
  await assert.rejects(start(g.engine),/outcome unknown|ended before confirming/);
  await settle();
  assert.equal((await g.engine.jobs())[0].state,'unknown');assert.equal(g.spawned.length,1);
  await assert.rejects(g.engine.assertWorkspaceIdle(),/active or unresolved/);
  await assert.rejects(start(g.engine),/unresolved|already has native history/i);
  assert.equal(g.spawned.length,1);
});

test('spawn or initialize failure has no unhandled rejection and sends no prompt', async t => {
  const unhandled=[];const listener=reason=>unhandled.push(reason);process.on('unhandledRejection',listener);
  t.after(()=>process.off('unhandledRejection',listener));
  const f=fixture(t,{script:(frame,child)=>{if(frame.request?.subtype==='initialize')child.exit(1);}});
  await assert.rejects(start(f.engine),/did not initialize cleanly/);
  await settle();
  assert.deepEqual(unhandled,[]);
  assert.equal(f.spawned[0].frames.filter(frame=>frame.type==='user').length,0);
});

test('changed executable bytes refuse before any native process or inventory command runs', async t => {
  const f=fixture(t);
  appendFileSync(f.claude,'tampered');
  await assert.rejects(f.engine.launch({id:'job_ab',key:'k',session_id:'s',attempts:[]},'x',false),/no native process was started/);
  assert.equal(f.spawned.length,0);
  const r=readinessFixture(t);appendFileSync(r.claude,'tampered');
  const ready=await r.run();
  assert.equal(ready.ready,false);assert.match(ready.gaps.join(),/executable changed/);
  assert.equal(r.spawned.length+r.calls.version+r.calls.auth,0);
});

test('partial frames are reassembled; oversized, incomplete, duplicate, mismatched or wrongly shaped completions stay unknown', async t => {
  const split=fixture(t,{script:nativeScript({onUser:(frame,child,session)=>{const line=`${JSON.stringify(success(frame,session))}\n`;child.emitLine(line.slice(0,10));setImmediate(()=>child.emitLine(line.slice(10)));}})});
  const a=await start(split.engine);await settle();split.record(a.turn_id);
  assert.equal((await split.engine.jobs())[0].state,'needs_review');

  const cases=[
    ['Duplicate',(frame,child,session)=>{child.emitLine(success(frame,session));child.emitLine(success(frame,session));}],
    ['did not match',(_frame,child,session)=>{child.emitLine(success({uuid:'someone-else'},session));}],
    ['unexpected shape',(frame,child,session)=>{const {is_error,...rest}=success(frame,session);child.emitLine(rest);}],
    ['unexpected shape',(frame,child,session)=>{child.emitLine(success(frame,session,{result:{text:'object'}}));}],
    ['malformed',(frame,child,session)=>{child.emitLine(`{"type":"assistant","x":"${'a'.repeat(17*1024*1024)}"}\n`);child.emitLine(success(frame,session));}],
    ['malformed',(frame,child,session)=>{child.emitLine(success(frame,session));child.emitLine('{"type":"assistant","partial":');}],
  ];
  for (const [note,onUser] of cases) {
    const f=fixture(t,{script:nativeScript({onUser,onClose:child=>child.exit(0)})});
    const job=await start(f.engine);f.spawned[0].exit(0);await settle();f.record(job.turn_id);
    const [seen]=await f.engine.jobs();
    assert.equal(seen.state,'unknown',note);assert.match(seen.native_state_note,new RegExp(note));
    assert.equal(seen.native_result,null);
  }
});

test('a result alone does not end the run; the workspace stays owned until the native process exits', async t => {
  const f=fixture(t,{script:nativeScript({onClose:()=>{}})});
  const job=await start(f.engine);await settle();f.record(job.turn_id);
  assert.equal((await f.engine.jobs())[0].state,'running');
  await assert.rejects(f.engine.assertWorkspaceIdle(),/still running/);
  f.spawned[0].exit(0);await settle();
  assert.equal((await f.engine.jobs())[0].state,'needs_review');
});

test('native quota or auth errors end as failed', async t => {
  const f=fixture(t,{script:nativeScript({onUser:(frame,child,session)=>child.emitLine({type:'result',subtype:'error_during_execution',is_error:true,errors:['rate limit reached'],uuid:'r-2',user_message_uuid:frame.uuid,session_id:session})})});
  const a=await start(f.engine);await settle();f.record(a.turn_id);
  const failed=(await f.engine.jobs())[0];
  assert.equal(failed.state,'failed');assert.match(failed.native_result.response,/rate limit/);
});

test('unexpected permission or dialog requests are denied by request ID, retained and keep the run unresolved', async t => {
  const f=fixture(t,{script:nativeScript({onUser:(frame,child,session)=>{
    child.emitLine({type:'control_request',request_id:'perm-1',request:{subtype:'can_use_tool',tool_name:'WebFetch',input:{}}});
    child.emitLine({type:'control_request',request_id:'dialog-1',request:{subtype:'elicitation',message:'?'}});
    child.emitLine(success(frame,session));
  }})});
  await start(f.engine).catch(()=>{});await settle();
  const replies=f.spawned[0].frames.filter(frame=>frame.type==='control_response');
  assert.deepEqual(replies.map(frame=>[frame.response.request_id,frame.response.subtype,frame.response.response?.behavior]),[['perm-1','success','deny'],['dialog-1','error',undefined]]);
  assert.ok(f.spawned[0].frames.some(frame=>frame.request?.subtype==='interrupt'&&frame.request.cancel_queued===true));
  f.record(receipts(f.state)[0].turn_id);
  const [job]=await f.engine.jobs();
  assert.equal(job.state,'unknown');
  assert.deepEqual(job.native_refused_requests,[{request_id:'perm-1',subtype:'can_use_tool'},{request_id:'dialog-1',subtype:'elicitation'}]);
  assert.equal((await f.engine.doctor()).ready,false);

  // A request before input confirmation refuses the run outright.
  const early=fixture(t,{script:(frame,child)=>{
    if(frame.type==='user')child.emitLine({type:'control_request',request_id:'perm-0',request:{subtype:'can_use_tool',tool_name:'Bash',input:{}}});
    return nativeScript()(frame,child);
  }});
  await assert.rejects(start(early.engine),/unexpected native authority request/);
  await settle();
  assert.equal((await early.engine.jobs())[0].state,'unknown');
});

test('interrupt is recorded as requested, then confirmed by the native error result and process exit; the turn is continuable', async t => {
  const f=fixture(t,{script:nativeScript({onUser:()=>{},onInterrupt:(_frame,child)=>{
    const user=child.frames.find(frame=>frame.type==='user');
    child.emitLine({type:'result',subtype:'error_during_execution',is_error:true,errors:['interrupted'],uuid:'r-3',user_message_uuid:user.uuid,session_id:child.session});
  },onClose:child=>child.exit(1)})});
  const job=await start(f.engine);
  assert.equal((await f.engine.jobs())[0].state,'running');
  await assert.rejects(f.engine.interrupt(job.id,'other-turn'),/not confirmed running/);
  const reply=await f.engine.interrupt(job.id,job.turn_id);
  assert.equal(reply.interrupt_requested,true);
  await settle();f.record(job.turn_id);
  const saved=receipts(f.state)[0];
  assert.equal(saved.interrupt.acknowledged,true);assert.ok(saved.interrupt.confirmed_at);assert.equal(saved.exit_code,1);
  assert.equal((await f.engine.jobs())[0].state,'interrupted');
  await assert.rejects(f.engine.interrupt(job.id,job.turn_id),/not confirmed running|already interrupted/);
  const next=await f.engine.continue(job.id,job.turn_id,'Resume carefully.');
  assert.equal(next.thread_id,job.thread_id);
});

test('an interrupt request without native confirmation is not reported as interrupted', async t => {
  const f=fixture(t,{script:nativeScript({onUser:()=>{},onInterrupt:(_frame,child)=>{
    const user=child.frames.find(frame=>frame.type==='user');
    child.emitLine(success(user,child.session));
  }})});
  const job=await start(f.engine);
  await f.engine.interrupt(job.id,job.turn_id);await settle();f.record(job.turn_id);
  assert.equal((await f.engine.jobs())[0].state,'needs_review');
});

test('a new bridge process never marks a persisted running receipt idle and preserves cross-harness writer locks', async t => {
  const f=fixture(t,{script:nativeScript({onUser:()=>{}})});
  const job=await start(f.engine);
  const restarted=new ClaudeEngine(f.state,f.config,f.provider,f.options);
  const [seen]=await restarted.jobs();
  assert.equal(seen.state,'unknown');assert.equal(seen.turn_id,job.turn_id);
  await assert.rejects(restarted.assertWorkspaceIdle(),/active or unresolved/);
  await assert.rejects(restarted.continue(job.id,job.turn_id,'Next.'),/active, stale or ambiguous/);
  await assert.rejects(restarted.interrupt(job.id,job.turn_id),/not confirmed running/);
  f.engine.close();
  const other=new ClaudeEngine(join(f.state,'..','other-state'),f.config,f.provider,f.options);
  await assert.rejects(other.assertWorkspaceIdle(),/Another native installation owns/);
});

test('readiness or unavailable or nonempty inventory refuse admission before any native process starts', async t => {
  const f=fixture(t,{ready:false});
  await assert.rejects(start(f.engine),/Native readiness failed/);
  const g=fixture(t);g.inventory.value=new Error('unavailable');
  await assert.rejects(start(g.engine),/inventory is unavailable/);
  const h=fixture(t);h.inventory.value={agents:[]};
  await assert.rejects(start(h.engine),/inventory is unavailable/);
  const i=fixture(t);i.inventory.value=[{pid:3,cwd:i.config.repo,kind:'interactive',sessionId:'x',status:'completed'}];
  await assert.rejects(start(i.engine),/active or unresolved/);
  assert.equal(f.spawned.length+g.spawned.length+h.spawned.length+i.spawned.length,0);
});

test('native inventory is read with safe mode and no setting sources', () => {
  const args=claudeInventoryArgs({repo:'/repo'});
  assert.deepEqual(args.slice(0,3),['agents','--json','--all']);
  assert.ok(args.includes('--safe-mode'));
  assert.equal(args[args.indexOf('--setting-sources')+1],'');
  assert.equal(args[args.indexOf('--cwd')+1],'/repo');
});

// Doctor fixture using the actual 2.1.289 summary payload (no tool lists).
function readinessFixture(t,{effort='medium',skills,hooks=[],policy={disabledByPolicy:false,managedOnly:false,pluginOnly:false,allDisabled:true,policyHookCount:0},
  auth={loggedIn:true,authMethod:'claude.ai',apiProvider:'firstParty',subscriptionType:'pro'},effective:edit=s=>s,initEnvelope,context={}}={}) {
  const {state,config,settings,claude}=pinned(t);
  const effective=edit(JSON.parse(settings));
  const calls={version:0,auth:0};
  const {spawnImpl,spawned}=fakeSpawn((frame,child)=>{
    if(frame.type!=='control_request')return;
    const replies={get_settings:{effective,sources:[],applied:{model:'claude-opus-5-5',effort}},get_hooks_listing:{hooks,policy},
      get_context_usage:{mcpTools:[],model:'claude-opus-5-5',skills:{totalSkills:7,includedSkills:7,tokens:1,
        skillFrontmatter:skills||[...FACTORY_SKILLS.map(name=>({name,source:'userSettings',tokens:1})),{name:'plugin-authoring',source:'built-in',tokens:1}]},...context}};
    if(frame.request.subtype==='initialize')return child.emitLine(ok(frame,{account:{apiProvider:'firstParty'}},initEnvelope||{pending_permission_requests:[],pending_user_dialog_requests:[]}));
    child.emitLine(ok(frame,replies[frame.request.subtype]));
  });
  return {claude,calls,spawned,run:()=>claudeReadiness(config,state,{spawnImpl,
    version:()=>{calls.version++;return '2.1.289 (Claude Code)';},auth:async()=>{calls.auth++;return auth;}})};
}

test('doctor probes only native control state, without a prompt, saved session or claimed tool inventory', async t => {
  const f=readinessFixture(t);
  const ready=await f.run();
  assert.equal(ready.ready,true,ready.gaps.join('; '));
  assert.equal(ready.account,'claude.ai · pro');assert.equal(ready.usage,'unknown');
  assert.match(ready.tools,/confirmed when each native run starts/);
  const [probe]=f.spawned;
  assert.ok(probe.args.includes('--no-session-persistence'));
  assert.deepEqual(probe.frames.map(frame=>frame.type==='control_request'?frame.request.subtype:frame.type),['initialize','get_settings','get_hooks_listing','get_context_usage']);
  assert.deepEqual(probe.frames.at(-1).request,{subtype:'get_context_usage',detail:'summary'});
});

test('doctor treats a first-party account without a native login as unavailable', async t => {
  for (const auth of [{loggedIn:false,apiProvider:'firstParty'},{apiProvider:'firstParty'},null]) {
    const ready=await readinessFixture(t,{auth}).run();
    assert.equal(ready.ready,false);assert.match(ready.gaps.join(),/login required/);
  }
});

test('doctor refuses drift in effort, hooks policy, skills, sandbox or plugins', async t => {
  const gaps=async options=>(await readinessFixture(t,options).run()).gaps.join();
  assert.match(await gaps({effort:'high'}),/model or effort/);
  assert.match(await gaps({hooks:[{event:'PreToolUse'}]}),/hooks/);
  assert.match(await gaps({policy:{allDisabled:false,policyHookCount:0}}),/hooks/);
  assert.match(await gaps({policy:{allDisabled:true,policyHookCount:1}}),/hooks/);
  assert.match(await gaps({skills:[...FACTORY_SKILLS.map(name=>({name,source:'userSettings'})),{name:'personal-skill',source:'userSettings'}]}),/skill inventory/);
  assert.match(await gaps({skills:[...FACTORY_SKILLS.slice(1).map(name=>({name,source:'userSettings'})),{name:FACTORY_SKILLS[0],source:'plugin'}]}),/skill inventory/);
  assert.match(await gaps({context:{systemTools:[{name:'WebFetch',tokens:1}]}}),/tool inventory/);
  for (const edit of [s=>({...s,sandbox:{...s.sandbox,allowWeakerNetworkIsolation:true}}),s=>({...s,sandbox:{...s.sandbox,allowWeakerNestedSandbox:true}}),
    s=>({...s,sandbox:{...s.sandbox,excludedCommands:['curl']}}),s=>({...s,sandbox:{...s.sandbox,filesystem:{...s.sandbox.filesystem,allowWrite:[...s.sandbox.filesystem.allowWrite,'/']}}}),
    s=>({...s,sandbox:{...s.sandbox,failIfUnavailable:undefined}}),s=>({...s,enabledPlugins:{'personal@x':true}}),s=>({...s,disableBundledSkills:false}),
    s=>({...s,permissions:{...s.permissions,ask:['Bash']}}),s=>({...s,env:{ANTHROPIC_BASE_URL:'http://x'}})])
    assert.match(await gaps({effective:edit}),/Effective Claude settings differ/);
  // Empty native defaults inside pinned objects remain acceptable.
  assert.equal((await readinessFixture(t,{effective:s=>({...s,sandbox:{...s.sandbox,excludedCommands:[],ignoreViolations:{}}})}).run()).ready,true);
});
