import { createHash, randomBytes } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { isDeepStrictEqual } from 'node:util';
import { VERSION } from './updates.mjs';
import { configAt, digest } from './lib.mjs';
import { effectiveExecutionConfig } from './execution-profile.mjs';
import { publicSourceAdmission } from './source-admission.mjs';
import { QueueError } from './queue.mjs';
import { readProjectLinks } from './project-links.mjs';
import { qualifyGitHubActions } from './workflow-qualification.mjs';
import { assertCurrentWebEvidence } from './web-verification.mjs';

const MAX_PATCH_BYTES = 8 * 1024 * 1024;
const MAX_CHANGED_FILES = 500;
const MAX_TREE_BYTES = 8 * 1024 * 1024;
const SHA1 = /^[a-f0-9]{40}$/;
const PRIVATE_JSON_BYTES = 1024 * 1024;
const utf8 = new TextDecoder('utf-8', { fatal: true });
const KNOWN_DELIVERY_STATES = new Set(['intent', 'publishing', 'uncertain', 'blocked', 'conflict', 'published', 'abandoned']);
const RESUMABLE_DELIVERY_STATES = new Set(['intent', 'publishing', 'uncertain', 'blocked']);
const PR_READBACK_STATES = new Set(['publishing', 'uncertain', 'blocked']);
const PULL_READBACK_STAGES = new Set(['creating_pull_request', 'pull_request_created', 'pull_request_found']);
const UNKNOWN_DELIVERY_REASON = 'Saved delivery has an unknown state; publication is blocked until it is inspected.';

function pendingPullReadback(record) {
  return Boolean(record && PR_READBACK_STATES.has(record.state) && PULL_READBACK_STAGES.has(record.stage));
}

function readOnlyRecovery(record) {
  return Boolean(record && (record.state === 'published'
    || (record.state === 'conflict' && Number.isSafeInteger(record.pull_request?.number))
    || pendingPullReadback(record)));
}

class BranchCollisionError extends QueueError {
  constructor(branch, message) {
    super(message);
    this.branch = branch;
  }
}

function sha256(value) { return createHash('sha256').update(value).digest('hex'); }
function utcGitDate(value) {
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) throw new Error('Accepted timestamp is invalid.');
  const date = new Date(Math.floor(parsed.getTime() / 1000) * 1000);
  return { iso: date.toISOString().replace(/\.000Z$/, 'Z'), epoch: Math.floor(date.getTime() / 1000) };
}
function commitObjectSha({ tree, parents, message, author, committer }) {
  if (parents.length !== 1 || !SHA1.test(tree || '') || !SHA1.test(parents[0] || '')) throw new Error('Candidate commit identity is invalid.');
  const date = utcGitDate(author.date);
  if (committer.date !== author.date || author.name !== 'Software and Defence Factory' || committer.name !== author.name
    || author.email !== 'factory@localhost' || committer.email !== author.email) throw new Error('Candidate commit identity is invalid.');
  const raw = Buffer.from(`tree ${tree}\nparent ${parents[0]}\nauthor ${author.name} <${author.email}> ${date.epoch} +0000\ncommitter ${committer.name} <${committer.email}> ${date.epoch} +0000\n\n${message}`, 'utf8');
  return createHash('sha1').update(`commit ${raw.length}\0`).update(raw).digest('hex');
}
function readPrivateJson(path) {
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0 || stat.size > PRIVATE_JSON_BYTES)
    throw new Error('Protected delivery evidence is missing or unsafe.');
  return JSON.parse(readFileSync(path, 'utf8'));
}
function readPrivateFile(path, limit) {
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0 || stat.size > limit)
    throw new Error('Protected candidate patch is missing, unsafe or too large.');
  return readFileSync(path);
}
function assertPrivateDirectory(path) {
  const stat = lstatSync(path);
  if (!stat.isDirectory() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0)
    throw new Error('Protected delivery directory is missing or unsafe.');
}
function runGitCommand(args) {
  const env = {
    PATH: process.env.PATH || '/usr/bin:/bin', HOME: '/nonexistent',
    GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0',
  };
  const result = spawnSync('git', args, { env, encoding: 'utf8', maxBuffer: MAX_TREE_BYTES + MAX_PATCH_BYTES + 1024 * 1024 });
  if (result.error || result.status !== 0) throw new Error('Could not prepare private candidate reconstruction storage.');
  return result.stdout.trim();
}
function runGit(repo, args, { input, binary = false } = {}) {
  // Delivery reconstruction runs only trusted Git operations in a newly made
  // bare repository. Candidate hooks, filters, global config and credentials
  // are unavailable to these subprocesses.
  const env = {
    PATH: process.env.PATH || '/usr/bin:/bin',
    HOME: '/nonexistent',
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_TERMINAL_PROMPT: '0',
    GIT_OPTIONAL_LOCKS: '0',
  };
  const result = spawnSync('git', ['--git-dir', repo, '-c', 'core.hooksPath=/dev/null', '-c', 'core.fsmonitor=false', ...args], {
    env, input, encoding: binary ? null : 'utf8', maxBuffer: MAX_TREE_BYTES + MAX_PATCH_BYTES + 1024 * 1024,
  });
  if (result.error || result.status !== 0) throw new Error('Could not reconstruct the accepted candidate from retained Git objects.');
  return binary ? result.stdout : result.stdout.trim();
}
function parseTree(bytes) {
  const entries = new Map();
  let start = 0;
  while (start < bytes.length) {
    const end = bytes.indexOf(0, start);
    if (end < 0) throw new Error('Retained Git tree is malformed.');
    const row = bytes.subarray(start, end), tab = row.indexOf(9);
    if (tab < 0) throw new Error('Retained Git tree is malformed.');
    const meta = row.subarray(0, tab).toString('ascii').split(' ');
    let path;
    try { path = utf8.decode(row.subarray(tab + 1)); }
    catch { throw new Error('Candidate has a path GitHub cannot represent.'); }
    if (meta.length !== 3 || !['blob', 'commit'].includes(meta[1]) || !SHA1.test(meta[2])
      || !path || path.startsWith('/') || path.split('/').some(part => !part || part === '.' || part === '..')
      || /[\u0000-\u001f\u007f]/.test(path)) throw new Error('Candidate contains an unsupported Git path or object.');
    entries.set(path, { mode: meta[0], type: meta[1], sha: meta[2] });
    start = end + 1;
  }
  return entries;
}

function candidateTree(state, job, sourcePath, sourceAdmission, accepted, { branch, target }) {
  if (sourceAdmission.object_format !== 'sha1' || !SHA1.test(accepted.base || '') || !SHA1.test(accepted.tree || ''))
    throw new Error('GitHub delivery currently requires a SHA-1 candidate from the retained source repository.');
  const patchPath = join(state, 'jobs', job.id, 'delivery-input', 'candidate.patch');
  assertPrivateDirectory(join(state, 'jobs'));
  assertPrivateDirectory(join(state, 'jobs', job.id));
  assertPrivateDirectory(join(state, 'jobs', job.id, 'delivery-input'));
  const patch = readPrivateFile(patchPath, MAX_PATCH_BYTES);
  if (!patch.length || sha256(patch) !== accepted.patch_sha256) throw new Error('Accepted patch digest does not match the approval record.');
  const folder = join(state, 'jobs', job.id);
  const scratchRoot = mkdtempSync(join(folder, 'delivery-work-'));
  const scratchRepo = join(scratchRoot, 'candidate.git');
  try {
    runGitCommand(['init', '--bare', '--quiet', '--object-format=sha1', scratchRepo]);
    runGit(scratchRepo, ['fetch', '--quiet', '--no-tags', '--', sourcePath, `${accepted.base}:refs/heads/factory-base`]);
    const baseCommit = runGit(scratchRepo, ['rev-parse', '--verify', `${accepted.base}^{commit}`]);
    if (baseCommit !== accepted.base) throw new Error('Accepted base differs from the retained source commit.');
    runGit(scratchRepo, ['read-tree', accepted.base]);
    runGit(scratchRepo, ['apply', '--cached', '--binary', '--whitespace=nowarn', patchPath]);
    const tree = runGit(scratchRepo, ['write-tree']);
    if (tree !== accepted.tree) throw new Error('Protected patch does not reproduce the accepted candidate tree.');
    const baseTree = runGit(scratchRepo, ['rev-parse', `${accepted.base}^{tree}`]);
    const before = parseTree(runGit(scratchRepo, ['ls-tree', '-r', '-z', accepted.base], { binary: true }));
    const after = parseTree(runGit(scratchRepo, ['ls-tree', '-r', '-z', tree], { binary: true }));
    const paths = [...new Set([...before.keys(), ...after.keys()])].sort();
    const changed = paths.filter(path => {
      const oldEntry = before.get(path), newEntry = after.get(path);
      return !oldEntry || !newEntry || oldEntry.mode !== newEntry.mode || oldEntry.type !== newEntry.type || oldEntry.sha !== newEntry.sha;
    });
    if (!changed.length || changed.length > MAX_CHANGED_FILES) throw new Error('Candidate change count is empty or exceeds the bounded GitHub delivery limit.');
    const workflowQualification = qualifyGitHubActions({
      baseEntries: before, candidateEntries: after, branch, target,
      readBlob: sha => runGit(scratchRepo, ['cat-file', 'blob', sha], { binary: true }),
    });
    const entries = [];
    let total = 0;
    for (const path of changed) {
      const next = after.get(path), previous = before.get(path);
      if (!next) {
        entries.push({ path, mode: previous.mode, type: previous.type, sha: null });
        continue;
      }
      if (next.type !== 'blob' || !['100644', '100755', '120000'].includes(next.mode))
        throw new Error('Candidate adds or changes an unsupported Git object type.');
      const content = runGit(scratchRepo, ['cat-file', 'blob', next.sha], { binary: true });
      total += content.length;
      if (total > MAX_TREE_BYTES) throw new Error('Candidate files exceed the bounded GitHub delivery size.');
      entries.push({ path, mode: next.mode, type: 'blob', content });
    }
    return { patch, patch_sha256: accepted.patch_sha256, base_tree: baseTree, tree, entries, workflowQualification };
  } finally {
    rmSync(scratchRoot, { recursive: true, force: true });
  }
}

function sourceIssue(job, repository) {
  const url = job.task?.source_url;
  if (typeof url !== 'string') return null;
  const match = url.match(/^https:\/\/github\.com\/([A-Za-z0-9-]+)\/([A-Za-z0-9_.-]+)\/issues\/(\d+)$/);
  if (!match || `https://github.com/${match[1]}/${match[2]}`.toLowerCase() !== repository.toLowerCase()) return null;
  return { number: Number(match[3]), url };
}

function branchIdentity(job, accepted) {
  return `factory/${job.id}-${accepted.head.slice(0, 12)}`;
}

function sameRepository(actual, expected) {
  return typeof actual === 'string' && actual.toLowerCase() === expected.toLowerCase();
}

function remotePullReceipt(pull, repository, target, branch) {
  const ownerName = repository.slice('https://github.com/'.length);
  if (!Number.isSafeInteger(pull?.number) || pull.number < 1
    || !sameRepository(pull.base?.repo?.full_name, ownerName) || !sameRepository(pull.head?.repo?.full_name, ownerName)
    || pull.base?.ref !== target || pull.head?.ref !== branch
    || pull.html_url !== `https://github.com/${pull.base.repo.full_name}/pull/${pull.number}`) return null;
  return {
    id: pull.id || null, node_id: pull.node_id || null, number: pull.number, url: pull.html_url,
    state: typeof pull.state === 'string' ? pull.state : 'unknown', draft: pull.draft === true, merged: pull.merged === true,
    repository: pull.base.repo.full_name, branch: pull.head.ref, target: pull.base.ref,
    base_sha: SHA1.test(pull.base.sha || '') ? pull.base.sha : null,
    head_sha: SHA1.test(pull.head.sha || '') ? pull.head.sha : null, tree: null,
  };
}

function trustedExecutionProfile(state, job, run, phase, expectedPolicy) {
  if (!run || !/^run_[a-z0-9]+$/.test(run.id || '')) return false;
  try {
    const folder = join(state, 'jobs', job.id);
    for (const path of [join(state, 'jobs'), folder, join(folder, 'artifacts'), join(folder, 'artifacts', run.id)])
      assertPrivateDirectory(path);
    const profile = readPrivateJson(join(folder, 'artifacts', run.id, 'execution.json'));
    const agentPhase = phase === 'build' || phase === 'review';
    const executorMatches = agentPhase
      ? ['codex', 'pi'].includes(profile.executor)
        && ['explicit', 'provider_default'].includes(profile.modelSelection)
        && (profile.modelSelection === 'explicit' ? typeof profile.requestedModel === 'string' : profile.requestedModel === null)
      : profile.executor === 'deterministic' && profile.modelSelection === 'not_applicable' && profile.requestedModel === null;
    return profile.version === 1 && profile.phase === phase && executorMatches
      && profile.runtimeVersion === VERSION && profile.policyHash === expectedPolicy
      && isDeepStrictEqual(run.execution, profile);
  } catch { return false; }
}

function trustedPhaseEvidence(state, job, expectedPolicy, runs, candidate, checks, review) {
  const executionsMatch = trustedExecutionProfile(state, job, runs.build, 'build', expectedPolicy)
    && trustedExecutionProfile(state, job, runs.verify, 'verify', expectedPolicy)
    && trustedExecutionProfile(state, job, runs.review, 'review', expectedPolicy)
    && trustedExecutionProfile(state, job, runs.handoff, 'handoff', expectedPolicy);
  if (!executionsMatch)
    return { trusted: false, reason: 'Protected phase execution provenance is missing, unknown or inconsistent; trusted PR publication is unavailable.' };
  if (candidate.synthetic !== false || checks.synthetic !== false || review.synthetic !== false)
    return { trusted: false, reason: 'Synthetic or unknown build, check or review evidence cannot authorize trusted PR publication.' };
  return { trusted: true };
}

function acceptanceSummary(job, state, config, sourceAdmission) {
  const handoff = job.runs?.at(-1);
  if (job.workflow?.name !== 'software' || job.state !== 'succeeded'
    || handoff?.command !== 'handoff' || handoff.state !== 'succeeded') return { state: 'not_ready' };

  let accepted, candidate, checks, review;
  try {
    const folder = join(state, 'jobs', job.id);
    accepted = readPrivateJson(join(folder, 'accepted.json'));
    candidate = readPrivateJson(join(folder, 'candidate.json'));
    checks = readPrivateJson(join(folder, 'checks.json'));
    review = readPrivateJson(join(folder, 'review.json'));
  } catch {
    return { state: 'unverified', reason: 'Bound candidate, check, review and approval evidence is missing or unsafe; publication is unavailable.' };
  }

  // Older accepted jobs recorded a head only. They must not appear as a
  // publishable candidate without the base/tree, patch digest and phase links
  // that the current handoff binds.
  if (!SHA1.test(accepted.base || '') || !SHA1.test(accepted.head || '') || !SHA1.test(accepted.tree || '')
    || !/^[a-f0-9]{64}$/.test(accepted.patch_sha256 || '')
    || !accepted.build_run_id || !accepted.checks_run_id || !accepted.review_run_id || !accepted.handoff_run_id) {
    return { state: 'legacy_unverified', reason: 'This legacy acceptance does not bind the candidate, checks, review and approval required for PR delivery.' };
  }

  let expectedPolicy;
  try { expectedPolicy = digest(JSON.stringify(effectiveExecutionConfig(config, job.model, join(state, 'model.env')))); }
  catch { return { state: 'blocked', reason: 'Trusted inference configuration is invalid or ambiguous; publication is unavailable.' }; }
  const byID = id => job.runs.find(run => run.id === id);
  const buildRun = byID(accepted.build_run_id), checkRun = byID(accepted.checks_run_id), reviewRun = byID(accepted.review_run_id);
  const handoffRun = byID(accepted.handoff_run_id);
  let browserEvidenceCurrent = true;
  if (config.webVerification?.enabled) {
    try { assertCurrentWebEvidence(config.webVerification, checks.web_verification,
      { job: job.id, attempt: checkRun?.id, meta: candidate, policyHash: expectedPolicy }); }
    catch { browserEvidenceCurrent = false; }
  }
  const phaseEvidence = trustedPhaseEvidence(state, job, expectedPolicy,
    { build: buildRun, verify: checkRun, review: reviewRun, handoff: handoffRun }, candidate, checks, review);
  if (!phaseEvidence.trusted) return { state: 'blocked', reason: phaseEvidence.reason };
  const validRun = (run, command) => run?.command === command && run.state === 'succeeded' && run.outcome === 'complete'
    && run.execution?.runtimeVersion === VERSION && run.execution?.policyHash === expectedPolicy;
  const bound = handoff.id === accepted.handoff_run_id && validRun(buildRun, 'build')
    && validRun(checkRun, 'verify') && validRun(reviewRun, 'review') && validRun(handoff, 'handoff')
    && job.source_admission?.status === 'retained' && accepted.head !== accepted.base && candidate.parent === accepted.base
    && candidate.build_run_id === buildRun.id && candidate.build_policy_hash === expectedPolicy
    && candidate.base === accepted.base && candidate.head === accepted.head && candidate.tree === accepted.tree
    && accepted.base === job.source_admission?.resolved_sha && accepted.policyHash === expectedPolicy
    && accepted.checks_run_id === checkRun.id && accepted.review_run_id === reviewRun.id
    && checks.run_id === checkRun.id && checks.passed === true && checks.head === accepted.head
    && checks.tree === accepted.tree && checks.policyHash === expectedPolicy && checks.command === config.check && browserEvidenceCurrent
    && review.run_id === reviewRun.id && review.verdict === 'pass' && review.head === accepted.head
    && review.tree === accepted.tree && review.policyHash === expectedPolicy && reviewRun.review_verdict === 'pass';
  if (!bound) return { state: 'blocked', reason: 'Candidate, checks, review or approval evidence is stale or does not match the current Factory policy.' };
  try {
    const retained = sourceAdmission?.validate(job.id, job.source_admission);
    if (!retained) throw new Error('The retained admission-time source is unavailable.');
    const patch = candidateTree(state, job, retained.path, job.source_admission, accepted, {
      branch: branchIdentity(job, accepted), target: config.delivery?.target,
    });
    if (!patch.workflowQualification.qualified)
      return { state: 'blocked', reason: patch.workflowQualification.reason, workflow_qualification: patch.workflowQualification };
    return { state: 'ready', workflow_qualification: patch.workflowQualification };
  } catch (error) {
    return { state: 'blocked', reason: error.message || 'The accepted Git trees could not be inspected for workflow qualification.' };
  }
}

export class DeliveryService {
  constructor(queue, state, { config = () => configAt(state), sourceAdmission, provider }) {
    this.queue = queue;
    this.state = state;
    this.currentConfig = config;
    this.sourceAdmission = sourceAdmission;
    this.provider = provider;
  }

  summary(job) {
    let config;
    try { config = this.currentConfig(); } catch { config = {}; }
    const enabled = config.delivery?.provider === 'github' && this.provider?.supported === true;
    const savedDestinationMatches = !job.delivery || (enabled
      && job.delivery.provider === config.delivery.provider
      && job.delivery.repository === config.delivery.repository
      && job.delivery.target === config.delivery.target);
    const acceptance = enabled ? acceptanceSummary(job, this.state, config, this.sourceAdmission) : { state: 'not_ready' };
    const state = job.delivery?.state || (enabled
      ? acceptance.state === 'ready' ? 'ready'
        : acceptance.state === 'legacy_unverified' ? 'legacy_unverified'
          : acceptance.state === 'blocked' ? 'blocked'
            : acceptance.state === 'unverified' ? 'unverified' : 'not_started'
      : config.delivery?.provider ? 'patch_only_unsupported_provider' : 'patch_only');
    const savedDelivery = job.delivery;
    const canResumeWrites = (!savedDelivery || RESUMABLE_DELIVERY_STATES.has(savedDelivery.state))
      && acceptance.state === 'ready';
    const canReadOnlyRecover = readOnlyRecovery(savedDelivery);
    const unknownDeliveryState = Boolean(savedDelivery && !KNOWN_DELIVERY_STATES.has(savedDelivery.state));
    const deliveryActionAllowed = enabled && savedDestinationMatches && job.workflow?.name === 'software' && job.state === 'succeeded';
    const actionMode = deliveryActionAllowed
      ? canReadOnlyRecover ? 'reconcile' : canResumeWrites ? 'publish' : null
      : null;
    const collision = job.delivery?.remote_collision;
    const canAbandon = Boolean(enabled && savedDestinationMatches && job.workflow?.name === 'software'
      && job.state === 'succeeded' && job.delivery?.state === 'conflict' && job.delivery.stage === 'intent'
      && collision?.kind === 'branch' && collision.repository === job.delivery.repository
      && collision.target === job.delivery.target && collision.branch === job.delivery.branch
      && SHA1.test(collision.sha || '') && !Number.isSafeInteger(job.delivery.pull_request?.number));
    return {
      state,
      provider: job.delivery?.provider || config.delivery?.provider || null,
      repository: job.delivery?.repository || (enabled ? config.delivery.repository : null),
      target: job.delivery?.target || (enabled ? config.delivery.target : null),
      candidate_sha: job.delivery?.candidate || null,
      source_ref: job.delivery?.source_ref || null,
      source_issue: job.delivery?.issue || null,
      branch: job.delivery?.branch || null,
      accepted_base_sha: job.delivery?.base || null,
      pull_request: job.delivery?.pull_request || null,
      checks: job.delivery?.checks || null,
      identity: job.delivery?.identity || null,
      remote_collision: collision ? {
        kind: collision.kind, repository: collision.repository, target: collision.target,
        branch: collision.branch, sha: collision.sha, node_id: collision.node_id || null,
        observed_at: collision.observed_at,
      } : null,
      resolution: job.delivery?.resolution || null,
      error: job.delivery && !savedDestinationMatches
        ? 'Saved delivery belongs to a different trusted destination. Restore its original provider, repository and target to recover it.'
        : unknownDeliveryState ? UNKNOWN_DELIVERY_REASON
        : canReadOnlyRecover ? job.delivery?.error || null : acceptance.reason || job.delivery?.error || null,
      can_publish: actionMode !== null,
      action_mode: actionMode,
      workflow_qualification: acceptance.workflow_qualification || null,
      can_abandon: canAbandon,
      integration: 'separate',
      deployment: 'separate',
    };
  }

  publish(jobId, input) {
    return this.queue.exclusive(jobId, async () => {
      const job = this.queue.get(jobId), latest = job.runs.at(-1);
      if (input?.run_id !== latest?.id) throw new QueueError('Job changed; reload before publishing.');
      if (Object.hasOwn(input || {}, 'repository') || Object.hasOwn(input || {}, 'target') || Object.hasOwn(input || {}, 'branch'))
        throw new QueueError('Publication destination is operator-configured and cannot be supplied with a job action.', 400);
      const saved = job.delivery;
      if (saved?.state === 'abandoned') throw new QueueError('This local delivery was explicitly abandoned; publishing remains disabled.');
      if (saved && !KNOWN_DELIVERY_STATES.has(saved.state))
        throw new QueueError(UNKNOWN_DELIVERY_REASON);
      const config = this.currentConfig();
      if (config.delivery?.provider !== 'github' || this.provider?.supported !== true)
        throw new QueueError('Trusted GitHub delivery is not configured; the accepted patch remains available.', 409);
      const savedEvidence = saved && { accepted: { head: saved.candidate, tree: saved.tree, base: saved.base }, expectedPolicy: saved.policyHash };
      if (saved?.state === 'published') {
        const intent = this.ensureIntent(job, config, savedEvidence);
        return this.refreshSavedPull(job, intent);
      }
      if (saved?.state === 'conflict' && Number.isSafeInteger(saved.pull_request?.number)) {
        const intent = this.ensureIntent(job, config, savedEvidence, { allowConflict: true });
        return this.refreshSavedPull(job, intent);
      }
      if (pendingPullReadback(saved)) {
        const intent = this.ensureIntent(job, config, savedEvidence);
        const reconciled = await this.discoverPendingPull(job, intent);
        if (reconciled) return reconciled;
        const message = 'Saved PR creation is not yet confirmed. Retry read-only reconciliation before any new write.';
        this.persist(job, intent, { state: 'uncertain', error: message });
        throw new QueueError(message, 409);
      }
      const evidence = this.validateEvidence(job, config);
      const intent = this.ensureIntent(job, config, evidence);
      return this.resume(job, config, evidence, intent);
    });
  }

  abandonDelivery(jobId, input) {
    return this.queue.exclusive(jobId, async () => {
      const job = this.queue.get(jobId), latest = job.runs.at(-1), record = job.delivery;
      if (input?.run_id !== latest?.id) throw new QueueError('Job changed; reload before abandoning local delivery.');
      if (!input || typeof input !== 'object' || Array.isArray(input)
        || Object.keys(input).some(key => !['run_id', 'delivery_identity', 'branch_sha'].includes(key)))
        throw new QueueError('Local delivery resolution accepts only the current run and inspected identities.', 400);
      if (!record || job.workflow?.name !== 'software' || job.state !== 'succeeded'
        || record.state !== 'conflict' || record.stage !== 'intent'
        || record.remote_collision?.kind !== 'branch'
        || Number.isSafeInteger(record.pull_request?.number))
        throw new QueueError('Only a confirmed branch-only collision before provider writes can be abandoned.');

      const config = this.currentConfig(), collision = record.remote_collision;
      if (config.delivery?.provider !== 'github' || this.provider?.supported !== true
        || record.provider !== config.delivery.provider || record.repository !== config.delivery.repository
        || record.target !== config.delivery.target)
        throw new QueueError('Restore the original trusted delivery destination before resolving this collision.');
      if (input?.delivery_identity !== record.identity || input?.branch_sha !== collision.sha
        || !SHA1.test(collision.sha || ''))
        throw new QueueError('The inspected branch identity is stale or incorrect; reload status and inspect the current branch before resolving.');
      if (collision.repository !== record.repository || collision.target !== record.target
        || collision.branch !== record.branch)
        throw new QueueError('Saved collision identity does not match the original delivery intent.');

      let repositoryInfo, currentBranch, pulls;
      try {
        repositoryInfo = await this.provider.inspectRepository(record.repository);
        if (!sameRepository(repositoryInfo?.full_name, record.repository.slice('https://github.com/'.length)))
          throw new QueueError('Configured GitHub identity cannot read the exact destination repository.');
        currentBranch = await this.provider.readBranch(record.repository, record.branch);
        if (!currentBranch || !SHA1.test(currentBranch.sha || ''))
          throw new QueueError('The remote branch is missing or has an invalid identity; local delivery remains unresolved.');
        if (currentBranch.sha !== collision.sha) {
          const refreshedCollision = {
            kind: 'branch', repository: record.repository, target: record.target, branch: record.branch,
            sha: currentBranch.sha, node_id: typeof currentBranch.node_id === 'string' ? currentBranch.node_id : null,
            observed_at: new Date().toISOString(),
          };
          this.persist(job, record, { remote_collision: refreshedCollision,
            error: 'The remote branch changed since it was displayed. Inspect the refreshed branch identity before resolving.' });
          throw new QueueError('The inspected branch identity changed; review the refreshed status before resolving.');
        }
        // Search every base target so a PR on this branch cannot be silently
        // ignored simply because it was opened against another target.
        pulls = await this.provider.findPulls(record.repository, record.branch, null);
      } catch (error) {
        if (error instanceof QueueError) throw error;
        throw new QueueError('The remote branch or related pull request could not be confirmed; local delivery remains unresolved.');
      }
      if (!Array.isArray(pulls) || pulls.length !== 0)
        throw new QueueError('A pull request uses the colliding branch or its status is unknown; inspect and reconcile it before resolving local delivery.');

      const resolvedAt = new Date().toISOString();
      this.persist(job, record, {
        state: 'abandoned', stage: 'operator_resolved', error: null,
        resolution: {
          action: 'abandon_local_delivery', actor: 'operator', delivery_identity: record.identity, decided_at: resolvedAt,
          inspected: {
            provider: 'github', repository: repositoryInfo.full_name, target: record.target,
            branch: record.branch, sha: currentBranch.sha,
            node_id: typeof currentBranch.node_id === 'string' ? currentBranch.node_id : null,
            pull_requests: 0, checked_at: resolvedAt,
          },
        },
      });
      return this.summary(job);
    });
  }

  validateEvidence(job, config) {
    if (job.workflow?.name !== 'software' || job.state !== 'succeeded') throw new QueueError('Only an accepted software candidate can be published.');
    const handoff = job.runs.at(-1);
    if (handoff?.command !== 'handoff' || handoff.state !== 'succeeded') throw new QueueError('The operator handoff has not completed.');
    if (job.source_admission?.status !== 'retained' || typeof this.sourceAdmission?.validate !== 'function')
      throw new QueueError('This job has no valid admission-time source revision.');
    let expectedPolicy;
    try { expectedPolicy = digest(JSON.stringify(effectiveExecutionConfig(config, job.model, join(this.state, 'model.env')))); }
    catch { throw new QueueError('Trusted inference configuration is invalid or ambiguous; publication is blocked.'); }
    const folder = join(this.state, 'jobs', job.id);
    let accepted, candidate, checks, review;
    try {
      accepted = readPrivateJson(join(folder, 'accepted.json'));
      candidate = readPrivateJson(join(folder, 'candidate.json'));
      checks = readPrivateJson(join(folder, 'checks.json'));
      review = readPrivateJson(join(folder, 'review.json'));
    } catch { throw new QueueError('Protected candidate, check, review or approval evidence is missing or unsafe.'); }
    const byID = id => job.runs.find(run => run.id === id);
    const buildRun = byID(accepted.build_run_id), checkRun = byID(accepted.checks_run_id), reviewRun = byID(accepted.review_run_id);
    const validRun = (run, command) => run?.command === command && run.state === 'succeeded' && run.outcome === 'complete'
      && run.execution?.runtimeVersion === VERSION && run.execution?.policyHash === expectedPolicy;
    if (!validRun(buildRun, 'build') || !validRun(checkRun, 'verify') || !validRun(reviewRun, 'review') || !validRun(handoff, 'handoff'))
      throw new QueueError('Build, checks, review and approval do not match the current Factory policy.');
    const phaseEvidence = trustedPhaseEvidence(this.state, job, expectedPolicy,
      { build: buildRun, verify: checkRun, review: reviewRun, handoff }, candidate, checks, review);
    if (!phaseEvidence.trusted) throw new QueueError(phaseEvidence.reason);
    if (candidate.build_run_id !== buildRun.id || candidate.build_policy_hash !== expectedPolicy
      || accepted.handoff_run_id !== handoff.id || accepted.policyHash !== expectedPolicy
      || accepted.base !== job.source_admission.resolved_sha || candidate.base !== accepted.base
      || accepted.head !== candidate.head || accepted.tree !== candidate.tree
      || !/^[a-f0-9]{64}$/.test(accepted.patch_sha256 || '')
      || accepted.checks_run_id !== checkRun.id || accepted.review_run_id !== reviewRun.id)
      throw new QueueError('Approval does not bind the exact admitted candidate and phase evidence.');
    if (checks.run_id !== checkRun.id || checks.passed !== true || checks.head !== accepted.head || checks.tree !== accepted.tree
      || checks.policyHash !== expectedPolicy || checks.command !== config.check
      || review.run_id !== reviewRun.id || review.verdict !== 'pass' || review.head !== accepted.head || review.tree !== accepted.tree
      || review.policyHash !== expectedPolicy || reviewRun.review_verdict !== 'pass')
      throw new QueueError('Current successful checks and independent review for this candidate are required.');
    if (config.webVerification?.enabled) {
      try { assertCurrentWebEvidence(config.webVerification, checks.web_verification,
        { job: job.id, attempt: checkRun.id, meta: candidate, policyHash: expectedPolicy }); }
      catch { throw new QueueError('Required browser evidence is missing, stale or non-passing; publication is blocked.'); }
    }
    if (!SHA1.test(accepted.base || '') || !SHA1.test(accepted.head || '') || !SHA1.test(accepted.tree || '')
      || accepted.head === accepted.base || candidate.parent !== accepted.base)
      throw new QueueError('Candidate base, head or tree is invalid for trusted PR delivery.');
    let retained;
    try { retained = this.sourceAdmission.validate(job.id, job.source_admission); }
    catch { throw new QueueError('The retained admission-time source is missing or corrupt.'); }
    const currentRepository = readProjectLinks(config.repo)?.repository;
    const admittedRepository = job.source_admission.source_repository;
    if (!admittedRepository || !sameRepository(admittedRepository, config.delivery.repository)
      || !sameRepository(currentRepository, admittedRepository))
      throw new QueueError('The configured GitHub destination no longer matches the repository identity captured at admission.');
    if (resolve(config.repo) !== job.source_admission.repository_path)
      throw new QueueError('Configured source path changed since admission.');
    let patch;
    try { patch = candidateTree(this.state, job, retained.path, job.source_admission, accepted, {
      branch: branchIdentity(job, accepted), target: config.delivery?.target,
    }); }
    catch (error) { throw new QueueError(error.message || 'Protected candidate patch is invalid.'); }
    if (!patch.workflowQualification.qualified) throw new QueueError(patch.workflowQualification.reason);
    return { accepted, candidate, checks, review, expectedPolicy, patch, issue: sourceIssue(job, config.delivery.repository) };
  }

  ensureIntent(job, config, evidence, { allowConflict = false } = {}) {
    const deliveryConfig = config.delivery;
    const branch = branchIdentity(job, evidence.accepted);
    const identity = digest(JSON.stringify({ job: job.id, candidate: evidence.accepted.head, tree: evidence.accepted.tree,
      base: evidence.accepted.base, provider: deliveryConfig.provider, repository: deliveryConfig.repository, target: deliveryConfig.target }));
    if (job.delivery) {
      if (job.delivery.identity !== identity || job.delivery.provider !== 'github' || job.delivery.repository !== deliveryConfig.repository
        || job.delivery.target !== deliveryConfig.target || job.delivery.branch !== branch)
        throw new QueueError('Saved delivery intent belongs to a different candidate or destination. Restore its original trusted configuration to recover it.');
      if (job.delivery.state === 'abandoned')
        throw new QueueError('This local delivery was explicitly abandoned; publication remains disabled.');
      if (!KNOWN_DELIVERY_STATES.has(job.delivery.state))
        throw new QueueError(UNKNOWN_DELIVERY_REASON);
      if (job.delivery.state === 'conflict' && !allowConflict)
        throw new QueueError('Saved delivery intent has an unexpected remote collision. Inspect it before taking further action.');
      return job.delivery;
    }
    const record = {
      version: 1, identity, provider: 'github', repository: deliveryConfig.repository, target: deliveryConfig.target,
      source_ref: job.source_admission.requested_ref, source_sha: job.source_admission.resolved_sha,
      base: evidence.accepted.base, candidate: evidence.accepted.head, tree: evidence.accepted.tree,
      patch_sha256: evidence.accepted.patch_sha256, policyHash: evidence.expectedPolicy,
      branch, state: 'intent', stage: 'intent', created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      issue: evidence.issue,
    };
    job.delivery = record;
    this.queue.save(job); // Durable intent precedes every GitHub write.
    return record;
  }

  persist(job, record, update) {
    Object.assign(record, update, { updated_at: new Date().toISOString() });
    job.delivery = record;
    this.queue.save(job);
  }

  async discoverPendingPull(job, record) {
    let pulls;
    try {
      const repoInfo = await this.provider.inspectRepository(record.repository);
      if (!sameRepository(repoInfo.full_name, record.repository.slice('https://github.com/'.length)))
        throw new QueueError('Configured GitHub identity cannot read the exact destination repository.');
      pulls = await this.provider.findPulls(record.repository, record.branch, record.target);
    } catch (error) {
      const message = error instanceof QueueError ? error.message : 'GitHub could not reconcile the saved PR creation checkpoint; retry readback before any new write.';
      this.persist(job, record, { state: 'uncertain', error: message });
      if (error instanceof QueueError) throw error;
      throw new QueueError(message, 409);
    }
    if (pulls.length > 1) {
      const message = 'Multiple pull requests use the saved delivery branch and target; inspect them before any further write.';
      this.persist(job, record, { state: 'conflict', error: message });
      throw new QueueError(message);
    }
    if (!pulls.length) return null;
    const receipt = remotePullReceipt(pulls[0], record.repository, record.target, record.branch);
    if (!receipt) {
      const message = 'A pull request uses the saved delivery branch but its repository, target or URL could not be safely reconciled.';
      this.persist(job, record, { state: 'conflict', error: message });
      throw new QueueError(message);
    }
    this.persist(job, record, { state: 'publishing', stage: 'pull_request_found', pull_request: receipt });
    return this.refreshSavedPull(job, record);
  }

  async refreshSavedPull(job, record) {
    const priorState = record.state;
    const previouslyPublished = priorState === 'published';
    const { repository, target, branch } = record;
    const receipt = record.pull_request;
    try {
      if (!Number.isSafeInteger(receipt?.number) || receipt.number < 1)
        throw new QueueError('Saved delivery has no PR identity to refresh.');
      if (!sameRepository(receipt.repository, repository.slice('https://github.com/'.length))
        || receipt.target !== target || receipt.branch !== branch
        || receipt.url !== `https://github.com/${receipt.repository}/pull/${receipt.number}`)
        throw new QueueError('Saved pull request identity differs from its original repository, target, branch or URL.');
      const repoInfo = await this.provider.inspectRepository(repository);
      if (!sameRepository(repoInfo.full_name, repository.slice('https://github.com/'.length)))
        throw new QueueError('Configured GitHub identity cannot read the exact destination repository.');
      if (!previouslyPublished) {
        const branchNow = await this.provider.readBranch(repository, branch);
        if (!branchNow) throw new QueueError('Saved delivery branch is missing; readback will not recreate it.');
        if (branchNow.sha !== record.final_sha)
          throw new QueueError('The delivery branch changed unexpectedly; it was preserved and will not be overwritten.');
        const pulls = await this.provider.findPulls(repository, branch, target);
        if (!pulls.length) throw new QueueError('Saved pull request is missing; readback will not create another PR.');
        if (pulls.length !== 1 || pulls[0]?.number !== receipt.number)
          throw new QueueError('The saved PR no longer uniquely matches its branch and target.');
      }
      const pull = await this.provider.readPull(repository, receipt.number);
      const ownerName = repository.slice('https://github.com/'.length);
      if (pull?.number !== receipt.number || (receipt.id != null && pull.id !== receipt.id)
        || (receipt.node_id != null && pull.node_id !== receipt.node_id)
        || !sameRepository(pull.base?.repo?.full_name, ownerName) || !sameRepository(pull.head?.repo?.full_name, ownerName)
        || pull.base?.ref !== target || pull.head?.ref !== branch || pull.head?.sha !== record.final_sha
        || (receipt.head_sha != null && receipt.head_sha !== record.final_sha)
        || (receipt.tree != null && receipt.tree !== record.tree)
        || pull.html_url !== `https://github.com/${pull.base.repo.full_name}/pull/${pull.number}`
        || !SHA1.test(pull.base?.sha || '')
        || !['open', 'closed'].includes(pull.state)
        || (pull.state === 'open' && pull.merged === true)
        || (pull.merged === true && pull.state !== 'closed'))
        throw new QueueError('A changed pull request differs from the saved repository, target, branch or accepted candidate; it was preserved.');

      if (!previouslyPublished) {
        if (pull.state !== 'open' || pull.draft !== true || pull.merged === true)
          throw new QueueError('First publication requires the exact pull request to remain open and draft; it was preserved.');
        const targetBefore = await this.provider.readTarget(repository, target);
        if (targetBefore.sha !== pull.base.sha)
          throw new QueueError('PR target changed while first-publication readback was starting; retry the read-only refresh.');
      } else if (pull.state === 'open') {
        const branchNow = await this.provider.readBranch(repository, branch);
        if (!branchNow || branchNow.sha !== record.final_sha)
          throw new QueueError('The open PR branch changed unexpectedly; its saved publication was preserved.');
      }
      const finalCommit = await this.provider.readCommit(repository, record.final_sha);
      if (!finalCommit || finalCommit.sha !== record.final_sha || finalCommit.tree !== record.tree
        || finalCommit.parents.length !== 1 || finalCommit.parents[0] !== record.base)
        throw new QueueError('PR head no longer reads back as the accepted candidate commit and tree.');

      if (previouslyPublished) {
        let accepted, candidate;
        try {
          const folder = join(this.state, 'jobs', job.id);
          accepted = readPrivateJson(join(folder, 'accepted.json'));
          candidate = readPrivateJson(join(folder, 'candidate.json'));
        } catch {
          throw new QueueError('Original accepted evidence is missing or unsafe; the saved publication was preserved.');
        }
        if (accepted.base !== record.base || accepted.head !== record.candidate || accepted.tree !== record.tree
          || accepted.patch_sha256 !== record.patch_sha256 || accepted.policyHash !== record.policyHash
          || candidate.base !== accepted.base || candidate.head !== accepted.head || candidate.tree !== accepted.tree
          || candidate.parent !== accepted.base || candidate.build_policy_hash !== accepted.policyHash)
          throw new QueueError('Saved publication no longer matches its immutable accepted candidate, tree or parent.');
      }

      const checks = await this.provider.readChecks(repository, record.final_sha, receipt.number);
      const afterChecks = await this.provider.readPull(repository, receipt.number);
      if (afterChecks?.number !== receipt.number || (receipt.id != null && afterChecks.id !== receipt.id)
        || (receipt.node_id != null && afterChecks.node_id !== receipt.node_id)
        || !sameRepository(afterChecks.base?.repo?.full_name, ownerName) || !sameRepository(afterChecks.head?.repo?.full_name, ownerName)
        || afterChecks.base.ref !== target || !SHA1.test(afterChecks.base.sha || '')
        || afterChecks.head.ref !== branch || afterChecks.head.sha !== record.final_sha
        || afterChecks.html_url !== `https://github.com/${afterChecks.base.repo.full_name}/pull/${afterChecks.number}`
        || !['open', 'closed'].includes(afterChecks.state)
        || (afterChecks.state === 'open' && afterChecks.merged === true)
        || (afterChecks.merged === true && afterChecks.state !== 'closed'))
        throw new QueueError('PR repository, target, branch or accepted head changed while its checks were being refreshed.');
      if (!previouslyPublished && (afterChecks.state !== 'open' || afterChecks.draft !== true || afterChecks.merged === true))
        throw new QueueError('First publication changed from an open draft while its checks were being refreshed.');
      if (!previouslyPublished) {
        const targetAfter = await this.provider.readTarget(repository, target);
        if (targetAfter.sha !== afterChecks.base.sha)
          throw new QueueError('PR target or head changed while first-publication checks were being refreshed.');
      }

      const updatedReceipt = {
        id: afterChecks.id || null, node_id: afterChecks.node_id || null,
        number: afterChecks.number, url: afterChecks.html_url, state: afterChecks.state, draft: afterChecks.draft === true,
        merged: afterChecks.merged === true,
        repository: afterChecks.base.repo.full_name, branch: afterChecks.head.ref, target: afterChecks.base.ref,
        base_sha: afterChecks.base.sha, head_sha: afterChecks.head.sha, tree: finalCommit.tree,
      };
      const baseAdvanced = afterChecks.base.sha !== record.base;
      const state = baseAdvanced && !previouslyPublished ? 'conflict' : 'published';
      const error = baseAdvanced
        ? 'The PR base differs from the immutable accepted base. This readback preserves the original acceptance and does not accept a changed candidate.'
        : null;
      this.persist(job, record, { state, stage: 'readback_complete', pull_request: updatedReceipt, checks, error });
      return this.summary(job);
    } catch (error) {
      const message = error instanceof QueueError ? error.message : 'GitHub PR readback is uncertain; the saved delivery remains visible.';
      const state = previouslyPublished ? (error instanceof QueueError ? 'conflict' : 'published')
        : Number.isSafeInteger(record.pull_request?.number) ? 'conflict'
          : priorState === 'blocked' ? 'blocked' : 'uncertain';
      this.persist(job, record, { state, error: message });
      if (error instanceof QueueError) throw error;
      throw new QueueError(message, 409);
    }
  }

  async resume(job, config, evidence, record) {
    const { repository, target, branch } = record;
    try {
      const repoInfo = await this.provider.inspectRepository(repository);
      if (!sameRepository(repoInfo.full_name, repository.slice('https://github.com/'.length)))
        throw new QueueError('Configured GitHub identity cannot read the exact destination repository.');
      if (repoInfo.archived || !repoInfo.push)
        throw new QueueError('Configured GitHub identity cannot write the exact destination repository.');

      const remoteTarget = await this.provider.readTarget(repository, target);
      if (remoteTarget.sha !== record.base) throw new QueueError('Configured PR target moved from the accepted base; fresh build, checks and review are required.');
      const remoteBaseCommit = await this.provider.readCommit(repository, remoteTarget.sha);
      if (remoteBaseCommit.sha !== record.base || remoteBaseCommit.tree !== evidence.patch.base_tree)
        throw new QueueError('GitHub target tree differs from the retained accepted base.');

      const existingBranch = await this.provider.readBranch(repository, branch);
      if (existingBranch && record.final_sha && existingBranch.sha !== record.final_sha)
        throw new BranchCollisionError(existingBranch, 'The delivery branch changed unexpectedly; it was preserved and will not be overwritten.');
      if (existingBranch && !record.final_sha)
        throw new BranchCollisionError(existingBranch, 'An unrelated branch already uses the reserved delivery name; it was preserved.');

      if (!record.tree_sha) {
        this.persist(job, record, { state: 'publishing', stage: 'creating_blobs' });
        const apiEntries = [];
        const blobShas = Object.assign(Object.create(null), record.blob_shas || {});
        for (const entry of evidence.patch.entries) {
          if (!Object.hasOwn(entry, 'content')) {
            apiEntries.push(entry); continue;
          }
          const expected = createHash('sha1').update(`blob ${entry.content.length}\0`).update(entry.content).digest('hex');
          let blob = blobShas[entry.path];
          if (blob && blob !== expected) throw new QueueError('Saved delivery blob evidence does not match the accepted tree.');
          if (!blob) {
            blob = await this.provider.createBlob(repository, entry.content);
            if (blob !== expected) throw new QueueError('GitHub returned a blob that differs from the accepted candidate.');
            blobShas[entry.path] = blob;
            this.persist(job, record, { state: 'publishing', stage: 'creating_blobs', blob_shas: blobShas });
          }
          apiEntries.push({ path: entry.path, mode: entry.mode, type: 'blob', sha: blob });
        }
        this.persist(job, record, { state: 'publishing', stage: 'creating_tree', blob_shas: blobShas });
        const treeSha = await this.provider.createTree(repository, evidence.patch.base_tree, apiEntries);
        if (treeSha !== record.tree) throw new QueueError('GitHub candidate tree does not match the approved tree.');
        this.persist(job, record, { state: 'publishing', stage: 'creating_commit', tree_sha: treeSha, blob_shas: blobShas });
      }

      const message = `Factory candidate ${job.id} ${record.candidate}\n`;
      const acceptedAt = utcGitDate(evidence.accepted.acceptedAt).iso;
      const commitInput = {
        message, tree: record.tree_sha, parents: [record.base],
        author: { name: 'Software and Defence Factory', email: 'factory@localhost', date: acceptedAt },
        committer: { name: 'Software and Defence Factory', email: 'factory@localhost', date: acceptedAt },
      };
      const expectedCommit = commitObjectSha(commitInput);
      if (record.final_sha && record.final_sha !== expectedCommit) throw new QueueError('Saved delivery commit identity differs from the accepted candidate.');
      if (!record.final_sha) this.persist(job, record, { state: 'publishing', stage: 'reconciling_commit', commit_message: message, final_sha: expectedCommit, final_tree: record.tree });
      let commit = await this.provider.readCommit(repository, expectedCommit);
      if (!commit) {
        const created = await this.provider.createCommit(repository, commitInput);
        if (created !== expectedCommit) throw new QueueError('GitHub candidate commit differs from the deterministic delivery identity.');
        this.persist(job, record, { state: 'publishing', stage: 'checking_commit', final_sha: expectedCommit, final_tree: record.tree });
        commit = await this.provider.readCommit(repository, expectedCommit);
      }
      if (!commit || commit.sha !== record.final_sha || commit.tree !== record.tree || commit.parents.length !== 1 || commit.parents[0] !== record.base)
        throw new QueueError('GitHub candidate commit did not read back with the approved base and tree.');

      const targetBeforeBranch = await this.provider.readTarget(repository, target);
      if (targetBeforeBranch.sha !== record.base) throw new QueueError('PR target moved before branch creation; fresh build, checks and review are required.');

      // Reconcile before every branch write. GitHub's create-ref endpoint is
      // create-only; an unexpected existing branch is never force-updated.
      const branchNow = await this.provider.readBranch(repository, branch);
      if (branchNow && branchNow.sha !== record.final_sha)
        throw new BranchCollisionError(branchNow, 'The delivery branch changed unexpectedly; it was preserved and will not be overwritten.');
      if (!branchNow) {
        this.persist(job, record, { state: 'publishing', stage: 'creating_branch' });
        try { await this.provider.createBranch(repository, branch, record.final_sha); }
        catch {
          const reconciled = await this.provider.readBranch(repository, branch);
          if (!reconciled || reconciled.sha !== record.final_sha) throw new QueueError('Branch creation is uncertain. Recovery read the branch; no duplicate branch write was attempted.');
        }
      }
      const confirmedBranch = await this.provider.readBranch(repository, branch);
      if (!confirmedBranch || confirmedBranch.sha !== record.final_sha)
        throw new QueueError('GitHub branch readback differs from the approved candidate.');
      this.persist(job, record, { state: 'publishing', stage: 'branch_confirmed', branch_node_id: confirmedBranch.node_id || record.branch_node_id || null, final_tree: record.tree });

      const targetBeforePR = await this.provider.readTarget(repository, target);
      if (targetBeforePR.sha !== record.base) throw new QueueError('PR target moved after branch creation; the branch was preserved and no pull request was opened.');
      let pulls = await this.provider.findPulls(repository, branch, target);
      if (pulls.length > 1) throw new QueueError('Multiple pull requests use this delivery branch; inspect the saved delivery record before recovery.');
      let pull = pulls[0];
      if (pull) {
        if (!sameRepository(pull.base?.repo?.full_name, repository.slice('https://github.com/'.length))
          || !sameRepository(pull.head?.repo?.full_name, repository.slice('https://github.com/'.length))
          || pull.base?.ref !== target || pull.head?.ref !== branch || pull.head?.sha !== record.final_sha)
          throw new QueueError('An unrelated or changed pull request uses the delivery branch; it was preserved.');
      } else {
        const sourceTitle = String(job.task?.title || 'Accepted candidate').replace(/[\r\n\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 160) || 'Accepted candidate';
        const title = `Factory: ${sourceTitle}`.slice(0, 240);
        const issueLine = record.issue ? `Source issue: ${record.issue.url}\n` : '';
        const body = `${issueLine}Factory job: ${job.id}\nCandidate: ${record.candidate}\nCandidate tree: ${record.tree}\nAccepted base: ${record.base}\nSource ref at admission: ${record.source_ref}\n\nThis draft PR records delivery only. It does not merge, release, deploy or claim integration.`;
        this.persist(job, record, { state: 'publishing', stage: 'creating_pull_request' });
        try { pull = await this.provider.createPull(repository, { title, body, head: `${repository.slice('https://github.com/'.length).split('/')[0]}:${branch}`, base: target, draft: true }); }
        catch {
          pulls = await this.provider.findPulls(repository, branch, target);
          if (pulls.length !== 1) throw new QueueError('Pull request creation is uncertain. Recovery searched the exact branch and target; no duplicate pull request was created.');
          pull = pulls[0];
        }
      }
      if (!Number.isSafeInteger(pull?.number) || pull.number < 1) throw new QueueError('GitHub did not return a valid pull request identity.');
      const initialReceipt = remotePullReceipt(pull, repository, target, branch);
      if (initialReceipt)
        this.persist(job, record, { state: 'publishing', stage: 'pull_request_found', pull_request: initialReceipt });
      const readback = await this.provider.readPull(repository, pull.number);
      const readbackReceipt = remotePullReceipt(readback, repository, target, branch);
      if (readbackReceipt)
        this.persist(job, record, { state: 'publishing', stage: 'pull_request_found', pull_request: readbackReceipt });
      const headSha = readback?.head?.sha;
      if (readback?.number !== pull.number || readback.state !== 'open' || readback.draft !== true
        || !sameRepository(readback?.base?.repo?.full_name, repository.slice('https://github.com/'.length))
        || !sameRepository(readback?.head?.repo?.full_name, repository.slice('https://github.com/'.length))
        || readback.base.ref !== target || readback.base.sha !== record.base
        || readback.head.ref !== branch || headSha !== record.final_sha)
        throw new QueueError('Pull request readback differs from the configured repository, target, draft state or candidate.');
      if (readback.html_url !== `https://github.com/${readback.base.repo.full_name}/pull/${readback.number}`)
        throw new QueueError('GitHub pull request URL does not match its repository identity.');
      const finalCommit = await this.provider.readCommit(repository, headSha);
      if (finalCommit.tree !== record.tree || finalCommit.parents.length !== 1 || finalCommit.parents[0] !== record.base)
        throw new QueueError('Pull request head tree or base parent differs from the approved candidate.');
      const checks = await this.provider.readChecks(repository, headSha, pull.number);
      const afterChecks = await this.provider.readPull(repository, pull.number);
      if (afterChecks?.number !== pull.number || afterChecks?.state !== 'open' || afterChecks?.draft !== true
        || afterChecks?.head?.sha !== headSha || afterChecks?.base?.sha !== record.base
        || afterChecks?.base?.ref !== target || afterChecks?.head?.ref !== branch)
        throw new QueueError('Pull request head or base changed while its checks were being read.');
      const receipt = {
        id: afterChecks.id || null, node_id: afterChecks.node_id || null,
        number: afterChecks.number, url: afterChecks.html_url, state: afterChecks.state, draft: afterChecks.draft === true,
        repository: afterChecks.base.repo.full_name, branch: afterChecks.head.ref, target: afterChecks.base.ref,
        base_sha: afterChecks.base.sha, head_sha: headSha, tree: finalCommit.tree,
      };
      this.persist(job, record, { state: 'published', stage: 'readback_complete', pull_request: receipt, checks, published_at: record.published_at || new Date().toISOString(), error: null });
      return this.summary(job);
    } catch (error) {
      const message = error instanceof QueueError ? error.message : 'GitHub delivery is uncertain. Inspect the saved intent and reconcile before retrying.';
      const state = error instanceof QueueError && /collision|unrelated|changed unexpectedly|multiple pull|readback differs|changed while its checks|does not match the approved|differs from the deterministic/i.test(message) ? 'conflict'
        : error instanceof QueueError && /moved|stale|current Factory policy|retained admission|evidence|source path changed/i.test(message) ? 'blocked' : 'uncertain';
      const remoteCollision = error instanceof BranchCollisionError ? {
        kind: 'branch', repository: record.repository, target: record.target, branch: record.branch,
        sha: SHA1.test(error.branch?.sha || '') ? error.branch.sha : null,
        node_id: typeof error.branch?.node_id === 'string' ? error.branch.node_id : null,
        observed_at: new Date().toISOString(),
      } : undefined;
      this.persist(job, record, { state, error: message, ...(remoteCollision ? { remote_collision: remoteCollision } : {}) });
      if (error instanceof QueueError) throw error;
      throw new QueueError(message, 409);
    }
  }
}
