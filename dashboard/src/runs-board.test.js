import test from 'node:test';
import assert from 'node:assert/strict';
import { boardColumnForState, filterJobs, groupJobsByBoardColumn, jobCounts, searchJobs, statusGroups } from './runs-board.js';

const jobs=['not_started','running','needs_review','failed','interrupted','unknown'].map((state,index)=>({
  id:`job_${index}`,state,task:{title:`Task ${index}`,source_url:`https://github.com/example/project/issues/${index+1}`},workflow:{name:'software'}
}));

test('list and board share a complete native state partition',()=>{
  const columns=groupJobsByBoardColumn(jobs);
  assert.deepEqual(Object.keys(columns),statusGroups.map(group=>group.id));
  assert.equal(Object.values(columns).flat().length,jobs.length);
  assert.equal(boardColumnForState('unknown'),'needs_attention');
  assert.equal(boardColumnForState('needs_review'),'needs_review');
  assert.deepEqual(jobCounts(jobs),{all:6,notStarted:1,running:1,needsAttention:3,failed:1,interrupted:1,unknown:1,needsReview:1,other:0});
});

test('filters and search keep failure, interruption, unknown and review separate',()=>{
  assert.deepEqual(filterJobs(jobs,'needs_attention').map(job=>job.state),['failed','interrupted','unknown']);
  assert.deepEqual(filterJobs(jobs,'needs_review').map(job=>job.state),['needs_review']);
  assert.deepEqual(searchJobs(jobs,'Task 4').map(job=>job.state),['interrupted']);
});
