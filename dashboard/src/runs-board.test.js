import assert from "node:assert/strict";
import test from "node:test";
import {
  statusGroups,
  boardColumnForState,
  filterJobs,
  githubIssueReference,
  groupJobsByBoardColumn,
  jobCounts,
  jobsByRecentActivity,
  jobDisplayTitle,
  needsAttention,
  nextOperatorAction,
  searchJobs,
  taskPhase,
} from "./runs-board.js";

test("list and Kanban use one exhaustive status partition without merging approvals or cancellations", () => {
  const jobs = ["not_started", "queued", "running", "cancelling", "failed", "timed_out", "blocked", "interrupted", "needs_review", "awaiting_approval", "succeeded", "cancelled", "new_runtime_state"].map(state => ({ id: state, state }));
  const groups = groupJobsByBoardColumn(jobs);
  for (const group of statusGroups) assert.deepEqual(groups[group.id], filterJobs(jobs, group.id));
  assert.equal(Object.values(groups).flat().length, jobs.length);
  assert.equal(boardColumnForState("awaiting_approval"), "awaiting_approval");
  assert.equal(boardColumnForState("cancelled"), "cancelled");
  assert.equal(needsAttention("cancelled"), false);
  assert.equal(needsAttention("awaiting_approval"), true);
  assert.equal(boardColumnForState("needs_review"), "needs_attention");
});

test("filters and counts use runtime state groups and expose failed review revision flows", () => {
  const jobs = [
    { id: "queued", state: "queued" },
    { id: "running", state: "running" },
    { id: "cancelling", state: "cancelling" },
    { id: "failed-build", state: "failed", runs: [{ command: "build" }] },
    { id: "failed-review", state: "failed", can_request_changes: true, runs: [{ command: "review" }] },
    { id: "timed-out", state: "timed_out" },
    { id: "blocked", state: "blocked" },
    { id: "interrupted", state: "interrupted" },
    { id: "native-complete", state: "needs_review", native: true },
    { id: "approval", state: "awaiting_approval" },
    { id: "complete", state: "succeeded" },
    { id: "cancelled", state: "cancelled" },
    { id: "unknown", state: "unexpected_state" },
  ];
  const ids = (filter) => filterJobs(jobs, filter).map(({ id }) => id);

  assert.deepEqual(ids("all"), jobs.map(({ id }) => id));
  assert.deepEqual(ids("in_progress"), ["queued", "running", "cancelling"]);
  assert.deepEqual(ids("running"), ["running"]);
  assert.deepEqual(ids("cancelling"), ["cancelling"]);
  assert.deepEqual(ids("needs_attention"), ["failed-build", "failed-review", "timed-out", "blocked", "interrupted", "native-complete"]);
  assert.deepEqual(ids("needs_review"), ["native-complete"]);
  assert.deepEqual(ids("failed"), ["failed-build", "failed-review", "timed-out"]);
  assert.deepEqual(ids("failed_review"), ["failed-review"]);
  assert.deepEqual(ids("review_changes"), ["failed-review"]);
  assert.deepEqual(ids("awaiting_approval"), ["approval"]);
  assert.deepEqual(ids("succeeded"), ["complete"]);
  assert.deepEqual(ids("cancelled"), ["cancelled"]);
  assert.deepEqual(ids("other"), ["unknown"]);

  assert.deepEqual(jobCounts(jobs), {
    all: 13, notStarted: 0, active: 3, failed: 3, needsAttention: 6, needsReview: 1, reviewFailed: 1,
    reviewChanges: 1, queued: 1, running: 1, cancelling: 1, blocked: 1, interrupted: 1,
    awaitingApproval: 1, succeeded: 1, cancelled: 1, other: 1,
  });
});

test("search combines with state filters and searches only supplied task data", () => {
  const jobs = [
    { id: "job_1", state: "failed", task: { title: "Update dashboard typography", spec: "Use compact task rows." }, runs: [{ command: "review" }], can_request_changes: true },
    { id: "job_2", state: "succeeded", task: { title: "Add artifact downloads", spec: "Keep prior evidence available." }, runs: [{ command: "handoff" }] },
  ];
  const matching = searchJobs(jobs, "  DASHBOARD ");
  assert.deepEqual(matching.map(({ id }) => id), ["job_1"]);
  assert.deepEqual(filterJobs(matching, "review_changes").map(({ id }) => id), ["job_1"]);
  assert.deepEqual(filterJobs(searchJobs(jobs, "proof not supplied"), "all"), []);
  assert.deepEqual(searchJobs(jobs, "artifact").map(({ id }) => id), ["job_2"]);
});

test("rows use the current workflow phase and action implied by runtime state", () => {
  const queued = { state: "queued", workflow: { steps: ["build", "verify", "review"], current_step: 1 }, runs: [{ command: "build", state: "succeeded" }] };
  assert.equal(taskPhase(queued), "verify");
  assert.equal(nextOperatorAction(queued), "Waiting for a worker");
  assert.equal(nextOperatorAction({ state: "blocked" }), "Resolve the blocker; cancel before retry");
  assert.equal(nextOperatorAction({ state: "timed_out" }), "Inspect timeout evidence and recovery options");

  const failedReview = { state: "failed", can_request_changes: true, workflow: { steps: ["build", "verify", "review", "handoff"], current_step: 2 }, runs: [{ command: "review", state: "failed" }] };
  assert.equal(taskPhase(failedReview), "review");
  assert.equal(nextOperatorAction(failedReview), "Revise or retry review");

  const awaiting = { state: "awaiting_approval", workflow: { steps: ["build", "review", "handoff"], current_step: 2 }, runs: [{ command: "review", state: "succeeded", id: "review" }, { command: "handoff", state: "awaiting_approval", reviewed_run_id: "review" }] };
  assert.equal(taskPhase(awaiting), "review");
  assert.equal(nextOperatorAction(awaiting), "Approve handoff or request changes");
  assert.equal(nextOperatorAction({ state: "succeeded" }), "Issue complete");
  assert.equal(nextOperatorAction({ state: "succeeded", workflow: { steps: ["build", "review", "handoff"] } }), "Handoff complete");
  assert.equal(taskPhase({ state: "awaiting_approval", runs: [{ command: "build" }] }), "build", "initial approval does not invent a completed review");
});

test("runtime issue titles remain preferred when explicitly supplied", () => {
  const job = { id: "job_12345678", prompt: "Complete https://github.com/o/r/issues/7", github_issue_title: "Make cards readable", trigger_subject: "https://github.com/o/r/issues/7" };
  assert.equal(jobDisplayTitle(job), "Make cards readable");
  assert.equal(githubIssueReference(job), "#7");
  assert.equal(jobDisplayTitle({ id: "job_12345678", prompt: "Run an audit" }), "Run an audit");
});


test("legacy CLI issue titles use their recorded task heading without changing data", () => {
  const title = "Issue: https://github.com/arcitai/software-and-defence-factory/issues/30";
  const job = { task: { title, spec: `${title}\nAdd supported image selection\n\n## Scope` } };
  assert.equal(jobDisplayTitle(job), "Add supported image selection");
  assert.equal(job.task.title, title);
  assert.equal(jobDisplayTitle({ task: { title } }), title);
  assert.equal(jobDisplayTitle({ task: { title: "Chosen name", spec: job.task.spec } }), "Chosen name");
});

test("task overview sorts by recent activity without reordering the runtime snapshot", () => {
  const jobs = [
    { id: "old", updated_at: "2026-09-24T12:00:00Z" },
    { id: "new", updated_at: "2026-09-25T12:00:00Z" },
    { id: "created", updated_at: "unknown", created_at: "2026-09-25T10:00:00Z" },
    { id: "unknown" },
  ];
  assert.deepEqual(jobsByRecentActivity(jobs).map(j => j.id), ["new", "created", "old", "unknown"]);
  assert.equal(jobs[0].id, "old");
});
