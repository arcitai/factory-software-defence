import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { validateIncident, validateReport, admitIncident, incidentFor } from '../factory/incident.mjs';
import { save, configAt, run } from '../factory/lib.mjs';

const scope={project:'pilot',service:'app',environment:'test',owner:'operator'};
function signal() {return {contract_version:1,sanitized:true,...scope,source:'fixture',event_id:'one',summary:'Synthetic HTTP 500',evidence:['logs','metrics','revision'].map(kind=>({kind,observed_at:new Date().toISOString(),text:`Synthetic ${kind}`}))};}
function instance(t) {
  const state=mkdtempSync(join(tmpdir(),'arcitai-test-'));t.after(()=>rmSync(state,{recursive:true,force:true}));
  save(join(state,'factory.json'),{version:1,repo:state,agent:'mock',command:['node','/opt/factory/mock.mjs'],port:7332,timeoutSeconds:10,memoryMiB:256,image:'example:1',network:'none',check:'true',scope});
  return state;
}
test('incident scope is explicit; credentials and stale/missing evidence never imply healthy operation',()=>{
  assert.throws(()=>validateIncident(signal(),{}),/scope/);
  assert.throws(()=>validateIncident({...signal(),environment:'production'},scope),/scope/);
  assert.throws(()=>validateIncident({...signal(),summary:'api_key=THIS_IS_A_SYNTHETIC_SECRET'},scope),/credential/);
  const input=signal();input.evidence[0].observed_at='2000-01-01T00:00:00Z';input.evidence.pop();
  const result=validateIncident(input,scope);assert.equal(result.gaps.length,2);
});
test('incident admission deduplicates, conflicts, and binds the report writer to its exact job',async t=>{
  const state=instance(t),input=signal();let calls=0,spec;
  const submit=async(workflow,brief)=>{calls++;spec=brief;assert.equal(workflow,'defence');return{id:'job_authorized'};};
  const first=await admitIncident(state,input,submit),second=await admitIncident(state,input,submit);
  assert.equal(first.id,second.id);assert.equal(second.deduplicated,true);assert.equal(calls,1);
  await assert.rejects(admitIncident(state,{...input,summary:'different'},submit),/conflicting/);
  await assert.rejects(incidentFor(state,spec,'job_duplicate'),/not bound/);
  assert.equal((await incidentFor(state,spec,'job_authorized')).entry.case_id,first.case_id);
});
test('ambiguous submission is retained and cannot silently start another writer',async t=>{
  const state=instance(t),input=signal();let calls=0;
  const submit=async()=>{calls++;throw new Error('network outcome unknown');};
  await assert.rejects(admitIncident(state,input,submit),/network/);
  await assert.rejects(admitIncident(state,input,submit),/reconcile/);assert.equal(calls,1);
});
test('incident report is a typed draft; model claims cannot verify cause, recovery or revision',()=>{
  const report={status:'insufficient_evidence',summary:'Need telemetry',hypotheses:[],recommended_actions:[],unknowns:['gap'],production_action_taken:false,recovered:true,verified_revision:'invented'};
  const output=validateReport(report,{entry:{case_id:'case_one'},input:{gaps:[]}});
  assert.equal(output.investigation,'inconclusive');assert.equal(output.case_state,'open');assert.equal(output.recovered,undefined);assert.equal(output.verified_revision,undefined);
  assert.throws(()=>validateReport({...report,hypotheses:[{shell:'run me'}]},{entry:{},input:{gaps:[]}}),/Invalid/);
});
test('configuration rejects unsafe network and command shapes before process launch',t=>{
  const state=instance(t),base=configAt(state);
  for(const change of [{network:'host'},{command:'sh -c anything'},{repo:'/tmp/a,target=/'},{scope:{}},{cpus:0},{cpus:33},{cpus:'8'},{pidsLimit:1},{pidsLimit:16385},{pidsLimit:'1024'}]) {
    save(join(state,'factory.json'),{...base,...change});assert.throws(()=>configAt(state));
  }
  for(const change of [
    {inferenceProvider:'openai'},
    {agent:'codex',inferenceProvider:'anthropic'},
    {agent:'pi',inferenceProvider:'unknown-provider'},
    {agent:'pi',inferenceProvider:'openai',model:'anthropic/claude-sonnet'},
  ]) {
    save(join(state,'factory.json'),{...base,...change});assert.throws(()=>configAt(state),/inferenceProvider/);
  }
  save(join(state,'factory.json'),{...base,cpus:8,pidsLimit:2048});
  assert.equal(configAt(state).cpus,8);
});
test('init preserves app and refuses to overwrite an existing installation',t=>{
  const parent=instance(t),repo=join(parent,'app'),state=join(parent,'new-state');mkdirSync(repo);
  run('git',['init','-b','main',repo]);run('git',['-C',repo,'-c','user.name=Test','-c','user.email=test@localhost','commit','--allow-empty','-m','fixture']);
  const before=run('git',['-C',repo,'status','--porcelain']);
  const args=['bin/software-defence-factory.mjs','init','--state',state,'--repo',repo,'--agent','mock','--check','true'];
  const options={env:{...process.env,XDG_STATE_HOME:join(parent,'private-state')}};
  run(process.execPath,args,options);const config=readFileSync(join(state,'factory.json'),'utf8');
  assert.equal(JSON.parse(config).sourceRef,'HEAD');
  assert.throws(()=>run(process.execPath,args,options),/Already configured/);
  assert.equal(readFileSync(join(state,'factory.json'),'utf8'),config);assert.equal(run('git',['-C',repo,'status','--porcelain']),before);
  const piState=join(parent,'pi-state');
  run(process.execPath,['bin/software-defence-factory.mjs','init','--state',piState,'--repo',repo,'--harness','pi','--inference-provider','anthropic','--model','anthropic/claude-sonnet','--check','true'],options);
  const piConfig=JSON.parse(readFileSync(join(piState,'factory.json'),'utf8'));
  assert.equal(piConfig.inferenceProvider,'anthropic');assert.equal(piConfig.model,'anthropic/claude-sonnet');
  run('git',['-C',repo,'remote','add','origin','https://github.com/example/authorized.git']);
  assert.throws(()=>run(process.execPath,['bin/software-defence-factory.mjs','run','--state',state,'--issue','https://github.com/example/wrong/issues/1']),/does not belong/);
});
