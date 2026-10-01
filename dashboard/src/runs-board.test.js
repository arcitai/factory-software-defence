import test from 'node:test';
import assert from 'node:assert/strict';
import { boardColumns, filterJobs, filterPhases, groupJobsByBoardColumn, jobCounts, phaseCounts, searchJobs, statusGroups } from './runs-board.js';

const jobs = [
  ['not_started', 'unresolved'], ['running', 'implementing'], ['needs_review', 'needs_review'],
  ['failed', 'needs_attention'], ['interrupted', 'closed'], ['unknown', 'done'],
].map(([state, phase], index) => ({
  id: `job_${index}`, state, workflow: { name: 'software' },
  task: { title: `Task ${index}`, source_url: `https://github.com/example/project/issues/${index + 1}` },
  work: { phase: { id: phase, label: phase }, source_status: phase === 'unresolved' ? 'not_loaded' : 'loaded', issue: { labels: [], assignees: [] } },
}));

test('the phase board partitions loaded and unresolved source records', () => {
  const columns = groupJobsByBoardColumn(jobs);
  assert.deepEqual(Object.keys(columns), boardColumns.map(stage => stage.id));
  assert.equal(Object.values(columns).flat().length, jobs.length);
  assert.deepEqual(phaseCounts(jobs), { triage: 0, ready_to_spec: 0, creating_spec: 0, ready_to_implement: 0, implementing: 1, needs_review: 1, needs_attention: 1, done: 1, closed: 1, unresolved: 1 });
});

test('repository phase and native outcome filters remain separate and intersect', () => {
  assert.deepEqual(filterPhases(jobs, 'needs_review').map(job => job.state), ['needs_review']);
  assert.deepEqual(filterJobs(jobs, 'needs_attention').map(job => job.state), ['failed', 'interrupted', 'unknown']);
  assert.deepEqual(filterPhases(filterJobs(jobs, ['running', 'needs_review']), ['implementing', 'needs_review']).map(job => job.state), ['running', 'needs_review']);
  assert.deepEqual(filterPhases(jobs, []), jobs);
  assert.deepEqual(filterJobs(jobs, statusGroups.map(group => group.id)), jobs);
});

test('native outcome counts derive from the catalog and search includes source phase', () => {
  assert.deepEqual(jobCounts(jobs), {
    all: 6, other: 0, not_started: 1, running: 1, needs_review: 1, failed: 1, interrupted: 1, unknown: 1,
    in_progress: 1, needs_attention: 3,
  });
  assert.deepEqual(searchJobs(jobs, 'implementing').map(job => job.state), ['running']);
  assert.deepEqual(searchJobs(jobs, 'not_loaded').map(job => job.state), ['not_started']);
});
