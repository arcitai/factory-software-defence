import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { PiUsageParser, MAX_PI_USAGE_LINE_BYTES, MAX_PI_USAGE_METADATA_BYTES, MAX_PI_USAGE_EVENTS } from '../factory/pi-usage.mjs';
import { usageFields, MAX_USAGE_EVENTS } from '../factory/usage.mjs';
import { retainedPiUsage } from '../factory/processes.mjs';
import { createController } from '../factory/server.mjs';
import { JobQueue } from '../factory/queue.mjs';
import { save, ROOT } from '../factory/lib.mjs';

const assistant = (usage = {}, extra = {}) => ({ role: 'assistant', timestamp: 1, model: 'untrusted-event-model', content: [{type:'text',text:'PRIVATE_CONTENT'}], stopReason: 'stop',
  usage: { input: 10, output: 3, cacheRead: 20, cacheWrite: 5, totalTokens: 38, ...usage }, ...extra });
const line = value => JSON.stringify(value) + '\n';
const end = message => ({ type: 'message_end', message });
const aggregate = messages => ({ type: 'agent_end', messages });
const start = { type: 'agent_start' };
function parse(events) { const p = new PiUsageParser(); p.write(events.map(line).join('')); return p.finish(); }
const expected = { input_tokens: '35', output_tokens: '3', cached_input_tokens: '20', cache_write_input_tokens: '5', source: 'pi_jsonl', coverage: 'partial' };

test('Pi chunked complete stream, final aggregate and both retain identical inclusive counts', () => {
  const message = assistant();
  for (const events of [[start, end(message)], [aggregate([message])], [start, end(message), aggregate([message]), aggregate([message])]]) {
    const bytes = Buffer.from(events.map(line).join('')), p = new PiUsageParser();
    for (let offset = 0; offset < bytes.length; offset += 7) p.write(bytes.subarray(offset, offset + 7));
    assert.deepEqual(p.finish(), expected);
    assert.equal(usageFields(p.finish(), {executor:'pi'}, 'build').token_usage, '38');
    assert(!JSON.stringify(p.messages).includes('PRIVATE_CONTENT'));
    assert(!p.line.includes(Buffer.from('PRIVATE_CONTENT')));
  }
});

test('equal counts and timestamps identify neither a message nor a new agent turn', () => {
  const m = assistant();
  const events = [start, end(m), end(m), aggregate([m,m]), aggregate([m,m]), start, end(m), aggregate([m])];
  assert.equal(usageFields(parse(events), {executor:'pi'}, 'build').token_usage, '114');
  assert.equal(parse([aggregate([m,m]), aggregate([m,m])]).input_tokens, '70');
  assert.equal(parse([start, aggregate([m]), start, aggregate([m])]).input_tokens, '70');
  // Without a boundary a different aggregate is ambiguous, not another call.
  assert.deepEqual(parse([aggregate([m]), aggregate([assistant({input:11,totalTokens:39})])]), expected);
});

test('nested events, updates, user/tool usage, and failed-request zero placeholders are not measurements', () => {
  const m = assistant();
  assert.equal(parse([{type:'message_update',usage:m.usage}, end({...m,role:'toolResult'}), {type:'tool_execution_end',result:end(m)}]), null);
  for (const stopReason of ['stop','error','aborted']) {
    assert.equal(parse([end(assistant({input:0,output:0,cacheRead:0,cacheWrite:0,totalTokens:0},{stopReason}))]), null);
  }
  for (const usage of [{input:-1}, {input:1.5}, {input:Number.MAX_SAFE_INTEGER+1}, {input:'1e3'}, {input:'9'.repeat(129)}, {cacheWrite:undefined}, {totalTokens:37}])
    assert.equal(parse([end(assistant(usage))]), null);
  assert.deepEqual(parse([end(m), end(assistant({totalTokens:37}))]), expected);
  assert.deepEqual(parse([end(m), {type:'auto_retry_start'}, {type:'auto_retry_end',success:true}, {type:'compaction_end',result:{summary:'PRIVATE_SUMMARY'}}]), expected);
});

test('malformed, contradictory, oversized and truncated streams preserve only unambiguous observations', () => {
  const m = assistant();
  const p = new PiUsageParser();
  p.write(line(end(m))); p.write('{broken}\n'); p.write(line(aggregate([m,m])));
  assert.deepEqual(p.finish(), expected);
  assert.deepEqual(parse([end(m), aggregate([assistant({input:11,totalTokens:39}),m])]), expected);
  const huge = new PiUsageParser();
  huge.write('x'.repeat(MAX_PI_USAGE_LINE_BYTES + 10)+'\n');
  huge.write(line(end(m))); huge.write(line(aggregate([m,m])));
  assert.deepEqual(huge.finish(), expected);
  assert.equal(huge.line.length, MAX_PI_USAGE_LINE_BYTES);
  const trailing = new PiUsageParser(); trailing.write(line(end(m)).trimEnd());
  assert.equal(trailing.finish(), null);
  const interrupted = new PiUsageParser(); interrupted.write(line(end(m))); interrupted.write('{"type":"message_end"');
  assert.deepEqual(interrupted.finish(), expected);
});

test('large decimal counts remain exact; event, metadata and aggregate integers stay bounded', () => {
  const value = '900719925474099312345';
  const usage = parse([end(assistant({input:value,totalTokens:'900719925474099312373'}))]);
  assert.equal(usage.input_tokens, '900719925474099312370');
  assert.equal(usageFields(usage,{executor:'pi'},'review').token_usage,'900719925474099312373');
  const p = new PiUsageParser();
  const large = assistant({input:'1'+'0'.repeat(127),output:0,cacheRead:0,cacheWrite:0,totalTokens:'1'+'0'.repeat(127)});
  p.write(Array.from({length:12}, () => line(end(large))).join(''));
  assert.equal(p.finish().input_tokens, '9'+'0'.repeat(127));
  assert.equal(p.exhausted,true);
  const bounded = new PiUsageParser();
  bounded.write(Array.from({length:MAX_USAGE_EVENTS+2}, () => line(end(assistant()))).join(''));
  assert.equal(bounded.observed,MAX_USAGE_EVENTS);
  assert(bounded.metadataBytes <= MAX_PI_USAGE_METADATA_BYTES);
  const many = new PiUsageParser(); many.write(line(end(assistant())));
  many.write(line({type:'message_update'}).repeat(MAX_PI_USAGE_EVENTS));
  many.write(line(end(assistant())));
  assert.deepEqual(many.finish(),expected);
});

test('missing Pi evidence stays unknown; deterministic work stays not applicable', () => {
  assert.deepEqual(usageFields(null,{executor:'pi'},'build'), {usage:{status:'unknown',source:'pi_jsonl',coverage:'unknown'},token_usage:null});
  for (const [phase,executor] of [['verify','pi'],['handoff','pi'],['build','mock']])
    assert.equal(usageFields(expected,{executor},phase).usage.status,'not_applicable');
  assert.equal(usageFields({...expected,cache_write_input_tokens:'40'},{executor:'pi'},'build').usage.status,'unknown');
});

function fixture(t) {
  const state = mkdtempSync(join(tmpdir(),'factory-pi-usage-'));
  t.after(()=>rmSync(state,{recursive:true,force:true}));
  const profile = {version:1,executor:'pi',phase:'build',runtimeVersion:'0.15.4',requestedModel:'frozen-local',policyHash:'a'.repeat(64)};
  const attempt = {id:'run_fixture',command:'build',state:'cancelled',completed_at:new Date().toISOString(),execution:profile};
  const job = {id:'job_fixture',state:'cancelled',created_at:new Date().toISOString(),workflow:{name:'software',steps:['build'],current_step:0},runs:[attempt]};
  const path = join(state,'jobs',job.id,attempt.id,'usage.json');
  const checkpoint = {version:1,job:job.id,attempt:attempt.id,phase:'build',execution:profile,usage:expected};
  save(path,checkpoint);
  save(join(state,'factory.json'),{version:1,repo:state,agent:'mock',command:['mock'],model:null,image:'fixture:1',port:7347,timeoutSeconds:10,memoryMiB:256,network:'none',check:'true',scope:{project:'p',service:'s',owner:'test',environment:'test'}});
  writeFileSync(join(state,'worker.token'),'inert-fixture-token',{mode:0o600});
  return {state,profile,attempt,job,path,checkpoint};
}

test('controller-owned interruption checkpoints reject mismatched identity and retain no message content', t => {
  const f = fixture(t);
  assert.deepEqual(retainedPiUsage(f.state,f.job,f.attempt),expected);
  save(f.path,{...f.checkpoint,attempt:'run_other'});
  assert.equal(retainedPiUsage(f.state,f.job,f.attempt),null);
  save(f.path,f.checkpoint); chmodSync(f.path,0o644);
  assert.equal(retainedPiUsage(f.state,f.job,f.attempt),null);
  chmodSync(f.path,0o600);
  assert.equal(retainedPiUsage(f.state,f.job,{...f.attempt,execution:{...f.profile,requestedModel:'different'}}),null);
});

test('Pi cancellation readback is identical through API, CLI and SQLite/controller restart', async t => {
  const f=fixture(t);
  const first=createController(f.state); first.queue.save(f.job);
  async function read(controller) {
    await new Promise(resolve=>controller.server.listen(0,'127.0.0.1',resolve));
    const port=controller.server.address().port;
    const config=JSON.parse(await (await import('node:fs/promises')).readFile(join(f.state,'factory.json')));
    save(join(f.state,'factory.json'),{...config,port});
    const api=await (await fetch(`http://127.0.0.1:${port}/api/v1/status`)).json();
    const cli=await new Promise((resolve,reject)=>{
      const child=spawn(process.execPath,[join(ROOT,'bin/software-defence-factory.mjs'),'status','--state',f.state],{env:{...process.env,FACTORY_NO_UPDATE:'1'}});
      let out='',err='';child.stdout.on('data',b=>out+=b);child.stderr.on('data',b=>err+=b);
      child.on('error',reject);child.on('close',code=>code===0?resolve(JSON.parse(out)):reject(new Error(err)));
    });
    assert.deepEqual(cli.jobs[0].runs[0],api.jobs[0].runs[0]);
    return api.jobs[0].runs[0];
  }
  let before;
  try {before=await read(first);} finally {await first.close();}
  const second=createController(f.state);
  try {
    const after=await read(second);
    assert.deepEqual(after,before);assert.equal(after.state,'cancelled');assert.equal(after.model,'frozen-local');
    assert.deepEqual(after.usage,expected);assert.equal(after.token_usage,'38');
    assert.equal(second.queue.get(f.job.id).runs[0].usage,undefined,'historical queue bytes are not rewritten by readback');
  } finally {await second.close();}
});

test('failed Build persists measured Pi totals without changing its outcome', async t => {
  const f=fixture(t);
  const sourceAdmission={admit:id=>({version:1,status:'retained',repository_identity:`sha256:${'a'.repeat(64)}`,object_format:'sha1',requested_ref:'main',ref_source:'configured',resolved_sha:'a'.repeat(40),retained_repo:`sources/retained_${id.slice(-24)}.git`,retained_ref:'refs/heads/factory-source',retained_at:new Date().toISOString()}),validate:()=>({}),release:()=>{}};
  const queue=new JobQueue(f.state,{prepare:()=>f.profile,execute:async()=>({outcome:'blocked',usage:expected,summary:'Synthetic failure after usage'}),stop:async()=>{},reconcile:async()=>{},sourceAdmission});
  const {id}=queue.submit({workflow:'software',repository:'app',spec:'Synthetic Pi usage'});
  for(let i=0;i<200 && (queue.get(id).state!=='failed'||queue.active);i++)await new Promise(resolve=>setTimeout(resolve,5));
  const before=queue.get(id).runs[0];assert.equal(before.state,'failed');assert.deepEqual(before.usage,expected);
  await queue.close();
  const restart=new JobQueue(f.state,{execute:async()=>{},stop:async()=>{},reconcile:async()=>{}});
  assert.deepEqual(restart.get(id).runs[0],before);await restart.close();
});
