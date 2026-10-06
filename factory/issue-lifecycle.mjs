import lifecycleCatalog from '../adlc/lifecycle.json' with { type: 'json' };

export const LIFECYCLE_CATALOG = lifecycleCatalog;
export const ISSUE_STAGES = Object.freeze(lifecycleCatalog.stages.map(stage => Object.freeze({ ...stage })));
export const NATIVE_STATES = Object.freeze(lifecycleCatalog.native_states.map(state => Object.freeze({ ...state })));
export const NATIVE_GROUPS = Object.freeze(lifecycleCatalog.native_groups.map(group => Object.freeze({ ...group, states: Object.freeze([...group.states]) })));

const labelsById = new Map(lifecycleCatalog.labels.map(label => [label.id, label]));
const readinessKeys = Object.keys(lifecycleCatalog.readiness);
export const DEFAULT_READINESS_LABELS = Object.freeze(Object.fromEntries(readinessKeys.map(key => [key, labelsById.get(lifecycleCatalog.readiness[key])?.name])));
const stageById = new Map(ISSUE_STAGES.map(stage => [stage.id, stage]));
const nativeById = new Map(NATIVE_STATES.map(state => [state.id, state]));
const readinessStage = Object.freeze({ triage: 'triage', spec: 'ready_to_spec', ready: 'ready_to_implement', blocked: 'needs_attention' });
const allowedStates = new Set(['open', 'closed']);
const closureReasons = new Map(lifecycleCatalog.closure_reasons.map(reason => [reason.id, reason]));

export function readinessMapping(value = DEFAULT_READINESS_LABELS) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).some(key => !Object.hasOwn(DEFAULT_READINESS_LABELS, key))
    || readinessKeys.some(key => typeof value[key] !== 'string' || !value[key].trim() || value[key].length > 100)
    || new Set(Object.values(value).map(label => label.toLowerCase())).size !== readinessKeys.length)
    throw new Error('Issue readiness labels must map triage, spec, ready and blocked to four distinct names.');
  return { ...value };
}

const labelNames = labels => (Array.isArray(labels) ? labels : [])
  .map(label => typeof label === 'string' ? label : label?.name)
  .filter(name => typeof name === 'string')
  .map(name => name.toLocaleLowerCase());

function mappedStageLabels(mapping) {
  const labels = Object.fromEntries(ISSUE_STAGES.filter(stage => stage.label_id)
    .map(stage => [stage.id, labelsById.get(stage.label_id)?.name]));
  for (const [key, stageID] of Object.entries(readinessStage)) labels[stageID] = mapping[key];
  return labels;
}

const unresolvedLabels = Object.freeze({
  not_loaded: 'Source not loaded',
  stale: 'Source stale',
  conflicting: 'Conflicting phase labels',
  unlabeled: 'Unlabeled',
  no_phase_label: 'No phase label',
  unknown_state: 'Source state unknown',
  local: 'Local request',
});

function unresolvedPhase(reason, extra = {}) {
  return { ...stageById.get('unresolved'), resolution: reason, label: unresolvedLabels[reason] || 'Source unresolved', ...extra };
}

function normalizedStateReason(value) {
  if (typeof value !== 'string') return null;
  const reason = value.toLowerCase();
  return closureReasons.has(reason) ? reason : 'unrecognized';
}

export function closureReasonLabel(value) {
  if (typeof value !== 'string' || !value) return 'reason unavailable';
  return closureReasons.get(value.toLowerCase())?.label || 'unrecognized reason';
}

export function projectIssuePhase(issue, { mapping = DEFAULT_READINESS_LABELS, sourceStatus = 'loaded' } = {}) {
  if (!issue || sourceStatus === 'not_loaded' || sourceStatus === 'local') return unresolvedPhase(sourceStatus === 'local' ? 'local' : 'not_loaded');
  if (sourceStatus === 'stale') {
    const observed = projectIssuePhase(issue, { mapping, sourceStatus: 'loaded' });
    return unresolvedPhase('stale', { observed_phase: { id: observed.id, label: observed.label }, detail: `Last loaded phase: ${observed.label}.` });
  }
  const state = typeof issue.state === 'string' ? issue.state.toLowerCase() : 'unknown';
  if (state === 'closed') {
    const reason = normalizedStateReason(issue.state_reason ?? issue.stateReason);
    if (reason === 'completed') return { ...stageById.get(closureReasons.get(reason).stage_id), resolution: 'resolved', source: 'github_state', state_reason: reason };
    const phase = { ...stageById.get('closed'), resolution: 'resolved', source: 'github_state', state_reason: reason };
    if (reason === 'not_planned') phase.label = `Closed · ${closureReasons.get(reason).label}`;
    else if (reason === 'reopened') phase.detail = 'GitHub supplied the reopened reason while the issue is currently closed.';
    else if (reason === 'unrecognized') phase.detail = 'GitHub supplied a closure reason this catalog does not recognize.';
    else phase.detail = 'GitHub did not supply a closure reason.';
    return phase;
  }
  if (!allowedStates.has(state)) return unresolvedPhase('unknown_state');

  const names = labelNames(issue.labels);
  const selectedMapping = readinessMapping(mapping);
  const stageLabels = mappedStageLabels(selectedMapping);
  // The four readiness labels are configurable legacy inputs. If one is
  // deliberately mapped to a catalog label name, that explicit mapping owns
  // the name for projection; it must not also match the catalog stage that
  // happens to use that name by default.
  const readinessOwners = new Map(Object.entries(readinessStage)
    .map(([key, stageID]) => [selectedMapping[key].toLocaleLowerCase(), stageID]));
  const matches = ISSUE_STAGES.filter(stage => {
    if (!stage.label_id) return false;
    const name = stageLabels[stage.id]?.toLocaleLowerCase();
    return Boolean(name && names.includes(name) && (!readinessOwners.has(name) || readinessOwners.get(name) === stage.id));
  });
  if (matches.length > 1) return unresolvedPhase('conflicting', { matched_stages: matches.map(stage => stage.id) });
  if (!matches.length) return unresolvedPhase(names.length ? 'no_phase_label' : 'unlabeled');
  return { ...matches[0], resolution: 'resolved', source: 'github_label', label_name: stageLabels[matches[0].id] };
}

export function issueReadiness(labels = [], mapping = DEFAULT_READINESS_LABELS) {
  const names = labelNames(labels);
  const selected = readinessMapping(mapping);
  const matches = Object.entries(selected).filter(([, label]) => names.includes(label.toLocaleLowerCase())).map(([key]) => key);
  const state = matches.length > 1 ? 'conflicting' : matches[0] || 'unknown';
  return { state, label: { triage: 'Needs triage', spec: 'Ready to spec', ready: 'Ready to implement', blocked: 'Needs attention', conflicting: 'Conflicting readiness labels', unknown: 'Readiness unknown' }[state] };
}

export function nativeState(value) {
  return nativeById.get(value) || { id: value || 'unknown', label: value ? String(value) : 'Unknown', tone: 'orange', icon: 'circle_help', action: 'Inspect native history; state is unresolved' };
}

export function canonicalIssue(value) {
  if (typeof value !== 'string' || value.length > 2048 || /(?:^|\/)\.\.?(?:\/|$)/.test(value)) return null;
  try {
    const url = new URL(value);
    if (!['https:', 'http:'].includes(url.protocol) || url.hostname !== 'github.com' || url.username || url.password || url.port) return null;
    const match = url.pathname.match(/^\/([A-Za-z0-9-]+)\/([A-Za-z0-9_.-]+)\/issues\/([1-9][0-9]*)\/?$/i);
    if (!match || !Number.isSafeInteger(Number(match[3]))) return null;
    const repository = `https://github.com/${match[1]}/${match[2]}`.toLowerCase(), number = Number(match[3]);
    return { key: `github:${repository}:${number}`, provider: 'github', repository, number, url: `${repository}/issues/${number}` };
  } catch { return null; }
}

const reserves = job => !['needs_review', 'failed', 'interrupted'].includes(job.state);
const describe = job => ({ id: job.id, state: job.state, workflow: job.workflow?.name || 'unknown', created_at: job.created_at, updated_at: job.updated_at });
export function executionAssociation(jobs, identity) {
  const attempts = jobs.filter(job => canonicalIssue(job.task?.source_url)?.key === identity.key)
    .sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')) || b.id.localeCompare(a.id));
  const active = attempts.filter(reserves).map(describe);
  return { executions: attempts.map(describe), latest_execution: attempts[0] ? describe(attempts[0]) : null,
    active_execution: active[0] || null, active_executions: active };
}

export function associateIssue(issue, jobs, mapping = DEFAULT_READINESS_LABELS) {
  const identity = canonicalIssue(issue.url);
  if (!identity) throw new Error('Provider returned an unsupported issue identity.');
  const association = executionAssociation(jobs, identity), readiness = issueReadiness(issue.labels, mapping);
  const phase = projectIssuePhase(issue, { mapping });
  const start_block_reason = association.active_execution ? 'Native work is active or unresolved. Inspect its native history first.'
    : association.executions.length ? 'This issue has native history. Continue its recorded session from the detail view.'
    : issue.state !== 'open' ? 'Only an open repository issue can start work.'
    : readiness.state === 'blocked' || readiness.state === 'conflicting' ? 'Resolve the readiness labels on the repository before starting work.'
      : phase.resolution === 'conflicting' ? 'Resolve the conflicting phase labels on the repository before starting work.' : null;
  return { ...issue, identity, readiness, phase, ...association, start_block_reason };
}

export function backlogHistory(jobs, issues) {
  const loaded = new Set(issues.map(issue => issue.identity?.key || canonicalIssue(issue.url)?.key).filter(Boolean));
  return jobs.filter(job => {
    const identity = canonicalIssue(job.task?.source_url);
    return !identity || !loaded.has(identity.key);
  }).map(job => {
    const identity = canonicalIssue(job.task?.source_url);
    return { identity, key: identity?.key || `local:${job.id}`, title: job.task?.title || job.id, url: identity?.url || null,
      source_status: identity ? 'not_loaded' : 'local', phase: unresolvedPhase(identity ? 'not_loaded' : 'local'),
      ...executionAssociation(jobs, identity || { key: '' }) };
  });
}

export function workRecords(jobs = [], issues = [], { sourceStale = false, mapping = DEFAULT_READINESS_LABELS } = {}) {
  const sources = new Map(issues.map(issue => [issue.identity?.key || canonicalIssue(issue.url)?.key, issue]).filter(([key]) => key));
  const rows = new Map(backlogHistory(jobs, []).map(row => [row.key, row]));
  for (const [key, issue] of sources) rows.set(key, { ...issue, key, ...executionAssociation(jobs, issue.identity || canonicalIssue(issue.url)) });
  return [...rows.values()].map(row => {
    const issue = sources.get(row.key) || null;
    const source_status = issue ? sourceStale ? 'stale' : 'loaded' : row.identity ? 'not_loaded' : 'local';
    const execution = row.active_execution || row.latest_execution || row.executions[0] || null;
    return { key: row.key, identity: row.identity || issue?.identity || null, title: issue?.title || row.title, url: row.url || issue?.url || null,
      source_status, issue, phase: projectIssuePhase(issue, { mapping, sourceStatus: source_status }), executions: row.executions || [],
      active_execution: row.active_execution || null, latest_execution: row.latest_execution || execution,
      execution_id: execution?.id || null, state: execution?.state || 'not_started', native_state: nativeState(execution?.state || 'not_started'),
      workflow: execution?.workflow || null };
  });
}
