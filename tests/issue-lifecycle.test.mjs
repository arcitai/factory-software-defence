import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_READINESS_LABELS, ISSUE_STAGES, NATIVE_STATES, associateIssue, backlogHistory, canonicalIssue, closureReasonLabel,
  issueReadiness, projectIssuePhase, readinessMapping, workRecords,
} from '../factory/issue-lifecycle.mjs';
import catalog from '../adlc/lifecycle.json' with { type: 'json' };
import exportedLabels from '../adlc/labels.json' with { type: 'json' };

const issue = (number, state = 'open', labels = [], state_reason = null) => ({
  number, title: `Issue ${number}`, url: `https://github.com/example/project/issues/${number}`, state, state_reason, labels,
});

test('the documented lifecycle catalog drives its label projection and preserves readiness mappings', () => {
  assert.equal(catalog.schema, 1);
  assert.deepEqual(DEFAULT_READINESS_LABELS, { triage: 'factory:triage', spec: 'factory:spec', ready: 'factory:ready', blocked: 'factory:blocked' });
  assert.deepEqual(readinessMapping(), DEFAULT_READINESS_LABELS);
  assert.deepEqual(exportedLabels, catalog.labels.map(({ name, color, description }) => ({ name, color, description })));
  assert.deepEqual(ISSUE_STAGES.map(stage => stage.id), ['triage', 'ready_to_spec', 'creating_spec', 'ready_to_implement', 'implementing', 'needs_review', 'needs_attention', 'done', 'closed', 'unresolved']);
  assert.ok(NATIVE_STATES.some(state => state.id === 'needs_review'));
  assert.equal(projectIssuePhase(issue(1, 'open', [{ name: 'factory:ready' }])).id, 'ready_to_implement');
  assert.equal(issueReadiness([{ name: 'factory:spec' }]).state, 'spec');
  assert.equal(issueReadiness([{ name: 'factory:blocked' }]).state, 'blocked');
  assert.throws(() => readinessMapping({ ...DEFAULT_READINESS_LABELS, ready: 'factory:spec' }), /distinct/);
});

test('open repository phases require one actual catalogued label and expose conflicts or missing data', () => {
  const cases = [
    [['factory:triage'], 'triage'],
    [['factory:spec'], 'ready_to_spec'],
    [['factory:creating-spec'], 'creating_spec'],
    [['factory:ready'], 'ready_to_implement'],
    [['factory:implementing'], 'implementing'],
    [['factory:review'], 'needs_review'],
    [['factory:blocked'], 'needs_attention'],
  ];
  for (const [names, expected] of cases) assert.equal(projectIssuePhase(issue(2, 'open', names.map(name => ({ name })))).id, expected);
  assert.deepEqual(projectIssuePhase(issue(3)).resolution, 'unlabeled');
  assert.deepEqual(projectIssuePhase(issue(4, 'open', [{ name: 'track:software' }])).resolution, 'no_phase_label');
  const conflict = projectIssuePhase(issue(5, 'open', [{ name: 'factory:ready' }, { name: 'factory:review' }]));
  assert.equal(conflict.id, 'unresolved');
  assert.equal(conflict.resolution, 'conflicting');
  assert.deepEqual(conflict.matched_stages, ['ready_to_implement', 'needs_review']);
  assert.equal(projectIssuePhase(issue(6, 'unknown', [{ name: 'factory:ready' }])).resolution, 'unknown_state');
  const custom = { triage: 'planning:intake', spec: 'planning:spec', ready: 'accepted-for-work', blocked: 'waiting-on-owner' };
  assert.equal(projectIssuePhase(issue(16, 'open', [{ name: 'accepted-for-work' }]), { mapping: custom }).id, 'ready_to_implement');
  const legacyReviewName = { ...DEFAULT_READINESS_LABELS, ready: 'factory:review' };
  assert.equal(issueReadiness([{ name: 'factory:review' }], legacyReviewName).state, 'ready');
  assert.equal(projectIssuePhase(issue(161, 'open', [{ name: 'factory:review' }]), { mapping: legacyReviewName }).id, 'ready_to_implement',
    'an explicit legacy readiness mapping owns its label even when the default catalog assigns that name to another phase');
  const actualConflict = projectIssuePhase(issue(162, 'open', [{ name: 'accepted-for-work' }, { name: 'factory:implementing' }]), { mapping: custom });
  assert.equal(actualConflict.resolution, 'conflicting', 'separate actual phase labels still conflict under adopted label conventions');
  assert.match(associateIssue(issue(17, 'open', [{ name: 'factory:ready' }, { name: 'factory:review' }]), []).start_block_reason, /conflicting phase labels/);
});

test('closure, reopen and stale reads stay tied to provider data without inventing completion', () => {
  assert.equal(projectIssuePhase(issue(7, 'closed', [], 'completed')).id, 'done');
  assert.equal(closureReasonLabel('completed'), 'Completed');
  assert.equal(closureReasonLabel(null), 'reason unavailable');
  assert.equal(closureReasonLabel('future_reason'), 'unrecognized reason');
  const declined = projectIssuePhase(issue(8, 'closed', [{ name: 'factory:ready' }], 'not_planned'));
  assert.equal(declined.id, 'closed');
  assert.equal(declined.label, 'Closed · Not planned');
  const noReason = projectIssuePhase(issue(9, 'closed', [{ name: 'factory:review' }], null));
  assert.equal(noReason.id, 'closed');
  assert.match(noReason.detail, /did not supply/);
  assert.equal(projectIssuePhase(issue(10, 'closed', [], 'future_reason')).id, 'closed');
  assert.match(projectIssuePhase(issue(10, 'closed', [], 'future_reason')).detail, /does not recognize/);
  assert.equal(projectIssuePhase(issue(11, 'open', [{ name: 'factory:implementing' }], 'reopened')).id, 'implementing');
  const stale = projectIssuePhase(issue(12, 'open', [{ name: 'factory:review' }]), { sourceStatus: 'stale' });
  assert.equal(stale.id, 'unresolved');
  assert.equal(stale.resolution, 'stale');
  assert.deepEqual(stale.observed_phase, { id: 'needs_review', label: 'Needs review' });
});

test('work records preserve provider phase, native outcome and off-page identity independently', () => {
  const closed = associateIssue(issue(13, 'closed', [{ name: 'factory:review' }], 'completed'), []);
  const jobs = [
    { id: 'job_running', state: 'running', workflow: { name: 'software' }, task: { title: 'Closed issue work', source_url: closed.url }, created_at: '2026-09-01T00:00:00Z' },
    { id: 'job_complete', state: 'needs_review', workflow: { name: 'software' }, task: { title: 'Unloaded issue work', source_url: 'https://github.com/example/project/issues/14' }, created_at: '2026-09-02T00:00:00Z' },
  ];
  assert.equal(backlogHistory(jobs, [issue(14)]).some(row => row.identity?.number === 14), false, 'raw provider issues count as loaded identities');
  const rows = workRecords(jobs, [closed]);
  const current = rows.find(row => row.identity?.number === 13);
  const unloaded = rows.find(row => row.identity?.number === 14);
  assert.equal(current.phase.id, 'done');
  assert.equal(current.state, 'running');
  assert.equal(current.native_state.label, 'Running');
  assert.equal(current.source_status, 'loaded');
  assert.equal(unloaded.source_status, 'not_loaded');
  assert.equal(unloaded.phase.resolution, 'not_loaded');
  assert.equal(unloaded.state, 'needs_review');
  assert.equal(unloaded.execution_id, 'job_complete');
  assert.equal(canonicalIssue(unloaded.url).number, 14);

  const stale = workRecords(jobs, [closed], { sourceStale: true }).find(row => row.identity?.number === 13);
  assert.equal(stale.source_status, 'stale');
  assert.equal(stale.phase.resolution, 'stale');
  assert.equal(stale.phase.observed_phase.id, 'done');

  const needsReview = associateIssue(issue(18, 'open', [{ name: 'factory:review' }]), [
    { id: 'job_review', state: 'needs_review', workflow: { name: 'software' }, task: { title: 'Candidate', source_url: 'https://github.com/example/project/issues/18' } },
  ]);
  assert.equal(needsReview.phase.id, 'needs_review');
  assert.equal(needsReview.latest_execution.state, 'needs_review');
  const failed = workRecords([{ id: 'job_failed', state: 'failed', task: { source_url: 'https://github.com/example/project/issues/19' } }],
    [associateIssue(issue(19, 'open', [{ name: 'factory:blocked' }]), [])])[0];
  assert.equal(failed.phase.id, 'needs_attention');
  assert.equal(failed.state, 'failed');
});
