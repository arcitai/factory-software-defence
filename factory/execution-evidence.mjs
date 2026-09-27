import { installedRoleRecord, hasRoleOverrides } from './role-definition.mjs';
import { lstatSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { configAt, digest } from './lib.mjs';
import { effectiveExecutionConfig, isSupportedExecutionProfile, assertFrozenExecution } from './execution-profile.mjs';
import { assertCurrentWebArtifacts, assertCurrentWebEvidence } from './web-verification.mjs';

export function assertCurrentHandoffEvidence(meta, checks, review, policyHash, config = {}, job) {
  if (review.verdict !== 'pass' || review.head !== meta.head || review.tree !== meta.tree
    || !checks.passed || checks.head !== meta.head || checks.tree !== meta.tree
    || checks.policyHash !== policyHash || review.policyHash !== policyHash
    || meta.build_policy_hash !== policyHash)
    throw new Error('Build/checks/review do not cover candidate and current policy');
  if (config.webVerification?.enabled) assertCurrentWebEvidence(config.webVerification, checks.web_verification,
    { job, attempt: checks.run_id, meta, policyHash });
}

export function readPrivateJson(path) {
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0 || stat.size > 1024 * 1024)
    throw new Error('Protected execution evidence is missing or unsafe.');
  return JSON.parse(readFileSync(path, 'utf8'));
}

export function assertPrivateDirectory(path) {
  const stat = lstatSync(path);
  if (!stat.isDirectory() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0)
    throw new Error('Protected execution directory is missing or unsafe.');
}

export function trustedExecutionProfile(state, job, run, phase, expectedPolicy) {
  if (!run || !/^run_[a-z0-9]+$/.test(run.id || '')) return false;
  try {
    const folder = join(state, 'jobs', job.id);
    for (const path of [join(state, 'jobs'), folder, join(folder, 'artifacts'), join(folder, 'artifacts', run.id)])
      assertPrivateDirectory(path);
    const profile = readPrivateJson(join(folder, 'artifacts', run.id, 'execution.json'));
    if (profile.version === 1 && hasRoleOverrides(installedRoleRecord(state).definition)) return false;
    if (profile.version === 2) {
      const frozen = readPrivateJson(join(folder, run.id, 'execution-config.json'));
      if (!frozen.roleDefinition || !frozen.resolvedRoleProfiles || digest(JSON.stringify(frozen)) !== expectedPolicy) return false;
      assertFrozenExecution(frozen, profile, phase);
    }
    const agentPhase = phase === 'build' || phase === 'review';
    const executorMatches = agentPhase
      ? ['codex', 'pi'].includes(profile.executor)
        && ['explicit', 'provider_default'].includes(profile.modelSelection)
        && (profile.modelSelection === 'explicit' ? typeof profile.requestedModel === 'string' : profile.requestedModel === null)
      : profile.executor === 'deterministic' && profile.modelSelection === 'not_applicable' && profile.requestedModel === null;
    return isSupportedExecutionProfile(profile) && profile.phase === phase && executorMatches
      && profile.policyHash === expectedPolicy
      && isDeepStrictEqual(run.execution, profile);
  } catch { return false; }
}

export function currentExecutionPolicy(state, job) {
  const config = effectiveExecutionConfig(configAt(state), job.model, join(state, 'model.env'));
  return { config, policyHash: digest(JSON.stringify(config)) };
}

// Only the current, completed review cycle may supply a continuation. Old writers
// can supply it only with the same protected profiles, full checks and bindings.
export function currentReviewedCandidate(state, job) {
  const latest = job.runs.at(-1);
  const reviewRun = job.state === 'awaiting_approval' && latest?.command === 'handoff'
    ? job.runs.find(run => run.id === latest.reviewed_run_id) : latest;
  if (job.workflow?.name !== 'software' || !['failed', 'awaiting_approval'].includes(job.state)
    || reviewRun?.command !== 'review' || !['failed', 'succeeded'].includes(reviewRun.state))
    throw new Error('Only this job’s current completed review can supply a checkpoint.');
  const folder = join(state, 'jobs', job.id);
  const meta = readPrivateJson(join(folder, 'candidate.json'));
  const checks = readPrivateJson(join(folder, 'checks.json'));
  const review = readPrivateJson(join(folder, 'review.json'));
  const { config, policyHash } = currentExecutionPolicy(state, job);
  const source = job.source_admission;
  const buildRun = job.runs.find(run => run.id === meta.build_run_id);
  const checkRun = job.runs.find(run => run.id === checks.run_id);
  const cycle = job.runs.slice(0, job.runs.indexOf(reviewRun));
  if (cycle.findLast(run => run.command === 'build')?.id !== buildRun?.id
    || cycle.findLast(run => run.command === 'verify')?.id !== checkRun?.id
    || job.runs.indexOf(buildRun) >= job.runs.indexOf(checkRun))
    throw new Error('Checkpoint is not from the current reviewed Build/Verify cycle.');
  for (const [run, phase] of [[buildRun, 'build'], [checkRun, 'verify'], [reviewRun, 'review']]) {
    if (!trustedExecutionProfile(state, job, run, phase, policyHash)
      || (phase !== 'review' && (run?.state !== 'succeeded' || run.outcome !== 'complete')))
      throw new Error('Checkpoint execution provenance or current policy is incompatible; start fresh from admitted source.');
  }
  if (source?.status !== 'retained' || meta.base !== source.resolved_sha
    || meta.source_admission?.resolved_sha !== source.resolved_sha
    || meta.source_admission?.repository_identity !== source.repository_identity
    || meta.build_policy_hash !== policyHash || meta.synthetic !== false || checks.synthetic !== false || review.synthetic !== false
    || !checks.passed || checks.command !== config.check || checks.policyHash !== policyHash
    || checks.head !== meta.head || checks.tree !== meta.tree
    || review.run_id !== reviewRun.id || review.head !== meta.head || review.tree !== meta.tree
    || review.policyHash !== policyHash || !['pass', 'changes', 'blocked'].includes(review.verdict)
    || (reviewRun.review_verdict !== undefined && reviewRun.review_verdict !== review.verdict)
    || (job.state === 'failed' && (reviewRun.state !== 'failed' || !['changes', 'blocked'].includes(review.verdict)))
    || (job.state === 'awaiting_approval' && (reviewRun.state !== 'succeeded' || review.verdict !== 'pass')))
    throw new Error('Checkpoint source, checks or review is stale or incompatible; reload or start fresh from admitted source.');
  for (const [run, name, evidence] of [[buildRun, 'candidate', meta], [checkRun, 'checks', checks], [reviewRun, 'review', review]]) {
    if (!isDeepStrictEqual(readPrivateJson(join(folder, 'artifacts', run.id, `${name}.json`)), evidence))
      throw new Error('Checkpoint differs from its protected attempt evidence; preserve it for investigation.');
  }
  if (config.webVerification?.enabled) {
    assertCurrentWebEvidence(config.webVerification, checks.web_verification,
      { job: job.id, attempt: checkRun.id, meta, policyHash });
    assertCurrentWebArtifacts(config.webVerification, checks.web_verification, join(folder, 'artifacts', checkRun.id));
  }
  return { head: meta.head, tree: meta.tree, original_base: meta.base,
    build_run_id: buildRun.id, checks_run_id: checkRun.id, review_run_id: reviewRun.id,
    policy_hash: policyHash, repository_identity: source.repository_identity };
}
