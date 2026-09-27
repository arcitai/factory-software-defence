import React, { useState } from 'react';
import { Search, List, Columns3, X, Plus, ChevronDown, CircleHelp, Code2, CircleAlert, ShieldCheck, CheckCircle2, CirclePause } from 'lucide-react';
import { Button } from './components/ui/button';
import { Card } from './components/ui/card';
import { Badge } from './components/ui/badge';
import { cn } from './lib/utils';
import { TaskFilters } from './task-filters.jsx';
import { State, TaskStateIcon, friendlyName, relativeTime, stateLabel } from './task-display.jsx';
import { statusGroups, boardColumns, groupJobsByBoardColumn, jobDisplayTitle, nextOperatorAction, taskPhase } from './runs-board.js';
import { Labels } from './issue-labels.jsx';
const filterOptions = [
  { id: "not_started", label: "Not started", count: "notStarted" },
  { id: "all", label: "All work", count: "all" },
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

export function RunsOverview({ visibleJobs, jobs, workflows, counts, loaded, statusError, submitError, synthetic, filter, setFilter, search, setSearch, workflowFilter, setWorkflowFilter, modelFilter, setModelFilter, clearFilters, runsView, setRunsView, refresh, openComposer, composer, labelFilter = [], setLabelFilter, sourceControls, sourceNotice, sourceLoading, sourceUnavailable }) {
  const filtering = labelFilter.length > 0 || filter.length > 0 || Boolean(search.trim()) || workflowFilter.length > 0 || modelFilter.length > 0;
  const selectStatus = value => setFilter(value === "all" || filter.length === 1 && filter[0] === value ? [] : [value]);
  return <div className="runs-page">
    <div className="tasks-toolbar">
      <h2 className="sr-only">Inbox work</h2>
      <TaskFilters jobs={jobs} availableWorkflows={workflows} workflow={workflowFilter} setWorkflow={setWorkflowFilter} model={modelFilter} setModel={setModelFilter} filter={filter} setFilter={setFilter} labels={labelFilter} setLabels={setLabelFilter} options={filterOptions} disabled={!loaded} />
      <div className="tasks-tools">
        <div className="view-toggle" role="group" aria-label="Work view">
          <Button variant="ghost" size="sm" className={cn(runsView === "list" && "view-active")} aria-pressed={runsView === "list"} onClick={() => setRunsView("list")} aria-label="List" title="List view"><List className="size-3.5" /><span className="sr-only">List</span></Button>
          <Button variant="ghost" size="sm" className={cn(runsView === "board" && "view-active")} aria-pressed={runsView === "board"} onClick={() => setRunsView("board")} aria-label="Board" title="Kanban board"><Columns3 className="size-3.5" /><span className="sr-only">Board</span></Button>
        </div>
        <div className="task-search" role="search">
          <Search className="size-4" aria-hidden="true" />
          <input type="search" aria-label="Search loaded work" placeholder="Search loaded work" value={search} onChange={(event) => setSearch(event.target.value)} />
          {search && <button type="button" className="clear-search" aria-label="Clear search" onClick={() => setSearch("")}><X className="size-3.5" /></button>}
        </div>
      </div>
    </div>
    {synthetic && <p className="synthetic-note">Synthetic installation demo — no model calls.</p>}
    <div className="active-filters"><span role="status">{loaded ? `${visibleJobs.length === jobs.length ? jobs.length : `${visibleJobs.length} of ${jobs.length}`} items` : "Loading work…"}</span>{sourceControls}<div className="task-list-actions"><button onClick={clearFilters} disabled={!filtering}>Clear filters<X size={12} /></button></div></div>
    {sourceNotice}

    {composer}

    {statusError && loaded && <div className="stale-banner" role="status"><span><strong>Status stale.</strong> Showing the last available task data. {statusError}</span><Button variant="outline" size="sm" onClick={refresh}>Refresh</Button></div>}

    <div className={cn("run-workspace", runsView === "board" && "is-board")}>
      <TaskFilterRail counts={counts} loaded={loaded} filter={filter} setFilter={selectStatus} />
      <section className="task-results" aria-label="Work results">
        {!loaded && !statusError ? <TaskMessage kind="loading" title="Loading executions" description="Checking the latest task state." />
          : !loaded && statusError ? <TaskMessage kind="error" title="Execution status unavailable" description={statusError} action="Retry status" onAction={refresh} />
            : !jobs.length && sourceLoading ? <TaskMessage kind="loading" title="Loading repository work" description="Waiting for the requested provider page." />
            : !jobs.length && sourceUnavailable ? <TaskMessage kind="error" title="Repository work unavailable" description="No retained executions are available. Refresh issues to retry the provider read." />
            : !visibleJobs.length ? <EmptyRuns filtered={filtering} clearFilters={clearFilters} openComposer={openComposer} />
                : runsView === "board" ? <RunBoard jobs={visibleJobs} /> : <div className="task-list" role="list">{visibleJobs.map((job) => <RunRow key={job.id} job={job} setFilter={selectStatus} />)}</div>}
      </section>
    </div>
  </div>;
}

function TaskFilterRail({ counts, loaded, filter, setFilter }) {
  const icons = { in_progress: Code2, needs_attention: CircleAlert, awaiting_approval: ShieldCheck, succeeded: CheckCircle2, cancelled: CirclePause, not_started: CirclePause, other: CircleHelp };
  const groups = statusGroups.filter(group => (group.id !== "other" || counts.other) && (group.id !== "not_started" || counts.notStarted)).map(group => ({ ...group, Icon: icons[group.id] }));
  const [expanded, setExpanded] = useState({ in_progress: true, needs_attention: true });
  return <aside className="task-filter-rail" aria-label="Filter work by status">
    <button className="all-tasks-filter" type="button" aria-pressed={filter.length === 0} onClick={() => setFilter("all")} disabled={!loaded}><span>All work</span></button>
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
    {boardColumns.filter((column) => (column.id !== "other" || groupedJobs.other.length > 0) && (column.id !== "not_started" || groupedJobs.not_started.length > 0)).map((column) => <section key={column.id} className={`run-column tone-${column.tone}`} aria-labelledby={`board-${column.id}`}>
      <header className="flex items-center justify-between gap-3 border-b border-border px-3 py-2.5">
        <div className="min-w-0"><h2 id={`board-${column.id}`} className="text-sm font-semibold">{column.title}</h2><p className="break-words text-xs text-muted-foreground">{column.description}</p></div>
        <Badge className="shrink-0 border-border bg-surface text-muted-foreground" aria-label={`${groupedJobs[column.id].length} visible ${column.title.toLowerCase()} work records`}>{groupedJobs[column.id].length}</Badge>
      </header>
      <div className="grid min-w-0 gap-2 p-2">
        {groupedJobs[column.id].length ? groupedJobs[column.id].map((job) => <RunCard key={job.id} job={job} />) : <p className="px-2 py-8 text-center text-xs text-muted-foreground">No work</p>}
      </div>
    </section>)}
  </div></div>;
}

function RunCard({ job }) {
  const title = jobDisplayTitle(job);
  return <Card className="overflow-hidden"><a href={job.href || `#/runs/${encodeURIComponent(job.id)}`} className="run-card-link" aria-label={`Open work ${title}`}>
    <p className="run-card-title">{title}</p>
    <WorkMetadata job={job} /><div className="run-card-status"><State value={job.state} /><span>{nextOperatorAction(job)}</span></div>
  </a></Card>;
}

function RunRow({ job, setFilter }) {
  const title = jobDisplayTitle(job);
  return <article className="task-row" role="listitem">
    <TaskStateIcon value={job.state} />
    <a href={job.href || `#/runs/${encodeURIComponent(job.id)}`} className="task-row-link" aria-label={`Open work ${title}, ${stateLabel(job.state)}, ${nextOperatorAction(job)}`}>
      <p className="task-row-title">{title}</p>
      <WorkMetadata job={job} />
    </a>
    <button className="row-badge-filter" aria-label={`Filter by ${stateLabel(job.state)} badge`} onClick={() => setFilter(job.state === "timed_out" ? "failed" : filterOptions.some(option => option.id === job.state) ? job.state : "other")}><State value={job.state} /></button>
  </article>;
}

function EmptyRuns({ filtered, clearFilters, openComposer }) {
  return <div className="empty-tasks" role="status">
    <h3>{filtered ? "No matching work" : "No loaded work yet"}</h3>
    <p>{filtered ? "Try another state or search term." : "Start work explicitly from a repository issue or a local execution request."}</p>
    {filtered ? <Button variant="outline" size="sm" onClick={clearFilters}>Clear filters</Button> : <Button variant="outline" size="sm" onClick={openComposer}><Plus className="size-3.5" />New issue</Button>}
  </div>;
}

function WorkMetadata({ job }) {
  const record = job.work;
  const workflow = job.workflow?.name || job.command;
  const phase = taskPhase(job);
  const parts = [
    record?.identity ? `#${record.identity.number}${record.issue?.author ? ` by ${record.issue.author}` : ''}` : record ? 'Local request' : null,
    job.updated_at ? <time dateTime={job.updated_at} title={`Last activity ${job.updated_at}`}>{relativeTime(job.updated_at)}</time> : null,
    [workflow, phase].filter(Boolean).map(friendlyName).join(' · '),
    record?.identity && (record.issue ? record.issue.state : 'Source not loaded'),
    record?.issue?.readiness && <span title="Issue readiness">{record.issue.readiness.label}</span>,
    record?.executions.length > 1 ? `${record.executions.length} attempts` : null,
  ].filter(Boolean);
  return <>
    <div className="task-row-meta">{parts.map((part,index)=><span className="work-meta-part" key={index}>{part}</span>)}</div>
    <Labels labels={record?.issue?.labels} />
  </>;
}
