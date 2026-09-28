import test from 'node:test';
import http from 'node:http';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, readFileSync, writeFileSync, statSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { ActivityParser, ActivityWriter, activityQuery, readActivity, ACTIVITY_CAP, ACTIVITY_BYTES, ACTIVITY_LINE_BYTES } from '../factory/activity.mjs';
import { followActivity } from '../factory/activity-follow.mjs';
import { createController } from '../factory/server.mjs';
import { ROOT, save } from '../factory/lib.mjs';
const line = event => Buffer.from(JSON.stringify(event) + '\n');
const sentinel = '<script>PRIVATE_🔑</script>\u001b[31m /host/model.env credential';
const message = { type: 'item.completed', item: { type: 'agent_message', text: sentinel } };
function fixture(t) {
  const state = mkdtempSync(join(tmpdir(), 'factory-activity-'));
  t.after(() => rmSync(state, { force: true, recursive: true }));
  const attempt = { id: 'run_b', command: 'build', state: 'running', started_at: '2026-09-28T00:00:00.000Z' };
  const job = { id: 'job_a', state: 'running', created_at: attempt.started_at, workflow: { name: 'software', steps: ['build'], current_step: 0 }, runs: [attempt] };
  const folder = join(state, 'jobs', job.id, attempt.id);
  mkdirSync(folder, { recursive: true, mode: 0o700 });
  const writer = new ActivityWriter(folder, { job: job.id, attempt: attempt.id, phase: 'build', harness: 'codex' }, { interval: 10 });
  t.after(() => writer.finish(false));
  return { state, job, attempt, folder, writer };
}
test('split UTF-8, top-level completed events and fixed categories exclude all content', () => {
  for (const harness of ['codex','pi','custom']) {
    const events = []; let rejected = 0, received = 0;
    const parser = new ActivityParser(harness, (kind, tool) => events.push([kind, tool]), () => received++, () => rejected++);
    const input = Buffer.concat([line(message), line({type:'item.completed',item:{type:'reasoning',text:sentinel}}),
      line({type:'item.completed',item:{type:'command_execution',command:sentinel,aggregated_output:sentinel}}),
      line({type:'message_end',message:{role:'assistant',content:sentinel}}),
      line({type:'tool_execution_end',toolName:'read',result:sentinel}),
      line({type:'tool_execution_end',toolName:sentinel,result:sentinel}),
      line({type:'message_update',message:message}), line({nested:message})]);
    for (let index=0; index<input.length; index++) parser.write(input.subarray(index,index+1));
    parser.finish();
    assert.deepEqual(events, harness === 'codex' ? [['message_completed',undefined],['tool_completed','command']]
      : harness === 'pi' ? [['message_completed',undefined],['tool_completed','read'],['tool_completed','other']] : []);
    assert(received > 0); assert.equal(rejected,0); assert(!parser.buffer.includes(Buffer.from('PRIVATE')));
  }
});
test('oversize, malformed UTF-8/JSON, nested forgery and output loss have bounded gaps and recover', () => {
  const events = []; let rejected = 0;
  const parser = new ActivityParser('codex', kind => events.push(kind), undefined, () => rejected++);
  parser.write(Buffer.alloc(ACTIVITY_LINE_BYTES * 10, 120)); parser.write(Buffer.from('\n'));
  parser.write(Buffer.from('{bad}\n')); parser.write(Buffer.from([0xff,10]));
  parser.write(line({type:'other',item:message})); parser.write(line(message));
  parser.write(line(message).subarray(0,-1)); parser.finish();
  assert.deepEqual(events,['message_completed']); assert.equal(rejected,4);
  assert.equal(parser.buffer.length,ACTIVITY_LINE_BYTES);
});
test('no-client burst, slow reader rollover, durable cursor and terminal output are finite', async t => {
  const f=fixture(t);
  for(let i=0;i<1000;i++) f.writer.parser.write(line(message));
  await f.writer.flush();
  assert(statSync(join(f.folder,'activity.json')).size<ACTIVITY_BYTES);
  assert.equal(f.writer.record.events.length,ACTIVITY_CAP);
  assert(!readFileSync(join(f.folder,'activity.json'),'utf8').includes('PRIVATE'));
  const first=readActivity(f.state,f.job,f.attempt,activityQuery('0','2'));
  assert.equal(first.truncated,true); assert.deepEqual(first.events.map(e=>e.cursor),[874,875]);
  assert.equal(first.dropped,873); assert.equal(first.next_cursor,875); assert.equal(first.has_more,true);
  const resumed=readActivity(f.state,f.job,f.attempt,activityQuery('875','128'));
  assert.equal(resumed.events[0].cursor,876); assert.equal(resumed.next_cursor,1001); assert.equal(resumed.has_more,false);
  assert.equal(readActivity(f.state,f.job,f.attempt,activityQuery('1001')).events.length,0);
  await f.writer.finish(true); f.attempt.state='succeeded';
  const end=readActivity(f.state,f.job,f.attempt,activityQuery('1001'));
  assert.equal(end.terminal,true); assert.equal(end.completion_observed,true); assert.equal(end.events[0].kind,'phase_completed');
  assert.equal(end.container_health,'unknown');
});
test('strict persisted revalidation, missing history, foreign attempts and unsafe files fail closed', async t => {
  const f=fixture(t); await f.writer.flush();
  const path=join(f.folder,'activity.json'), original=JSON.parse(readFileSync(path));
  for(const mutation of [{job:'job_c'}, {phase:'review'}, {attempt:'run_c'}, {support:sentinel}, {cursor:-1}, {cursor:99},
    {last_received_at:sentinel}, {extra:sentinel}, {events:[{cursor:1,at:original.events[0].at,kind:sentinel}]},
    {events:[{...original.events[0],text:sentinel}]}, {events:[{...original.events[0],tool:sentinel}]}]) {
    writeFileSync(path,JSON.stringify({...original,...mutation}));
    const page=readActivity(f.state,f.job,f.attempt); assert.equal(page.status,'error'); assert(!JSON.stringify(page).includes('PRIVATE'));
  }
  writeFileSync(path,'x'.repeat(ACTIVITY_BYTES+1)); assert.equal(readActivity(f.state,f.job,f.attempt).status,'error');
  rmSync(path); assert.equal(readActivity(f.state,f.job,f.attempt).status,'unavailable');
  symlinkSync('/etc/passwd',path); assert.equal(readActivity(f.state,f.job,f.attempt).status,'error'); rmSync(path);
  writeFileSync(path,JSON.stringify(original),{mode:0o600});
  assert.throws(()=>readActivity(f.state,f.job,f.attempt,activityQuery('99')),/ahead/);
  for(const cursor of ['-1','1.2','01','NaN','9007199254740992','../model.env']) assert.throws(()=>activityQuery(cursor),/Invalid/);
  for(const limit of ['0','129','1.2','no']) assert.throws(()=>activityQuery('0',limit),/Invalid/);
});
test('storage failures do not throw into stdout or prevent execution', async t => {
  const f=fixture(t); rmSync(f.folder,{recursive:true,force:true});
  f.writer.parser.write(line(message)); await f.writer.flush();
  assert.equal(f.writer.record.write_errors,1);
  mkdirSync(f.folder,{mode:0o700}); await f.writer.finish(false);
  const page=readActivity(f.state,f.job,{...f.attempt,state:'failed'});
  assert.equal(page.write_errors,1); assert.equal(page.completion_observed,true);
});
test('follow resumes exact cursor after outage, stops on terminal and supports abort', async () => {
  let calls=0; const paths=[], pages=[], errors=[];
  await followActivity({job:'job_a',attempt:'run_b',interval:1000,follow:true,
    request:async path=>{paths.push(path);calls++;if(calls===2)throw new Error('offline');return {next_cursor:calls===1?7:8,terminal:calls===3,has_more:false};},
    output:p=>pages.push(p),unavailable:p=>errors.push(p)});
  assert.equal(pages.length,2);assert.equal(errors.length,1);
  assert.equal(paths[1],'/api/v1/jobs/job_a/runs/run_b/activity?limit=50&after=7');assert.equal(paths[1],paths[2]);
  const controller=new AbortController();
  await followActivity({job:'job_a',attempt:'run_b',follow:true,signal:controller.signal,
    request:async()=>{controller.abort();throw new Error('aborted');},output:()=>assert.fail(),unavailable:()=>assert.fail()});
});
test('authenticated API/actual CLI share retained identity/order through controller restart', async t => {
  const f=fixture(t); f.writer.parser.write(line(message)); await f.writer.finish(false); f.job.state='cancelled';f.attempt.state='cancelled';
  save(join(f.state,'factory.json'),{version:1,repo:f.state,agent:'mock',command:['mock'],model:null,image:'fixture:1',port:7347,timeoutSeconds:10,memoryMiB:256,network:'none',check:'true',scope:{project:'p',service:'s',owner:'test',environment:'test'}});
  writeFileSync(join(f.state,'worker.token'),'synthetic-private-token');
  let previous;
  for(let restart=0;restart<2;restart++) {
    const controller=createController(f.state); if(!restart)controller.queue.save(f.job);
    try {
      await new Promise(resolve=>controller.server.listen(0,'127.0.0.1',resolve));
      const port=controller.server.address().port, origin=`http://127.0.0.1:${port}`;
      const config=JSON.parse(readFileSync(join(f.state,'factory.json')));save(join(f.state,'factory.json'),{...config,port});
      const path='/api/v1/jobs/job_a/runs/run_b/activity?after=1', headers={Authorization:'Bearer synthetic-private-token'};
      assert.equal((await fetch(origin+path)).status,403);
      assert.equal((await fetch(origin+path,{headers:{...headers,Origin:'https://untrusted.invalid'}})).status,403);
      assert.equal(await new Promise((resolve,reject)=>{const request=http.request(origin+path,{headers:{...headers,Host:'untrusted.invalid'}},response=>{response.resume();resolve(response.statusCode);});request.on('error',reject);request.end();}),403);
      assert.equal((await fetch(origin+path.replace('run_b','run_c'),{headers})).status,404);
      assert.equal((await fetch(origin+path.replace('job_a','job_c'),{headers})).status,404);
      assert.equal((await fetch(origin+path.replace('after=1','after=99'),{headers})).status,409);
      const page=await(await fetch(origin+path,{headers})).json();
      const cli=await new Promise((resolve,reject)=>{
        const child=spawn(process.execPath,[join(ROOT,'bin/software-defence-factory.mjs'),'activity','job_a','run_b','--state',f.state,'--after','1','--follow'],{env:{...process.env,FACTORY_NO_UPDATE:'1'}});
        let out='',err=''; child.stdout.on('data',b=>out+=b);child.stderr.on('data',b=>err+=b);child.on('error',reject);
        child.on('close',code=>code===0?resolve(JSON.parse(out)):reject(new Error(err)));
      });
      assert.deepEqual(cli.events,page.events);assert.equal(cli.next_cursor,3);assert.equal(cli.terminal,true);
      assert(!JSON.stringify(cli).includes('PRIVATE'));
      if(previous)assert.deepEqual(page.events,previous);previous=page.events;
    } finally {await controller.close();}
  }
});

test('reader restart preserves interrupted cursor; later attempts never replace prior records', async t => {
  const { JobQueue } = await import('../factory/queue.mjs');
  const f=fixture(t); f.writer.emit('process_started'); f.writer.parser.write(line(message)); await f.writer.flush();
  const adapter={execute:async()=>{},stop:async()=>{},reconcile:async()=>{}};
  const first=new JobQueue(f.state,adapter);first.save(f.job);await first.close();
  const second=new JobQueue(f.state,adapter);
  try {
    const job=second.get(f.job.id), attempt=job.runs[0];
    assert.equal(attempt.state,'interrupted');
    const before=readFileSync(join(f.folder,'activity.json'));
    const resumed=readActivity(f.state,job,attempt,activityQuery('2'));
    assert.equal(resumed.next_cursor,3);assert.equal(resumed.events[0].kind,'message_completed');
    assert.equal(resumed.terminal,true);assert.equal(resumed.completion_observed,false);
    assert.equal(resumed.process_observation,'process_started');assert.equal(resumed.container_health,'unknown');
    const next={...attempt,id:'run_c',state:'cancelled'};job.runs.push(next);second.save(job);
    assert.equal(readActivity(f.state,job,next).status,'unavailable');
    assert.deepEqual(readFileSync(join(f.folder,'activity.json')),before);
    assert.equal(readActivity(f.state,job,attempt,activityQuery('2')).next_cursor,3);
  } finally {await second.close();}
});
