// Provider issue truth is read-only here. Only execution associations come from SQLite.
export const DEFAULT_READINESS_LABELS = Object.freeze({ triage: 'factory:triage', spec: 'factory:spec', ready: 'factory:ready', blocked: 'factory:blocked' });
export function readinessMapping(value = DEFAULT_READINESS_LABELS) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).some(key => !Object.hasOwn(DEFAULT_READINESS_LABELS, key))
    || Object.keys(DEFAULT_READINESS_LABELS).some(key => typeof value[key] !== 'string' || !value[key].trim() || value[key].length > 100)
    || new Set(Object.values(value).map(label => label.toLowerCase())).size !== 4)
    throw new Error('issueReadinessLabels must map triage, spec, ready and blocked to four distinct label names.');
  return { ...value };
}
export function issueReadiness(labels = [], mapping = DEFAULT_READINESS_LABELS) {
  const names = labels.map(label => (typeof label === 'string' ? label : label.name).toLowerCase());
  const matches = Object.entries(mapping).filter(([, label]) => names.includes(label.toLowerCase())).map(([key]) => key);
  const state = matches.length > 1 ? 'conflicting' : matches[0] || 'unknown';
  return { state, label: { triage:'Needs triage', spec:'Needs specification', ready:'Ready', blocked:'Blocked', conflicting:'Conflicting readiness labels', unknown:'Readiness unknown' }[state] };
}
export function canonicalIssue(value) {
  if (typeof value !== 'string' || value.length > 2048 || /(?:^|\/)\.\.?(?:\/|$)/.test(value)) return null;
  try {
    const url = new URL(value);
    if (!['https:', 'http:'].includes(url.protocol) || url.hostname !== 'github.com' || url.username || url.password || url.port) return null;
    const match = url.pathname.match(/^\/([A-Za-z0-9-]+)\/([A-Za-z0-9_.-]+)\/issues\/([1-9][0-9]*)\/?$/i);
    if (!match || !Number.isSafeInteger(Number(match[3]))) return null;
    const repository = `https://github.com/${match[1]}/${match[2]}`.toLowerCase(), number = Number(match[3]);
    return { key:`github:${repository}:${number}`, provider:'github', repository, number, url:`${repository}/issues/${number}` };
  } catch { return null; }
}
export function executionReservesIssue(job) {
  return !job.deleted_at && (!['succeeded', 'failed', 'cancelled'].includes(job.state)
    || Boolean(job.delivery && !['published', 'abandoned'].includes(job.delivery.state)));
}
export function executionAssociation(jobs, identity) {
  const attempts = jobs.filter(job => canonicalIssue(job.task?.source_url)?.key === identity.key)
    .sort((a,b) => String(b.created_at || '').localeCompare(String(a.created_at || '')) || b.id.localeCompare(a.id));
  const describe = job => ({ id:job.id, state:job.state, workflow:job.workflow?.name || null, phase:job.workflow?.steps?.[job.workflow.current_step] || null, created_at:job.created_at, updated_at:job.updated_at });
  const active = attempts.filter(executionReservesIssue).map(describe);
  return { executions:attempts.map(describe), latest_execution:attempts[0] ? describe(attempts[0]) : null, active_execution:active[0] || null, active_executions:active };
}
export function associateIssue(issue, jobs, mapping) {
  const identity = canonicalIssue(issue.url);
  if (!identity) throw new Error('Provider returned an unsupported issue identity.');
  const association = executionAssociation(jobs, identity);
  const readiness = issueReadiness(issue.labels, mapping);
  const start_block_reason = association.active_execution ? 'An execution is active or unresolved. Open its history to continue or cancel it.'
    : issue.state !== 'open' ? 'Only an open repository issue can start new work.'
    : readiness.state === 'blocked' || readiness.state === 'conflicting' ? 'Resolve the readiness labels on the repository before starting work.' : null;
  return { ...issue, identity, readiness, ...association, start_block_reason };
}
export function backlogHistory(jobs, issues) {
  const loaded = new Set(issues.map(issue => issue.identity.key)), grouped = new Map();
  for (const job of jobs) {
    const identity = canonicalIssue(job.task?.source_url);
    if (identity && loaded.has(identity.key)) continue;
    const key = identity?.key || `local:${job.id}`;
    if (!grouped.has(key)) grouped.set(key, { identity, key, title:job.task?.title || job.prompt?.split('\n')[0] || job.id, url:identity?.url || null,
      source_status:identity ? 'not_loaded' : 'local', ...(identity ? executionAssociation(jobs, identity) : { executions:[{id:job.id,state:job.state,workflow:job.workflow?.name || null,phase:job.workflow?.steps?.[job.workflow.current_step] || null}] }) });
  }
  return [...grouped.values()];
}
