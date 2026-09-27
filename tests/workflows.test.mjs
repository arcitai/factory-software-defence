import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { workflowDefinitions, WORKFLOWS } from '../factory/workflows.mjs';
import { createController } from '../factory/server.mjs';
import { digest, ROOT, harnessOf, configAt } from '../factory/lib.mjs';
import { machineInfo } from '../factory/machine.mjs';

test('installed CLI, controller and queue share the same phase/skill contract for a non-Codex profile', async t => {
  const state = mkdtempSync(join(tmpdir(), 'sdf-catalog-'));
  t.after(()=>rmSync(state,{recursive:true,force:true}));
  const config={version:1, repo:state, agent:'pi', command:['pi','secret-command-argument'], model:'example/model', port:7349, timeoutSeconds:10, memoryMiB:512, network:'none', image:'fixture:1',check:'npm test',scope:{project:'p',service:'s',environment:'test',owner:'operator'}};
  writeFileSync(join(state,'factory.json'), JSON.stringify(config));writeFileSync(join(state,'worker.token'),'private-fixture');
  const cli=JSON.parse(execFileSync(process.execPath,[join(ROOT,'bin/software-defence-factory.mjs'),'workflows','--state',state],{encoding:'utf8',env:{...process.env,SDF_AUTO_UPDATE:'0'}}));
  const controller=createController(state,{execute:async()=>({outcome:'blocked'}),stop:async()=>{},reconcile:async()=>{}});
  await new Promise(resolve=>controller.server.listen(0,'127.0.0.1',resolve));t.after(()=>controller.close());
  const origin=`http://127.0.0.1:${controller.server.address().port}`;
  const api=await (await fetch(origin+'/api/v1/definitions')).json();
  assert.deepEqual(api,cli);assert.deepEqual(api,workflowDefinitions(config));
  for(const [name,steps] of Object.entries(api.workflows)) assert.deepEqual(steps.map(step=>step.name),WORKFLOWS[name]);
  assert.equal(api.skills.length,6);assert.equal(api.operator_skills.length,1);
  assert.equal(api.configuration.harness,'pi');assert.equal(api.agents.length,3);assert(api.agents.every(role=>role.harness==='pi'));
  for (const command of ['definition','agents','skills']) {
    const output=JSON.parse(execFileSync(process.execPath,[join(ROOT,'bin/software-defence-factory.mjs'),command,'--state',state],{encoding:'utf8',env:{...process.env,SDF_AUTO_UPDATE:'0'}}));
    assert.deepEqual(output,command==='agents'?api.agents:command==='skills'?{agents:api.skills,operators:api.operator_skills}:api);
  }
  assert.equal(execFileSync(process.execPath,[join(ROOT,'bin/software-defence-factory.mjs'),'foundation'],{encoding:'utf8'}).trim(),api.operator_skills[0].content.trim());assert(!JSON.stringify(api).includes('secret-command-argument'));
  assert.deepEqual(api.skills.map(skill => skill.id).sort(), ['factory-evaluate','factory-implement','factory-review','factory-security','factory-spec','factory-triage']);
  for (const skill of [...api.skills, ...api.operator_skills]) {
    assert.equal(skill.path, `${skill.id === 'factory-foundation' ? '.agents' : 'kit'}/skills/${skill.id}/SKILL.md`);
    assert.equal(skill.content, readFileSync(join(ROOT, skill.path), 'utf8'));
    assert.equal(skill.sha256, digest(skill.content));
  }
  assert.equal(api.commands.find(phase=>phase.name==='build').executor,'pi');
  assert.equal(api.commands.find(phase=>phase.name==='verify').executor,'factory');
  const status=await(await fetch(origin+'/api/v1/status')).json();
  assert.equal(status.infrastructure.host.hostname,status.workers[0].machine.hostname);
  assert.equal(status.infrastructure.workers[0].name,"Local worker");assert.equal(status.harness,"pi");
  assert(status.workers[0].machine.hostname);assert(status.workers[0].machine.memoryMiB>0);
  const denied=await fetch(origin+'/api/v1/issues/preview',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({url:'https://github.com/example/another/issues/1'})});
  assert.equal(denied.status,403);
  assert.equal((await fetch(origin+'/api/v1/issues')).status,403);
  assert.equal((await fetch(origin+'/api/v1/issue-templates')).status,403);
  assert.equal((await fetch(origin+'/api/v1/issue-templates/draft',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})).status,403);
  assert.equal((await fetch(origin+'/api/v1/issues?page=0',{headers:{'X-Factory-Session':status.csrf_token}})).status,400);
  const recommendation=await fetch(origin+'/api/v1/intake/recommend',{method:'POST',headers:{'Content-Type':'application/json','X-Factory-Session':status.csrf_token},body:JSON.stringify({spec:'Investigate suspicious access logs.'})});
  assert.equal((await recommendation.json()).workflow,'defence');
  assert.equal((await fetch(origin+'/api/v1/intake/recommend',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})).status,403);
  const invalid=await fetch(origin+'/api/v1/issues/preview',{method:'POST',headers:{'Content-Type':'application/json','X-Factory-Session':status.csrf_token},body:JSON.stringify({url:'https://github.com/example/another/issues/1'})});
  assert.equal(invalid.status,400);assert.equal(controller.queue.all().length,0);
});

test('machine discovery returns portable host capacity, never a hard-coded worker identity',()=>{
  const value=machineInfo();assert.equal(value.platform,process.platform);assert.equal(value.architecture,process.arch);
  assert.equal(typeof value.hostname,'string');assert(value.logicalCpus>0);assert(value.memoryMiB>0);
  assert.deepEqual(Object.keys(value).sort(),['architecture','hardware','hostname','logicalCpus','memoryMiB','osRelease','platform']);
});

test('harness compatibility is read-only and rejects conflicting old/new keys',()=>{
  const legacy={version:1,agent:'pi',command:['pi']};
  const serialized=JSON.stringify(legacy);
  assert.equal(harnessOf(legacy),'pi');assert.equal(JSON.stringify(legacy),serialized);
  assert.equal(harnessOf({harness:'codex'}),'codex');
  assert.equal(harnessOf({harness:'pi',agent:'pi'}),'pi');
  assert.throws(()=>harnessOf({harness:'pi',agent:'codex'}),/conflicts/);
  assert.throws(()=>harnessOf({harness:'invented'}),/Unsupported/);
});
