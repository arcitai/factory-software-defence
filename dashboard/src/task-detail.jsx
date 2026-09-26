import React, { useEffect, useState } from "react";
import { ArrowRight, Check, ChevronUp, ChevronDown, Link2, X, FileText, GitBranch, Coins } from "lucide-react";
import { Tabs } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { Artifacts, useTaskArtifacts } from "./artifacts.jsx";
import { taskPresentation } from "./task-presentation.js";
import { jobDisplayTitle } from "./runs-board.js";
import { formatDurationMillis, formatTokenUsage, formatRunTokenUsage, tokenUsageSummary, formatTaskTokenUsage, formatReportingCoverage, taskDurationMillis } from "./run-metrics.js";
import {
  State,
  friendlyName,
  stateLabel,
  formatTimestamp,
  TaskStateIcon,
} from "./task-display.jsx";

export function TaskDetail({
  identity,
  links,
  navigation = [],
  csrfToken,
  job,
  loaded,
  error,
  deliveryActionError = "",
  deleting,
  onDelete,
  onWorkflowAction,
}) {
  const artifacts = useTaskArtifacts(job, csrfToken);
  const [copyStatus, setCopyStatus] = useState("");
  useEffect(() => {
    setCopyStatus("");
    const escape = event => {
      if (event.key === "Escape" && !event.target.closest?.("input, textarea, select")) window.location.hash = "#/runs";
    };
    window.addEventListener("keydown", escape);
    return () => window.removeEventListener("keydown", escape);
  }, [job?.id]);
  async function copyLink() {
    try { await navigator.clipboard.writeText(`${window.location.origin}/#/runs/${encodeURIComponent(job.id)}`); setCopyStatus("Link copied"); }
    catch { setCopyStatus("Unable to copy link"); }
  }
  if (!job)
    return (
      <div className="p-8">
        <a href="#/runs" className="text-sm underline">
          Back to inbox
        </a>
        <p className="mt-4">{!loaded ? "Loading issue…" : "Issue not found."}</p>
        {error && <p role="alert">{error}</p>}
      </div>
    );
  const usage = tokenUsageSummary(job.runs || []);
  const terminal = ["succeeded", "failed", "cancelled"].includes(job.state);
  const latest = job.runs.at(-1);
  const showDelivery = job.workflow?.name === "software" && job.delivery_status
    && (job.state === "succeeded" || job.delivery_status.candidate_sha || job.delivery_removal_blocked);
  const lastCompleted = job.runs.findLast((run) => run.outcome === "complete");
  const sourceAdmission = job.source_admission || { status: "legacy_unknown", note: "Admission-time source revision was not recorded for this job." };
  const { result, history, stages } = taskPresentation(job);
  const reviewing = job.state === "awaiting_approval";
  return (
    <div className="task-detail-layout">
      <div className="task-detail-main">
      <div className="detail-toolbar">
        <div className="detail-position"><span>{navigation.findIndex(item => item.id === job.id) >= 0 ? `${navigation.findIndex(item => item.id === job.id) + 1} / ${navigation.length}` : "Issue"}</span><div>
          {[-1, 1].map((delta) => {
            const index = navigation.findIndex(item => item.id === job.id);
            const adjacent = index >= 0 ? navigation[index + delta] : undefined;
            const Icon = delta < 0 ? ChevronUp : ChevronDown;
            const label = delta < 0 ? "Previous issue" : "Next issue";
            return adjacent ? <a key={delta} href={`#/runs/${encodeURIComponent(adjacent.id)}`} aria-label={label} title={adjacent.title}><Icon size={14} /></a> : <span key={delta} aria-label={`${label} unavailable`}><Icon size={14} /></span>;
          })}
        </div></div>
        <div className="detail-toolbar-actions"><span role="status" className="copy-status">{copyStatus}</span><button type="button" aria-label="Copy issue link" title="Copy issue link" onClick={copyLink}><Link2 size={16} /></button><a href="#/runs" aria-label="Close issue detail" title="Close issue detail (Esc)"><X size={18} /></a></div>
      </div>
      <header className="task-detail-heading">
        <TaskStateIcon value={job.state} /><h2>{jobDisplayTitle(job)}</h2>
        {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      </header>
      {stages.length > 1 && (
        <ol
          className="task-progress flex flex-wrap items-center gap-3 text-sm"
          aria-label="Issue progress"
        >
          {stages.map((stage, index) => (
            <li
              key={index}
              className="flex items-center gap-3"
              aria-current={stage.current ? "step" : undefined}
            >
              {index > 0 && (
                <ArrowRight
                  className="size-4 text-muted-foreground"
                  aria-hidden="true"
                />
              )}
              <span
                className={cn(
                  "flex items-center gap-2 py-1",
                  stage.current
                    ? "font-medium text-foreground"
                    : "text-muted-foreground",
                )}
              >
                {stage.complete ? (
                  <Check
                    className="size-4 text-success"
                    aria-label="Complete"
                  />
                ) : (
                  <span className="text-xs">{index + 1}</span>
                )}
                {friendlyName(stage.name)}
                {stage.current && (
                  <span className="text-xs text-muted-foreground">
                    {reviewing ? "Awaiting approval" : stateLabel(job.state)}
                  </span>
                )}
              </span>
            </li>
          ))}
        </ol>
      )}
      <Tabs
        key={job.id}
        label="Issue sections"
        items={[
          {
            id: "result",
            label: "Result",
            content: (
              <Card
                className="task-result space-y-5 p-5 sm:p-6"
                aria-label="Current result"
              >
                <h2 className="text-lg font-semibold">
                  {resultTitle(job, result)}
                </h2>
                {result?.summary && (
                  <div className="space-y-1.5">
                    <p className="text-xs font-medium text-muted-foreground">Run report</p>
                    <p className="line-clamp-3 whitespace-pre-wrap break-words text-sm leading-6 text-muted-foreground">
                      {result.summary}
                    </p>
                    <p className="text-xs text-muted-foreground">Agent-reported text. The workflow state and its evidence determine acceptance.</p>
                  </div>
                )}
                {result?.error && result.error !== result.summary && (
                  <p
                    role="alert"
                    className="whitespace-pre-wrap break-words text-sm text-danger"
                  >
                    {result.error}
                  </p>
                )}
                {showDelivery && <DeliveryDetails delivery={job.delivery_status} />}
                {result && job.task && (
                  <Artifacts
                    key={result.id}
                    artifacts={artifacts}
                    runID={result.id}
                    csrfToken={csrfToken}
                  />
                )}
                {job.workflow && (
                  <TaskActions
                    key={`${job.id}:${latest?.id}:${job.state}`}
                    job={job}
                    result={result}
                    deliveryActionError={deliveryActionError}
                    onAction={onWorkflowAction}
                  />
                )}
              </Card>
            ),
          },
          ...(job.task && lastCompleted
            ? [
                {
                  id: "files",
                  label: "Files",
                  content: (
                    <Artifacts
                      artifacts={artifacts}
                      runID={lastCompleted.id}
                      csrfToken={csrfToken}
                    />
                  ),
                },
              ]
            : []),
          ...(history.length
            ? [
                {
                  id: "history",
                  label: "History",
                  content: (
                    <ol className="space-y-4">
                      {history.map((run) => (
                        <li
                          key={run.id}
                          className="space-y-3 border-l-2 border-border pl-4"
                        >
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <h3 className="font-medium">
                              {run.outcome === "changes_requested"
                                ? "Changes requested"
                                : friendlyName(run.command)}
                            </h3>
                            <State
                              value={
                                run.outcome === "complete"
                                  ? "succeeded"
                                  : run.outcome || run.state
                              }
                            />
                          </div>
                          {run.summary && (
                            <p className="whitespace-pre-wrap break-words leading-6">
                              {run.summary}
                            </p>
                          )}
                          {run.error && run.error !== run.summary && (
                            <p className="text-danger">{run.error}</p>
                          )}
                          {job.task && (
                            <Artifacts
                              artifacts={artifacts}
                              runID={run.id}
                              csrfToken={csrfToken}
                            />
                          )}
                          <ExecutionDetails run={run} />
                        </li>
                      ))}
                    </ol>
                  ),
                },
              ]
            : []),
          {
            id: "instructions",
            label: "Instructions",
            content: (
              <pre className="whitespace-pre-wrap break-words font-sans leading-6">
                {job.task
                  ? job.task.spec || "Use the linked source for requirements."
                  : job.prompt}
              </pre>
            ),
          },
          {
            id: "details",
            label: "Details",
            content: (
              <div className="space-y-6 text-sm">
                {result?.revision && (
                  <section>
                    <h2 className="mb-2 font-medium">Requested changes</h2>
                    <p className="whitespace-pre-wrap">
                      {result.revision.feedback}
                    </p>
                  </section>
                )}
                {result?.summary && (
                  <section>
                    <h2 className="mb-2 font-medium">Full summary</h2>
                    <p className="whitespace-pre-wrap break-words leading-6">
                      {result.summary}
                    </p>
                  </section>
                )}
                {result && <ExecutionDetails run={result} />}
                <section className="border-t border-border pt-4">
                  <dl className="my-4 grid gap-3 sm:grid-cols-3">
                    <RunMetric label="Issue ID" value={job.id} />
                    <RunMetric label="Repository" value={job.repository} />
                    <RunMetric
                      label="Created"
                      value={formatTimestamp(job.created_at)}
                    />
                    <RunMetric
                      label="Updated"
                      value={formatTimestamp(job.updated_at)}
                    />
                  </dl>
                  <Button
                    variant="outline"
                    disabled={!terminal || deleting || job.can_remove === false}
                    onClick={() => onDelete(job)}
                  >
                    {deleting ? "Deleting…" : "Delete issue"}
                  </Button>
                  {job.delivery_removal_blocked && <p className="text-xs text-muted-foreground" role="note">
                    {job.removal_block_reason || "Trusted PR delivery is unresolved. Reconcile it or inspect the remote collision before deleting this issue."}
                  </p>}
                </section>
              </div>
            ),
          },
        ]}
      />
      </div>
      <aside className="task-metadata" aria-label="Issue details">
        <h3><FileText size={15} />Metadata</h3>
        <dl>
          <div><dt>Factory job</dt><dd><code className="source-revision-sha">{job.id}</code></dd></div>
          <div><dt>Status</dt><dd><State value={job.state} /></dd></div>
          <div><dt>Project</dt><dd>{identity?.name || job.repository}</dd></div>
          <div><dt>Workflow</dt><dd>{friendlyName(job.workflow?.name || job.command)}</dd></div>
          <div><dt>Created</dt><dd>{formatTimestamp(job.created_at)}</dd></div>
          <div><dt>Last activity</dt><dd>{formatTimestamp(job.updated_at)}</dd></div>
          <div><dt>Requested models</dt><dd>{[...new Set((job.runs || []).map(run => run.model || run.execution?.requestedModel).filter(Boolean))].join(", ") || job.model || "Not recorded"}</dd></div>
          <div><dt>Recorded duration</dt><dd>{formatDurationMillis(taskDurationMillis(job.runs || []))}</dd></div>
          <div className="task-usage"><dt><Coins size={13} />Reported tokens</dt><dd>{formatTaskTokenUsage(usage)}</dd><dd className="metadata-hint">{formatReportingCoverage(usage)}</dd></div>
          {usage.input !== undefined && <div><dt>Token breakdown</dt><dd>{formatTokenUsage(usage.input)} input<br />{formatTokenUsage(usage.output)} output<br />{formatTokenUsage(usage.cached)} cached input</dd><dd className="metadata-hint">Cached input is a subset of input.</dd></div>}
          <div><dt>Monetary cost</dt><dd>Not reported</dd><dd className="metadata-hint">Token counts are usage, not a charge.</dd></div>
          <div className="task-source-revision"><dt>Source ref</dt><dd>{sourceAdmission.status === "retained" ? sourceAdmission.requested_ref : "Not recorded (legacy/unknown)"}</dd></div>
          <div className="task-source-revision"><dt>Resolved source commit</dt><dd>{sourceAdmission.status === "retained" ? <code className="source-revision-sha" title={sourceAdmission.resolved_sha}>{sourceAdmission.resolved_sha}</code> : sourceAdmission.note}</dd></div>
          {sourceAdmission.status === "retained" && <div className="task-source-revision"><dt>Repository identity</dt><dd><code className="source-revision-sha" title={sourceAdmission.repository_identity}>{sourceAdmission.repository_identity}</code></dd></div>}
          {(job.source_history || []).length > 0 && <div><dt>Previous source commits</dt><dd>{job.source_history.map((source, index) => <code className="source-revision-sha" key={`${source.resolved_sha}-${index}`} title={source.resolved_sha}>{source.resolved_sha}</code>)}</dd></div>}
          {links?.repository && <div><dt>Repository</dt><dd><a className="metadata-link" href={links.repository} target="_blank" rel="noreferrer"><GitBranch size={13} />View repo</a></dd></div>}
          {job.task?.source_url && /^https?:\/\//.test(job.task.source_url) && <div><dt>Source</dt><dd><a className="metadata-link" href={job.task.source_url} target="_blank" rel="noreferrer"><Link2 size={13} />Open source</a></dd></div>}
        </dl>
      </aside>
    </div>
  );
}

function ExecutionDetails({ run }) {
  const modelLabel = !run.execution ? "Not recorded"
    : run.execution.modelSelection === "not_applicable" || ["deterministic", "mock"].includes(run.executor) ? "Not applicable"
    : !["codex", "pi"].includes(run.executor) ? "Not recorded by custom executor"
    : run.model || "Provider default requested";
  return (
    <section
      aria-label="execution details"
      className="text-xs text-muted-foreground"
    >
      <dl className="mt-3 grid gap-3 sm:grid-cols-3">
        <RunMetric label="Started" value={formatTimestamp(run.started_at)} />
        <RunMetric
          label="Completed"
          value={formatTimestamp(run.completed_at)}
        />
        <RunMetric
          label="Exit code"
          value={
            run.exit_code === undefined ? "Unavailable" : String(run.exit_code)
          }
        />
        <RunMetric label="Run ID" value={run.id} mono />
        <RunMetric label="Executor" value={run.execution ? run.executor : run.started_at ? "Not recorded (legacy/unknown)" : "Not started"} />
        <RunMetric label="Host" value={run.host_name || run.worker_name || (run.started_at ? "Not recorded" : "Not assigned yet")} />
        <RunMetric
          label="Duration"
          value={
            Number.isSafeInteger(run.duration_millis)
              ? formatDurationMillis(run.duration_millis)
              : "Not available"
          }
        />
        <RunMetric label="Requested model" value={modelLabel} />
        <RunMetric label="Runtime version" value={run.execution?.runtimeVersion || "Not recorded"} />
        <RunMetric label="Job image" value={run.execution ? run.execution.image || "Not applicable" : "Not recorded"} mono />
        <RunMetric label="Policy hash" value={run.execution?.policyHash || "Not recorded"} mono />
        <RunMetric
          label="Tokens"
          value={formatRunTokenUsage(run) === "Unavailable" ? "Not reported" : formatRunTokenUsage(run)}
        />
      </dl>
    </section>
  );
}

function RunMetric({ label, value, mono = false }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd
        className={cn("mt-0.5 truncate text-sm", mono && "font-mono")}
        title={value}
      >
        {value}
      </dd>
    </div>
  );
}

function TaskActions({ job, result, deliveryActionError = "", onAction }) {
  const [stopped, setStopped] = useState(false);
  const [requesting, setRequesting] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [revisionSourceRef, setRevisionSourceRef] = useState("");
  const [busy, setBusy] = useState(false);
  const latest = job.runs.at(-1);
  const action = async (name) => {
    setBusy(true);
    try {
      await onAction(
        job,
        name,
        stopped,
        name === "request_changes" ? feedback : "",
        name === "request_changes" ? revisionSourceRef : "",
      );
    } finally {
      setBusy(false);
    }
  };
  const hasRetainedSource = job.source_admission?.status === "retained";
  const retry = hasRetainedSource && ["failed", "interrupted", "cancelled"].includes(job.state);
  const legacyRecovery = !hasRetainedSource && ["blocked", "failed", "interrupted", "cancelled"].includes(job.state);
  const canRevise = job.can_request_changes ?? (job.state === "awaiting_approval" && job.workflow?.name === "software");
  const delivery = job.delivery_status;
  return (
    <div className="space-y-3">
      {(job.state === "awaiting_approval" || canRevise) && (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-2">
            {job.state === "awaiting_approval" && <Button
              disabled={busy || requesting}
              onClick={() => action("approve")}
            >
              Approve and start {friendlyName(latest?.command).toLowerCase()}
            </Button>}
            {canRevise && (
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => setRequesting(true)}
              >
                Request changes
              </Button>
            )}
          </div>
          {requesting && (
            <div className="space-y-3">
              <label className="block">
                <span className="field-label">What needs to change?</span>
                <textarea
                  className="field-control min-h-24"
                  value={feedback}
                  onChange={(e) => setFeedback(e.target.value)}
                  maxLength={4000}
                  placeholder="Explain what to revise in the previous stage’s result."
                />
              </label>
              <label className="block">
                <span className="field-label">New base ref · optional</span>
                <input className="field-control" value={revisionSourceRef} onChange={(event) => setRevisionSourceRef(event.target.value)} maxLength={256} placeholder={`Keep ${job.source_admission?.resolved_sha || "the pinned source"}`} />
              </label>
              <p className="text-xs text-muted-foreground">
                Blank keeps the recorded source commit. A ref here is resolved and retained as a deliberate new base; it starts a fresh build, checks and review. Previous evidence stays in history.
              </p>
              <div className="flex flex-wrap gap-2">
                <Button
                  disabled={busy || !feedback.trim()}
                  onClick={() => action("request_changes")}
                >
                  {busy ? "Submitting…" : "Send feedback and revise"}
                </Button>
                <Button
                  variant="ghost"
                  disabled={busy}
                  onClick={() => setRequesting(false)}
                >
                  Keep reviewing
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
      {(delivery?.can_publish || deliveryActionError) && delivery && (
        <section className="trusted-delivery-action space-y-2 rounded-lg border border-border p-3" aria-label="Trusted PR delivery action">
          <p className="text-sm font-medium">Optional PR delivery</p>
          <p className="text-xs text-muted-foreground">{delivery.repository} · target {delivery.target}. Publishing uses the accepted patch and current evidence. Merge, integration and deployment remain separate.</p>
          {(deliveryActionError || delivery.error) && <p id={`delivery-action-error-${job.id}`} role="alert" aria-live="assertive" className="text-sm text-danger">{deliveryActionError || delivery.error}</p>}
          {delivery.can_publish && <Button
            className="delivery-action-button"
            variant={delivery.state === "published" ? "outline" : "default"}
            disabled={busy}
            aria-describedby={(deliveryActionError || delivery.error) ? `delivery-action-error-${job.id}` : undefined}
            onClick={() => action("publish")}
          >
            {busy ? "Reconciling…" : delivery.state === "published" ? "Refresh PR readback and checks" : ["intent", "uncertain", "publishing", "blocked"].includes(delivery.state) ? "Reconcile PR delivery" : "Publish accepted candidate as draft PR"}
          </Button>}
        </section>
      )}
      {job.state === "blocked" && hasRetainedSource && (
        <p className="text-sm text-muted-foreground">
          Resolve the blocker, then cancel this work to reconcile the worker before retrying.
        </p>
      )}
      {legacyRecovery && <p className="text-sm text-muted-foreground">This legacy job has no admission-time source record and cannot be retried or revised. Submit a replacement to capture the configured source before work starts.</p>}
      {job.state === "timed_out" && <p className="text-sm text-muted-foreground">Inspect the timeout evidence and recovery options. This state cannot be retried directly.</p>}
      {hasRetainedSource && ["interrupted", "cancelled"].includes(job.state) && (
        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            checked={stopped}
            onChange={(event) => setStopped(event.target.checked)}
          />
          I have verified the previous worker process has stopped. Retrying will
          inspect existing work before continuing.
        </label>
      )}
      {["queued", "running", "awaiting_approval", "blocked", "interrupted"].includes(
        job.state,
      ) && (
        <Button
          variant="ghost"
          className="text-muted-foreground hover:text-danger"
          disabled={busy}
          onClick={() => action("cancel")}
        >
          Cancel work
        </Button>
      )}
      {retry && <p className="text-xs text-muted-foreground">Retry repeats the stopped {friendlyName(latest?.command).toLowerCase()} phase.{latest?.command === "review" && " It does not change the candidate."}{canRevise && " Request changes when the implementation needs revision."}</p>}
      {retry && (
        <Button
          disabled={
            busy || requesting ||
            (["interrupted", "cancelled"].includes(job.state) && !stopped)
          }
          onClick={() => action("retry")}
        >
          Retry {friendlyName(latest?.command).toLowerCase()}
        </Button>
      )}
    </div>
  );
}

function DeliveryDetails({ delivery }) {
  const pull = delivery.pull_request;
  const checks = delivery.checks;
  const status = value => ({success:"Passed",failure:"Failed",pending:"Pending",queued:"Queued",in_progress:"In progress",unknown:"Unknown",skipped:"Skipped",neutral:"Neutral",action_required:"Action required",timed_out:"Timed out",cancelled:"Cancelled"}[value] || "Unknown");
  const checkResult = item => {
    if (item.kind !== "check_run" || item.status !== "completed") return status(item.status || "unknown");
    const conclusion = typeof item.conclusion === "string" ? item.conclusion : "unknown";
    return `${status(conclusion)} · ${conclusion}`;
  };
  const deliveryState = {
    intent: "Delivery intent saved; reconcile the same PR before deleting this issue",
    publishing: "PR delivery is in progress; reconcile the same PR before deleting this issue",
    uncertain: "PR delivery response is uncertain; reconcile the same PR before deleting this issue",
    blocked: "PR delivery is blocked; restore current evidence or inspect the saved delivery before deleting this issue",
    conflict: "PR delivery has a remote collision; inspect it before deleting this issue",
    legacy_unverified: "Legacy acceptance has no bound publication evidence",
    unverified: "Candidate evidence is unavailable; PR delivery is blocked",
  };
  return (
    <section className="space-y-2 rounded-lg border border-border bg-muted/20 p-3" aria-label="Delivery status">
      <h3 className="text-sm font-semibold">Delivery</h3>
      {delivery.state === "patch_only" || delivery.state === "patch_only_unsupported_provider"
        ? <p className="text-sm text-muted-foreground">Patch-only handoff · no trusted PR destination is enabled.</p>
        : <p className="text-sm text-muted-foreground">{delivery.state === "published" ? "PR created or reconciled" : delivery.state === "ready" ? "Ready for explicit draft PR delivery" : deliveryState[delivery.state] || delivery.state.replaceAll("_", " ")} · {delivery.repository} · target {delivery.target}</p>}
      {delivery.error && <p role="alert" className="text-sm text-danger">{delivery.error}</p>}
      {pull && <dl className="grid gap-1 text-xs sm:grid-cols-2">
        <div><dt className="text-muted-foreground">Pull request</dt><dd><a className="underline" href={pull.url} target="_blank" rel="noreferrer">#{pull.number} · {pull.state}{pull.draft ? " · draft" : ""}</a></dd></div>
        <div><dt className="text-muted-foreground">Branch → target</dt><dd className="break-all">{pull.branch} → {pull.target}</dd></div>
        <div><dt className="text-muted-foreground">Accepted base</dt><dd className="break-all font-mono">{pull.base_sha}</dd></div>
        <div><dt className="text-muted-foreground">PR head / tree</dt><dd className="break-all font-mono">{pull.head_sha} / {pull.tree}</dd></div>
        {delivery.candidate_sha && <div><dt className="text-muted-foreground">Accepted candidate</dt><dd className="break-all font-mono">{delivery.candidate_sha}</dd></div>}
        <div><dt className="text-muted-foreground">Triggered PR checks</dt><dd>{status(checks?.state || "unknown")}</dd></div>
      </dl>}
      {checks && <ul className="space-y-1 text-xs" aria-label="Actual PR check results">
        {[...(checks.check_runs || []), ...(checks.commit_statuses || [])].map((item, index) => <li key={`${item.kind || item.name}-${index}`} className="flex flex-wrap justify-between gap-2">
          {item.url && /^https:\/\//.test(item.url) ? <a className="underline" href={item.url} target="_blank" rel="noreferrer">{item.name}</a> : <span>{item.name}</span>}
          <span>{checkResult(item)}</span>
        </li>)}
        {checks.state === "unknown" && <li className="text-muted-foreground">No successful PR check result is recorded.</li>}
      </ul>}
      <p className="text-xs text-muted-foreground">Delivery records a PR only. Integration and deployment are separate.</p>
    </section>
  );
}

function resultTitle(job, result) {
  const command = friendlyName(job.runs.at(-1)?.command);
  switch (job.state) {
    case "awaiting_approval":
      return result
        ? `${friendlyName(result.command)} ready for review`
        : `Ready to start ${command.toLowerCase()}`;
    case "running":
      return `${command} in progress`;
    case "queued":
      return `${command} queued`;
    case "succeeded":
      return "Issue complete";
    default:
      return `${command} · ${stateLabel(job.state)}`;
  }
}
