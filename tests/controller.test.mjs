import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import http from 'node:http';
import { execFileSync } from 'node:child_process';
import { JobQueue } from '../factory/queue.mjs';
import { createController } from '../factory/server.mjs';

function temp(t) { const root = mkdtempSync(join(tmpdir(), 'sdf-controller-')); t.after(() => rmSync(root, { recursive: true, force: true })); return root; }
async function until(condition) { for (let i = 0; i < 200; i++) { if (condition()) return; await new Promise(resolve => setTimeout(resolve, 5)); } throw new Error('Expected queue state was not reached'); }
const task = { workflow: 'software', repository: 'app', spec: 'Synthetic bounded change', title: 'Fixture' };
const sourceAdmission = {
  admit: (jobId, requestedRef, expectedRepositoryIdentity) => ({ version: 1, status: 'retained', repository_identity: expectedRepositoryIdentity || `sha256:${'a'.repeat(64)}`, repository_path: '/fixture/repository',
    repository_common_dir: '/fixture/repository/.git', object_format: 'sha1', requested_ref: requestedRef ?? 'main', ref_source: requestedRef === undefined ? 'configured' : 'explicit',
    resolved_sha: requestedRef === 'next' ? 'b'.repeat(40) : 'a'.repeat(40), retained_repo: `sources/retained_${jobId.slice(-24)}.git`, retained_ref: 'refs/heads/factory-source', retained_at: new Date().toISOString() }),
  validate: () => ({ path: '/fixture/retained.git', sha: 'a'.repeat(40) }),
  release: () => {},
};
function adapter(execute = async () => ({ outcome: 'complete', summary: 'fixture' })) { return { execute, stop: async () => {}, reconcile: async () => {}, sourceAdmission }; }
test('one execution owner advances checks and review, then waits for a current approval', async t => {
  const phases = []; let concurrent = 0, maximum = 0;
  const queue = new JobQueue(temp(t), adapter(async (job, run) => { maximum = Math.max(maximum, ++concurrent); phases.push(run.command); await new Promise(resolve => setTimeout(resolve, 2)); concurrent--; return { outcome: 'complete' }; }));
  t.after(() => queue.close());
  const first = queue.submit(task), second = queue.submit(task);
  await until(() => queue.all().every(job => job.state === 'awaiting_approval'));
  assert.equal(maximum, 1); assert.deepEqual(phases, ['build', 'verify', 'review', 'build', 'verify', 'review']);
  await assert.rejects(queue.action(first.id, 'approve', { run_id: 'stale' }), /changed/);
  const current = queue.get(first.id).runs.at(-1);
  await queue.action(first.id, 'approve', { run_id: current.id });
  await until(() => queue.get(first.id).state === 'succeeded');
  assert.equal(queue.get(second.id).state, 'awaiting_approval'); assert.equal(phases.at(-1), 'handoff');
});
test('failed checks cannot advance to review and retry creates a new attempt', async t => {
  let fail = true, reconciled = 0;
  const queue = new JobQueue(temp(t), { ...adapter(async (job, run) => ({ outcome: run.command === 'verify' && fail ? 'blocked' : 'complete', summary: 'fixture' })), reconcile: async () => { reconciled++; } });
  t.after(() => queue.close()); const { id } = queue.submit(task);
  await until(() => queue.get(id).state === 'failed');
  let job = queue.get(id); assert.equal(job.runs.at(-1).command, 'verify'); assert.equal(job.runs.length, 2);
  fail = false; await queue.action(id, 'retry', { run_id: job.runs.at(-1).id });
  await until(() => queue.get(id).state === 'awaiting_approval');
  job = queue.get(id); assert.equal(reconciled, 1); assert.notEqual(job.runs[1].id, job.runs[2].id); assert.equal(job.runs[2].command, 'verify');
});
test('cancel waits for stop and a late successful result cannot accept a cancelled job', async t => {
  let finish, stopped = false;
  const queue = new JobQueue(temp(t), { execute: () => new Promise(resolve => { finish = resolve; }), stop: async () => { stopped = true; finish({ outcome: 'complete' }); }, reconcile: async () => {}, sourceAdmission });
  t.after(() => queue.close()); const { id } = queue.submit(task);
  await until(() => !!finish);
  await queue.action(id, 'cancel', { run_id: queue.get(id).runs.at(-1).id });
  await until(() => !queue.active); assert.ok(stopped); assert.equal(queue.get(id).state, 'cancelled');
});
test('restart marks an unconfirmed running attempt interrupted and requires reconciliation', async t => {
  const state = temp(t), first = new JobQueue(state, adapter());
  const job = { id: 'job_fixture', state: 'running', source_admission: sourceAdmission.admit('job_fixture'), workflow: { name: 'software', steps: ['build'], current_step: 0 }, runs: [{ id: 'run_fixture', state: 'running', command: 'build' }] };
  first.save(job); await first.close();
  const next = new JobQueue(state, { ...adapter(), reconcile: async () => { throw new Error('Old process is still live'); } });
  t.after(() => next.close()); assert.equal(next.get(job.id).state, 'interrupted');
  await assert.rejects(next.action(job.id, 'retry', { run_id: 'run_fixture' }), /still live/);
  assert.equal(next.get(job.id).state, 'interrupted');
});
test('requested changes preserve attempts, reconcile the checkout and require fresh checks and approval', async t => {
  const phases = [], reconciled = [];
  const queue = new JobQueue(temp(t), { ...adapter(async (job, run) => { phases.push(run.command); return { outcome: 'complete' }; }), reconcile: async (id, phase) => reconciled.push(phase) });
  t.after(() => queue.close()); const { id } = queue.submit(task);
  await until(() => queue.get(id).state === 'awaiting_approval');
  const prior = queue.get(id).runs.at(-1).id;
  await assert.rejects(queue.action(id, 'request_changes', { run_id: prior, feedback: '' }), /feedback/);
  await queue.action(id, 'request_changes', { run_id: prior, feedback: 'Cover the denied-access path.' });
  await until(() => queue.get(id).state === 'awaiting_approval');
  const job = queue.get(id);
  assert.deepEqual(reconciled, ['build']);
  assert.deepEqual(phases, ['build','verify','review','build','verify','review']);
  assert.match(job.prompt, /denied-access/); assert.equal(job.runs[3].outcome, 'changes_requested');
  await assert.rejects(queue.action(id, 'approve', { run_id: prior }), /changed/);
  await assert.rejects(queue.remove(id), /Stop/);
  await queue.action(id, 'approve', { run_id: job.runs.at(-1).id });
  await until(() => queue.get(id).state === 'succeeded' && !queue.active);
  await queue.remove(id); assert.equal(queue.all().length, 0); assert.throws(() => queue.get(id), /not found/);
  assert.equal(JSON.parse(queue.db.prepare('SELECT data FROM jobs WHERE id=?').get(id).data).runs.length, 8);
});
test('controller enforces host/origin/session checks and persists only bounded jobs', async t => {
  const state = temp(t);
  writeFileSync(join(state, 'factory.json'), JSON.stringify({ version: 1, repo: state, agent: 'mock', command: ['mock'], port: 7332, timeoutSeconds: 10, memoryMiB: 256, image: 'fixture:1', network: 'none', check: 'true', scope: { project: 'p', service: 's', environment: 'test', owner: 'fixture' } }));
  writeFileSync(join(state, 'worker.token'), 'synthetic-private-token');
  execFileSync('git', ['init', state], {stdio:'ignore'});
  writeFileSync(join(state, 'source.txt'), 'synthetic source\n');
  execFileSync('git', ['-C', state, 'add', 'source.txt']);
  execFileSync('git', ['-C', state, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@localhost', 'commit', '-m', 'Synthetic source'], {stdio:'ignore'});
  execFileSync('git', ['-C',state,'remote','add','origin','git@github.com:example/actual-project.git']);
  const controller = createController(state, adapter());
  await new Promise(resolve => controller.server.listen(0, '127.0.0.1', resolve)); t.after(() => controller.close());
  const origin = `http://127.0.0.1:${controller.server.address().port}`;
  const status = await (await fetch(origin + '/api/v1/status')).json();
  assert.deepEqual(status.project_links, {repository:'https://github.com/example/actual-project',new_issue:'https://github.com/example/actual-project/issues/new/choose',source:'configured_git_origin'});
  const post = headers => fetch(origin + '/api/v1/jobs', { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(task) });
  assert.equal((await post({})).status, 403);
  assert.equal((await post({ Authorization: 'Bearer synthetic-private-token', Origin: 'https://untrusted.invalid' })).status, 403);
  const rejectedHost = await new Promise((resolve, reject) => {
    const request = http.request(origin + '/api/v1/status', { headers: { Host: 'untrusted.invalid' } }, response => { response.resume(); resolve(response.statusCode); });
    request.on('error', reject); request.end();
  });
  assert.equal(rejectedHost, 403);
  assert.equal((await post({ 'X-Factory-Session': status.csrf_token })).status, 201);
  assert.equal((await post({ Authorization: 'Bearer synthetic-private-token' })).status, 201);
  assert.equal((await fetch(origin + '/api/v1/jobs/job_123/artifacts?file=../../worker.token', { headers: { 'X-Factory-Session': status.csrf_token } })).status, 404);
  const page = await fetch(origin);
  assert.equal(page.headers.get('content-security-policy'),
    "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' blob:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
    'generated image previews permit blob URLs without widening scripts, connections, frames or forms');
  assert.match(await page.text(), /Software &amp; Defence|Software & Defence/);
  assert.throws(() => controller.queue.submit({ ...task, workflow: 'constructor' }), /workflow/);
});
test('concurrent retries cannot overwrite a running attempt or its history', async t => {
  let release;
  const queue = new JobQueue(temp(t), { ...adapter(async () => ({ outcome: 'blocked' })), reconcile: () => new Promise(resolve => { release = resolve; }) });
  t.after(() => queue.close()); const { id } = queue.submit(task);
  await until(() => queue.get(id).state === 'failed');
  const input = { run_id: queue.get(id).runs.at(-1).id };
  const first = queue.action(id, 'retry', input);
  await assert.rejects(queue.action(id, 'retry', input), /already changing/);
  release(); await first;
  await until(() => queue.get(id).state === 'failed');
  assert.equal(queue.get(id).runs.length, 2);
});

test('stopped reviews with changes or blocked can revise without rewriting their failed result', async t => {
  for (const verdict of ['changes', 'blocked']) await t.test(verdict, async t => {
    let rejected = true, unsafe = true;
    const phases = [], reconciled = [];
    const queue = new JobQueue(temp(t), {
      ...adapter(async (job, run) => {
        phases.push(run.command);
        return run.command === 'review' && rejected
          ? { outcome: 'blocked', summary: 'Correct the candidate', review_verdict: verdict }
          : { outcome: 'complete', review_verdict: run.command === 'review' ? 'pass' : undefined };
      }),
      reconcile: async (id, phase) => { if (unsafe) throw new Error('Previous writer unknown'); reconciled.push(phase); },
    });
    t.after(() => queue.close());
    const { id } = queue.submit(task);
    await until(() => queue.get(id).state === 'failed' && !queue.active);
    const original = queue.get(id), failed = original.runs.at(-1);
    assert.equal(failed.review_verdict, verdict);
    const input = { run_id: failed.id, feedback: 'Fix the failing behavior.' };
    await assert.rejects(queue.action(id, 'approve', { run_id: failed.id }), /not awaiting/);
    await assert.rejects(queue.action(id, 'request_changes', { ...input, run_id: 'stale' }), /changed/);
    for (const feedback of ['', ' ', 'a'.repeat(4001)])
      await assert.rejects(queue.action(id, 'request_changes', { ...input, feedback }), /feedback/);
    await assert.rejects(queue.action(id, 'request_changes', input), /writer unknown/);
    assert.deepEqual(queue.get(id), original);
    unsafe = false; rejected = false;
    await queue.action(id, 'request_changes', input);
    await assert.rejects(queue.action(id, 'request_changes', input), /changed|reviewed|already changing/);
    await until(() => queue.get(id).state === 'awaiting_approval');
    const job = queue.get(id), prior = job.runs.find(run => run.id === failed.id);
    assert.deepEqual({ ...prior, revision: undefined }, { ...failed, revision: undefined });
    assert.equal(prior.revision.feedback, input.feedback);
    assert.deepEqual(reconciled, ['build']);
    assert.deepEqual(phases, ['build', 'verify', 'review', 'build', 'verify', 'review']);
    assert.equal(job.runs.at(-1).reviewed_run_id, job.runs.at(-2).id);
    await assert.rejects(queue.action(id, 'approve', { run_id: failed.id }), /changed/);
    await queue.action(id, 'approve', { run_id: job.runs.at(-1).id });
    await until(() => queue.get(id).state === 'succeeded');
  });
});

test('revision is not offered for active, crashed, non-review or defence attempts', async t => {
  const queue = new JobQueue(temp(t), adapter()); t.after(() => queue.close());
  for (const [state, phase, workflow, verdict] of [
    ['running','review','software','changes'], ['failed','review','software',undefined],
    ['failed','verify','software','changes'], ['failed','defence','defence','blocked'],
    ['failed','review','software','pass'],
  ]) {
    const job = { id: 'job_fixture', state, prompt: 'Fixture', workflow: { name: workflow, steps: [phase], current_step: 0 },
      runs: [{ id: 'run_fixture', state, command: phase, review_verdict: verdict }] };
    queue.save(job);
    await assert.rejects(queue.action(job.id,'request_changes',{run_id:'run_fixture',feedback:'Fix it'}), /reviewed|legacy/);
  }
});
