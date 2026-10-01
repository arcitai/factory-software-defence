import { ISSUE_STAGES, NATIVE_GROUPS, NATIVE_STATES, nativeState } from '../../factory/issue-lifecycle.mjs';

export const statusGroups = NATIVE_GROUPS;
export const boardColumns = ISSUE_STAGES;
const knownStates = new Set(NATIVE_STATES.map(state => state.id));

export function filterJobs(jobs, filter) {
  const selected = Array.isArray(filter) ? filter : [filter];
  if (!selected.length || selected.includes('all')) return jobs;
  const states = new Set(selected.flatMap(id => statusGroups.find(group => group.id === id)?.states || [id]));
  return jobs.filter(job => states.has(job.state));
}

export function filterPhases(jobs, filter) {
  const selected = Array.isArray(filter) ? filter : [filter];
  if (!selected.length || selected.includes('all')) return jobs;
  const phases = new Set(selected);
  return jobs.filter(job => phases.has(job.work?.phase?.id || 'unresolved'));
}

export function searchJobs(jobs, query) {
  const needle = String(query || '').trim().toLocaleLowerCase();
  if (!needle) return jobs;
  return jobs.filter(job => [jobDisplayTitle(job), job.state, job.workflow?.name, job.task?.source_url,
    job.work?.identity?.number, job.work?.phase?.label, job.work?.phase?.resolution, job.work?.source_status,
    job.work?.issue?.state, job.work?.issue?.state_reason, job.work?.issue?.author,
    ...(job.work?.issue?.assignees || []).map(person => person.login), ...(job.work?.issue?.labels || []).map(label => label.name),
    ...(job.work?.executions || []).map(item => `${item.id} ${item.workflow} ${item.state}`)]
    .some(value => String(value || '').toLocaleLowerCase().includes(needle)));
}

export function groupJobsByBoardColumn(jobs) {
  const groups = Object.fromEntries(boardColumns.map(stage => [stage.id, []]));
  const fallback = boardColumns.find(stage => stage.id === 'unresolved')?.id || boardColumns.at(-1).id;
  for (const job of jobs) {
    const phase = job.work?.phase?.id;
    groups[Object.hasOwn(groups, phase) ? phase : fallback].push(job);
  }
  return groups;
}

export function jobCounts(jobs) {
  const counts = { all: jobs.length, other: 0, ...Object.fromEntries(NATIVE_STATES.map(state => [state.id, 0])) };
  for (const job of jobs) {
    if (knownStates.has(job.state)) counts[job.state]++;
    else counts.other++;
  }
  for (const group of statusGroups) counts[group.id] = group.states.reduce((sum, state) => sum + counts[state], 0);
  return counts;
}

export function phaseCounts(jobs) {
  const counts = Object.fromEntries(boardColumns.map(stage => [stage.id, 0]));
  const fallback = boardColumns.find(stage => stage.id === 'unresolved')?.id || boardColumns.at(-1).id;
  for (const job of jobs) {
    const phase = job.work?.phase?.id;
    counts[Object.hasOwn(counts, phase) ? phase : fallback]++;
  }
  return counts;
}

export const currentRun = job => job.runs?.at(-1);
export function taskPhase(job) { return currentRun(job)?.command || ''; }
export function nextOperatorAction(job) { return nativeState(job.state).action; }
export function jobsByRecentActivity(jobs) {
  const activity = job => Date.parse(job.updated_at) || Date.parse(job.created_at) || 0;
  return [...jobs].sort((a, b) => activity(b) - activity(a));
}
export function jobDisplayTitle(job) { return job.task?.title || job.github_issue_title || job.task?.source_url || job.id; }
export function githubIssueReference(job) { const match = job.task?.source_url?.match(/\/issues\/(\d+)\/?$/); return match ? `#${match[1]}` : ''; }
