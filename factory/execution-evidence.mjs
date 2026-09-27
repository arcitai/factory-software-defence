import { assertCurrentWebEvidence } from './web-verification.mjs';

export function assertCurrentHandoffEvidence(meta, checks, review, policyHash, config = {}, job) {
  if (review.verdict !== 'pass' || review.head !== meta.head || review.tree !== meta.tree
    || !checks.passed || checks.head !== meta.head || checks.tree !== meta.tree
    || checks.policyHash !== policyHash || review.policyHash !== policyHash
    || meta.build_policy_hash !== policyHash)
    throw new Error('Build/checks/review do not cover candidate and current policy');
  if (config.webVerification?.enabled) assertCurrentWebEvidence(config.webVerification, checks.web_verification,
    { job, attempt: checks.run_id, meta, policyHash });
}
