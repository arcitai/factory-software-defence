import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createController } from '../factory/server.mjs';
import { configAt } from '../factory/lib.mjs';
import { withRequestedModel, executionProfile, attemptPresentation } from '../factory/execution-profile.mjs';

const image='sha256:'+'a'.repeat(64);
test('model overrides and public phase facts are isolated from credentials and mutable config',()=>{
  const config={agent:'codex',command:['codex','exec','-'],model:'old',image,secret:'PRIVATE_SENTINEL'};
  const effective=withRequestedModel(config,'requested');
  assert.deepEqual(effective.command,['codex','exec','--model','requested','-']);
  assert.equal(config.model,'old');assert.deepEqual(config.command,['codex','exec','-']);
  const profile=executionProfile(effective,'build');
  assert.equal(profile.requestedModel,'requested');assert.equal(profile.image,image);assert(!JSON.stringify(profile).includes('PRIVATE_SENTINEL'));
  assert.equal(executionProfile(effective,'verify').requestedModel,null);
  for(const [agent,selection] of [['mock','not_applicable'],['custom','unknown']]) {
    const profile=executionProfile({...effective,agent},'build');assert.equal(profile.requestedModel,null);assert.equal(profile.modelSelection,selection);
  }
  assert.equal(profile.modelSelection,'explicit');
  assert.equal(executionProfile({...effective,model:null},'build').modelSelection,'provider_default');
  assert.equal(executionProfile(effective,'handoff').executor,'deterministic');
  assert.equal(executionProfile(effective,'handoff').image,null);
  assert.throws(()=>withRequestedModel({...config,agent:'custom'},'other'),/overrides/);
});

test('A-profile failure and B-profile retry remain distinct through controller restart and status',async t=>{
  const state=mkdtempSync(join(tmpdir(),'sdf-provenance-'));t.after(()=>rmSync(state,{recursive:true,force:true}));
  const initial={version:1,repo:state,agent:'pi',command:['synthetic-fixture','PRIVATE_SENTINEL'],model:'model-a',image,port:7349,timeoutSeconds:10,memoryMiB:256,network:'none',check:'true',scope:{project:'p',service:'s',owner:'test',environment:'test'}};
  const save=config=>writeFileSync(join(state,'factory.json'),JSON.stringify(config));save(initial);writeFileSync(join(state,'worker.token'),'fixture-token');
  let failing=true, controller;
  const adapter={prepare:(job,run)=>executionProfile(withRequestedModel(configAt(state),job.model),run.command),execute:async()=>({outcome:failing?'blocked':'complete',summary:'Synthetic adapter'}),stop:async()=>{},reconcile:async()=>{}};
  async function start(){controller=createController(state,adapter);await new Promise(r=>controller.server.listen(0,'127.0.0.1',r));return `http://127.0.0.1:${controller.server.address().port}`;}
  t.after(async()=>{if(controller)await controller.close();});
  let origin=await start();
  const snapshot=async()=>await(await fetch(origin+'/api/v1/status')).json();
  const {id}=controller.queue.submit({workflow:'software',repository:'app',spec:'Fixture'});
  async function wait(wanted){for(let i=0;i<100;i++){if(controller.queue.get(id).state===wanted&&!controller.queue.active)return;await new Promise(r=>setTimeout(r,5));}throw new Error('Timed out');}
  await wait('failed');const first=(await snapshot()).jobs[0].runs[0];assert.equal(first.executor,'pi');assert.equal(first.model,'model-a');
  assert.deepEqual(first.usage,{status:'unknown',source:'unsupported_executor',coverage:'unknown'});assert.equal(first.token_usage,null);
  await controller.close();controller=null;save({...initial,agent:'codex',model:'model-b'});origin=await start();
  assert.deepEqual((await snapshot()).jobs[0].runs[0],first);
  failing=false;await controller.queue.action(id,'retry',{run_id:first.id});await wait('awaiting_approval');
  let status=await snapshot(),runs=status.jobs[0].runs;
  assert.deepEqual(runs[0],first);assert.equal(runs[1].executor,'codex');assert.equal(runs[1].model,'model-b');
  assert.notEqual(runs[1].execution.policyHash,first.execution.policyHash);
  assert.equal(runs.find(r=>r.command==='verify').model,null);assert.equal(runs.find(r=>r.command==='verify').executor,'deterministic');
  assert.deepEqual(runs.find(r=>r.command==='verify').usage,{status:'not_applicable',source:'not_applicable',coverage:'not_applicable'});
  assert.equal(runs.at(-1).provenance_status,'not_started');
  assert(!JSON.stringify(status).includes('PRIVATE_SENTINEL'));
  await controller.close();controller=null;origin=await start();assert.deepEqual((await snapshot()).jobs[0].runs,runs);
  const legacy={id:'run_legacy',command:'build',started_at:'2026-01-01',executor:'wrong-current-profile',model:'wrong-current-model'};
  const shown=attemptPresentation(legacy);assert.equal(shown.executor,'unknown');assert.equal(shown.model,null);assert.equal(shown.provenance_status,'unknown');
});
