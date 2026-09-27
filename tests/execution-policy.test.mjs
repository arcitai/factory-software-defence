import test from 'node:test';
import assert from 'node:assert/strict';
import { assertCurrentHandoffEvidence } from '../factory/execution-evidence.mjs';

function evidence(policyHash) {
  const meta = { head: 'candidate-head', tree: 'candidate-tree', build_policy_hash: policyHash };
  const checks = { passed: true, head: meta.head, tree: meta.tree, policyHash };
  const review = { verdict: 'pass', head: meta.head, tree: meta.tree, policyHash };
  return { meta, checks, review };
}

test('handoff requires passing current-policy checks and a build under the same policy', () => {
  const original = evidence('check-policy-A');
  assert.throws(() => assertCurrentHandoffEvidence(original.meta, { ...original.checks, passed: false }, original.review, 'check-policy-A'), /current policy/);

  const changedPolicy = evidence('check-policy-B');
  assert.throws(() => assertCurrentHandoffEvidence(original.meta, changedPolicy.checks, changedPolicy.review, 'check-policy-B'), /current policy/,
    'retrying only verify/review after changing the check cannot reuse the earlier build');

  const freshBuild = evidence('check-policy-B');
  assert.equal(assertCurrentHandoffEvidence(freshBuild.meta, freshBuild.checks, freshBuild.review, 'check-policy-B'), undefined,
    'a fresh build and evidence set under the current policy can be handed off');
});
