import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { promisify } from 'node:util';
import { createServer as createNetServer } from 'node:net';
import { JobQueue } from '../factory/queue.mjs';
import { DeliveryService } from '../factory/delivery.mjs';
import { SourceAdmissionStore, publicSourceAdmission, restoreRetainedCheckout } from '../factory/source-admission.mjs';
import { runCandidateGit } from '../factory/git-environment.mjs';
import { API_TIMEOUT_MS, PUBLICATION_API_TIMEOUT_MS, configAt, digest } from '../factory/lib.mjs';
import { effectiveExecutionConfig, executionProfile } from '../factory/execution-profile.mjs';
import { VERSION } from '../factory/updates.mjs';
import { githubDeliveryProvider } from '../factory/providers/github-delivery.mjs';
import { createController } from '../factory/server.mjs';

const jobID = `job_${'a'.repeat(24)}`;
const execFileAsync = promisify(execFile);
const runIDs = { build: `run_${'b'.repeat(24)}`, verify: `run_${'c'.repeat(24)}`, review: `run_${'d'.repeat(24)}`, handoff: `run_${'e'.repeat(24)}` };
const git = (repo, ...args) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8', env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' } }).trim();
const save = (path, value) => { mkdirSync(join(path, '..'), { recursive: true, mode: 0o700 }); writeFileSync(path, JSON.stringify(value), { mode: 0o600 }); };

function testFixture(t, { delivery = true, port = 7331, harness = 'codex', model = null, taskModel = null, modelEnv = '' } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'sdf-delivery-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const repo = join(root, 'repo'), state = join(root, 'state');
  mkdirSync(repo); mkdirSync(state, { mode: 0o700 });
  execFileSync('git', ['-C', repo, 'init', '--quiet', '-b', 'main']);
  writeFileSync(join(repo, 'source.txt'), 'source\n');
  git(repo, 'add', 'source.txt');
  git(repo, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@localhost', 'commit', '--quiet', '-m', 'Source');
  git(repo, 'remote', 'add', 'origin', 'git@github.com:example/project.git');
  const command = harness === 'codex' ? ['codex', 'exec', '-'] : harness === 'pi' ? ['pi'] : ['mock'];
  const config = { version: 1, repo, sourceRef: 'main', harness, command, port,
    timeoutSeconds: 10, memoryMiB: 256, image: 'fixture:1', network: 'none', check: 'node --test', model,
    scope: { project: 'fixture', service: 'app', environment: 'test', owner: 'operator' },
    ...(delivery ? { delivery: { provider: 'github', repository: 'https://github.com/example/project', target: 'main' } } : {}) };
  writeFileSync(join(state, 'factory.json'), JSON.stringify(config), { mode: 0o600 });
  writeFileSync(join(state, 'model.env'), modelEnv, { mode: 0o600 });
  writeFileSync(join(state, 'worker.token'), 'fixture-token', { mode: 0o600 });
  const sourceAdmission = new SourceAdmissionStore(state, repo, 'main');
  const admission = sourceAdmission.admit(jobID, undefined);
  assert.equal(admission.requested_ref, 'main');
  assert.equal(admission.ref_source, 'configured');
  assert.equal(admission.source_repository, 'https://github.com/example/project');
  const base = admission.resolved_sha;
  const baseTree = git(repo, 'rev-parse', `${base}^{tree}`);
  const checkout = join(state, 'jobs', jobID, 'checkout');
  restoreRetainedCheckout(state, jobID, admission, checkout);
  writeFileSync(join(checkout, 'candidate.txt'), 'accepted content\n');
  runCandidateGit(checkout, 'add', '-A');
  runCandidateGit(checkout, '-c', 'user.name=Factory candidate', '-c', 'user.email=factory@localhost', 'commit', '--no-verify', '-m', 'Candidate');
  const head = git(checkout, 'rev-parse', 'HEAD'), tree = git(checkout, 'rev-parse', 'HEAD^{tree}');
  const patchText = runCandidateGit(checkout, '--no-pager', 'diff', '--binary', '--full-index', '--no-ext-diff', '--no-textconv', base, head);
  const patch = patchText ? `${patchText}\n` : '';
  const policyHash = digest(JSON.stringify(effectiveExecutionConfig(config, taskModel, join(state, 'model.env'))));
  const patchHash = digest(Buffer.from(patch));
  // Success fixtures model the private protected provenance for native Codex/Pi
  // phases; they exercise the delivery contract without making model calls.
  const synthetic = harness === 'mock';
  const candidate = { base, head, tree, parent: git(checkout, 'rev-parse', 'HEAD^'), build_run_id: runIDs.build,
    build_policy_hash: policyHash, source_admission: publicSourceAdmission(admission), synthetic };
  const checks = { run_id: runIDs.verify, head, tree, policyHash, command: config.check, passed: true, synthetic };
  const review = { run_id: runIDs.review, verdict: 'pass', summary: synthetic ? 'Synthetic fixture review; no model judgment.' : 'Candidate reviewed.', findings: [], head, tree, policyHash, synthetic };
  const accepted = { base, head, tree, patch_sha256: patchHash, build_run_id: runIDs.build, checks_run_id: runIDs.verify,
    review_run_id: runIDs.review, handoff_run_id: runIDs.handoff, policyHash, source_admission: publicSourceAdmission(admission), acceptedAt: '2026-09-26T12:00:00.000Z' };
  const folder = join(state, 'jobs', jobID), input = join(folder, 'delivery-input');
  mkdirSync(input, { mode: 0o700 });
  writeFileSync(join(input, 'candidate.patch'), patch, { mode: 0o600 });
  save(join(folder, 'candidate.json'), candidate); save(join(folder, 'checks.json'), checks);
  save(join(folder, 'review.json'), review); save(join(folder, 'accepted.json'), accepted);
  const effective = effectiveExecutionConfig(config, taskModel, join(state, 'model.env'));
  const executions = Object.fromEntries(['build', 'verify', 'review', 'handoff'].map(phase => [phase, executionProfile(effective, phase)]));
  for (const phase of ['build', 'verify', 'review', 'handoff'])
    save(join(folder, 'artifacts', runIDs[phase], 'execution.json'), executions[phase]);
  const runs = [
    { id: runIDs.build, command: 'build', state: 'succeeded', outcome: 'complete', execution: executions.build },
    { id: runIDs.verify, command: 'verify', state: 'succeeded', outcome: 'complete', execution: executions.verify },
    { id: runIDs.review, command: 'review', state: 'succeeded', outcome: 'complete', review_verdict: 'pass', execution: executions.review },
    { id: runIDs.handoff, command: 'handoff', state: 'succeeded', outcome: 'complete', execution: executions.handoff },
  ];
  const job = { id: jobID, state: 'succeeded', model: taskModel, task: { title: 'Delivery fixture', source_url: 'https://github.com/example/project/issues/29' },
    workflow: { name: 'software', steps: ['build', 'verify', 'review', 'handoff'], current_step: 3 }, repository: 'app',
    source_admission: admission, runs, created_at: '2026-09-26T11:00:00.000Z' };
  const sourceAdapter = { admit: () => admission, validate: (id, value) => sourceAdmission.validate(id, value), release: () => {} };
  const queue = new JobQueue(state, { execute: async () => ({ outcome: 'complete' }), stop: async () => {}, reconcile: async () => {}, sourceAdmission: sourceAdapter });
  queue.save(job);
  let queueOpen = true;
  const closeQueue = async () => { if (queueOpen) { queueOpen = false; await queue.close(); } };
  t.after(closeQueue);
  return { root, repo, state, config, base, baseTree, head, tree, patch, policyHash, patchHash, admission, sourceAdmission, sourceAdapter, queue, job, folder, run_id: runIDs.handoff, closeQueue };
}

function fakeGitHub(f, options = {}) {
  const state = { targetSha: options.targetSha || f.base, branch: options.branch || null, pull: null, commit: null, checks: { state: 'pending', check_runs: [], commit_statuses: [] },
    writes: { blobs: 0, trees: 0, commits: 0, branches: 0, pulls: 0 }, loseBranch: options.loseBranch === true,
    losePull: options.losePull === true, failFindOnce: false, hidePullSearches: options.hidePullSearches || 0, pullSearchTargets: [] };
  const branchName = `factory/${jobID}-${f.head.slice(0, 12)}`;
  const provider = {
    supported: true, id: 'github',
    inspectRepository: async () => ({ full_name: 'example/project', archived: false, push: true }),
    readTarget: async () => ({ sha: state.targetSha, ref: 'refs/heads/main' }),
    readCommit: async (_repository, sha) => sha === f.base
      ? { sha: f.base, tree: f.baseTree, parents: [] }
      : state.commit?.sha === sha ? { ...state.commit } : null,
    createBlob: async (_repository, content) => {
      state.writes.blobs++;
      if (options.branchAfterBlob && !state.branch) state.branch = { ...options.branchAfterBlob };
      if (options.slowBlobMs) await new Promise(resolve => setTimeout(resolve, options.slowBlobMs));
      if (state.holdBlob) {
        state.blobStarted?.();
        await new Promise(resolve => { state.releaseBlob = resolve; });
        state.holdBlob = false;
      }
      return createHashBlob(content);
    },
    createTree: async (_repository, baseTree, entries) => { state.writes.trees++; assert.equal(baseTree, f.baseTree); assert(entries.some(entry => entry.path === 'candidate.txt')); return f.tree; },
    createCommit: async (_repository, input) => {
      state.writes.commits++; assert.equal(input.tree, f.tree); assert.deepEqual(input.parents, [f.base]);
      const sha = commitSha(input); state.commit = { sha, tree: input.tree, parents: input.parents };
      return sha;
    },
    readBranch: async () => state.branch && ({ ...state.branch }),
    createBranch: async (_repository, branch, sha) => {
      state.writes.branches++; assert.equal(branch, branchName);
      if (state.branch) throw Object.assign(new Error('branch exists'), { httpStatus: 422 });
      state.branch = { sha, node_id: 'branch-node' };
      if (state.loseBranch) { state.loseBranch = false; throw new Error('response lost'); }
      return state.branch;
    },
    findPulls: async (_repository, _branch, target) => {
      state.pullSearchTargets.push(target);
      if (state.failFindOnce) { state.failFindOnce = false; throw new Error('read failed after ambiguous creation'); }
      if (state.hidePullSearches > 0) { state.hidePullSearches--; return []; }
      return state.pull ? [state.pull] : [];
    },
    createPull: async (_repository, input) => {
      state.writes.pulls++;
      assert.equal(input.head, `example:${branchName}`); assert.equal(input.base, 'main'); assert.equal(input.draft, true);
      assert.match(input.body, new RegExp(jobID)); assert.match(input.body, /issues\/29/);
      if (options.advanceTargetOnPull) state.targetSha = '9'.repeat(40);
      state.pull = pullRecord(state.commit.sha, state.targetSha, branchName);
      if (options.readyAfterCreate) state.pull.draft = false;
      if (state.losePull) { state.losePull = false; state.failFindOnce = options.failFindAfterLostPull !== false; throw new Error('response lost'); }
      return state.pull;
    },
    readPull: async () => state.pull && ({ ...state.pull, base: { ...state.pull.base }, head: { ...state.pull.head } }),
    readChecks: async () => structuredClone(state.checks),
  };
  return { provider, state, get finalSha() { return state.commit?.sha; }, branchName };
}
function createHashBlob(content) {
  return createHash('sha1').update(`blob ${content.length}\0`).update(content).digest('hex');
}
function commitSha(input) {
  const epoch = Math.floor(new Date(input.author.date).getTime() / 1000);
  const raw = Buffer.from(`tree ${input.tree}\nparent ${input.parents[0]}\nauthor ${input.author.name} <${input.author.email}> ${epoch} +0000\ncommitter ${input.committer.name} <${input.committer.email}> ${epoch} +0000\n\n${input.message}`, 'utf8');
  return createHash('sha1').update(`commit ${raw.length}\0`).update(raw).digest('hex');
}
function pullRecord(sha, base, branch) {
  return { id: 2900, node_id: 'PR_fixture', number: 29, html_url: 'https://github.com/example/project/pull/29', state: 'open', draft: true, merged: false,
    base: { ref: 'main', sha: base, repo: { full_name: 'example/project' } },
    head: { ref: branch, sha, repo: { full_name: 'example/project' } } };
}
function service(f, provider) { return new DeliveryService(f.queue, f.state, { config: () => configAt(f.state), sourceAdmission: f.sourceAdapter, provider }); }

test('synthetic mock acceptance cannot advertise or perform trusted PR publication', async t => {
  const f = testFixture(t, { harness: 'mock' }), gh = fakeGitHub(f), manager = service(f, gh.provider);
  const summary = manager.summary(f.queue.get(jobID));
  let failure;
  try { await manager.publish(jobID, { run_id: f.run_id }); } catch (error) { failure = error; }
  assert.deepEqual(gh.state.writes, { blobs: 0, trees: 0, commits: 0, branches: 0, pulls: 0 },
    `synthetic evidence must not reach a provider write; publish result: ${failure?.message || 'published'}`);
  assert.equal(summary.can_publish, false, 'mock phase evidence is local exploration, not publication proof');
  assert.match(summary.error, /synthetic|execution provenance/i);
  assert.ok(failure, 'the shared publisher rejects synthetic phase evidence');
});

test('synthetic publication refusal is shared by status, authenticated API and CLI', async t => {
  const reservation = createNetServer();
  await new Promise(resolve => reservation.listen(0, '127.0.0.1', resolve));
  const port = reservation.address().port;
  await new Promise(resolve => reservation.close(resolve));
  const f = testFixture(t, { harness: 'mock', port }), gh = fakeGitHub(f);
  await f.closeQueue();
  const controller = createController(f.state, { execute: async () => ({ outcome: 'complete' }), stop: async () => {}, reconcile: async () => {} }, { deliveryProvider: gh.provider });
  await new Promise(resolve => controller.server.listen(port, '127.0.0.1', resolve));
  t.after(() => controller.close());
  const origin = `http://127.0.0.1:${port}`;
  const status = await (await fetch(`${origin}/api/v1/status`)).json();
  assert.equal(status.jobs[0].delivery_status.can_publish, false);
  assert.match(status.jobs[0].delivery_status.error, /synthetic|execution provenance/i);
  const headers = { 'Content-Type': 'application/json', 'X-Factory-Session': status.csrf_token };
  const response = await fetch(`${origin}/api/v1/jobs/${jobID}/publish`, {
    method: 'POST', headers, body: JSON.stringify({ run_id: f.run_id }),
  });
  assert.equal(response.status, 409, 'the dashboard action reaches the same shared rejection');
  assert.match((await response.json()).error, /synthetic|execution provenance/i);
  let cliFailure;
  try {
    await execFileAsync(process.execPath, ['bin/software-defence-factory.mjs', 'publish', jobID, '--state', f.state], {
      encoding: 'utf8', env: { ...process.env, SDF_AUTO_UPDATE: '0', SDF_BOOTSTRAPPED: '1' },
    });
  } catch (error) { cliFailure = error; }
  assert.match(cliFailure?.stderr || '', /synthetic|execution provenance/i);
  assert.deepEqual(gh.state.writes, { blobs: 0, trees: 0, commits: 0, branches: 0, pulls: 0 });
});

test('saved pre-write intents revalidate synthetic evidence and unknown protected provenance before writing', async t => {
  const noWrites = { blobs: 0, trees: 0, commits: 0, branches: 0, pulls: 0 };
  const f = testFixture(t), gh = fakeGitHub(f), manager = service(f, gh.provider);
  const config = configAt(f.state), job = f.queue.get(jobID);
  manager.ensureIntent(job, config, manager.validateEvidence(job, config));
  const reviewPath = join(f.folder, 'review.json');
  const review = JSON.parse(readFileSync(reviewPath, 'utf8'));
  writeFileSync(reviewPath, JSON.stringify({ ...review, synthetic: true }), { mode: 0o600 });
  const summary = manager.summary(f.queue.get(jobID));
  let failure;
  try { await manager.publish(jobID, { run_id: f.run_id }); } catch (error) { failure = error; }
  assert.equal(summary.can_publish, false, 'a saved intent cannot make synthetic evidence publishable');
  assert.ok(failure, 'the saved intent is revalidated before any new provider write');
  assert.deepEqual(gh.state.writes, noWrites);
  assert.match(failure.message, /synthetic|execution provenance/i);
  await f.closeQueue();

  for (const defect of ['missing protected profile', 'inconsistent run profile']) {
    const broken = testFixture(t), provider = fakeGitHub(broken), delivery = service(broken, provider.provider);
    if (defect === 'missing protected profile') {
      rmSync(join(broken.state, 'jobs', jobID, 'artifacts', runIDs.review, 'execution.json'));
    } else {
      const changed = broken.queue.get(jobID);
      changed.runs.find(run => run.id === runIDs.review).execution.executor = 'pi';
      broken.queue.save(changed);
    }
    const status = delivery.summary(broken.queue.get(jobID));
    let rejected;
    try { await delivery.publish(jobID, { run_id: broken.run_id }); } catch (error) { rejected = error; }
    assert.equal(status.can_publish, false, `${defect} cannot be advertised as trusted proof`);
    assert.ok(rejected, `${defect} is rejected by the shared publisher`);
    assert.deepEqual(provider.state.writes, noWrites, `${defect} blocks all GitHub content/ref/PR writes`);
    await broken.closeQueue();
  }
});

test('synthetic evidence cannot resume writes but known PR readback remains read-only', async t => {
  const noWrites = { blobs: 0, trees: 0, commits: 0, branches: 0, pulls: 0 };
  const pending = testFixture(t), pendingGH = fakeGitHub(pending), pendingManager = service(pending, pendingGH.provider);
  const config = configAt(pending.state), pendingJob = pending.queue.get(jobID);
  pendingManager.ensureIntent(pendingJob, config, pendingManager.validateEvidence(pendingJob, config));
  pendingJob.delivery.state = 'uncertain'; pendingJob.delivery.stage = 'creating_pull_request';
  pending.queue.save(pendingJob);
  const pendingReviewPath = join(pending.folder, 'review.json');
  const pendingReview = JSON.parse(readFileSync(pendingReviewPath, 'utf8'));
  writeFileSync(pendingReviewPath, JSON.stringify({ ...pendingReview, synthetic: true }), { mode: 0o600 });
  assert.equal(pendingManager.summary(pending.queue.get(jobID)).can_publish, true,
    'the displayed action is limited to read-only reconciliation of a saved PR-create checkpoint');
  await assert.rejects(pendingManager.publish(jobID, { run_id: pending.run_id }), /not yet confirmed/);
  assert(pendingGH.state.pullSearchTargets.includes('main'), 'the saved PR checkpoint receives its read-only lookup');
  assert.deepEqual(pendingGH.state.writes, noWrites, 'an absent PR is not created from synthetic evidence');
  await pending.closeQueue();

  const published = testFixture(t), publishedGH = fakeGitHub(published), publishedManager = service(published, publishedGH.provider);
  assert.equal((await publishedManager.publish(jobID, { run_id: published.run_id })).state, 'published');
  const writes = structuredClone(publishedGH.state.writes);
  const reviewPath = join(published.folder, 'review.json'), review = JSON.parse(readFileSync(reviewPath, 'utf8'));
  writeFileSync(reviewPath, JSON.stringify({ ...review, synthetic: true }), { mode: 0o600 });
  assert.equal(publishedManager.summary(published.queue.get(jobID)).can_publish, true,
    'a known receipt remains available for read-only refresh');
  assert.equal((await publishedManager.publish(jobID, { run_id: published.run_id })).state, 'published');
  assert.deepEqual(publishedGH.state.writes, writes, 'published readback remains read-only');
});

test('explicit trusted config publishes one draft PR, records pending checks, reconciles lost responses and survives restart', async t => {
  const f = testFixture(t), gh = fakeGitHub(f, { loseBranch: true, losePull: true }), manager = service(f, gh.provider);
  assert.equal(manager.summary(f.queue.get(jobID)).state, 'ready');
  assert.equal(manager.summary(f.queue.get(jobID)).can_publish, true);
  await assert.rejects(manager.publish(jobID, { run_id: f.run_id }), /uncertain/);
  assert.equal(f.queue.get(jobID).delivery.state, 'uncertain');
  assert.equal(gh.state.writes.branches, 1); assert.equal(gh.state.writes.pulls, 1);
  await f.closeQueue();
  const restartedQueue = new JobQueue(f.state, { execute: async () => ({ outcome: 'complete' }), stop: async () => {}, reconcile: async () => {}, sourceAdmission: f.sourceAdapter });
  const restarted = new DeliveryService(restartedQueue, f.state, { config: () => configAt(f.state), sourceAdmission: f.sourceAdapter, provider: gh.provider });
  const receipt = await restarted.publish(jobID, { run_id: f.run_id });
  assert.equal(receipt.state, 'published');
  assert.equal(receipt.repository, 'https://github.com/example/project');
  assert.equal(receipt.target, 'main');
  assert.equal(receipt.pull_request.head_sha, gh.finalSha);
  assert.equal(receipt.pull_request.tree, f.tree);
  assert.equal(receipt.checks.state, 'pending');
  assert.equal(gh.state.writes.branches, 1, 'the branch response was reconciled without a duplicate ref write');
  assert.equal(gh.state.writes.pulls, 1, 'the uncertain PR response was reconciled without a duplicate PR');
  const configPath = join(f.state, 'factory.json'), savedConfig = JSON.parse(readFileSync(configPath, 'utf8'));
  writeFileSync(configPath, JSON.stringify({ ...savedConfig, delivery: { ...savedConfig.delivery, repository: 'https://github.com/example/other', target: 'dev' } }), { mode: 0o600 });
  const movedDestination = restarted.summary(restartedQueue.get(jobID));
  assert.equal(movedDestination.repository, 'https://github.com/example/project', 'the receipt keeps its recorded repository identity');
  assert.equal(movedDestination.target, 'main', 'the receipt keeps its recorded target');
  assert.equal(movedDestination.can_publish, false, 'changed trusted destination disables recovery until restored');
  assert.match(movedDestination.error, /Restore its original provider, repository and target/);
  writeFileSync(configPath, JSON.stringify(savedConfig), { mode: 0o600 });
  gh.state.checks = { state: 'success', check_runs: [{ name: 'check (22)', status: 'completed', conclusion: 'success' }], commit_statuses: [] };
  const refreshed = await restarted.publish(jobID, { run_id: f.run_id });
  assert.equal(refreshed.checks.state, 'success');
  assert.equal(gh.state.writes.pulls, 1);
  await restartedQueue.close();
});

test('delivery evidence uses the trusted inferred provider policy for Codex and Pi', async t => {
  for (const options of [
    { harness: 'codex', model: null, taskModel: 'task-selected-codex-model' },
    { harness: 'pi', model: 'openai/configured-model', taskModel: 'anthropic/task-requested-model' },
  ]) {
    const f = testFixture(t, options), gh = fakeGitHub(f), manager = service(f, gh.provider);
    assert.equal(configAt(f.state).inferenceProvider, undefined, 'provider choice remains derived from trusted installation config');
    assert.equal(manager.summary(f.queue.get(jobID)).state, 'ready');
    const receipt = await manager.publish(jobID, { run_id: f.run_id });
    assert.equal(receipt.state, 'published');
    assert.equal(receipt.pull_request.head_sha, gh.finalSha);
    await f.closeQueue();
  }

  const f = testFixture(t, { harness: 'pi', model: null, taskModel: 'anthropic/task-requested-model', modelEnv: 'OPENAI_API_KEY=inert-openai-sentinel\n' });
  const gh = fakeGitHub(f), manager = service(f, gh.provider), job = f.queue.get(jobID);
  assert.equal(manager.summary(job).state, 'ready', 'the sole trusted provider group is included in accepted policy');
  writeFileSync(join(f.state, 'model.env'), 'ANTHROPIC_API_KEY=inert-anthropic-sentinel\n', { mode: 0o600 });
  assert.equal(manager.summary(job).state, 'blocked', 'changing the inferred provider invalidates old acceptance evidence');
  await assert.rejects(manager.publish(jobID, { run_id: f.run_id }), /current Factory policy/);
  writeFileSync(join(f.state, 'model.env'), 'OPENAI_API_KEY=inert-openai-sentinel\n', { mode: 0o600 });
  assert.equal((await manager.publish(jobID, { run_id: f.run_id })).state, 'published');
  await f.closeQueue();
});

test('patch-only is the default and issue text cannot provide a destination', async t => {
  const f = testFixture(t, { delivery: false }), gh = fakeGitHub(f), manager = service(f, gh.provider);
  assert.equal(manager.summary(f.queue.get(jobID)).can_publish, false);
  await assert.rejects(manager.publish(jobID, { run_id: f.run_id }), /not configured/);
  const unknown = testFixture(t), unknownConfigPath = join(unknown.state, 'factory.json');
  writeFileSync(unknownConfigPath, JSON.stringify({ ...unknown.config, delivery: { provider: 'future-provider' } }), { mode: 0o600 });
  const unknownManager = service(unknown, fakeGitHub(unknown).provider);
  assert.equal(unknownManager.summary(unknown.queue.get(jobID)).state, 'patch_only_unsupported_provider');
  await assert.rejects(unknownManager.publish(jobID, { run_id: unknown.run_id }), /not configured/);
  const configured = testFixture(t);
  const provider = fakeGitHub(configured).provider, configuredManager = service(configured, provider);
  await assert.rejects(configuredManager.publish(jobID, { run_id: configured.run_id, repository: 'https://github.com/attacker/target' }), /operator-configured/);
  assert.equal(configured.queue.get(jobID).delivery, undefined);
  const configPath = join(configured.state, 'factory.json');
  const operatorConfig = JSON.parse(readFileSync(configPath, 'utf8'));
  operatorConfig.delivery.target = 'dev';
  writeFileSync(configPath, JSON.stringify(operatorConfig), { mode: 0o600 });
  assert.equal(configAt(configured.state).sourceRef, 'main');
  assert.equal(configAt(configured.state).delivery.target, 'dev', 'source ref and PR target remain separate operator settings');
  operatorConfig.delivery.target = 'feature/from-task-text';
  writeFileSync(configPath, JSON.stringify(operatorConfig), { mode: 0o600 });
  assert.throws(() => configAt(configured.state), /target main or dev/);
});

test('legacy acceptance without candidate-bound approval evidence is not advertised as publishable', async t => {
  const f = testFixture(t), gh = fakeGitHub(f), manager = service(f, gh.provider);
  writeFileSync(join(f.folder, 'accepted.json'), JSON.stringify({ head: f.head, source_admission: publicSourceAdmission(f.admission), acceptedAt: '2026-09-26T12:00:00.000Z' }), { mode: 0o600 });
  const summary = manager.summary(f.queue.get(jobID));
  assert.equal(summary.state, 'legacy_unverified');
  assert.equal(summary.can_publish, false);
  assert.match(summary.error, /does not bind the candidate/);
});

test('stale evidence, changed source identity and changed remote base block before content writes', async t => {
  const f = testFixture(t), gh = fakeGitHub(f), manager = service(f, gh.provider);
  const checkFile = join(f.folder, 'checks.json'), checks = JSON.parse(readFileSync(checkFile, 'utf8'));
  writeFileSync(checkFile, JSON.stringify({ ...checks, head: '0'.repeat(40) }), { mode: 0o600 });
  await assert.rejects(manager.publish(jobID, { run_id: f.run_id }), /successful checks/);
  assert.equal(gh.state.writes.blobs, 0);
  writeFileSync(checkFile, JSON.stringify(checks), { mode: 0o600 });
  git(f.repo, 'config', 'remote.origin.url', 'git@github.com:example/renamed.git');
  await assert.rejects(manager.publish(jobID, { run_id: f.run_id }), /destination no longer matches/);
  assert.equal(gh.state.writes.blobs, 0);
  git(f.repo, 'config', 'remote.origin.url', 'git@github.com:example/project.git');
  gh.state.targetSha = '9'.repeat(40);
  await assert.rejects(manager.publish(jobID, { run_id: f.run_id }), /target moved/);
  assert.equal(gh.state.writes.blobs, 0);
});

test('stale policy, approval and protected patch are rejected before publishing', async t => {
  const f = testFixture(t), gh = fakeGitHub(f), manager = service(f, gh.provider);
  const configPath = join(f.state, 'factory.json'), config = JSON.parse(readFileSync(configPath, 'utf8'));
  writeFileSync(configPath, JSON.stringify({ ...config, check: 'changed policy' }), { mode: 0o600 });
  const staleSummary = manager.summary(f.queue.get(jobID));
  assert.equal(staleSummary.state, 'blocked');
  assert.equal(staleSummary.can_publish, false);
  await assert.rejects(manager.publish(jobID, { run_id: f.run_id }), /current Factory policy/);
  writeFileSync(configPath, JSON.stringify(config), { mode: 0o600 });
  const acceptedPath = join(f.folder, 'accepted.json'), accepted = JSON.parse(readFileSync(acceptedPath, 'utf8'));
  writeFileSync(acceptedPath, JSON.stringify({ ...accepted, head: '9'.repeat(40) }), { mode: 0o600 });
  await assert.rejects(manager.publish(jobID, { run_id: f.run_id }), /Approval does not bind/);
  writeFileSync(acceptedPath, JSON.stringify(accepted), { mode: 0o600 });
  writeFileSync(join(f.folder, 'delivery-input', 'candidate.patch'), `${f.patch}tampered\n`, { mode: 0o600 });
  await assert.rejects(manager.publish(jobID, { run_id: f.run_id }), /Accepted patch digest/);
  assert.equal(gh.state.writes.blobs, 0);
});

test('unrelated branch collisions are preserved and repeated/concurrent actions do not overwrite them', async t => {
  const f = testFixture(t), branch = `factory/${jobID}-${f.head.slice(0, 12)}`;
  const gh = fakeGitHub(f, { branch: { sha: '9'.repeat(40), node_id: 'unrelated' } }), manager = service(f, gh.provider);
  await assert.rejects(manager.publish(jobID, { run_id: f.run_id }), /unrelated branch/);
  assert.deepEqual(gh.state.branch, { sha: '9'.repeat(40), node_id: 'unrelated' });
  assert.equal(gh.state.writes.branches, 0); assert.equal(gh.state.writes.pulls, 0);
  await assert.rejects(manager.publish(jobID, { run_id: f.run_id }), /unexpected remote collision/);
  assert.equal(gh.state.writes.branches, 0);
  assert.match(branch, /^factory\/job_/);
});

test('a pre-write branch collision can be explicitly abandoned after exact readback and remains removed only locally', async t => {
  const foreignSha = '9'.repeat(40), f = testFixture(t);
  const gh = fakeGitHub(f, { branch: { sha: foreignSha, node_id: 'foreign-branch-node' } });
  const manager = service(f, gh.provider);
  const evidencePaths = ['accepted.json', 'candidate.json', 'checks.json', 'review.json'];
  const evidenceBefore = new Map(evidencePaths.map(name => [name, readFileSync(join(f.folder, name))]));
  const historyBefore = structuredClone(f.queue.get(jobID).runs);
  await assert.rejects(manager.publish(jobID, { run_id: f.run_id }), /unrelated branch/);

  const collision = f.queue.get(jobID).delivery;
  assert.equal(collision.state, 'conflict');
  assert.equal(collision.stage, 'intent', 'the resolution is restricted to a collision found before provider writes');
  assert.deepEqual(gh.state.branch, { sha: foreignSha, node_id: 'foreign-branch-node' });
  const status = manager.summary(f.queue.get(jobID));
  assert.equal(status.can_abandon, true);
  assert.equal(status.remote_collision.sha, foreignSha);

  const writes = structuredClone(gh.state.writes);
  await assert.rejects(manager.abandonDelivery(jobID, {
    run_id: f.run_id, delivery_identity: collision.identity, branch_sha: '8'.repeat(40),
  }), /inspected branch identity/);
  assert.deepEqual(gh.state.writes, writes, 'a wrong identity is refused without provider writes');

  const resolved = await manager.abandonDelivery(jobID, {
    run_id: f.run_id, delivery_identity: collision.identity, branch_sha: foreignSha,
  });
  assert.equal(resolved.state, 'abandoned');
  assert.equal(resolved.can_abandon, false);
  assert.equal(resolved.can_publish, false, 'abandonment never resumes publication');
  assert.equal(f.queue.canRemove(f.queue.get(jobID)), true);
  assert.equal(gh.state.branch.sha, foreignSha, 'the unexpected remote branch remains untouched');
  assert.deepEqual(gh.state.writes, writes, 'resolution is read-only at the provider boundary');
  assert.equal(f.queue.get(jobID).delivery.resolution.action, 'abandon_local_delivery');
  assert.equal(f.queue.get(jobID).delivery.resolution.actor, 'operator');
  assert.equal(f.queue.get(jobID).delivery.resolution.inspected.sha, foreignSha);
  assert.ok(gh.state.pullSearchTargets.includes(null), 'resolution searches for PRs on every base target');
  await assert.rejects(manager.publish(jobID, { run_id: f.run_id }), /explicitly abandoned/);
  assert.deepEqual(gh.state.writes, writes, 'a later publish click cannot restart an abandoned delivery');

  await f.closeQueue();
  const restartedQueue = new JobQueue(f.state, { execute: async () => ({ outcome: 'complete' }), stop: async () => {}, reconcile: async () => {}, sourceAdmission: f.sourceAdapter });
  t.after(() => restartedQueue.close());
  const restarted = new DeliveryService(restartedQueue, f.state, { config: () => configAt(f.state), sourceAdmission: f.sourceAdapter, provider: gh.provider });
  const restartedJob = restartedQueue.get(jobID);
  assert.equal(restarted.summary(restartedJob).state, 'abandoned', 'resolution survives controller restart');
  assert.equal(restarted.summary(restartedJob).can_publish, false);
  assert.equal(restartedQueue.removalBlockReason(restartedJob), null);
  await assert.rejects(restarted.publish(jobID, { run_id: f.run_id }), /explicitly abandoned/);
  await restartedQueue.remove(jobID);
  const retained = JSON.parse(restartedQueue.db.prepare('SELECT data FROM jobs WHERE id=?').get(jobID).data);
  assert.ok(retained.deleted_at, 'issue removal is a local tombstone');
  assert.equal(retained.delivery.resolution.inspected.node_id, 'foreign-branch-node');
  assert.deepEqual(retained.runs, historyBefore, 'local run history remains intact after removal');
  for (const name of evidencePaths)
    assert.deepEqual(readFileSync(join(f.folder, name)), evidenceBefore.get(name), `${name} remains immutable`);
});

test('branch-collision abandonment rejects stale identities, PR-backed collisions and uncertain delivery effects', async t => {
  const f = testFixture(t), gh = fakeGitHub(f, { branch: { sha: '9'.repeat(40), node_id: 'foreign-node' } });
  const manager = service(f, gh.provider);
  await assert.rejects(manager.publish(jobID, { run_id: f.run_id }), /unrelated branch/);
  const collision = f.queue.get(jobID).delivery, writes = structuredClone(gh.state.writes);
  const baseInput = { run_id: f.run_id, delivery_identity: collision.identity, branch_sha: collision.remote_collision.sha };
  await assert.rejects(manager.abandonDelivery(jobID, { ...baseInput, run_id: 'run_stale' }), /Job changed/);
  await assert.rejects(manager.abandonDelivery(jobID, { ...baseInput, delivery_identity: 'another-delivery' }), /identity is stale or incorrect/);
  await assert.rejects(manager.abandonDelivery(jobID, { ...baseInput, branch_sha: '8'.repeat(40) }), /identity is stale or incorrect/);
  assert.deepEqual(gh.state.writes, writes, 'stale or wrong identities do not call provider writes');

  gh.state.branch.sha = '7'.repeat(40);
  await assert.rejects(manager.abandonDelivery(jobID, baseInput), /identity changed/);
  assert.equal(manager.summary(f.queue.get(jobID)).remote_collision.sha, '7'.repeat(40), 'status refreshes after a detected stale remote head');
  const freshInput = { ...baseInput, branch_sha: '7'.repeat(40) };
  gh.state.pull = pullRecord('6'.repeat(40), f.base, gh.branchName);
  gh.state.pull.base.ref = 'dev';
  await assert.rejects(manager.abandonDelivery(jobID, freshInput), /pull request uses the colliding branch/);
  assert.equal(gh.state.pullSearchTargets.at(-1), null, 'resolution searches branch PRs without filtering to one base target');
  assert.equal(f.queue.get(jobID).delivery.state, 'conflict', 'a foreign PR is never accepted by local abandonment');
  assert.deepEqual(gh.state.writes, writes, 'identity refresh and foreign PR detection remain read-only');

  const later = testFixture(t), lateGH = fakeGitHub(later, {
    branchAfterBlob: { sha: '6'.repeat(40), node_id: 'late-foreign-node' },
  }), lateManager = service(later, lateGH.provider);
  await assert.rejects(lateManager.publish(jobID, { run_id: later.run_id }), /changed unexpectedly/);
  assert.equal(later.queue.get(jobID).delivery.stage, 'checking_commit');
  assert.equal(lateManager.summary(later.queue.get(jobID)).can_abandon, false,
    'a later-stage collision after provider writes is not eligible for abandonment');
  const lateWrites = structuredClone(lateGH.state.writes);
  await assert.rejects(lateManager.abandonDelivery(jobID, {
    run_id: later.run_id, delivery_identity: later.queue.get(jobID).delivery.identity, branch_sha: '6'.repeat(40),
  }), /Only a confirmed branch-only collision before provider writes/);
  assert.deepEqual(lateGH.state.writes, lateWrites);

  const ready = testFixture(t), readyManager = service(ready, fakeGitHub(ready).provider);
  await assert.rejects(readyManager.abandonDelivery(jobID, {
    run_id: ready.run_id, delivery_identity: 'unrelated', branch_sha: '9'.repeat(40),
  }), /Only a confirmed branch-only collision/);

  const uncertain = testFixture(t), uncertainGH = fakeGitHub(uncertain, { losePull: true }), uncertainManager = service(uncertain, uncertainGH.provider);
  await assert.rejects(uncertainManager.publish(jobID, { run_id: uncertain.run_id }), /uncertain/);
  const uncertainWrites = structuredClone(uncertainGH.state.writes);
  assert.equal(uncertainManager.summary(uncertain.queue.get(jobID)).can_abandon, false);
  await assert.rejects(uncertainManager.abandonDelivery(jobID, {
    run_id: uncertain.run_id, delivery_identity: uncertain.queue.get(jobID).delivery.identity, branch_sha: uncertainGH.finalSha,
  }), /Only a confirmed branch-only collision/);
  assert.deepEqual(uncertainGH.state.writes, uncertainWrites, 'uncertain PR effects remain blocked from local abandonment');
});

test('authenticated dashboard and CLI abandon the same inspected branch-only collision contract', async t => {
  async function reservePort() {
    const server = createNetServer();
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const port = server.address().port;
    await new Promise(resolve => server.close(resolve));
    return port;
  }

  const apiFixture = testFixture(t, { port: await reservePort() });
  const apiGH = fakeGitHub(apiFixture, { branch: { sha: '9'.repeat(40), node_id: 'api-foreign-node' } });
  await assert.rejects(service(apiFixture, apiGH.provider).publish(jobID, { run_id: apiFixture.run_id }), /unrelated branch/);
  const apiWrites = structuredClone(apiGH.state.writes);
  await apiFixture.closeQueue();
  const apiController = createController(apiFixture.state, { execute: async () => ({ outcome: 'complete' }), stop: async () => {}, reconcile: async () => {} }, { deliveryProvider: apiGH.provider });
  await new Promise(resolve => apiController.server.listen(apiFixture.config.port, '127.0.0.1', resolve));
  t.after(() => apiController.close());
  const apiOrigin = `http://127.0.0.1:${apiFixture.config.port}`;
  const status = await (await fetch(`${apiOrigin}/api/v1/status`)).json();
  const apiJob = status.jobs[0], collision = apiJob.delivery_status.remote_collision;
  assert.equal(apiJob.delivery_status.can_abandon, true);
  assert.equal(apiJob.can_remove, false);
  assert.equal(apiJob.delivery_removal_blocked, true);
  const request = (headers, body) => fetch(`${apiOrigin}/api/v1/jobs/${jobID}/abandon-delivery`, {
    method: 'POST', headers, body: JSON.stringify(body),
  });
  assert.equal((await request({ 'Content-Type': 'application/json' }, {
    run_id: apiFixture.run_id, delivery_identity: apiJob.delivery_status.identity, branch_sha: collision.sha,
  })).status, 403, 'the dashboard resolution still requires its controller session');
  const resolved = await request({ 'Content-Type': 'application/json', 'X-Factory-Session': status.csrf_token }, {
    run_id: apiFixture.run_id, delivery_identity: apiJob.delivery_status.identity, branch_sha: collision.sha,
  });
  assert.equal(resolved.status, 200);
  assert.equal((await resolved.json()).state, 'abandoned');
  const after = await (await fetch(`${apiOrigin}/api/v1/status`)).json();
  assert.equal(after.jobs[0].delivery_status.can_publish, false);
  assert.equal(after.jobs[0].delivery_removal_blocked, false);
  assert.equal(after.jobs[0].can_remove, true);
  const removed = await fetch(`${apiOrigin}/api/v1/jobs/${jobID}`, {
    method: 'DELETE', headers: { 'X-Factory-Session': status.csrf_token },
  });
  assert.equal(removed.status, 200, 'the dashboard can remove the issue only after explicit resolution');
  assert.deepEqual(await removed.json(), { id: jobID, deleted: true });
  assert.deepEqual(apiGH.state.writes, apiWrites);
  assert.equal(apiGH.state.branch.sha, collision.sha);

  const cliFixture = testFixture(t, { port: await reservePort() });
  const cliGH = fakeGitHub(cliFixture, { branch: { sha: '8'.repeat(40), node_id: 'cli-foreign-node' } });
  await assert.rejects(service(cliFixture, cliGH.provider).publish(jobID, { run_id: cliFixture.run_id }), /unrelated branch/);
  const cliWrites = structuredClone(cliGH.state.writes);
  await cliFixture.closeQueue();
  const cliController = createController(cliFixture.state, { execute: async () => ({ outcome: 'complete' }), stop: async () => {}, reconcile: async () => {} }, { deliveryProvider: cliGH.provider });
  await new Promise(resolve => cliController.server.listen(cliFixture.config.port, '127.0.0.1', resolve));
  t.after(() => cliController.close());
  const { stdout } = await execFileAsync(process.execPath, [
    'bin/software-defence-factory.mjs', 'abandon-delivery', jobID,
    '--branch-sha', '8'.repeat(40), '--state', cliFixture.state,
  ], { encoding: 'utf8', env: { ...process.env, SDF_AUTO_UPDATE: '0', SDF_BOOTSTRAPPED: '1' } });
  assert.equal(JSON.parse(stdout).state, 'abandoned', 'the CLI consumes the shared controller result');
  const cliStatus = await (await fetch(`http://127.0.0.1:${cliFixture.config.port}/api/v1/status`)).json();
  assert.equal(cliStatus.jobs[0].can_remove, true);
  assert.deepEqual(cliGH.state.writes, cliWrites);
  assert.equal(cliGH.state.branch.sha, '8'.repeat(40));
});

test('a changed remote branch or PR head is never overwritten or duplicated', async t => {
  const f = testFixture(t), gh = fakeGitHub(f), manager = service(f, gh.provider);
  await manager.publish(jobID, { run_id: f.run_id });
  const originalBranch = gh.state.branch.sha;
  gh.state.branch.sha = '8'.repeat(40);
  await assert.rejects(manager.publish(jobID, { run_id: f.run_id }), /changed unexpectedly/);
  assert.equal(gh.state.branch.sha, '8'.repeat(40));
  assert.equal(gh.state.writes.branches, 1);
  assert.equal(gh.state.writes.pulls, 1);
  assert.equal(originalBranch, f.queue.get(jobID).delivery.final_sha);
  const f2 = testFixture(t), gh2 = fakeGitHub(f2), manager2 = service(f2, gh2.provider);
  await manager2.publish(jobID, { run_id: f2.run_id });
  gh2.state.pull.head.sha = '7'.repeat(40);
  await assert.rejects(manager2.publish(jobID, { run_id: f2.run_id }), /changed pull request/);
  assert.equal(gh2.state.writes.pulls, 1);
  const f3 = testFixture(t), gh3 = fakeGitHub(f3), manager3 = service(f3, gh3.provider);
  await manager3.publish(jobID, { run_id: f3.run_id });
  gh3.state.pull.draft = false;
  const ready = await manager3.publish(jobID, { run_id: f3.run_id });
  assert.equal(ready.state, 'published', 'a person marking a known PR ready is ordinary lifecycle');
  assert.equal(ready.pull_request.draft, false);
  assert.equal(gh3.state.pull.draft, false, 'readback does not change the PR draft state');
  assert.equal(gh3.state.writes.pulls, 1);
});

test('first publication still requires a current-base open draft PR', async t => {
  const f = testFixture(t), gh = fakeGitHub(f, { readyAfterCreate: true }), manager = service(f, gh.provider);
  await assert.rejects(manager.publish(jobID, { run_id: f.run_id }), /draft state/);
  assert.equal(f.queue.get(jobID).delivery.state, 'conflict');
  assert.equal(f.queue.get(jobID).delivery.pull_request.draft, false, 'the durable PR receipt is retained for read-only recovery');
  assert.equal(gh.state.writes.pulls, 1, 'first-publication validation does not repeat PR creation');
});

test('published delivery refresh is read-only, allows ordinary PR lifecycle and never recreates missing remote records', async t => {
  const f = testFixture(t), gh = fakeGitHub(f), manager = service(f, gh.provider);
  await manager.publish(jobID, { run_id: f.run_id });
  const originalWrites = structuredClone(gh.state.writes);
  const acceptedPath = join(f.folder, 'accepted.json'), acceptedBefore = readFileSync(acceptedPath);
  const configPath = join(f.state, 'factory.json'), config = JSON.parse(readFileSync(configPath, 'utf8'));
  writeFileSync(configPath, JSON.stringify({ ...config, check: 'changed after publication' }), { mode: 0o600 });
  gh.state.targetSha = '9'.repeat(40);
  gh.state.pull.base.sha = gh.state.targetSha;
  gh.state.pull.draft = false;
  const refreshed = await manager.publish(jobID, { run_id: f.run_id });
  assert.equal(refreshed.state, 'published');
  assert.equal(refreshed.pull_request.base_sha, gh.state.targetSha);
  assert.equal(refreshed.accepted_base_sha, f.base, 'the original accepted base remains separate from the PR base');
  assert.equal(refreshed.pull_request.state, 'open');
  assert.equal(refreshed.pull_request.draft, false, 'a person marking the PR ready is ordinary lifecycle');
  assert.equal(refreshed.checks.state, 'pending');
  assert.match(refreshed.error, /immutable accepted base/);
  assert.equal(f.queue.get(jobID).delivery.state, 'published');
  assert.equal(f.queue.canRemove(f.queue.get(jobID)), true);
  assert.deepEqual(gh.state.writes, originalWrites, 'advancing the base refreshes the existing PR without writes');
  assert.deepEqual(readFileSync(acceptedPath), acceptedBefore, 'readback leaves original accepted evidence immutable');

  gh.state.pull.state = 'closed';
  gh.state.pull.merged = true;
  gh.state.pull.base.sha = f.base;
  gh.state.branch = null;
  const merged = await manager.publish(jobID, { run_id: f.run_id });
  assert.equal(merged.state, 'published');
  assert.equal(merged.pull_request.state, 'closed');
  assert.equal(merged.pull_request.merged, true, 'a merged PR remains the same confirmed publication');
  assert.equal(merged.pull_request.base_sha, f.base, 'a closed PR may retain its older base after the target advances');
  assert.equal(merged.accepted_base_sha, f.base);
  assert.equal(f.queue.get(jobID).delivery.state, 'published');
  assert.equal(f.queue.canRemove(f.queue.get(jobID)), true);
  assert.deepEqual(gh.state.writes, originalWrites, 'closed/merged readback does not recreate a deleted branch');
  assert.deepEqual(readFileSync(acceptedPath), acceptedBefore);

  gh.state.pull = null;
  await assert.rejects(manager.publish(jobID, { run_id: f.run_id }), /changed pull request/);
  assert.equal(f.queue.get(jobID).delivery.state, 'conflict');
  assert.equal(f.queue.get(jobID).delivery.pull_request.number, 29, 'the known receipt remains visible when its PR cannot be found');
  assert.equal(f.queue.canRemove(f.queue.get(jobID)), false);
  assert.deepEqual(gh.state.writes, originalWrites, 'published readback does not create another PR');
});

test('published readback records provider lifecycle and retains its receipt during provider outage', async t => {
  const f = testFixture(t), gh = fakeGitHub(f), manager = service(f, gh.provider);
  const original = await manager.publish(jobID, { run_id: f.run_id });
  const savedReceipt = structuredClone(f.queue.get(jobID).delivery.pull_request);
  const originalWrites = structuredClone(gh.state.writes);
  gh.state.pull.state = 'closed';
  gh.state.pull.draft = false;
  gh.state.pull.merged = false;
  const closed = await manager.publish(jobID, { run_id: f.run_id });
  assert.equal(closed.state, 'published');
  assert.equal(closed.pull_request.state, 'closed');
  assert.equal(closed.pull_request.merged, false);
  assert.deepEqual(gh.state.writes, originalWrites);

  const observedReceipt = structuredClone(f.queue.get(jobID).delivery.pull_request);
  gh.provider.readPull = async () => { throw new Error('provider unavailable'); };
  await assert.rejects(manager.publish(jobID, { run_id: f.run_id }), /readback is uncertain/);
  assert.equal(f.queue.get(jobID).delivery.state, 'published', 'provider outage does not discard a known publication');
  assert.deepEqual(f.queue.get(jobID).delivery.pull_request, observedReceipt);
  assert.deepEqual(gh.state.writes, originalWrites, 'lifecycle readback and outage recovery make no remote writes');
  assert.equal(original.pull_request.state, 'open');
  assert.deepEqual(savedReceipt, original.pull_request);
});

test('published readback marks changed identity or candidate head/tree as conflict without changing acceptance', async t => {
  const changes = [
    ['head', gh => { gh.state.pull.head.sha = '7'.repeat(40); }],
    ['repository', gh => { gh.state.pull.base.repo.full_name = 'other/project'; }],
    ['target', gh => { gh.state.pull.base.ref = 'release'; }],
    ['tree', gh => { gh.state.commit.tree = '8'.repeat(40); }],
    ['parent', gh => { gh.state.commit.parents = ['6'.repeat(40)]; }],
  ];
  for (const [name, change] of changes) {
    const f = testFixture(t), gh = fakeGitHub(f), manager = service(f, gh.provider);
    await manager.publish(jobID, { run_id: f.run_id });
    const receipt = structuredClone(f.queue.get(jobID).delivery.pull_request);
    const acceptedPath = join(f.folder, 'accepted.json'), acceptedBefore = readFileSync(acceptedPath);
    const originalWrites = structuredClone(gh.state.writes);
    change(gh);
    await assert.rejects(manager.publish(jobID, { run_id: f.run_id }));
    assert.equal(f.queue.get(jobID).delivery.state, 'conflict', `${name} change remains visible as a conflict`);
    assert.deepEqual(f.queue.get(jobID).delivery.pull_request, receipt, 'the known publication receipt is retained');
    assert.deepEqual(readFileSync(acceptedPath), acceptedBefore, 'conflicting readback cannot rewrite acceptance');
    assert.deepEqual(gh.state.writes, originalWrites, 'conflict detection performs readback only');
  }
});

test('a target race after PR creation retains the remote identity for read-only recovery', async t => {
  const f = testFixture(t), gh = fakeGitHub(f, { advanceTargetOnPull: true }), manager = service(f, gh.provider);
  await assert.rejects(manager.publish(jobID, { run_id: f.run_id }), /readback differs/);
  const checkpoint = f.queue.get(jobID).delivery;
  assert.equal(checkpoint.state, 'conflict');
  assert.equal(checkpoint.pull_request.number, 29);
  assert.equal(checkpoint.pull_request.base_sha, '9'.repeat(40));
  assert.equal(manager.summary(f.queue.get(jobID)).can_publish, true, 'the PR remains explicitly reconcilable');
  assert.equal(f.queue.canRemove(f.queue.get(jobID)), false, 'the remote PR cannot be hidden by deletion');
  const writes = structuredClone(gh.state.writes);

  const refreshed = await manager.publish(jobID, { run_id: f.run_id });
  assert.equal(refreshed.state, 'conflict', 'the changed base remains an unresolved candidate change');
  assert.equal(refreshed.pull_request.number, 29);
  assert.equal(refreshed.pull_request.base_sha, '9'.repeat(40));
  assert.equal(refreshed.checks.state, 'pending');
  assert.equal(gh.state.writes.pulls, 1, 'reconciliation reuses the found PR without a duplicate write');
  assert.deepEqual(gh.state.writes, writes, 'reconciliation only reads the changed remote PR');
});

test('an empty PR search after ambiguous create never repeats the non-idempotent create', async t => {
  const f = testFixture(t), gh = fakeGitHub(f, {
    losePull: true, failFindAfterLostPull: false, hidePullSearches: 3,
  }), manager = service(f, gh.provider);
  await assert.rejects(manager.publish(jobID, { run_id: f.run_id }), /creation is uncertain/);
  assert.equal(f.queue.get(jobID).delivery.stage, 'creating_pull_request');
  assert.equal(gh.state.hidePullSearches, 1);
  assert.equal(gh.state.writes.pulls, 1);
  await assert.rejects(manager.publish(jobID, { run_id: f.run_id }), /not yet confirmed/);
  assert.equal(gh.state.writes.pulls, 1, 'an empty reconciliation read cannot authorize a second PR write');

  const reconciled = await manager.publish(jobID, { run_id: f.run_id });
  assert.equal(reconciled.state, 'published');
  assert.equal(reconciled.pull_request.number, 29);
  assert.equal(gh.state.writes.pulls, 1, 'a later visible read reuses the original PR');
});

test('concurrent publish requests serialize on the accepted job', async t => {
  const f = testFixture(t), gh = fakeGitHub(f), manager = service(f, gh.provider);
  let started;
  const waitStarted = new Promise(resolve => { started = resolve; });
  gh.state.holdBlob = true; gh.state.blobStarted = started;
  const first = manager.publish(jobID, { run_id: f.run_id });
  await waitStarted;
  await assert.rejects(manager.publish(jobID, { run_id: f.run_id }), /already changing/);
  gh.state.releaseBlob();
  assert.equal((await first).state, 'published');
  assert.equal(gh.state.writes.pulls, 1);
});

test('CLI and authenticated dashboard action use the same accepted delivery receipt', async t => {
  const reservation = createNetServer();
  await new Promise(resolve => reservation.listen(0, '127.0.0.1', resolve));
  const port = reservation.address().port;
  await new Promise(resolve => reservation.close(resolve));
  const f = testFixture(t, { port }), gh = fakeGitHub(f);
  await f.closeQueue();
  const controller = createController(f.state, { execute: async () => ({ outcome: 'complete' }), stop: async () => {}, reconcile: async () => {} }, { deliveryProvider: gh.provider });
  await new Promise(resolve => controller.server.listen(port, '127.0.0.1', resolve));
  t.after(() => controller.close());
  const origin = `http://127.0.0.1:${port}`;
  const status = await (await fetch(`${origin}/api/v1/status`)).json();
  assert.equal(status.delivery_configuration.mode, 'trusted_pr');
  assert.equal(status.jobs[0].delivery_status.can_publish, true);
  const unauthorized = await fetch(`${origin}/api/v1/jobs/${jobID}/publish`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ run_id: f.run_id }) });
  assert.equal(unauthorized.status, 403);
  const { stdout: cli } = await execFileAsync(process.execPath, ['bin/software-defence-factory.mjs', 'publish', jobID, '--state', f.state], {
    encoding: 'utf8', env: { ...process.env, SDF_AUTO_UPDATE: '0', SDF_BOOTSTRAPPED: '1' },
  });
  const cliReceipt = JSON.parse(cli);
  assert.equal(cliReceipt.state, 'published');
  assert.equal(cliReceipt.pull_request.url, 'https://github.com/example/project/pull/29');
  const dashboard = await fetch(`${origin}/api/v1/jobs/${jobID}/publish`, { method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Factory-Session': status.csrf_token }, body: JSON.stringify({ run_id: f.run_id }) });
  assert.equal(dashboard.status, 200);
  assert.equal((await dashboard.json()).pull_request.head_sha, gh.finalSha);
  assert.equal(gh.state.writes.pulls, 1);
});

test('durable intent and lost-response delivery cannot be hidden before API reconciliation', async t => {
  const reservation = createNetServer();
  await new Promise(resolve => reservation.listen(0, '127.0.0.1', resolve));
  const port = reservation.address().port;
  await new Promise(resolve => reservation.close(resolve));
  const f = testFixture(t, { port }), gh = fakeGitHub(f, { loseBranch: true, losePull: true });
  const manager = service(f, gh.provider), config = configAt(f.state), job = f.queue.get(jobID);
  manager.ensureIntent(job, config, manager.validateEvidence(job, config));
  assert.equal(manager.summary(f.queue.get(jobID)).state, 'intent');
  assert.equal(manager.summary(f.queue.get(jobID)).can_publish, true, 'a crash after the durable intent can be recovered');
  assert.equal(f.queue.canRemove(f.queue.get(jobID)), false);
  await assert.rejects(f.queue.remove(jobID), /delivery is unresolved/);
  await f.closeQueue();

  const controller = createController(f.state, { execute: async () => ({ outcome: 'complete' }), stop: async () => {}, reconcile: async () => {} }, { deliveryProvider: gh.provider });
  await new Promise(resolve => controller.server.listen(port, '127.0.0.1', resolve));
  t.after(() => controller.close());
  const origin = `http://127.0.0.1:${port}`, statusURL = `${origin}/api/v1/status`;
  let status = await (await fetch(statusURL)).json();
  const csrf = status.csrf_token;
  assert.equal(status.jobs[0].delivery_status.state, 'intent');
  assert.equal(status.jobs[0].delivery_status.can_publish, true);
  assert.equal(status.jobs[0].can_remove, false);
  assert.match(status.jobs[0].removal_block_reason, /Reconcile the saved delivery/);
  const headers = { 'Content-Type': 'application/json', 'X-Factory-Session': csrf };
  const remove = () => fetch(`${origin}/api/v1/jobs/${jobID}`, { method: 'DELETE', headers: { 'X-Factory-Session': csrf } });
  assert.equal((await remove()).status, 409, 'the controller rejects deletion while only the intent is recorded');
  const publish = () => fetch(`${origin}/api/v1/jobs/${jobID}/publish`, { method: 'POST', headers, body: JSON.stringify({ run_id: f.run_id }) });
  assert.equal((await publish()).status, 409, 'the fixture simulates a lost remote PR response and failed first reconciliation');
  status = await (await fetch(statusURL)).json();
  assert.equal(status.jobs[0].delivery_status.state, 'uncertain');
  assert.equal(status.jobs[0].delivery_status.can_publish, true, 'lost response remains an explicit reconciliation action');
  assert.equal(status.jobs[0].can_remove, false);
  assert.equal((await remove()).status, 409, 'uncertain remote side effects remain visible and cannot be forgotten');
  const recovered = await publish();
  assert.equal(recovered.status, 200);
  assert.equal((await recovered.json()).pull_request.number, 29);
  assert.equal(gh.state.writes.branches, 1);
  assert.equal(gh.state.writes.pulls, 1);
  status = await (await fetch(statusURL)).json();
  assert.equal(status.jobs[0].delivery_status.state, 'published');
  assert.equal(status.jobs[0].can_remove, true, 'removal is available after confirmed readback');
});

test('CLI publication waits for bounded asynchronous delivery while ordinary API calls keep their default deadline', async t => {
  const reservation = createNetServer();
  await new Promise(resolve => reservation.listen(0, '127.0.0.1', resolve));
  const port = reservation.address().port;
  await new Promise(resolve => reservation.close(resolve));
  const f = testFixture(t, { port }), gh = fakeGitHub(f, { slowBlobMs: 5200 });
  await f.closeQueue();
  const controller = createController(f.state, { execute: async () => ({ outcome: 'complete' }), stop: async () => {}, reconcile: async () => {} }, { deliveryProvider: gh.provider });
  await new Promise(resolve => controller.server.listen(port, '127.0.0.1', resolve));
  t.after(() => controller.close());
  assert.equal(API_TIMEOUT_MS, 5000, 'unrelated shared API requests retain the five-second timeout');
  assert.equal(PUBLICATION_API_TIMEOUT_MS, 600000, 'publication has an explicit ten-minute upper bound');
  const { stdout } = await execFileAsync(process.execPath, ['bin/software-defence-factory.mjs', 'publish', jobID, '--state', f.state], {
    encoding: 'utf8', env: { ...process.env, SDF_AUTO_UPDATE: '0', SDF_BOOTSTRAPPED: '1' },
  });
  const receipt = JSON.parse(stdout);
  assert.equal(receipt.state, 'published');
  assert.equal(receipt.pull_request.number, 29);
  assert.equal(gh.state.writes.pulls, 1);
});

test('GitHub adapter keeps unknown and pending PR checks visible without treating them as success', async () => {
  const responses = [];
  const adapter = githubDeliveryProvider({ request: async (method, path) => {
    responses.push({ method, path });
    if (path.endsWith('/check-runs?per_page=100')) return { total_count: 1, check_runs: [{ name: 'build', status: 'queued', conclusion: null,
      pull_requests: [{ number: 29 }], html_url: 'https://github.com/example/project/actions/runs/1' }] };
    return { state: 'pending', total_count: 0, statuses: [] };
  } });
  const checks = await adapter.readChecks('https://github.com/example/project', 'a'.repeat(40), 29);
  assert.equal(checks.state, 'pending');
  assert.equal(checks.check_runs[0].status, 'queued');
  assert.equal(responses.length, 2);

  const unrelated = githubDeliveryProvider({ request: async (_method, path) => path.endsWith('/check-runs?per_page=100')
    ? { total_count: 1, check_runs: [{ name: 'push-only', status: 'completed', conclusion: 'success', pull_requests: [{ number: 28 }] }] }
    : { state: 'success', total_count: 1, statuses: [{ context: 'legacy status', state: 'success' }] } });
  assert.equal((await unrelated.readChecks('https://github.com/example/project', 'a'.repeat(40), 29)).state, 'unknown',
    'a successful run for another PR does not qualify as a PR check');
  const nonBlocking = githubDeliveryProvider({ request: async (_method, path) => path.includes('/check-runs?')
    ? { total_count: 3, check_runs: ['success', 'skipped', 'neutral'].map((conclusion, index) => ({ name: `job ${index}`, status: 'completed', conclusion,
      pull_requests: [{ number: 29 }] })) }
    : { state: 'success', total_count: 0, statuses: [] } });
  const accepted = await nonBlocking.readChecks('https://github.com/example/project', 'a'.repeat(40), 29);
  assert.equal(accepted.state, 'success', 'successful, skipped and neutral conclusions are non-blocking for the aggregate');
  assert.equal(accepted.pagination_complete, true);
  assert.deepEqual(accepted.check_runs.map(item => item.kind), ['check_run', 'check_run', 'check_run']);
  assert.deepEqual(accepted.check_runs.map(item => item.conclusion), ['success', 'skipped', 'neutral'], 'raw provider conclusions remain available');
  assert.deepEqual(accepted.check_runs.map(item => item.passed), [true, false, false], 'skipped and neutral remain distinct from executed passing checks');
  assert.deepEqual(accepted.check_runs.map(item => item.non_blocking), [true, true, true]);
  const skippedOnly = githubDeliveryProvider({ request: async (_method, path) => path.includes('/check-runs?')
    ? { total_count: 2, check_runs: ['skipped', 'neutral'].map((conclusion, index) => ({ name: `non-run ${index}`, status: 'completed', conclusion,
      pull_requests: [{ number: 29 }] })) }
    : { state: 'success', total_count: 0, statuses: [] } });
  const skippedOnlyResult = await skippedOnly.readChecks('https://github.com/example/project', 'a'.repeat(40), 29);
  assert.equal(skippedOnlyResult.state, 'non_blocking', 'skipped/neutral-only results are not advertised as executed passing checks');
  assert.deepEqual(skippedOnlyResult.check_runs.map(item => item.passed), [false, false]);
  for (const conclusion of ['failure', 'action_required', 'timed_out', 'cancelled']) {
    const failed = githubDeliveryProvider({ request: async (_method, path) => path.includes('/check-runs?')
      ? { total_count: 1, check_runs: [{ name: 'check', status: 'completed', conclusion, pull_requests: [{ number: 29 }] }] }
      : { state: 'success', total_count: 0, statuses: [] } });
    assert.equal((await failed.readChecks('https://github.com/example/project', 'a'.repeat(40), 29)).state, 'failure', `${conclusion} remains a failure`);
  }
  const unrecognized = githubDeliveryProvider({ request: async (_method, path) => path.includes('/check-runs?')
    ? { total_count: 1, check_runs: [{ name: 'check', status: 'completed', conclusion: 'startup_failure', pull_requests: [{ number: 29 }] }] }
    : { state: 'success', total_count: 0, statuses: [] } });
  const unrecognizedResult = await unrecognized.readChecks('https://github.com/example/project', 'a'.repeat(40), 29);
  assert.equal(unrecognizedResult.state, 'unknown');
  assert.equal(unrecognizedResult.check_runs[0].conclusion, 'startup_failure');
  const incomplete = githubDeliveryProvider({ request: async (_method, path) => path.endsWith('/check-runs?per_page=100')
    ? { total_count: 101, check_runs: [{ name: 'build', status: 'completed', conclusion: 'success', pull_requests: [{ number: 29 }] }] }
    : { state: 'success', total_count: 0, statuses: [] } });
  assert.equal((await incomplete.readChecks('https://github.com/example/project', 'a'.repeat(40), 29)).state, 'unknown',
    'truncated check results are not presented as complete success');
  const incompletePending = githubDeliveryProvider({ request: async (_method, path) => path.includes('/check-runs?')
    ? { total_count: 101, check_runs: [{ name: 'build', status: 'queued', pull_requests: [{ number: 29 }] }] }
    : { state: 'success', total_count: 0, statuses: [] } });
  assert.equal((await incompletePending.readChecks('https://github.com/example/project', 'a'.repeat(40), 29)).state, 'unknown',
    'pending rows do not hide incomplete pagination');
  const missingPaginationCount = githubDeliveryProvider({ request: async (_method, path) => path.includes('/check-runs?')
    ? { check_runs: [{ name: 'build', status: 'completed', conclusion: 'success', pull_requests: [{ number: 29 }] }] }
    : { state: 'success', total_count: 0, statuses: [] } });
  const missingCount = await missingPaginationCount.readChecks('https://github.com/example/project', 'a'.repeat(40), 29);
  assert.equal(missingCount.state, 'unknown', 'absent pagination totals cannot prove a complete result');
  assert.equal(missingCount.pagination_complete, false);
});
