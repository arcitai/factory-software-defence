import React, { useId, useRef, useState } from 'react';
import { Search, List, Columns3, X, Plus, ChevronDown } from 'lucide-react';
import { Button } from './components/ui/button';
import { Card } from './components/ui/card';
import { Badge } from './components/ui/badge';
import { cn } from './lib/utils';
import { TaskFilters } from './task-filters.jsx';
import { State, LifecycleGlyph, friendlyName, relativeTime, stateLabel } from './task-display.jsx';
import { statusGroups, boardColumns, groupJobsByBoardColumn, jobDisplayTitle, nextOperatorAction, taskPhase } from './runs-board.js';
import { NATIVE_STATES, closureReasonLabel } from '../../factory/issue-lifecycle.mjs';
import { Labels } from './issue-labels.jsx';
import { Contributors } from './contributors.jsx';

export function RunsOverview({ visibleJobs, jobs, workflows, counts, phaseCounts, loaded, statusError, filter, setFilter, phaseFilter, setPhaseFilter,
  search, setSearch, workflowFilter, setWorkflowFilter, clearFilters, runsView, setRunsView, refresh, openComposer, composer, labelFilter = [],
  setLabelFilter, sourceControls, sourceNotice, sourceLoading, sourceUnavailable }) {
  const filtering = phaseFilter.length > 0 || labelFilter.length > 0 || filter.length > 0 || Boolean(search.trim()) || workflowFilter.length > 0;
  const selectPhase = value => setPhaseFilter(previous => value === 'all' ? [] : previous.includes(value) ? previous.filter(item => item !== value) : [...previous, value]);
  const nativeFilterOptions = [
    ...statusGroups.map(group => ({ ...group, count: counts[group.id] || 0 })),
    ...NATIVE_STATES.filter(state => !statusGroups.some(group => group.id === state.id)).map(state => ({ ...state, count: counts[state.id] || 0 })),
  ];
  return <div className="runs-page">
    <div className="tasks-toolbar">
      <h2 className="sr-only">Inbox work</h2>
      <TaskFilters jobs={jobs} availableWorkflows={workflows} workflow={workflowFilter} setWorkflow={setWorkflowFilter} filter={filter}
        setFilter={setFilter} phaseFilter={phaseFilter} setPhaseFilter={setPhaseFilter} phaseCounts={phaseCounts} labels={labelFilter} setLabels={setLabelFilter} options={nativeFilterOptions} disabled={!loaded} />
      <div className="tasks-tools">
        <div className="view-toggle" role="group" aria-label="Work view">
          <Button variant="ghost" size="sm" className={cn(runsView === "list" && "view-active")} aria-pressed={runsView === "list"} onClick={() => setRunsView("list")} aria-label="List" title="List view"><List className="size-3.5" /><span className="sr-only">List</span></Button>
          <Button variant="ghost" size="sm" className={cn(runsView === "board" && "view-active")} aria-pressed={runsView === "board"} onClick={() => setRunsView("board")} aria-label="Board" title="Kanban board"><Columns3 className="size-3.5" /><span className="sr-only">Board</span></Button>
        </div>
        <div className="task-search" role="search">
          <Search className="size-4" aria-hidden="true" />
          <input type="search" aria-label="Search loaded work" placeholder="Search loaded work" value={search} onChange={event => setSearch(event.target.value)} />
          {search && <button type="button" className="clear-search" aria-label="Clear search" onClick={() => setSearch("")}><X className="size-3.5" /></button>}
        </div>
      </div>
    </div>
    <div className="active-filters"><span role="status">{loaded ? `${visibleJobs.length === jobs.length ? jobs.length : `${visibleJobs.length} of ${jobs.length}`} items` : "Loading work…"}</span>{sourceControls}<div className="task-list-actions"><button onClick={clearFilters} disabled={!filtering}>Clear filters<X size={12} /></button></div></div>
    {sourceNotice}

    {composer}

    {statusError && loaded && <div className="stale-banner" role="status"><span><strong>Status stale.</strong> Showing the last available task data. {statusError}</span><Button variant="outline" size="sm" onClick={refresh}>Refresh</Button></div>}

    <div className={cn("run-workspace", runsView === "board" && "is-board")}>
      <TaskFilterRail counts={phaseCounts} loaded={loaded} filter={phaseFilter} setFilter={selectPhase} />
      <section className="task-results" aria-label="Work results">
        {!loaded && !statusError ? <TaskMessage kind="loading" title="Loading project work" description="Checking GitHub issues and native Codex history." />
          : !loaded && statusError ? <TaskMessage kind="error" title="Project status unavailable" description={statusError} action="Retry status" onAction={refresh} />
            : !jobs.length && sourceLoading ? <TaskMessage kind="loading" title="Loading repository work" description="Waiting for the requested provider page." />
            : !jobs.length && sourceUnavailable ? <TaskMessage kind="error" title="Repository issues unavailable" description="No issue snapshot is available. Refresh issues to retry the provider read." />
            : !visibleJobs.length ? <EmptyRuns filtered={filtering} clearFilters={clearFilters} openComposer={openComposer} />
                : runsView === "board" ? <RunBoard jobs={visibleJobs} phaseFilter={phaseFilter} selectPhase={selectPhase} filter={filter} setFilter={setFilter} />
                : <div className="task-list" role="list">{visibleJobs.map(job => <RunRow key={job.id} job={job} phaseFilter={phaseFilter} selectPhase={selectPhase} filter={filter} setFilter={setFilter} />)}</div>}
      </section>
    </div>
  </div>;
}

function TaskFilterRail({ counts, loaded, filter, setFilter }) {
  const [expanded, setExpanded] = useState(true);
  return <aside className="task-filter-rail" aria-label="Filter work by repository phase">
    <button className="all-tasks-filter" type="button" aria-pressed={filter.length === 0} onClick={() => setFilter('all')} disabled={!loaded}><span>All phases</span></button>
    <section className="phase-filter-section" aria-label="Repository phase groups">
      <button className="filter-disclosure" aria-expanded={expanded} aria-controls="phase-filter-groups" onClick={() => setExpanded(value => !value)}>Repository phase groups<ChevronDown size={12} /></button>
      <div className="phase-filter-groups" id="phase-filter-groups" hidden={!expanded}>
        {boardColumns.map(stage => <PhaseRailButton key={stage.id} stage={stage} count={loaded ? counts[stage.id] : '—'} pressed={filter.includes(stage.id)} onClick={() => setFilter(stage.id)} disabled={!loaded} />)}
      </div>
    </section>
  </aside>;
}

function PhaseRailButton({ stage, count, pressed, onClick, disabled }) {
  const tooltip = usePhaseTooltip(stage.description);
  return <span className="phase-filter-control phase-rail-control" ref={tooltip.ref} onMouseEnter={tooltip.show} onMouseLeave={tooltip.closeIfInactive} onKeyDown={tooltip.onKeyDown}>
    <button type="button" className={`phase-filter-option phase-filter-card tone-${stage.tone}`} aria-pressed={pressed}
      aria-label={`Filter by repository phase: ${stage.label}`} aria-describedby={tooltip.id} title={stage.description} onFocus={tooltip.show} onBlur={tooltip.closeIfInactive} onClick={onClick} disabled={disabled}>
      <span className="phase-filter-heading"><LifecycleGlyph definition={stage} size={14} /><span>{stage.label}</span><span className="filter-card-count">{count}</span></span>
    </button>
    <span id={tooltip.id} role="tooltip" className="phase-tooltip" style={tooltip.position || undefined} hidden={!tooltip.open}>{stage.description}</span>
  </span>;
}

function TaskMessage({ kind, title, description, action, onAction }) {
  return <div className={`task-message task-message-${kind}`} role={kind === "error" ? "alert" : "status"}>
    <h3>{title}</h3><p>{description}</p>
    {action && <Button variant="outline" size="sm" onClick={onAction}>{action}</Button>}
  </div>;
}

function RunBoard({ jobs, phaseFilter, selectPhase, filter, setFilter }) {
  const groupedJobs = groupJobsByBoardColumn(jobs);
  return <div className="kanban-scroll" role="region" aria-label="Issue board — scroll horizontally" tabIndex={0}><div className="kanban-board">
    {boardColumns.map(stage => <section key={stage.id} className={`run-column tone-${stage.tone}`} aria-labelledby={`board-${stage.id}`}>
      <header className="run-column-heading">
        <div className="run-column-title"><LifecycleGlyph definition={stage} size={15} /><div className="min-w-0"><h2 id={`board-${stage.id}`}>{stage.label}</h2><p>{stage.description}</p></div></div>
        <Badge className="shrink-0 border-border bg-surface text-muted-foreground" aria-label={`${groupedJobs[stage.id].length} visible ${stage.label.toLowerCase()} work records`}>{groupedJobs[stage.id].length}</Badge>
      </header>
      <div className="grid min-w-0 gap-2 p-2">
        {groupedJobs[stage.id].length ? groupedJobs[stage.id].map(job => <RunCard key={job.id} job={job} phaseFilter={phaseFilter} selectPhase={selectPhase} filter={filter} setFilter={setFilter} />)
          : <p className="px-2 py-8 text-center text-xs text-muted-foreground">No work</p>}
      </div>
    </section>)}
  </div></div>;
}

function PhaseFilterButton({ phase, phaseFilter, selectPhase, compact = false }) {
  const description = phase?.detail || phase?.description || phase?.label || 'Repository phase is unresolved.';
  const tooltip = usePhaseTooltip(description);
  return <span className="phase-filter-control" ref={tooltip.ref} onMouseEnter={tooltip.show} onMouseLeave={tooltip.closeIfInactive} onKeyDown={tooltip.onKeyDown}>
    <button type="button" className={`phase-filter-badge tone-${phase?.tone || 'orange'}${compact ? ' is-compact' : ''}`} aria-label={`Filter by repository phase: ${phase?.label || 'Source unresolved'}`}
      aria-describedby={tooltip.id} aria-pressed={phaseFilter.includes(phase?.id || 'unresolved')} title={phase?.detail || phase?.description || phase?.label} onFocus={tooltip.show} onBlur={tooltip.closeIfInactive} onClick={() => selectPhase(phase?.id || 'unresolved')}>
      <LifecycleGlyph definition={phase} size={13} /><span>{phase?.label || 'Source unresolved'}</span>
    </button>
    <span id={tooltip.id} role="tooltip" className="phase-tooltip" style={tooltip.position || undefined} hidden={!tooltip.open}>{description}</span>
  </span>;
}

function PhaseIconButton({ phase, phaseFilter, selectPhase }) {
  const description = phase?.detail || phase?.description || phase?.label || 'Repository phase is unresolved.';
  const tooltip = usePhaseTooltip(description);
  return <span className="phase-filter-control phase-row-control" ref={tooltip.ref} onMouseEnter={tooltip.show} onMouseLeave={tooltip.closeIfInactive} onKeyDown={tooltip.onKeyDown}>
    <button type="button" className={`phase-row-icon tone-${phase?.tone || 'orange'}`} aria-label={`Filter by repository phase: ${phase?.label || 'Source unresolved'}`}
      aria-describedby={tooltip.id} aria-pressed={phaseFilter.includes(phase?.id || 'unresolved')} title={phase?.detail || phase?.description || phase?.label}
      onFocus={tooltip.show} onBlur={tooltip.closeIfInactive} onClick={() => selectPhase(phase?.id || 'unresolved')}><LifecycleGlyph definition={phase} size={14} /></button>
    <span id={tooltip.id} role="tooltip" className="phase-tooltip" style={tooltip.position || undefined} hidden={!tooltip.open}>{description}</span>
  </span>;
}

function usePhaseTooltip(description) {
  const [open, setOpen] = useState(false), [position, setPosition] = useState(null), id = useId(), ref = useRef(null);
  const show = () => {
    const rect = ref.current?.getBoundingClientRect();
    if (rect) {
      const width = Math.min(280, window.innerWidth - 32);
      setPosition({ position: 'fixed', left: Math.max(16, Math.min(rect.left, window.innerWidth - width - 16)),
        top: Math.max(8, Math.min(rect.bottom + 6, window.innerHeight - 80)) });
    }
    setOpen(true);
  };
  const closeIfInactive = () => {
    if (!ref.current?.matches(':hover') && !ref.current?.contains(document.activeElement)) setOpen(false);
  };
  const onKeyDown = event => {
    if (event.key === 'Escape') { event.stopPropagation(); setOpen(false); }
  };
  return { open, position, id, ref, show, closeIfInactive, onKeyDown };
}

function NativeFilterButton({ job, filter, setFilter }) {
  const selected = filter.includes(job.state);
  return <button type="button" className="native-filter-badge" aria-label={`Filter by native state: ${stateLabel(job.state)}`} aria-pressed={selected}
    title={`Codex native state: ${stateLabel(job.state)}`} onClick={() => setFilter(previous => previous.includes(job.state) ? previous.filter(value => value !== job.state) : [...previous, job.state])}>
    <State value={job.state} />
  </button>;
}

function RunCard({ job, phaseFilter, selectPhase, filter, setFilter }) {
  const title = jobDisplayTitle(job), phase = job.work?.phase;
  return <Card className="run-card">
    <div className="run-card-top"><PhaseFilterButton phase={phase} phaseFilter={phaseFilter} selectPhase={selectPhase} compact />
      <NativeFilterButton job={job} filter={filter} setFilter={setFilter} /></div>
    <a href={job.href || `#/runs/${encodeURIComponent(job.id)}`} className="run-card-link" aria-label={`Open work ${title}, repository phase ${phase?.label || 'unresolved'}, native state ${stateLabel(job.state)}`}>
      <p className="run-card-title">{title}</p>
    </a>
    <WorkMetadata job={job} />
    <p className="run-card-action">{nextOperatorAction(job)}</p>
  </Card>;
}

function RunRow({ job, phaseFilter, selectPhase, filter, setFilter }) {
  const title = jobDisplayTitle(job), phase = job.work?.phase;
  return <article className="task-row" role="listitem">
    <PhaseIconButton phase={phase} phaseFilter={phaseFilter} selectPhase={selectPhase} />
    <div className="task-row-content">
      <a href={job.href || `#/runs/${encodeURIComponent(job.id)}`} className="task-row-link" aria-label={`Open work ${title}, repository phase ${phase?.label || 'unresolved'}, native state ${stateLabel(job.state)}`}>
        <p className="task-row-title">{title}</p>
      </a>
      <WorkMetadata job={job} />
    </div>
    <div className="task-row-actions"><PhaseFilterButton phase={phase} phaseFilter={phaseFilter} selectPhase={selectPhase} compact />
      <NativeFilterButton job={job} filter={filter} setFilter={setFilter} /></div>
  </article>;
}

function EmptyRuns({ filtered, clearFilters, openComposer }) {
  return <div className="empty-tasks" role="status">
    <h3>{filtered ? "No matching work" : "No loaded work yet"}</h3>
    <p>{filtered ? "Try another phase, native state or search term." : "Start work explicitly from an open GitHub issue."}</p>
    {filtered ? <Button variant="outline" size="sm" onClick={clearFilters}>Clear filters</Button> : openComposer && <Button variant="outline" size="sm" onClick={openComposer}><Plus className="size-3.5" />New issue</Button>}
  </div>;
}

function WorkMetadata({ job }) {
  const record = job.work, workflow = job.workflow?.name || job.command, phase = taskPhase(job);
  const source = record?.issue;
  const sourceState = source?.state === 'closed' ? `Closed · ${closureReasonLabel(source.state_reason ?? source.stateReason)}`
    : source?.state === 'open' ? 'Open' : source ? `Source state unknown${source.state ? ` · ${source.state}` : ''}` : null;
  const parts = [
    record?.identity ? `#${record.identity.number}` : record ? 'Local request' : null,
    job.updated_at ? <time dateTime={job.updated_at} title={`Last activity ${job.updated_at}`}>{relativeTime(job.updated_at)}</time> : null,
    [workflow, phase].filter(Boolean).map(friendlyName).join(' · '),
    source && record?.source_status === 'loaded' ? sourceState : null,
    record?.executions?.length > 1 ? `${record.executions.length} attempts` : null,
  ].filter(Boolean);
  return <div className="task-row-meta">{parts.map((part, index) => <span className="work-meta-part" key={index}>{part}</span>)}
    {source && <Contributors {...source} compact />}
    {source && Array.isArray(source.labels) && <Labels labels={source.labels} />}
  </div>;
}
