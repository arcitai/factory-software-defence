import { Inbox } from "./inbox.jsx";
import { RunComposer } from "./run-composer.jsx";
import { Github } from "./github-icon.jsx";
import { TaskDetail } from "./task-detail.jsx";
import { State, TaskStateIcon, friendlyName, relativeTime, stateLabel } from "./task-display.jsx";
import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource-variable/geist";
import { Activity, BarChart3, Bot, Menu, Moon, Plus, Search, Server, Sun, List, Columns3, BookOpen, Settings2, TimerReset, X, ExternalLink, CircleHelp, ChevronDown, CheckCircle2, CirclePause, Code2, ShieldCheck, CircleAlert } from "lucide-react";
import { Analytics } from "@/analytics";
import { DefinitionPage, InfrastructurePage, AutomationsPage } from "@/catalog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { routeFromHash } from "@/routes";
import { statusGroups, boardColumns, filterJobs, groupJobsByBoardColumn, jobsByRecentActivity, jobCounts, jobDisplayTitle, nextOperatorAction, searchJobs, taskPhase } from "@/runs-board";
import { projectIdentity } from "@/project-identity";
import { createStatusLoader } from "@/status-loader";
import { TaskFilters, filterTaskFacets } from "./task-filters.jsx";
import { tokenUsageSummary, formatTaskTokenUsage } from "./run-metrics.js";
import "./styles.css";


function App() {
  const [status, setStatus] = useState({ jobs: [], workers: [], commands: [], repositories: [], triggers: [], csrf_token: "" });
  const [selection, setSelection] = useState("");
  const [repository, setRepository] = useState("");
 const [prompt, setPrompt] = useState("");
 const [title,setTitle]=useState("");
 const [sourceURL,setSourceURL]=useState("");
 const [sourceRef,setSourceRef]=useState("");
  const [model, setModel] = useState("");
  const [statusError, setStatusError] = useState("");
  const [statusLoaded, setStatusLoaded] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [taskActionError, setTaskActionError] = useState("");
  const [deliveryActionError, setDeliveryActionError] = useState("");
  const [removalError,setRemovalError] = useState("");
  const [deletingJob, setDeletingJob] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [composerOpen, setComposerOpen] = useState(false);
  const [composerLocal,setComposerLocal] = useState(false);
  const [inboxRefresh,setInboxRefresh] = useState(0);
  const [filter, setFilter] = useState([]);
  const [runsView, setRunsView] = useState(() => localStorage.getItem("factory-runs-view") === "board" ? "board" : "list");
  const [search, setSearch] = useState("");
  const [workflowFilter, setWorkflowFilter] = useState([]);
  const [modelFilter, setModelFilter] = useState([]);
  const [dark, setDark] = useState(() => localStorage.getItem("factory-theme") === "dark");
  const [route, setRoute] = useState(() => routeFromHash(window.location.hash));
  const view = route.view;
  const scrollPositions = useRef(new Map());
  const previousHash = useRef(window.location.hash);
  const returnTask = useRef(null);
  useLayoutEffect(() => {
    const key = route.view === "task" ? "" : window.location.hash;
    window.scrollTo({ top: scrollPositions.current.get(key) || 0, behavior: "instant" });
    if (route.view === "runs" && returnTask.current) {
      const link = [...document.querySelectorAll('.task-row-link')].find(item => item.getAttribute('href') === returnTask.current);
      link?.focus({ preventScroll: true });
      returnTask.current = null;
    }
  }, [route.view, route.jobID]);
  const statusLoader = useRef(null);
  if (!statusLoader.current) statusLoader.current = createStatusLoader({
    request: async () => {
      const response = await fetch("/api/v1/status", { headers: { Accept: "application/json" } });
      if (!response.ok) throw new Error(`Status request failed (${response.status})`);
      return response.json();
    },
    apply: (result) => {
      if (result.kind === "error") {
        setStatusError(result.message);
        return;
      }
      const next = result.status;
      setStatus(next);
      setStatusError("");
      setStatusLoaded(true);
      const available = new Set(selectionChoices(next).map((choice) => choice.value));
      setSelection((current) => available.has(current) ? current : available.has(localStorage.getItem("factory-workflow")) ? localStorage.getItem("factory-workflow") : firstSelection(next));
      const availableRepositories = next.repositories || [];
      setRepository((current) => availableRepositories.includes(current) ? current : availableRepositories.includes(localStorage.getItem("factory-repository")) ? localStorage.getItem("factory-repository") : availableRepositories[0] || "");
    },
  });

  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
    localStorage.setItem("factory-theme", dark ? "dark" : "light");
  }, [dark]);

  useEffect(() => {
    const updateView = () => {
      scrollPositions.current.set(previousHash.current, window.scrollY);
      if (routeFromHash(previousHash.current).view === "task") returnTask.current = previousHash.current;
      previousHash.current = window.location.hash;
      setTaskActionError("");
      setDeliveryActionError("");
      setRemovalError("");
      setRoute(routeFromHash(window.location.hash));
    };
    window.addEventListener("hashchange", updateView);
    return () => window.removeEventListener("hashchange", updateView);
  }, []);

  useEffect(() => {
    let stopped = false;
    let timer;
    const load = async () => {
      await statusLoader.current.refresh();
      if (!stopped) timer = window.setTimeout(load, 2000);
    };
    load();
    return () => {
      stopped = true;
      statusLoader.current.cancel();
      window.clearTimeout(timer);
    };
  }, []);

  const choices = useMemo(() => selectionChoices(status), [status.commands, status.workflows]);

  const repositories = status.repositories;
  const identity = projectIdentity(status.repo);

  const counts = useMemo(() => jobCounts(status.jobs), [status.jobs]);
  const matchingJobs = useMemo(() => searchJobs(status.jobs, search), [search, status.jobs]);
  const facetJobs = useMemo(() => filterTaskFacets(matchingJobs, workflowFilter, modelFilter), [matchingJobs, workflowFilter, modelFilter]);
  const visibleJobs = useMemo(() => jobsByRecentActivity(filterJobs(facetJobs, filter)), [filter, facetJobs]);
  const facetCounts = useMemo(() => jobCounts(facetJobs), [facetJobs]);
  const clearFilters = () => { setFilter([]); setSearch(""); setWorkflowFilter([]); setModelFilter([]); };

  const selectedJob = route.jobID ? status.jobs.find((job) => job.id === route.jobID) : undefined;

  function changeRunsView(nextView) {
    localStorage.setItem("factory-runs-view", nextView);
    setRunsView(nextView);
  }

  async function submit(event) {
    event.preventDefault();
    setSubmitting(true);
    setSubmitError("");
    try {
      const response = await fetch("/api/v1/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Factory-Session": status.csrf_token },
        body: JSON.stringify({ repository, model: model.trim(), ...(selection.startsWith("workflow:") ? { workflow: selection.slice(9),title: title || prompt.trim().split("\n")[0].slice(0,100),source_url:sourceURL,spec:prompt,...(sourceRef.trim()?{source_ref:sourceRef.trim()}:{}) } : { command: selection.slice(8),prompt }) }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error || `Submission failed (${response.status})`);
      }
      localStorage.setItem("factory-workflow",selection); localStorage.setItem("factory-repository",repository);
      const created = await response.json();
      setPrompt(""); setTitle(""); setSourceURL(""); setSourceRef("");
      setComposerOpen(false);
      await statusLoader.current.refresh();
      window.location.hash = `#/runs/${created.id}`;
    } catch (requestError) {
      setSubmitError(requestError.message);
    } finally {
      setSubmitting(false);
    }
  }

  async function workflowAction(job, action, stopped = false, feedback = "", sourceRef = "", revision = {}) {
    const deliveryAction = ["publish", "abandon-delivery"].includes(action);
    if (deliveryAction) setDeliveryActionError("");
    else setTaskActionError("");
    try {
      const body = action === "publish"
        ? { run_id: job.runs.at(-1)?.id }
        : action === "abandon-delivery"
          ? { run_id: job.runs.at(-1)?.id, delivery_identity: job.delivery_status?.identity, branch_sha: job.delivery_status?.remote_collision?.sha }
          : { run_id: job.runs.at(-1)?.id, ...revision, previous_process_stopped: stopped, feedback, ...(sourceRef.trim()?{source_ref:sourceRef.trim()}:{}) };
      const response = await fetch(`/api/v1/jobs/${encodeURIComponent(job.id)}/${action}`, {
        method: "POST", headers: { "Content-Type": "application/json", "X-Factory-Session": status.csrf_token },
        body: JSON.stringify(body),
      });
      if (!response.ok) { const body = await response.json().catch(() => ({})); throw new Error(body.error || "Unable to update job"); }
      await statusLoader.current.refresh();
    } catch (error) {
      if (deliveryAction) setDeliveryActionError(error.message);
      else setTaskActionError(error.message);
    }
  }

  async function deleteJob(job) {
    if (!window.confirm(`Remove local execution ${shortId(job.id)} from history? Private evidence is retained. The repository issue is unchanged.`)) return;
    setDeletingJob(job.id);
    setRemovalError("");
    try {
      const response = await fetch(`/api/v1/jobs/${encodeURIComponent(job.id)}`, {
        method: "DELETE",
        headers: { "X-Factory-Session": status.csrf_token },
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error || `Removal failed (${response.status})`);
      }
      await statusLoader.current.refresh();
      window.location.hash = "#/runs";
    } catch (requestError) {
      setRemovalError(requestError.message);
    } finally {
      setDeletingJob("");
    }
  }

  return (
    <div className="app-shell min-h-screen bg-background text-foreground md:flex">
      <aside className="app-sidebar sticky top-0 z-20 flex shrink-0 items-center border-b border-border bg-sidebar px-4 py-2 md:h-screen md:w-[203px] md:flex-col md:items-stretch md:border-b-0 md:border-r md:px-4 md:py-5">
        <div className="brand-lockup flex h-10 shrink-0 items-center gap-3 px-1">
          <a href="#/runs" className="brand-wordmark" aria-label="Factory home"><span>factory<span className="brand-period">.</span></span><span className="brand-descriptor">Software &amp; Defence</span></a>
        </div>
        <nav className="desktop-nav" aria-label="Primary">
          <PrimaryLinks view={view} />
        </nav>
        <details className="mobile-nav">
          <summary aria-label="Open navigation"><Menu className="size-4" /><span>Menu</span></summary>
          <nav aria-label="Primary mobile">
            <PrimaryLinks view={view} mobile />
            <div className="mobile-settings"><DefinitionLink view={view} mobile /></div>
          </nav>
        </details>
        <div className="sidebar-bottom">
          <nav aria-label="Settings"><DefinitionLink view={view} /></nav>
          <button onClick={() => setDark((value) => !value)} className="nav-item theme-switch" aria-label={`Switch to ${dark ? "light" : "dark"} theme`}>
            {dark ? <Moon className="size-4" /> : <Sun className="size-4" />}<span>{dark ? "Dark" : "Light"} theme</span>
          </button>
        </div>
        <button onClick={() => setDark((value) => !value)} className="mobile-theme ml-auto grid size-9 place-items-center text-muted-foreground md:hidden" aria-label={`Switch to ${dark ? "light" : "dark"} theme`}>
          {dark ? <Moon className="size-4" /> : <Sun className="size-4" />}
        </button>
      </aside>

      <main className="workshop min-w-0 flex-1">
        <ProjectContext identity={identity} links={status.project_links} compact={view === "task"} loaded={statusLoaded} error={statusError} showNewTask={view === "runs"} onNewTask={() => (setComposerLocal(false), setSubmitError(""), setComposerOpen(true))} />
        {view === "task" ? <TaskDetail identity={identity} links={status.project_links} navigation={visibleJobs.map(job => ({ id: job.id, title: jobDisplayTitle(job) }))} csrfToken={status.csrf_token} job={selectedJob} loaded={statusLoaded} error={statusError} actionError={taskActionError} removalError={removalError} deliveryActionError={deliveryActionError} deleting={deletingJob === route.jobID} onDelete={deleteJob} onWorkflowAction={workflowAction} />
          : view === "analytics" ? <Analytics jobs={status.jobs} workflows={status.workflows || []} loaded={statusLoaded} error={statusError} />
            : view === "infrastructure" ? <InfrastructurePage infrastructure={status.infrastructure} workers={status.workers} identity={identity} loaded={statusLoaded} error={statusError} />
              : view === "automations" ? <AutomationsPage control={status.automation_control} loaded={statusLoaded} error={statusError} />
                  : ["agents", "skills", "definition"].includes(view) ? <DefinitionPage key={view} section={view} />
                  : null}
        <div hidden={view !== "runs"}>
          <Inbox onLocalRequest={()=>{setComposerLocal(true);setSubmitError("");setComposerOpen(true);}} token={status.csrf_token} provider={status.issue_provider} history={status.issue_history || []} statusError={statusError} refreshKey={inboxRefresh} onStarted={async created=>{await statusLoader.current.refresh();window.location.hash=`#/runs/${created.id}`;}} executionView={<RunsOverview
                    visibleJobs={visibleJobs}
                    counts={facetCounts}
                    jobs={status.jobs}
                    workflows={status.workflows || []}
                    workflowFilter={workflowFilter}
                    setWorkflowFilter={setWorkflowFilter}
                    modelFilter={modelFilter}
                    setModelFilter={setModelFilter}
                    clearFilters={clearFilters}
                    loaded={statusLoaded}
                    statusError={statusError}
                    submitError={submitError}
                    synthetic={(status.harness ?? status.agent) === "mock"}
                    filter={filter}
                    setFilter={setFilter}
                    search={search}
                    setSearch={setSearch}
                    runsView={runsView}
                    setRunsView={changeRunsView}
                    refresh={() => statusLoader.current.refresh()}
                    openComposer={() => (setComposerLocal(false), setSubmitError(""), setComposerOpen(true))}
                  />} />
          {composerOpen && <RunComposer localOnly={composerLocal} onCreated={()=>setInboxRefresh(value=>value+1)} issueProvider={status.issue_provider} csrfToken={status.csrf_token} projectLinks={status.project_links} sourceRefDefault={status.source_ref_default || "HEAD"} sourceRef={sourceRef} setSourceRef={setSourceRef} error={submitError} title={title} setTitle={setTitle} sourceURL={sourceURL} setSourceURL={setSourceURL} choices={choices} repositories={repositories} identity={identity} selection={selection} setSelection={setSelection} repository={repository} setRepository={setRepository} prompt={prompt} setPrompt={setPrompt} model={model} setModel={setModel} submitting={submitting} submit={submit} close={() => setComposerOpen(false)} />}
        </div>
      </main>
    </div>
  );
}

function DefinitionLink({ view, mobile = false }) {
  return <a href="#/definition" title="Factory settings and definition" aria-current={view === "definition" ? "page" : undefined} className={cn("nav-item", view === "definition" && "nav-item-active")} onClick={event => { if (mobile) event.currentTarget.closest("details")?.removeAttribute("open"); }}><Settings2 className="size-4" /><span>Definition</span></a>;
}

function PrimaryLinks({ view, mobile = false }) {
  const link = (href, Icon, label, active) => <a href={href} aria-current={active ? "page" : undefined} className={cn("nav-item", active && "nav-item-active")} onClick={(event) => { if (mobile) event.currentTarget.closest("details")?.removeAttribute("open"); }}>
    <Icon className="size-4" /><span>{label}</span>
  </a>;
  return <>
    {link("#/inbox", Activity, "Inbox", view === "runs" || view === "task")}
    {link("#/analytics", BarChart3, "Analytics", view === "analytics")}
    {link("#/agents", Bot, "Agents", view === "agents")}
    {link("#/skills", BookOpen, "Skills", view === "skills")}
    {link("#/automations", TimerReset, "Automations", view === "automations")}
    {link("#/infrastructure", Server, "Infrastructure", view === "infrastructure")}
  </>;
}

function ProjectContext({ identity, links, compact, loaded, error, showNewTask, onNewTask }) {
  const title = identity?.name || (!loaded && !error ? "Loading configured project…" : "Project identity unavailable");
  const freshness = error ? loaded ? "Status stale" : "Status unavailable" : loaded ? "Status current" : "Loading status";
  return <header aria-label="Configured project" className={cn("project-header", compact && "project-header-compact")}>
    <div className="project-heading">
      <div className="project-heading-copy">
        <h1 title={identity?.name}>{title}</h1>
        <div className="project-context-line">
          <span className={cn("project-freshness", error && "is-stale")} title={error || undefined} aria-label={error ? `${freshness}: ${error}` : freshness} aria-live="polite"><span className="freshness-dot" />{freshness}</span>
          {identity && <ProjectTooltip path={identity.path} />}
        </div>
      </div>
      <div className="project-actions">
        {links?.repository && <a className="repo-action" href={links.repository} target="_blank" rel="noreferrer"><Github size={14} />View repo<ExternalLink size={12} /></a>}
        {showNewTask && <button className="repo-action new-issue-action" type="button" onClick={onNewTask} disabled={!loaded || Boolean(error)}><Plus size={14} />New issue</button>}

      </div>
    </div>
  </header>;
}

function ProjectTooltip({ path }) {
  const [open, setOpen] = useState(false), id = React.useId();
  return <span className="project-path" onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)} onBlur={() => setOpen(false)} onKeyDown={event => { if (event.key === "Escape") setOpen(false); }}>
    <button type="button" aria-label="Project details" aria-describedby={open ? id : undefined} onFocus={() => setOpen(true)} onClick={() => setOpen(true)}><CircleHelp size={13} />Project details</button>
    <span id={id} role="tooltip" hidden={!open}>Configured project<br /><code>{path}</code></span>
  </span>;
}

const filterOptions = [
  { id: "all", label: "All executions", count: "all" },
  { id: "in_progress", label: "In progress", count: "active" },
  { id: "queued", label: "Queued", count: "queued" },
  { id: "running", label: "Running", count: "running" },
  { id: "cancelling", label: "Cancelling", count: "cancelling" },
  { id: "needs_attention", label: "Needs attention", count: "needsAttention" },
  { id: "failed", label: "Failed work", count: "failed" },
  { id: "failed_review", label: "Failed review", count: "reviewFailed" },
  { id: "review_changes", label: "Review changes available", count: "reviewChanges" },
  { id: "blocked", label: "Blocked", count: "blocked" },
  { id: "interrupted", label: "Interrupted", count: "interrupted" },
  { id: "awaiting_approval", label: "Awaiting acceptance", count: "awaitingApproval" },
  { id: "succeeded", label: "Completed", count: "succeeded" },
  { id: "cancelled", label: "Cancelled", count: "cancelled" },
  { id: "other", label: "Other state", count: "other" },
];

function formatCount(counts, key) {
  return counts[key] ?? "—";
}

function RunsOverview({ visibleJobs, jobs, workflows, counts, loaded, statusError, submitError, synthetic, filter, setFilter, search, setSearch, workflowFilter, setWorkflowFilter, modelFilter, setModelFilter, clearFilters, runsView, setRunsView, refresh, openComposer, composer }) {
  const filtering = filter.length > 0 || Boolean(search.trim()) || workflowFilter.length > 0 || modelFilter.length > 0;
  const selectStatus = value => setFilter(value === "all" || filter.length === 1 && filter[0] === value ? [] : [value]);
  return <div className="runs-page">
    <div className="tasks-toolbar">
      <h2 className="sr-only">Executions</h2>
      <TaskFilters jobs={jobs} availableWorkflows={workflows} workflow={workflowFilter} setWorkflow={setWorkflowFilter} model={modelFilter} setModel={setModelFilter} filter={filter} setFilter={setFilter} options={filterOptions} disabled={!loaded} />
      <div className="tasks-tools">
        <div className="view-toggle" role="group" aria-label="Execution view">
          <Button variant="ghost" size="sm" className={cn(runsView === "list" && "view-active")} aria-pressed={runsView === "list"} onClick={() => setRunsView("list")} aria-label="List" title="List view"><List className="size-3.5" /><span className="sr-only">List</span></Button>
          <Button variant="ghost" size="sm" className={cn(runsView === "board" && "view-active")} aria-pressed={runsView === "board"} onClick={() => setRunsView("board")} aria-label="Board" title="Kanban board"><Columns3 className="size-3.5" /><span className="sr-only">Board</span></Button>
        </div>
        <div className="task-search" role="search">
          <Search className="size-4" aria-hidden="true" />
          <input type="search" aria-label="Search executions" placeholder="Search executions" value={search} onChange={(event) => setSearch(event.target.value)} />
          {search && <button type="button" className="clear-search" aria-label="Clear search" onClick={() => setSearch("")}><X className="size-3.5" /></button>}
        </div>
      </div>
    </div>
    {synthetic && <p className="synthetic-note">Synthetic installation demo — no model calls.</p>}
    <div className="active-filters"><span role="status">{loaded ? filtering ? `Showing ${visibleJobs.length} of ${jobs.length} executions` : `${jobs.length} ${jobs.length === 1 ? "execution" : "executions"}` : "Loading executions…"}</span><div className="task-list-actions"><button onClick={clearFilters} disabled={!filtering}>Clear filters<X size={12} /></button></div></div>

    {composer}

    {statusError && loaded && <div className="stale-banner" role="status"><span><strong>Status stale.</strong> Showing the last available task data. {statusError}</span><Button variant="outline" size="sm" onClick={refresh}>Refresh</Button></div>}

    <div className={cn("run-workspace", runsView === "board" && "is-board")}>
      <TaskFilterRail counts={counts} loaded={loaded} filter={filter} setFilter={selectStatus} />
      <section className="task-results" aria-label="Execution results">
        {!loaded && !statusError ? <TaskMessage kind="loading" title="Loading executions" description="Checking the latest task state." />
          : !loaded && statusError ? <TaskMessage kind="error" title="Execution status unavailable" description={statusError} action="Retry status" onAction={refresh} />
            : runsView === "board" ? <RunBoard jobs={visibleJobs} />
            : !visibleJobs.length ? <EmptyRuns filtered={filtering} clearFilters={clearFilters} openComposer={openComposer} />
                : <div className="task-list" role="list">{visibleJobs.map((job) => <RunRow key={job.id} job={job} setFilter={selectStatus} />)}</div>}
      </section>
    </div>
  </div>;
}

function TaskFilterRail({ counts, loaded, filter, setFilter }) {
  const icons = { in_progress: Code2, needs_attention: CircleAlert, awaiting_approval: ShieldCheck, succeeded: CheckCircle2, cancelled: CirclePause, other: CircleHelp };
  const groups = statusGroups.filter(group => group.id !== "other" || counts.other).map(group => ({ ...group, Icon: icons[group.id] }));
  const [expanded, setExpanded] = useState({ in_progress: true, needs_attention: true });
  return <aside className="task-filter-rail" aria-label="Filter executions by status">
    <button className="all-tasks-filter" type="button" aria-pressed={filter.length === 0} onClick={() => setFilter("all")} disabled={!loaded}><span>All executions</span></button>
    {groups.map(({ Icon, ...group }) => <section className={`filter-card tone-${group.tone}`} key={group.id}>
      <button className="filter-card-main" type="button" aria-pressed={filter.includes(group.id)} onClick={() => setFilter(group.id)} disabled={!loaded}>
        <span className="filter-card-heading"><Icon size={14} /><span>{group.label}</span><span className="filter-card-count">{loaded ? counts[group.count] : "—"}</span></span>
      </button>
      {group.children && <>
        <button className="filter-disclosure" aria-expanded={Boolean(expanded[group.id])} aria-controls={`filter-${group.id}`} onClick={() => setExpanded(value => ({ ...value, [group.id]: !value[group.id] }))}>Status details<ChevronDown size={12} /></button>
        <div className="filter-card-children" id={`filter-${group.id}`} hidden={!expanded[group.id]}>
          {group.children.map(([id, label, count]) => <button type="button" className="filter-substate" key={id} aria-pressed={filter.includes(id)} onClick={() => setFilter(id)} disabled={!loaded}><span>{label}</span><span>{formatCount(loaded ? counts : {}, count)}</span></button>)}
        </div>
      </>}
    </section>)}
  </aside>;
}

function TaskMessage({ kind, title, description, action, onAction }) {
  return <div className={`task-message task-message-${kind}`} role={kind === "error" ? "alert" : "status"}>
    <h3>{title}</h3>
    <p>{description}</p>
    {action && <Button variant="outline" size="sm" onClick={onAction}>{action}</Button>}
  </div>;
}

function RunBoard({ jobs }) {
  const groupedJobs = groupJobsByBoardColumn(jobs);
  return <div className="kanban-scroll" role="region" aria-label="Issue board — scroll horizontally" tabIndex={0}><div className="kanban-board">
    {boardColumns.filter((column) => column.id !== "other" || groupedJobs.other.length > 0).map((column) => <section key={column.id} className={`run-column tone-${column.tone}`} aria-labelledby={`board-${column.id}`}>
      <header className="flex items-center justify-between gap-3 border-b border-border px-3 py-2.5">
        <div className="min-w-0"><h2 id={`board-${column.id}`} className="text-sm font-semibold">{column.title}</h2><p className="break-words text-xs text-muted-foreground">{column.description}</p></div>
        <Badge className="shrink-0 border-border bg-surface text-muted-foreground" aria-label={`${groupedJobs[column.id].length} visible ${column.title.toLowerCase()} runs`}>{groupedJobs[column.id].length}</Badge>
      </header>
      <div className="grid min-w-0 gap-2 p-2">
        {groupedJobs[column.id].length ? groupedJobs[column.id].map((job) => <RunCard key={job.id} job={job} />) : <p className="px-2 py-8 text-center text-xs text-muted-foreground">No executions</p>}
      </div>
    </section>)}
  </div></div>;
}

function RunCard({ job }) {
  const title = jobDisplayTitle(job);
  return <Card className="overflow-hidden"><a href={`#/runs/${encodeURIComponent(job.id)}`} className="run-card-link" aria-label={`Open execution ${title}`}>
    <p className="run-card-title">{title}</p>
    <p className="run-card-meta">{friendlyName(job.workflow?.name || job.command)} · {friendlyName(taskPhase(job))}</p>
    <div className="run-card-status"><State value={job.state} /><span>{nextOperatorAction(job)}</span></div>
  </a></Card>;
}

function RunRow({ job, setFilter }) {
  const title = jobDisplayTitle(job);
  const workflow = job.workflow?.name || job.command;
  const phase = taskPhase(job);
  const usage = tokenUsageSummary(job.runs || []);
  return <article className="task-row" role="listitem">
    <TaskStateIcon value={job.state} />
    <a href={`#/runs/${encodeURIComponent(job.id)}`} className="task-row-link" aria-label={`Open execution ${title}, ${stateLabel(job.state)}, ${nextOperatorAction(job)}`}>
      <p className="task-row-title">{title}</p>
      <div className="task-row-meta">
        <time dateTime={job.updated_at}>{job.updated_at ? `Last activity ${relativeTime(job.updated_at)}` : "Last activity unavailable"}</time>
        {(workflow || phase) && <span>{[workflow, phase].filter(Boolean).map(friendlyName).join(" · ")}</span>}
        {usage.total !== undefined && <span title={formatTaskTokenUsage(usage)}>{formatTaskTokenUsage(usage)}</span>}
      </div>
    </a>
    <button className="row-badge-filter" aria-label={`Filter by ${stateLabel(job.state)} badge`} onClick={() => setFilter(job.state === "timed_out" ? "failed" : filterOptions.some(option => option.id === job.state) ? job.state : "other")}><State value={job.state} /></button>
  </article>;
}

function EmptyRuns({ filtered, clearFilters, openComposer }) {
  return <div className="empty-tasks" role="status">
    <h3>{filtered ? "No matching executions" : "No executions yet"}</h3>
    <p>{filtered ? "Try another state or search term." : "Start work explicitly from a repository issue or a local execution request."}</p>
    {filtered ? <Button variant="outline" size="sm" onClick={clearFilters}>Clear filters</Button> : <Button variant="outline" size="sm" onClick={openComposer}><Plus className="size-3.5" />New issue</Button>}
  </div>;
}


function selectionChoices(status) {
 const workflows=status.workflows || [];
 return workflows.length ? workflows.map(name=>({value:`workflow:${name}`,label:friendlyName(name)})) : (status.commands || []).map(name=>({value:`command:${name}`,label:friendlyName(name)}));
}
function firstSelection(status) { return selectionChoices(status)[0]?.value || ""; }
function shortId(id) { const [, value = id] = id.split("_", 2); return value.slice(0, 8); }
export const appRoot = createRoot(document.getElementById("root"));
appRoot.render(<App />);
