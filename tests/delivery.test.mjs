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
import { effectiveExecutionConfig } from '../factory/execution-profile.mjs';
import { VERSION } from '../factory/updates.mjs';
import { githubDeliveryProvider } from '../factory/providers/github-delivery.mjs';
import { createController } from '../factory/server.mjs';

const jobID = `job_${'a'.repeat(24)}`;
const execFileAsync = promisify(execFile);
const runIDs = { build: `run_${'b'.repeat(24)}`, verify: `run_${'c'.repeat(24)}`, review: `run_${'d'.repeat(24)}`, handoff: `run_${'e'.repeat(24)}` };
const git = (repo, ...args) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8', env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' } }).trim();
const save = (path, value) => { mkdirSync(join(path, '..'), { recursive: true, mode: 0o700 }); writeFileSync(path, JSON.stringify(value), { mode: 0o600 }); };

function testFixture(t, { delivery = true, port = 7331, harness = 'mock', model = null, taskModel = null, modelEnv = '' } = {}) {
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
  const candidate = { base, head, tree, parent: git(checkout, 'rev-parse', 'HEAD^'), build_run_id: runIDs.build,
    build_policy_hash: policyHash, source_admission: publicSourceAdmission(admission), synthetic: true };
  const checks = { run_id: runIDs.verify, head, tree, policyHash, command: config.check, passed: true, synthetic: true };
  const review = { run_id: runIDs.review, verdict: 'pass', summary: 'Candidate reviewed.', findings: [], head, tree, policyHash };
  const accepted = { base, head, tree, patch_sha256: patchHash, build_run_id: runIDs.build, checks_run_id: runIDs.verify,
    review_run_id: runIDs.review, handoff_run_id: runIDs.handoff, policyHash, source_admission: publicSourceAdmission(admission), acceptedAt: '2026-09-26T12:00:00.000Z' };
  const folder = join(state, 'jobs', jobID), input = join(folder, 'delivery-input');
  mkdirSync(input, { mode: 0o700 });
  writeFileSync(join(input, 'candidate.patch'), patch, { mode: 0o600 });
  save(join(folder, 'candidate.json'), candidate); save(join(folder, 'checks.json'), checks);
  save(join(folder, 'review.json'), review); save(join(folder, 'accepted.json'), accepted);
  const execution = { runtimeVersion: VERSION, policyHash };
  const runs = [
    { id: runIDs.build, command: 'build', state: 'succeeded', outcome: 'complete', execution },
    { id: runIDs.verify, command: 'verify', state: 'succeeded', outcome: 'complete', execution },
    { id: runIDs.review, command: 'review', state: 'succeeded', outcome: 'complete', review_verdict: 'pass', execution },
    { id: runIDs.handoff, command: 'handoff', state: 'succeeded', outcome: 'complete', execution },
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
    losePull: options.losePull === true, failFindOnce: false, hidePullSearches: options.hidePullSearches || 0 };
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
    findPulls: async () => {
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
