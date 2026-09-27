import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync, existsSync, renameSync, chmodSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createController } from '../factory/server.mjs';
import { qualificationWebConfig } from '../factory/web/qualification-fixture.mjs';
import { DeliveryService } from '../factory/delivery.mjs';
import { executors } from '../factory/processes.mjs';
import { SourceAdmissionStore, publicSourceAdmission, publicContinuation, restoreBuildCheckout, assertRetainedCheckpoint } from '../factory/source-admission.mjs';
import { effectiveExecutionConfig, executionProfile } from '../factory/execution-profile.mjs';
import { assertCurrentHandoffEvidence } from '../factory/execution-evidence.mjs';
import { configAt, digest, save } from '../factory/lib.mjs';

const execAsync = promisify(execFile);
const git = (repo, ...args) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8' }).trim();
const commit = repo => { git(repo, 'add', '-A'); git(repo, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@localhost', 'commit', '--quiet', '-m', 'Candidate'); };
const read = path => JSON.parse(readFileSync(path, 'utf8'));
const pause = () => new Promise(resolve => setTimeout(resolve, 5));
async function wait(queue, id, predicate) {
  for (let i = 0; i < 300; i++) { const job = queue.get(id); if (predicate(job) && !queue.active) return job; await pause(); }
  throw new Error('Fixture queue did not settle');
}

// Real local Git objects and controller/API; controlled phase outputs and Docker
// client probes only. These tests do not claim native/provider/browser proof.
async function fixture(t, { runtimeVersion, nativePhases = false, webVerification } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'sdf-continuation-')), state = join(root, 'state'), repo = join(root, 'repo');
  mkdirSync(state, { mode: 0o700 }); mkdirSync(repo);
  execFileSync('git', ['init', '--quiet', '-b', 'main', repo]);
  writeFileSync(join(repo, 'base.txt'), 'original source\n'); commit(repo);
  const base = git(repo, 'rev-parse', 'HEAD');
  git(repo, 'remote', 'add', 'origin', 'https://github.com/example/app.git');
  const config = { version: 1, repo, sourceRef: 'main', harness: 'codex', command: ['codex', 'exec', '-'], model: null,
    image: 'sha256:' + 'a'.repeat(64), network: 'none', check: 'node --test', timeoutSeconds: 10, memoryMiB: 256, port: 7331,
    scope: { project: 'fixture', service: 'app', owner: 'fixture', environment: 'test' },
    ...(webVerification ? { webVerification } : {}),
    ...(nativePhases ? { delivery: { provider: 'github', repository: 'https://github.com/example/app', target: 'main' } } : {}) };
  save(join(state, 'factory.json'), config); writeFileSync(join(state, 'model.env'), 'OPENAI_API_KEY=controlled-inert-key\n', { mode: 0o600 }); writeFileSync(join(state, 'worker.token'), 'fixture-token', { mode: 0o600 });
  const phases = [], observed = [];
  const clientBin = mkdtempSync(join(process.cwd(), '.sdf-controlled-docker-'));
  t.after(() => rmSync(clientBin, { recursive: true, force: true }));
  for (const name of ['git', 'ps']) symlinkSync(execFileSync('which', [name], { encoding: 'utf8' }).trim(), join(clientBin, name));
  const docker = join(clientBin, 'docker');
  writeFileSync(docker, `#!${process.execPath}
import { writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
const args = process.argv.slice(2);
let input = '';
process.stdin.on('data', bytes => { input += bytes; });
process.stdin.on('end', () => {
  if (args[0] === 'ps' || args[0] === 'rm') return;
  if (args[0] !== 'run') throw new Error('Unexpected controlled Docker command');
  const mount = target => args.find(arg => arg.includes('target=' + target + ',') || arg.endsWith('target=' + target))?.split('source=')[1].split(',')[0];
  const workspace = mount('/workspace'), output = mount('/output');
  const phase = args.find(arg => arg.startsWith('FACTORY_PHASE=')).slice('FACTORY_PHASE='.length);
  if (phase === 'build') writeFileSync(join(workspace, process.env.FIXTURE_BUILD_FILE), 'controlled repair\\n');
  if (phase === 'review') {
    writeFileSync(join(output, 'review.json'), JSON.stringify({verdict:process.env.FIXTURE_REVIEW_VERDICT,summary:'Controlled review only',findings:[]}));
    writeFileSync(process.env.FIXTURE_REVIEW_INPUT, input);
  }
  writeFileSync(join(output, 'agent-report.md'), 'Controlled client fixture, no provider or container proof.');
  process.stdout.write(JSON.stringify({type:'turn.completed',usage:{input_tokens:11,cached_input_tokens:2,output_tokens:5}}) + '\\n');
});
`, { mode: 0o700 });
  chmodSync(docker, 0o700);
  let controller, origin, reviewPass = false, buildFile = 'A.txt', failBuild = false, activeContainers = [], livePid = false, processGroups = '';
  let onBeforeArchive;
  const adapter = {
    prepare(job, attempt) {
      const effective = effectiveExecutionConfig(configAt(state), job.model, join(state, 'model.env'));
      const profile = executionProfile(effective, attempt.command);
      if (runtimeVersion) profile.runtimeVersion = runtimeVersion;
      save(join(state, 'jobs', job.id, 'artifacts', attempt.id, 'execution.json'), profile);
      return profile;
    },
    async execute(job, run) {
      phases.push(run.command);
      const folder = join(state, 'jobs', job.id), workspace = join(folder, 'checkout'), output = join(folder, 'artifacts', run.id);
      const policyHash = run.execution.policyHash;
      if (nativePhases) {
        const effective = effectiveExecutionConfig(configAt(state), job.model, join(state, 'model.env'));
        save(join(folder, run.id, 'execution-config.json'), effective);
        const result = join(output, 'result.json');
        try {
          execFileSync(process.execPath, [join(process.cwd(), 'factory/executor.mjs'), state, run.command], {
            input: job.prompt, encoding: 'utf8', timeout: 10000,
            env: { ...process.env, PATH: clientBin, SDF_JOB_ID: job.id, SDF_RUN_ID: run.id,
              SDF_OUTPUT_DIR: output, SDF_STEP_RESULT_PATH: result, SDF_SOURCE_ADMISSION: JSON.stringify(job.source_admission),
              SDF_CONTINUATION: JSON.stringify(job.continuation || null), FIXTURE_BUILD_FILE: buildFile,
              FIXTURE_REVIEW_VERDICT: reviewPass ? 'pass' : 'changes', FIXTURE_REVIEW_INPUT: join(root, 'review-input.txt') },
          });
        } catch (error) { if (!existsSync(result)) throw error; }
        if (run.command === 'review') {
          const meta = read(join(folder, 'candidate.json'));
          observed.push({ base: meta.base, files: git(workspace, 'diff', '--name-only', meta.base, meta.head).split('\n'), tree: meta.tree });
        }
        return read(result);
      }
      if (run.command === 'build') {
        restoreBuildCheckout(state, job.id, job.source_admission, workspace, job.continuation, policyHash);
        if (failBuild) return { outcome: 'blocked', summary: 'Controlled stopped Build' };
        writeFileSync(join(workspace, buildFile), `change ${buildFile}\n`); commit(workspace);
        const head = git(workspace, 'rev-parse', 'HEAD'), tree = git(workspace, 'rev-parse', 'HEAD^{tree}');
        const meta = { base: job.source_admission.resolved_sha, head, tree, parent: git(workspace, 'rev-parse', 'HEAD^'),
          build_run_id: run.id, build_policy_hash: policyHash, synthetic: false,
          source_admission: publicSourceAdmission(job.source_admission), continuation: publicContinuation(job.continuation) };
        save(join(folder, 'candidate.json'), meta); save(join(output, 'candidate.json'), meta);
        writeFileSync(join(output, 'change.patch'), git(workspace, 'diff', '--binary', meta.base, meta.head) + '\n');
      } else if (run.command === 'verify') {
        const meta = read(join(folder, 'candidate.json'));
        const checks = { run_id: run.id, head: meta.head, tree: meta.tree, policyHash, command: configAt(state).check, passed: true, synthetic: false };
        save(join(folder, 'checks.json'), checks); save(join(output, 'checks.json'), checks);
      } else if (run.command === 'review') {
        const meta = read(join(folder, 'candidate.json'));
        observed.push({ base: meta.base, files: git(workspace, 'diff', '--name-only', meta.base, meta.head).split('\n'), tree: meta.tree });
        const verdict = reviewPass ? 'pass' : 'changes';
        const review = { run_id: run.id, head: meta.head, tree: meta.tree, policyHash, verdict, summary: 'Controlled review fixture', findings: [], synthetic: false };
        save(join(folder, 'review.json'), review); save(join(output, 'review.json'), review);
        return { outcome: reviewPass ? 'complete' : 'blocked', review_verdict: verdict, summary: review.summary };
      } else if (run.command === 'handoff') {
        assertCurrentHandoffEvidence(read(join(folder, 'candidate.json')), read(join(folder, 'checks.json')), read(join(folder, 'review.json')), policyHash);
      }
      return { outcome: 'complete', summary: 'Controlled phase fixture' };
    },
    stop: async () => {},
    reconcile: (id, phase, options) => {
      const supervisor = executors(state, { containers: () => activeContainers, stopContainers: () => {}, alive: () => livePid, run: () => processGroups });
      return supervisor.reconcile(id, phase, options && { ...options, beforeArchive: () => { options.beforeArchive(); onBeforeArchive?.(); } });
    },
  };
  async function start() {
    controller = createController(state, adapter, { deliveryProvider: { id: 'github', supported: false } });
    await new Promise(resolve => controller.server.listen(origin ? config.port : 0, '127.0.0.1', resolve));
    origin = `http://127.0.0.1:${controller.server.address().port}`;
    config.port = controller.server.address().port; save(join(state, 'factory.json'), config);
  }
  await start();
  t.after(async () => { await controller.close(); rmSync(root, { recursive: true, force: true }); });
  const { id } = controller.queue.submit({ workflow: 'software', repository: 'app', spec: 'Controlled continuation regression' });
  const first = await wait(controller.queue, id, job => job.state === 'failed');
  const folder = join(state, 'jobs', id), workspace = join(folder, 'checkout');
  const input = () => { const job = controller.queue.get(id), selected = controller.queue.continuationStatus(job);
    return { run_id: job.runs.at(-1).id, feedback: 'Repair B while retaining A', revision_mode: 'continue_candidate', candidate_head: selected.head, candidate_tree: selected.tree }; };
  return { root, state, repo, id, base, folder, workspace, first, phases, observed, config, input,
    get queue() { return controller.queue; }, get origin() { return origin; },
    async restart() { await controller.close(); await start(); },
    next(options = {}) { reviewPass = options.reviewPass ?? true; buildFile = options.file || 'B.txt'; failBuild = options.failBuild || false; },
    probe(options = {}) { activeContainers = options.containers || []; livePid = options.livePid || false; processGroups = options.groups || ''; },
    beforeArchive(callback) { onBeforeArchive = callback; },
    post(body) { return fetch(`${origin}/api/v1/jobs/${id}/request_changes`, { method: 'POST', headers: { Authorization: 'Bearer fixture-token', 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); },
  };
}

test('reviewed A continues with B on original source, survives restart, preserves failed review and needs new checks/review/approval', async t => {
  const f = await fixture(t, { nativePhases: true }), oldReview = structuredClone(f.first.runs.at(-1));
  const oldEvidence = read(join(f.folder, 'review.json')), oldHead = f.input().candidate_head;
  await f.restart();
  const sourceBefore = f.queue.get(f.id).source_admission;
  f.next();
  f.beforeArchive(() => {
    assert(existsSync(join(f.workspace, 'A.txt')), 'retention happens before checkout reconciliation');
    assert.equal(readdirSync(join(f.folder, 'checkpoints')).length, 1);
  });
  const response = await f.post(f.input()); assert.equal(response.status, 200, await response.text());
  let job = await wait(f.queue, f.id, job => job.state === 'awaiting_approval');
  assert.deepEqual(job.source_admission, sourceBefore);
  assert.equal(job.source_history, undefined);
  assert.equal(job.continuation.original_base, f.base); assert.equal(job.continuation.head, oldHead);
  assert.equal(job.continuation.review_run_id, oldReview.id);
  const prior = job.runs.find(run => run.id === oldReview.id);
  assert.deepEqual({ ...prior, revision: undefined }, { ...oldReview, revision: undefined });
  assert.deepEqual(read(join(f.folder, 'artifacts', oldReview.id, 'review.json')), oldEvidence);
  assert.deepEqual(f.phases, ['build', 'verify', 'review', 'build', 'verify', 'review']);
  assert.deepEqual(f.observed.at(-1).files, ['A.txt', 'B.txt']); assert.equal(f.observed.at(-1).base, f.base);
  const meta = read(join(f.folder, 'candidate.json'));
  assert.equal(git(f.workspace, 'rev-list', '--parents', '-n', '1', meta.head), `${meta.head} ${f.base}`);
  assert.equal(meta.tree, git(f.workspace, 'rev-parse', 'HEAD^{tree}'));
  const patch = readFileSync(join(f.folder, 'artifacts', meta.build_run_id, 'change.patch'), 'utf8');
  assert.match(patch, /A.txt/); assert.match(patch, /B.txt/);
  const status = await (await fetch(f.origin + '/api/v1/status')).json();
  const shown = status.jobs.find(job => job.id === f.id);
  assert.equal(shown.continuation.head, oldHead); assert.equal(shown.continuation.retained_repo, undefined);
  assert.equal(shown.continuation_status.head, meta.head);
  await assert.rejects(f.queue.action(f.id, 'approve', { run_id: oldReview.id }), /changed/);
  await f.queue.action(f.id, 'approve', { run_id: job.runs.at(-1).id });
  job = await wait(f.queue, f.id, job => job.state === 'succeeded');
  assert.equal(job.runs.at(-1).command, 'handoff');
  const accepted = read(join(f.folder, 'accepted.json'));
  assert.equal(accepted.base, f.base); assert.equal(accepted.tree, meta.tree); assert.equal(accepted.continuation.head, oldHead);
  assert.match(readFileSync(join(f.root, 'review-input.txt'), 'utf8'), new RegExp(`git diff ${f.base} ${meta.head}`));
  let writes = 0;
  const provider = { id: 'github', supported: true,
    inspectRepository: async () => ({ full_name: 'example/app', push: true, archived: false }),
    readTarget: async () => ({ sha: '9'.repeat(40) }),
    createBlob: async () => { writes++; throw new Error('No writes expected'); },
  };
  const delivery = new DeliveryService(f.queue, f.state, { config: () => configAt(f.state), provider,
    sourceAdmission: new SourceAdmissionStore(f.state, f.repo, 'main') });
  const validated = delivery.validateEvidence(job, configAt(f.state));
  assert.equal(validated.accepted.base, f.base); assert.equal(validated.accepted.tree, meta.tree);
  assert.deepEqual(validated.patch.entries.map(entry => entry.path).sort(), ['A.txt', 'B.txt']);
  await assert.rejects(delivery.publish(job.id, { run_id: job.runs.at(-1).id }), /target moved/);
  assert.equal(writes, 0, 'a combined continuation cannot bypass the unchanged remote-target guard');
  for (const run of job.runs.filter(run => ['build', 'review'].includes(run.command))) {
    assert.equal(run.usage.input_tokens, '11'); assert.equal(run.usage.output_tokens, '5');
  }
});

test('fresh start after continuation resets deliberately; source replacement selects a new baseline', async t => {
  const f = await fixture(t); f.next({ reviewPass: false });
  await f.queue.action(f.id, 'request_changes', f.input());
  await wait(f.queue, f.id, job => job.state === 'failed' && job.runs.length === 6);
  assert(existsSync(join(f.workspace, 'A.txt'))); assert(existsSync(join(f.workspace, 'B.txt')));
  f.next({ reviewPass: false, file: 'C.txt' });
  await f.queue.action(f.id, 'request_changes', { run_id: f.queue.get(f.id).runs.at(-1).id, feedback: 'Start fresh' });
  await wait(f.queue, f.id, job => job.state === 'failed' && job.runs.length === 9);
  assert.equal(existsSync(join(f.workspace, 'A.txt')), false); assert.equal(existsSync(join(f.workspace, 'B.txt')), false);
  assert.equal(f.queue.get(f.id).continuation, null);
  assert.deepEqual(f.observed.at(-1).files, ['C.txt']);
  writeFileSync(join(f.repo, 'new-base.txt'), 'new baseline\n'); commit(f.repo);
  const newBase = git(f.repo, 'rev-parse', 'HEAD'); f.next();
  await f.queue.action(f.id, 'request_changes', { run_id: f.queue.get(f.id).runs.at(-1).id, feedback: 'Replace source explicitly', source_ref: 'main' });
  const job = await wait(f.queue, f.id, job => job.state === 'awaiting_approval');
  assert.equal(job.source_admission.resolved_sha, newBase); assert.equal(job.source_history[0].resolved_sha, f.base);
  assert.equal(existsSync(join(f.workspace, 'C.txt')), false); assert(existsSync(join(f.workspace, 'new-base.txt')));
});

test('stale selections, changed policy/target, foreign evidence and active workers refuse without archiving or losing evidence', async t => {
  const f = await fixture(t), original = f.input();
  async function refused(body, pattern) {
    const response = await f.post(body); assert.equal(response.status, 409, await response.clone().text());
    assert.match((await response.json()).error, pattern);
    assert.equal(f.queue.get(f.id).runs.length, 3); assert(existsSync(join(f.workspace, 'A.txt')));
    assert.equal(readdirSync(f.folder).some(name => name.startsWith('previous-checkout')), false);
  }
  await refused({ ...original, run_id: 'run_stale' }, /changed/);
  await refused({ ...original, candidate_head: '0'.repeat(40) }, /changed/);
  await refused({ ...original, candidate_tree: '0'.repeat(40) }, /changed/);
  for (const change of [{ check: 'other check' }, { delivery: { provider: 'github', repository: 'https://github.com/example/app', target: 'dev' } }]) {
    save(join(f.state, 'factory.json'), { ...f.config, ...change });
    await refused(original, /policy/);
  }
  save(join(f.state, 'factory.json'), f.config);
  f.probe({ containers: [{ Config: { Labels: { 'sdf.job': f.id } }, State: { Running: true } }] });
  await refused(original, /container.*active/); f.probe();
  save(join(f.folder, 'active.json'), { pid: 12345, pgid: 12345, phase: 'review', attempt: f.first.runs.at(-1).id });
  f.probe({ livePid: true }); await refused(original, /executor.*present/);
  assert.equal(existsSync(join(f.folder, 'active.json')), true);
  f.probe({ groups: '12345' }); await refused(original, /group.*present/);
  rmSync(join(f.folder, 'active.json')); f.probe();
  f.probe({ containers: [{ Config: { Labels: { 'sdf.job': f.id } }, State: {} }] });
  await refused(original, /container/); f.probe();
  const retainedSource = join(f.folder, f.first.source_admission.retained_repo);
  renameSync(retainedSource, retainedSource + '.saved'); await refused(original, /Retained source/); renameSync(retainedSource + '.saved', retainedSource);

  f.queue.active = { jobId: f.id }; await refused(original, /executor.*finishing/); f.queue.active = null;
  const candidatePath = join(f.folder, 'candidate.json'), candidate = read(candidatePath);
  save(candidatePath, { ...candidate, build_run_id: 'run_foreign' }); await refused(original, /cycle|provenance/); save(candidatePath, candidate);
  save(candidatePath, { ...candidate, source_admission: { ...candidate.source_admission, repository_identity: 'foreign' } });
  await refused(original, /source/); save(candidatePath, candidate);
  const checksPath = join(f.folder, 'checks.json'), checks = read(checksPath);
  save(checksPath, { ...checks, tree: '0'.repeat(40) }); await refused(original, /stale/); save(checksPath, checks);
  const reviewPath = join(f.folder, 'artifacts', f.first.runs.at(-1).id, 'review.json');
  renameSync(reviewPath, reviewPath + '.saved'); await refused(original, /missing|unreadable/); renameSync(reviewPath + '.saved', reviewPath);
  writeFileSync(join(f.workspace, 'uncommitted.txt'), 'Preserve me'); await refused(original, /checkout changed/);
  assert.equal(readFileSync(join(f.workspace, 'uncommitted.txt'), 'utf8'), 'Preserve me');
});

test('retained checkpoints survive checkout deletion, reject missing/tampered/foreign objects and remain checked after restart', async t => {
  const f = await fixture(t); f.next({ failBuild: true });
  await f.queue.action(f.id, 'request_changes', f.input());
  const failed = await wait(f.queue, f.id, job => job.state === 'failed' && job.runs.length === 4);
  const checkpoint = failed.continuation, retainedPath = join(f.folder, checkpoint.retained_repo);
  assertRetainedCheckpoint(f.state, f.id, failed.source_admission, checkpoint, checkpoint.policy_hash);
  await f.restart();
  assert.deepEqual(f.queue.get(f.id).continuation, checkpoint);
  save(join(f.state, 'factory.json'), { ...f.config, check: 'changed policy' });
  await assert.rejects(f.queue.action(f.id, 'retry', { run_id: failed.runs.at(-1).id }), /policy/);
  assert(existsSync(f.workspace), 'incompatible policy refuses before checkout reconciliation');
  save(join(f.state, 'factory.json'), f.config);
  for (const altered of [{ ...checkpoint, job_id: 'job_' + 'b'.repeat(24) }, { ...checkpoint, original_base: '0'.repeat(40) },
    { ...checkpoint, tree: '0'.repeat(40) }, { ...checkpoint, retained_repo: '../foreign.git' }])
    assert.throws(() => assertRetainedCheckpoint(f.state, f.id, failed.source_admission, altered, checkpoint.policy_hash), /foreign|tampered/);
  assert.throws(() => assertRetainedCheckpoint(f.state, f.id, failed.source_admission, checkpoint, '0'.repeat(64)), /policy/);
  renameSync(retainedPath, retainedPath + '.saved');
  await assert.rejects(f.queue.action(f.id, 'retry', { run_id: failed.runs.at(-1).id }), /missing/);
  assert(existsSync(f.workspace), 'failed retry preserves the prior checkout');
  renameSync(retainedPath + '.saved', retainedPath);
  const manifest = join(retainedPath, 'checkpoint.json'); save(manifest, { ...checkpoint, head: '0'.repeat(40) });
  assert.throws(() => assertRetainedCheckpoint(f.state, f.id, failed.source_admission, checkpoint, checkpoint.policy_hash), /tampered/);
  save(manifest, checkpoint);
  const packs = join(retainedPath, 'objects', 'pack'), pack = readdirSync(packs).find(name => name.endsWith('.pack'));
  if (pack) {
    const bytes = readFileSync(join(packs, pack)); writeFileSync(join(packs, pack), Buffer.from('tampered'));
    assert.throws(() => assertRetainedCheckpoint(f.state, f.id, failed.source_admission, checkpoint, checkpoint.policy_hash), /tampered/);
    writeFileSync(join(packs, pack), bytes);
  } else {
    const object = join(retainedPath, 'objects', checkpoint.head.slice(0, 2), checkpoint.head.slice(2));
    const bytes = readFileSync(object); rmSync(object); writeFileSync(object, 'tampered');
    assert.throws(() => assertRetainedCheckpoint(f.state, f.id, failed.source_admission, checkpoint, checkpoint.policy_hash), /tampered/);
    writeFileSync(object, bytes);
  }
  for (const name of readdirSync(f.folder).filter(name => name.startsWith('previous-checkout'))) rmSync(join(f.folder, name), { recursive: true });
  f.next(); await f.queue.action(f.id, 'retry', { run_id: failed.runs.at(-1).id });
  await wait(f.queue, f.id, job => job.state === 'awaiting_approval');
  assert.deepEqual(f.observed.at(-1).files, ['A.txt', 'B.txt']);
});

for (const runtimeVersion of ['0.8.0', '0.9.0', '0.9.1']) test(`compatible ${runtimeVersion} full protected review can supply continuation`, async t => {
  const f = await fixture(t, { runtimeVersion });
  assert.equal(f.queue.continuationStatus(f.queue.get(f.id)).available, true);
  f.next(); await f.queue.action(f.id, 'request_changes', f.input());
  await wait(f.queue, f.id, job => job.state === 'awaiting_approval');
  assert.deepEqual(f.observed.at(-1).files, ['A.txt', 'B.txt']);
});

test('CLI uses shared current head/tree and rejects ambiguous modes before mutation', async t => {
  const f = await fixture(t), feedback = join(f.root, 'feedback.md'); writeFileSync(feedback, 'Retain A and repair B');
  
  const cli = (...args) => execAsync(process.execPath, ['bin/software-defence-factory.mjs', 'revise', f.id, '--state', f.state, '--file', feedback, ...args],
    { cwd: process.cwd(), env: { ...process.env, SDF_NO_UPDATE: '1' } });
  await assert.rejects(cli('--from', 'reviewed-candidate', '--source-ref', 'main'), /Choose --from or --source-ref/);
  await assert.rejects(cli('--from', '/host/checkpoint'), /must be/);
  f.next(); await cli('--from', 'reviewed-candidate');
  const job = await wait(f.queue, f.id, job => job.state === 'awaiting_approval');
  assert.equal(job.revision_mode, 'continue_candidate'); assert.deepEqual(f.observed.at(-1).files, ['A.txt', 'B.txt']);
});


test('an admitted continuation resumes after a controller restart from its private checkpoint', async t => {
  const f = await fixture(t); f.next();
  f.queue.schedule = () => {}; // Crash boundary after the durable action, before Build dispatch.
  await f.queue.action(f.id, 'request_changes', f.input());
  const queued = f.queue.get(f.id);
  assert.equal(queued.state, 'queued'); assert.equal(existsSync(f.workspace), false);
  const retained = assertRetainedCheckpoint(f.state, f.id, queued.source_admission, queued.continuation, queued.continuation.policy_hash);
  assert(existsSync(retained.path));
  await f.restart();
  const job = await wait(f.queue, f.id, job => job.state === 'awaiting_approval');
  assert.deepEqual(job.continuation, queued.continuation);
  assert.deepEqual(f.observed.at(-1).files, ['A.txt', 'B.txt']);
});

test('continuation retains current profile and required browser gates', async t => {
  const f = await fixture(t);
  const original = f.queue.get(f.id), path = join(f.folder, 'artifacts', original.runs[0].id, 'execution.json');
  for (const runtimeVersion of ['0.7.0', '0.10.1', 'future']) {
    const changed = structuredClone(original); changed.runs[0].execution.runtimeVersion = runtimeVersion;
    save(path, changed.runs[0].execution); f.queue.save(changed);
    assert.equal(f.queue.continuationStatus(changed).available, false);
    await assert.rejects(f.queue.action(f.id, 'request_changes', f.input()), /provenance/);
    assert(existsSync(join(f.workspace, 'A.txt')));
  }
  save(path, original.runs[0].execution); f.queue.save(original);
  const web = await fixture(t, { webVerification: qualificationWebConfig('sha256:' + 'b'.repeat(64)) });
  const status = web.queue.continuationStatus(web.queue.get(web.id));
  assert.equal(status.available, false); assert.match(status.reason, /browser/i);
  await assert.rejects(web.queue.action(web.id, 'request_changes', web.input()), /browser/i);
  assert(existsSync(join(web.workspace, 'A.txt')));
});
