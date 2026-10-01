import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFile,execFileSync} from 'node:child_process';
import {promisify} from 'node:util';
import {setupNative,readNative} from '../factory/native/setup.mjs';
import {registerBridge} from '../factory/native/bridge-client.mjs';
import {createNativeServer} from '../factory/native/server.mjs';
const exec=promisify(execFile),cli=fileURLToPath(new URL('../bin/software-defence-factory.mjs',import.meta.url));
test('CLI repository actions use the running shared bridge and creation never starts native work',async t=>{
 const base=mkdtempSync(join(tmpdir(),'factory-cli-'));t.after(()=>rmSync(base,{recursive:true,force:true}));
 const repo=join(base,'repo');mkdirSync(repo);execFileSync('git',['init','-q',repo]);
 const state=join(base,'state');setupNative(repo,state,process.execPath);
 const {config}=readNative(state);let published=0,started=0;
 const repository='https://github.com/example/project',identity={repository,actor:'operator',actor_id:42,available:true,labels_supported:true};
 const sourceIssue={number:1,title:'Accepted work',url:`${repository}/issues/1`,state:'open',state_reason:null,author:'operator',author_profile_url:`${repository}/operator`,author_avatar_url:'https://avatars.githubusercontent.com/u/42?v=4',assignees:[],labels:[{name:'factory:ready',color:'d9dde5'}]};
 const provider={id:'github',label:'GitHub',repository,supported:true,capabilities:{issues:true,templates:true,create:true},
  context:async()=>identity,list:async()=>({repository,issues:[sourceIssue],next_page:null}),templates:async()=>({templates:[]}),
  draft:async input=>({title:input.title,spec:'A required field was completed.'}),
  publish:async record=>{published++;return {url:repository+'/issues/1',number:1,title:record.payload.title};}};
 const harness={name:'test-native',available:true,jobs:async()=>[{id:'job_abcdef',state:'needs_review',workflow:{name:'software'},task:{title:'Accepted work',source_url:sourceIssue.url}}],doctor:async()=>({ready:true}),start:async()=>{started++;}};
 const {server}=createNativeServer(state,config,{harness,provider,instance:'cli-test'});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 t.after(()=>new Promise(resolve=>server.close(resolve)));
 t.after(registerBridge(state,repo,server.address().port,'cli-test'));
 const run=async args=>JSON.parse((await exec(process.execPath,[cli,...args,'--state',state],{timeout:15000})).stdout);
 assert.equal((await run(['issues','connection'])).actor,'operator');
 const listing=await run(['issues','list']);
 assert.equal(listing.issues[0].phase.id,'ready_to_implement');
 assert.equal(listing.work_records[0].phase.id,'ready_to_implement');
 assert.equal(listing.work_records[0].state,'needs_review');
 assert.equal(listing.issues[0].author_profile_url,`${repository}/operator`);
 assert.deepEqual((await run(['issues','templates'])).templates,[]);
 const file=join(base,'input.json');writeFileSync(file,JSON.stringify({title:'A scoped change'}));
 assert.match((await run(['issues','draft','--file',file])).spec,/required field/);
 writeFileSync(file,JSON.stringify({request_id:'stable-request-0001',repository,actor:'operator',title:'A scoped change',spec:'Accepted scope',labels:[]}));
 assert.equal((await run(['issues','create','--file',file])).state,'created');
 assert.equal((await run(['issues','create','--file',file])).state,'created');
 assert.equal(published,1);assert.equal(started,0);
 assert.equal((await run(['issues','submissions'])).length,1);
 assert.equal((await run(['issues','recover','stable-request-0001'])).issue.number,1);
});
