import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { execFile, execFileSync } from 'node:child_process';
import { JobQueue } from '../factory/queue.mjs';
import { IssueSubmissions } from '../factory/issue-submissions.mjs';
import { githubIssueProvider } from '../factory/providers/github.mjs';
import { issueProvider } from '../factory/issue-provider.mjs';
import { createController } from '../factory/server.mjs';

const executor={execute:async()=>{throw Error('No execution permitted');},stop:async()=>{},reconcile:async()=>{}};
function directory(t) { const root=mkdtempSync(join(tmpdir(),'sdf-provider-'));t.after(()=>rmSync(root,{recursive:true,force:true}));return root; }
function fixture() {
  const context={repository:'https://forge.example/team/project',actor:'operator',actor_id:7,available:true,labels_supported:true};
  let writes=0,mode='ok',remote;
  const provider={id:'other-forge',label:'Other forge',supported:true,repository:context.repository,capabilities:{issues:true,create:true,templates:false},context:async()=>({...context}),
    publish:async record=>{writes++;if(mode==='rejected')throw Object.assign(Error('rejected'),{httpStatus:403});remote={number:1,url:context.repository+'/issues/1',title:record.payload.title,labels:record.payload.labels,missing_labels:[]};if(mode==='lost')throw Error('response lost');return remote;},
    recover:async()=>{if(!remote)throw Error('unavailable');return remote;}};
  return {provider,context,get writes(){return writes;},set mode(value){mode=value;},input:{request_id:'request_123456789',repository:context.repository,actor:context.actor,title:'Implement bridge',spec:'A bounded software improvement.',labels:['enhancement']}};
}
test('provider-independent creation persists receipts, rejects stale context and never submits a job',async t=>{
  const queue=new JobQueue(directory(t),executor);t.after(()=>queue.close());const f=fixture(),store=new IssueSubmissions(queue,f.provider);
  for(const input of [{...f.input,repository:'https://evil.example/elsewhere'},{...f.input,actor:'someone-else'},{...f.input,labels:'bad'},{...f.input,spec:'x'.repeat(60001)}])await assert.rejects(store.create(input));
  assert.equal(f.writes,0);assert.equal(store.list().length,0);
  const receipt=await store.create(f.input);assert.equal(receipt.provider,'other-forge');assert.equal(receipt.state,'created');assert.equal(receipt.issue.number,1);
  assert.deepEqual(await store.create(f.input),receipt);assert.equal(f.writes,1);
  await assert.rejects(store.create({...f.input,title:'Different'}),/different content/);
  assert.equal(queue.all().length,0);assert.equal(store.list().length,1);
  queue.setMaintenance(true);await assert.rejects(store.create({...f.input,request_id:'request_222222222'}),/maintenance/);assert.equal(f.writes,1);
});
test('lost response recovers after restart without duplicate publication; rejection safely retries the same request',async t=>{
  const root=directory(t),f=fixture();let queue=new JobQueue(root,executor),store=new IssueSubmissions(queue,f.provider);f.mode='lost';
  await assert.rejects(store.create(f.input),/may have succeeded/);assert.equal(store.list()[0].state,'uncertain');await queue.close();
  queue=new JobQueue(root,executor);t.after(()=>queue.close());store=new IssueSubmissions(queue,f.provider);
  assert.equal((await store.recover(f.input.request_id)).state,'created');assert.equal(f.writes,1);assert.equal(queue.all().length,0);
  f.mode='rejected';const second={...f.input,request_id:'request_222222222'};await assert.rejects(store.create(second),/rejected/);
  assert.equal(store.get(second.request_id).state,'rejected');f.mode='ok';assert.equal((await store.create(second)).state,'created');assert.equal(f.writes,3);
});
test('GitHub adapter pins repository identity, preserves labels and reconciles a marker using bounded reads',async t=>{
  const root=directory(t);execFileSync('git',['init',root],{stdio:'ignore'});execFileSync('git',['-C',root,'remote','add','origin','git@github.com:example/project.git']);
  let stored,writes=0;
  const provider=githubIssueProvider(root,{read:async args=>{
    if(args[0]==='issue'){assert.deepEqual(args,['issue','view','https://github.com/example/project/issues/4','--json','title,body,url,labels,state']);return {title:stored.title,body:stored.body,url:stored.html_url,labels:stored.labels};}
    const endpoint=args[3];if(endpoint==='user')return {id:7,login:'operator'};
    if(endpoint==='repos/example/project')return {full_name:'example/project',has_issues:true,permissions:{push:true}};
    assert.match(endpoint,/repos\/example\/project\/issues\?state=all&creator=operator/);return stored?[stored]:[];
  },write:async(path,payload)=>{assert.equal(path,'repos/example/project/issues');writes++;stored={number:4,html_url:'https://github.com/example/project/issues/4',user:{id:7},title:payload.title,body:payload.body,labels:payload.labels.map(name=>({name}))};return stored;}});
  const queue=new JobQueue(root,executor);t.after(()=>queue.close());const store=new IssueSubmissions(queue,provider),input={...fixture().input,repository:'https://github.com/example/project'};
  const result=await store.create(input);assert.deepEqual(result.issue.labels,['enhancement']);assert.match(stored.body,/<!-- factory-issue:/);
  const selected=await provider.preview(result.issue.url);assert.equal(selected.title,input.title);assert.equal(selected.url,result.issue.url);assert.match(selected.spec,/bounded software improvement/);
  const record=store.get(input.request_id);record.state='pending';store.save(record);assert.equal((await store.recover(input.request_id)).issue.url,stored.html_url);assert.equal(writes,1);
  stored=null;record.state='uncertain';store.save(record);await assert.rejects(store.recover(input.request_id),/still unconfirmed/);assert.equal(writes,1);
});
test('unsupported remotes expose only a sanitized host and retain local execution',async t=>{
  const root=directory(t);execFileSync('git',['init',root],{stdio:'ignore'});
  for(const remote of ['https://secret:token@forge.example/org/repo.git','ssh://git@origin.cursor.com/team/project.git','git@codeberg.org:org/repo.git']){
    execFileSync('git',['-C',root,'config','remote.origin.url',remote]);const provider=issueProvider(root);
    assert.equal(provider.supported,false);assert.equal(provider.capabilities.create,false);assert(!JSON.stringify(provider).includes('token'));assert(!JSON.stringify(provider).includes('secret'));
    await assert.rejects(provider.context(),/no supported issue provider/);
  }
});
test('HTTP creation is session-protected, exposes the same receipt and leaves the queue empty',async t=>{
  const root=directory(t),f=fixture();writeFileSync(join(root,'factory.json'),JSON.stringify({version:1,repo:root,harness:'mock',command:['mock'],port:7331,check:'true',image:'fixture:1',network:'none',timeoutSeconds:10,memoryMiB:512,scope:{project:'fixture',service:'app',environment:'test',owner:'operator'}}));writeFileSync(join(root,'worker.token'),'fixture');
  const controller=createController(root,executor,{issueProvider:f.provider});await new Promise(resolve=>controller.server.listen(0,'127.0.0.1',resolve));t.after(()=>controller.close());
  const base=`http://127.0.0.1:${controller.server.address().port}`;
  const post=headers=>fetch(base+'/api/v1/issues',{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(f.input)});
  assert.equal((await post({})).status,403);assert.equal(f.writes,0);
  assert.equal((await post({Authorization:'Bearer fixture',Origin:'https://evil.example'})).status,403);
  const result=await(await post({Authorization:'Bearer fixture'})).json();assert.equal(result.state,'created');assert.equal(f.writes,1);
  const receipts=await(await fetch(base+'/api/v1/issue-submissions',{headers:{Authorization:'Bearer fixture'}})).json();assert.equal(receipts[0].issue.url,result.issue.url);assert.equal(controller.queue.all().length,0);
  const config=JSON.parse((await import('node:fs')).readFileSync(join(root,'factory.json'),'utf8'));config.port=controller.server.address().port;writeFileSync(join(root,'factory.json'),JSON.stringify(config));
  writeFileSync(join(root,'draft.json'),JSON.stringify({title:f.input.title,spec:f.input.spec,labels:f.input.labels}));
  const cli=async(...args)=>JSON.parse((await promisify(execFile)(process.execPath,['bin/software-defence-factory.mjs','issue',...args,'--state',root],{env:{...process.env,SDF_AUTO_UPDATE:'0'}})).stdout);
  const same=await cli('create','--draft',join(root,'draft.json'),'--key',f.input.request_id);assert.equal(same.issue.url,result.issue.url);assert.equal(f.writes,1);assert.equal(controller.queue.all().length,0);
  assert.equal((await cli('submissions'))[0].issue.url,result.issue.url);
});
