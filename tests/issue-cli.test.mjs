import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,rmSync,writeFileSync,mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createController } from '../factory/server.mjs';
import { ROOT } from '../factory/lib.mjs';
import { execFileSync } from 'node:child_process';
const exec=promisify(execFile);

test('issue CLI requires explicit execution choice and shares the controller record with the dashboard',async t=>{
  const state=mkdtempSync(join(tmpdir(),'sdf-issue-cli-'));t.after(()=>rmSync(state,{recursive:true,force:true}));
  const repo=join(state,'repo');mkdirSync(repo);execFileSync('git',['-C',repo,'init','--quiet','-b','main']);writeFileSync(join(repo,'source.txt'),'fixture\n');execFileSync('git',['-C',repo,'add','source.txt']);execFileSync('git',['-C',repo,'-c','user.name=Fixture','-c','user.email=fixture@localhost','commit','--quiet','-m','Fixture']);
  const config={version:1,repo,sourceRef:'main',harness:'mock',command:['mock'],port:7331,check:'true',image:'fixture:1',network:'none',timeoutSeconds:10,memoryMiB:512,scope:{project:'fixture',service:'app',environment:'test',owner:'operator'}};
  writeFileSync(join(state,'factory.json'),JSON.stringify(config));writeFileSync(join(state,'worker.token'),'fixture');
  writeFileSync(join(state,'brief.md'),'Investigate supplied suspicious access logs.');
  const controller=createController(state,{execute:async()=>({outcome:'blocked'}),stop:async()=>{},reconcile:async()=>{}});
  await new Promise(resolve=>controller.server.listen(0,'127.0.0.1',resolve));t.after(()=>controller.close());
  config.port=controller.server.address().port;writeFileSync(join(state,'factory.json'),JSON.stringify(config));
  assert.equal((await(await fetch(`http://127.0.0.1:${config.port}/api/v1/status`)).json()).source_ref_default,'main');
  const cli=async(...args)=>JSON.parse((await exec(process.execPath,[join(ROOT,'bin/software-defence-factory.mjs'),'issue',...args,'--state',state],{env:{...process.env,SDF_AUTO_UPDATE:'0'}})).stdout);
  await assert.rejects(cli('start','--file',join(state,'brief.md'),'--title','Investigate evidence'),/choose --workflow/);
  assert.equal(controller.queue.all().length,0);
  assert.equal((await cli('recommend','--file',join(state,'brief.md'))).workflow,'defence');
  const created=await cli('start','--file',join(state,'brief.md'),'--title','Investigate evidence','--workflow','defence','--source-ref','main');
  assert.equal(created.source_admission.requested_ref,'main');assert.equal(created.source_admission.ref_source,'explicit');assert.match(created.source_admission.resolved_sha,/^[a-f0-9]{40}$/);
  await assert.rejects(cli('start','--file',join(state,'brief.md'),'--title','Invalid ref','--workflow','defence','--source-ref','missing-ref'),/Could not resolve source ref/);
  assert.equal(controller.queue.all().length,1,'the CLI does not report a missing source ref as a successful admission');
  const listed=await cli('list');assert.equal(listed[0].id,created.id);
  assert.equal(listed[0].task.title,'Investigate evidence');assert.equal(listed[0].workflow.name,'defence');
  const persisted=controller.queue.get(created.id);persisted.source_history=[persisted.source_admission];controller.queue.save(persisted);
  const snapshot=await(await fetch(`http://127.0.0.1:${config.port}/api/v1/status`)).json();assert.equal(snapshot.jobs[0].task.title,listed[0].task.title);assert.deepEqual(snapshot.jobs[0].source_admission,created.source_admission);assert.equal(snapshot.jobs[0].source_history[0].resolved_sha,created.source_admission.resolved_sha);assert(!JSON.stringify(snapshot).includes('retained_repo'));assert(!JSON.stringify(snapshot).includes('repository_path'));
});

// Controlled provider + real CLI/controller/SQLite; no provider writes or worker runs.
async function lifecycleFixture(t) {
  const state=mkdtempSync(join(tmpdir(),'sdf-cli-lifecycle-'));t.after(()=>rmSync(state,{recursive:true,force:true}));
  const repo=join(state,'repo');mkdirSync(repo);execFileSync('git',['init','-q',repo]);
  writeFileSync(join(repo,'source.txt'),'fixture');execFileSync('git',['-C',repo,'add','.']);
  execFileSync('git',['-C',repo,'-c','user.name=Fixture','-c','user.email=f@localhost','commit','-qm','Fixture']);
  const config={version:1,repo,harness:'mock',command:['mock'],port:7331,check:'true',image:'fixture:1',network:'none',timeoutSeconds:10,memoryMiB:512,scope:{project:'fixture',service:'app',environment:'test',owner:'operator'}};
  writeFileSync(join(state,'factory.json'),JSON.stringify(config));writeFileSync(join(state,'worker.token'),'fixture');
  const url='https://github.com/example/project/issues/42';
  const issue={number:42,url,title:'Provider title',spec:'Current provider scope',body:'Current provider scope',state:'open',labels:['factory:ready']};
  const provider={id:'github',label:'GitHub',repository:'https://github.com/example/project',supported:true,capabilities:{issues:true},preview:async()=>({...issue}),list:async(page,filter)=>({issues:page===1?[{...issue,state:filter==='closed'?'closed':'open'}]:[],next_page:page===1?2:null})};
  const controller=createController(state,{execute:async()=>({outcome:'complete'}),stop:async()=>{},reconcile:async()=>{}},{issueProvider:provider});
  await new Promise(resolve=>controller.server.listen(0,'127.0.0.1',resolve));t.after(()=>controller.close());
  config.port=controller.server.address().port;writeFileSync(join(state,'factory.json'),JSON.stringify(config));
  const cli=async(...args)=>JSON.parse((await exec(process.execPath,[join(ROOT,'bin/software-defence-factory.mjs'),...args,'--state',state],{env:{...process.env,SDF_AUTO_UPDATE:'0'}})).stdout);
  const request=async(path,input)=>{const response=await fetch(`http://127.0.0.1:${config.port}${path}`,{method:input?'POST':'GET',headers:{Authorization:'Bearer fixture','Content-Type':'application/json'},...(input?{body:JSON.stringify(input)}:{})});return {status:response.status,value:await response.json()};};
  return {state,url,issue,provider,controller,cli,request};
}

test('CLI remote start forwards a bounded operator brief through shared admission and rejects misuse without jobs',async t=>{
  const {state,url,issue,provider,controller,cli,request}=await lifecycleFixture(t);
  const file=join(state,'operator.md'),draft=join(state,'draft.json');
  const brief='Preserve the operator boundary.\n\nUse the existing source policy. <literal>';
  writeFileSync(file,brief);writeFileSync(draft,JSON.stringify({title:'Local draft',spec:'Local scope'}));
  const start=(...args)=>cli('issue','start','--workflow','software',...args);
  for(const args of [
    ['issue','preview','--url',url,'--brief-file',file],
    ['issue','create','--file',file,'--title','New','--key','controlled_request_42','--brief-file',file],
    ['inbox','--brief-file',file],
  ]) await assert.rejects(cli(...args),/--brief-file.*issue start/);
  for(const args of [['--file',file,'--title','Local'],['--draft',draft],['--url',url,'--file',file],['--url',url,'--draft',draft]])
    await assert.rejects(start(...args,'--brief-file',file),/Choose|--brief-file/);
  await assert.rejects(start('--url',url,'--brief-file',join(state,'missing.md')),/ENOENT/);
  await assert.rejects(start('--url',url,'--brief-file',state),/EISDIR|regular file/);
  writeFileSync(file,'x'.repeat(16001));await assert.rejects(start('--url',url,'--brief-file',file),/16000/);
  for(const invalid of [123,{},'x'.repeat(16001)])assert.equal((await request('/api/v1/issues/start',{url,workflow:'software',expected_spec:issue.spec,brief:invalid})).status,400);
  assert.equal(controller.queue.all().length,0);
  writeFileSync(file,brief);
  const preview=provider.preview;let reads=0;
  provider.preview=async()=>({...issue,spec:++reads===1?issue.spec:'Changed after preview'});
  await assert.rejects(start('--url',url,'--brief-file',file),/Issue content changed/);assert.equal(controller.queue.all().length,0);
  provider.preview=preview;
  const created=await start('--url',url+'?view=all#context','--brief-file',file);
  assert.equal(controller.queue.get(created.id).task.spec,`${issue.spec}\n\nOperator brief:\n${brief}`);
  assert.equal(controller.queue.get(created.id).task.source_url,url);
  for(let i=0;i<100 && controller.queue.get(created.id).state!=='awaiting_approval';i++)await new Promise(resolve=>setTimeout(resolve,5));
  await controller.queue.action(created.id,'cancel',{run_id:controller.queue.get(created.id).runs.at(-1).id});
  writeFileSync(file,'x'.repeat(16000));const boundary=await start('--url',url,'--brief-file',file);
  assert.equal(controller.queue.get(boundary.id).task.spec,`${issue.spec}\n\nOperator brief:\n${'x'.repeat(16000)}`);
  const local=await start('--draft',draft);assert.equal(controller.queue.get(local.id).task.spec,'Local scope');
});

test('CLI Inbox defaults to shared repository pages; explicit factory mode preserves executions and errors stay errors',async t=>{
  const {cli,request,controller,provider,url,issue,state}=await lifecycleFixture(t);
  assert.deepEqual(await cli('inbox'),(await request('/api/v1/issues?page=1&state=open')).value);
  assert.equal(controller.queue.all().length,0,'browsing cannot admit jobs');
  for(const args of [['--page','2','--issue-state','all'],['--issue-state','closed']]) {
    const page=await cli('inbox',...args);
    assert.deepEqual(page,(await request(`/api/v1/issues?page=${page.page}&state=${page.state}`)).value);
  }
  for(const args of [['--page','0'],['--issue-state','invalid'],['--source','unknown'],['--source','factory','--page','2'],['--source','factory','--issue-state','closed']])await assert.rejects(cli('inbox',...args),/valid issue|Choose|Repository paging/);
  assert.equal(controller.queue.all().length,0);
  const local=join(state,'local.md');writeFileSync(local,'Local evidence');
  await cli('issue','start','--file',local,'--title','Local execution','--workflow','defence');
  const created=await request('/api/v1/issues/start',{url,expected_spec:issue.spec,workflow:'software'});
  for(let i=0;i<100 && controller.queue.get(created.value.id).state!=='awaiting_approval';i++)await new Promise(resolve=>setTimeout(resolve,5));
  const page=await cli('inbox');assert.equal(page.issues[0].executions[0].id,created.value.id);assert.equal(page.history[0].source_status,'local');
  assert.deepEqual(page,(await request('/api/v1/issues')).value);
  assert.equal((await cli('inbox','--page','2')).history.length,2);
  for(const args of [['inbox','--source','factory'],['issue','list'],['issue','list','--source','factory']])assert.deepEqual(await cli(...args),(await request('/api/v1/status')).value.jobs);
  for(const args of [['inbox','--source','remote'],['issue','list','--source','inbox'],['issues']])assert.deepEqual(await cli(...args),page);
  provider.list=async()=>{throw Error('Provider credentials unavailable');};
  await assert.rejects(cli('inbox'),/Provider credentials unavailable/);
  assert.equal((await request('/api/v1/issues')).status,400);
  assert.equal((await cli('inbox','--source','factory')).length,2);
  provider.supported=false;
  const unsupported=await cli('inbox');assert.equal(unsupported.provider.supported,false);assert.equal(unsupported.issues.length,0);assert.equal(unsupported.history.length,2);
  assert.deepEqual(unsupported,(await request('/api/v1/issues')).value);
  assert.equal(controller.queue.all().length,2,'only explicit starts admitted work');
});

test('legacy run --issue retains canonical identity and shares active rejection and subsequent history',async t=>{
  const {state,cli,request,controller,url,issue}=await lifecycleFixture(t);
  execFileSync('git',['-C',join(state,'repo'),'remote','add','origin','https://github.com/example/project.git']);
  // Stub only gh reads in the child; CLI, HTTP, source retention and SQLite are real.
  const hook=join(state,'provider-read.mjs');
  writeFileSync(hook,`import cp from 'node:child_process';\nimport {syncBuiltinESMExports} from 'node:module';\nimport {promisify} from 'node:util';\nconst original=cp.execFile;\ncp.execFile=function(command,args,options,callback){\n if(command==='gh'){queueMicrotask(()=>callback(null,JSON.stringify(${JSON.stringify({title:issue.title,body:issue.body,url,state:'OPEN',labels:[{name:'factory:ready'}]})}),''));return {};}\n return original(command,args,options,callback);\n};\ncp.execFile[promisify.custom]=(...args)=>new Promise((resolve,reject)=>cp.execFile(...args,(error,stdout,stderr)=>error?reject(error):resolve({stdout,stderr})));\nsyncBuiltinESMExports();\n`);
  const run=async()=>JSON.parse((await exec(process.execPath,['--import',hook,join(ROOT,'bin/software-defence-factory.mjs'),'run','--issue','http://GitHub.com/Example/Project/issues/42/#context','--state',state],{env:{...process.env,SDF_AUTO_UPDATE:'0'}})).stdout);
  const first=await cli('issue','start','--url',url,'--workflow','software');
  for(let i=0;i<100 && controller.queue.get(first.id).state!=='awaiting_approval';i++)await new Promise(resolve=>setTimeout(resolve,5));
  await assert.rejects(run(),/already has active/);assert.equal(controller.queue.all().length,1);
  await controller.queue.action(first.id,'cancel',{run_id:controller.queue.get(first.id).runs.at(-1).id});
  const second=await run();assert.equal(controller.queue.get(second.id).task.source_url,url);
  const backlog=(await request('/api/v1/issues')).value;
  assert.equal(backlog.issues.length,1);assert.equal(backlog.issues[0].executions.length,2);assert.equal(backlog.history.length,0);
});
