// One partition owns list and board groups; detailed filters may overlap within a group.
export const statusGroups = [
  { id: "not_started", label: "Not started", count: "notStarted", tone: "neutral", states: ["not_started"] },
  { id: "in_progress", label: "In progress", count: "active", tone: "violet", states: ["queued", "running", "cancelling"], children: [["queued", "Queued", "queued"], ["running", "Running", "running"], ["cancelling", "Cancelling", "cancelling"]] },
  { id: "needs_attention", label: "Needs attention", count: "needsAttention", tone: "amber", states: ["failed", "timed_out", "blocked", "interrupted"], children: [["failed", "Failed", "failed"], ["blocked", "Blocked", "blocked"], ["interrupted", "Interrupted", "interrupted"], ["review_changes", "Revisions available · subset", "reviewChanges"]] },
  { id: "awaiting_approval", label: "Awaiting acceptance", count: "awaitingApproval", tone: "pink", states: ["awaiting_approval"] },
  { id: "succeeded", label: "Completed", count: "succeeded", tone: "green", states: ["succeeded"] },
  { id: "cancelled", label: "Cancelled", count: "cancelled", tone: "neutral", states: ["cancelled"] },
  { id: "other", label: "Other state", count: "other", tone: "neutral", states: [] },
];
export const boardColumns = statusGroups.map(group => ({ ...group, title: group.label }));

const activeStates = new Set(["queued", "running", "cancelling"]);
const failedStates = new Set(["failed", "timed_out"]);
const attentionStates = new Set(["failed", "timed_out", "blocked", "interrupted"]);
const knownStates = new Set([
  "not_started", "queued", "running", "cancelling", "failed", "timed_out", "blocked",
  "interrupted", "awaiting_approval", "succeeded", "cancelled",
]);

export function boardColumnForState(state) {
  return statusGroups.find(group => group.states.includes(state))?.id || "other";
}

export function needsAttention(state) {
  return attentionStates.has(state) || state === "awaiting_approval";
}

export function filterJobs(jobs, filter) {
  if (Array.isArray(filter)) return filter.length ? jobs.filter(job => filter.some(value => filterJobs([job], value).length)) : jobs;
  return jobs.filter((job) => {
    switch (filter) {
      case "active":
      case "in_progress":
        return activeStates.has(job.state);
      case "needs_attention":
        return attentionStates.has(job.state);
      case "failed":
        return failedStates.has(job.state);
      case "not_started":
        return job.state === "not_started";
      case "queued":
        return job.state === "queued";
      case "running":
        return job.state === "running";
      case "cancelling":
        return job.state === "cancelling";
      case "blocked":
        return job.state === "blocked";
      case "interrupted":
        return job.state === "interrupted";
      case "failed_review":
        return job.state === "failed" && job.runs?.at(-1)?.command === "review";
      case "review_changes":
        return job.state === "failed" && job.runs?.at(-1)?.command === "review" && job.can_request_changes === true;
      case "awaiting_approval":
        return job.state === "awaiting_approval";
      case "succeeded":
        return job.state === "succeeded";
      case "cancelled":
        return job.state === "cancelled";
      case "other":
        return !knownStates.has(job.state);
      default:
        return true;
    }
  });
}

export function searchJobs(jobs, query) {
  const needle = String(query || "").trim().toLocaleLowerCase();
  if (!needle) return jobs;
  return jobs.filter((job) => {
    const latest = job.runs?.at(-1);
    const fields = [
      jobDisplayTitle(job), job.id, job.state, job.repository,
      job.workflow?.name, job.command, latest?.command,
      job.task?.spec, job.task?.source_url, job.prompt, job.trigger_subject,
      job.work?.identity?.number, ...(job.work?.issue?.labels || []).map(label => label.name),
      ...(job.work?.executions || []).map(item => `${item.id} ${item.workflow || ""} ${item.state} ${item.phase || ""}`),
    ];
    return fields.some((field) => String(field || "").toLocaleLowerCase().includes(needle));
  });
}

export function groupJobsByBoardColumn(jobs) {
  const groups = Object.fromEntries(statusGroups.map(group => [group.id, []]));
  for (const job of jobs) groups[boardColumnForState(job.state)].push(job);
  return groups;
}

export function jobCounts(jobs) {
  const result = {
    all: jobs.length,
    notStarted: 0,
    active: 0,
    failed: 0,
    needsAttention: 0,
    reviewFailed: 0,
    reviewChanges: 0,
    queued: 0,
    running: 0,
    cancelling: 0,
    blocked: 0,
    interrupted: 0,
    awaitingApproval: 0,
    succeeded: 0,
    cancelled: 0,
    other: 0,
  };
  for (const job of jobs) {
    if (job.state === "not_started") result.notStarted += 1;
    if (activeStates.has(job.state)) result.active += 1;
    if (failedStates.has(job.state)) result.failed += 1;
    if (attentionStates.has(job.state)) result.needsAttention += 1;
    if (job.state === "queued") result.queued += 1;
    if (job.state === "running") result.running += 1;
    if (job.state === "cancelling") result.cancelling += 1;
    if (job.state === "blocked") result.blocked += 1;
    if (job.state === "interrupted") result.interrupted += 1;
    if (job.state === "failed" && job.runs?.at(-1)?.command === "review") {
      result.reviewFailed += 1;
      if (job.can_request_changes === true) result.reviewChanges += 1;
    }
    if (job.state === "awaiting_approval") result.awaitingApproval += 1;
    if (job.state === "succeeded") result.succeeded += 1;
    if (job.state === "cancelled") result.cancelled += 1;
    if (!knownStates.has(job.state)) result.other += 1;
  }
  return result;
}

export function currentRun(job) {
  const runs = job.runs || [];
  if (job.workflow) return runs.at(-1);
  return [...runs].reverse().find((run) => run.state !== "queued") || runs[0];
}

export function taskPhase(job) {
  const runs = job.runs || [];
  if (job.state === "awaiting_approval") {
    const handoff = runs.at(-1);
    const reviewed = runs.find((run) => run.id === handoff?.reviewed_run_id);
    return reviewed?.command || handoff?.command || job.command || "";
  }
  const phase = job.workflow?.steps?.[job.workflow.current_step];
  return phase || currentRun(job)?.command || job.command || "";
}

export function nextOperatorAction(job) {
  const latest = job.runs?.at(-1);
  switch (job.state) {
    case "not_started":
      return "Open context to start work";
    case "queued":
      return "Waiting for a worker";
    case "running":
      return "Work in progress";
    case "cancelling":
      return "Stopping task";
    case "failed":
      return job.can_request_changes === true && latest?.command === "review"
        ? "Revise or retry review"
        : "Retry the failed phase";
    case "timed_out":
      return "Inspect timeout evidence and recovery options";
    case "blocked":
      return "Resolve the blocker; cancel before retry";
    case "interrupted":
    case "cancelled":
      return "Verify the worker stopped before retry";
    case "awaiting_approval":
      return "Approve handoff or request changes";
    case "succeeded":
      return job.workflow?.steps?.includes("handoff") ? "Handoff complete" : "Issue complete";
    default:
      return "Inspect task";
  }
}

export function jobsByRecentActivity(jobs) {
  const activity = (job) => Date.parse(job.updated_at) || Date.parse(job.created_at) || 0;
  return [...jobs].sort((a, b) => activity(b) - activity(a));
}

export function jobDisplayTitle(job) {
  const recorded = job.task?.title;
  // Earlier CLI issue admission used the URL as the title. Its task text still
  // carries the actual title on the following line; preserve the stored record.
  if (typeof recorded === "string" && /^Issue: https:\/\/github\.com\/[^/]+\/[^/]+\/issues\/\d+$/.test(recorded)) {
    const lines = String(job.task?.spec || "").split("\n");
    if (lines[0]?.trim() === recorded) {
      const heading = lines.slice(1).find((line) => line.trim());
      if (heading) return heading.replace(/^#+\s*/, "").trim();
    }
  }
  const title = typeof job.github_issue_title === "string" ? job.github_issue_title.trim() : "";
  return job.task?.title || title || job.task?.spec || job.task?.source_url || job.prompt || job.id;
}

export function githubIssueReference(job) {
  const match = typeof job.trigger_subject === "string" ? job.trigger_subject.match(/\/issues\/(\d+)\/?$/) : null;
  return match ? `#${match[1]}` : "";
}

export function runProgress(runs) {
  const completeStates = new Set(["succeeded", "failed", "timed_out", "cancelled"]);
  return { completed: runs.filter((run) => completeStates.has(run.state)).length, total: runs.length };
}
