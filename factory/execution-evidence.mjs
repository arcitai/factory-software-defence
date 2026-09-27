export function assertCurrentHandoffEvidence(meta, checks, review, policyHash) {
  if (review.verdict !== 'pass' || review.head !== meta.head || review.tree !== meta.tree
    || !checks.passed || checks.head !== meta.head || checks.tree !== meta.tree
    || checks.policyHash !== policyHash || review.policyHash !== policyHash
    || meta.build_policy_hash !== policyHash)
    throw new Error('Build/checks/review do not cover candidate and current policy');
}
