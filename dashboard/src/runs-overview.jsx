import React, { useEffect, useId, useRef, useState } from 'react';
import { Search, List, Columns3, X, Plus, ChevronDown, SlidersHorizontal } from 'lucide-react';
import { Button } from './components/ui/button';
import { Card } from './components/ui/card';
import { Badge } from './components/ui/badge';
import { cn } from './lib/utils';
import { TaskFilters } from './task-filters.jsx';
import { State, LifecycleGlyph, friendlyName, relativeTime, stateLabel } from './task-display.jsx';
import { statusGroups, boardColumns, groupJobsByBoardColumn, jobDisplayTitle, nextOperatorAction, taskPhase, toggleNativeFilter } from './runs-board.js';
import { NATIVE_STATES, closureReasonLabel, nativeState } from '../../factory/issue-lifecycle.mjs';
import { Labels } from './issue-labels.jsx';
import { Contributors } from './contributors.jsx';
import { RepositoryRail } from './repository-rail.jsx';
import { groupListJobs } from './runs-board.js';

export function RunsOverview({ visibleJobs, jobs, workflows, counts, phaseCounts, loaded, statusError, filter, setFilter, phaseFilter, setPhaseFilter,
  search, setSearch, workflowFilter, setWorkflowFilter, clearFilters, runsView, setRunsView, refresh, openComposer, composer, labelFilter = [],
  setLabelFilter, sourceControls, sourceNotice, sourceLoading, sourceUnavailable, grouping='none', setGrouping, ordering='recent', setOrdering, assignees=[],setAssignees }) {
  const [rail,setRail]=useState('repository'), [hideEmpty,setHideEmpty]=useState(false);
  const display=useRef(null);
  useEffect(()=>{
    const dismiss=event=>{if(display.current?.open && !display.current.contains(event.target))display.current.open=false;};
    document.addEventListener('pointerdown',dismiss);document.addEventListener('focusin',dismiss);
    return()=>{document.removeEventListener('pointerdown',dismiss);document.removeEventListener('focusin',dismiss);};
  },[]);
  const filtering = assignees.length > 0 || phaseFilter.length > 0 || labelFilter.length > 0 || filter.length > 0 || Boolean(search.trim()) || workflowFilter.length > 0;
  const selectPhase = value => setPhaseFilter(previous => value === 'all' ? [] : previous.includes(value) ? previous.filter(item => item !== value) : [...previous, value]);
  const selectStatus = value => setFilter(previous => toggleNativeFilter(previous, value));
  const nativeFilterOptions = NATIVE_STATES.map(state => ({ ...state, count: counts[state.id] || 0 }));
  const activeFilters = [
    ...assignees.map(value=>({key:`assignee:${value}`,label:value==='__unassigned'?'Unassigned':`Assignee: ${value}`,remove:()=>setAssignees(assignees.filter(item=>item!==value))})),
    ...filter.map(value => ({ key: `native:${value}`, label: `Native: ${nativeFilterOptions.find(option => option.id === value)?.label || value}`, remove: () => selectStatus(value) })),
    ...phaseFilter.map(value => ({ key: `phase:${value}`, label: `Phase: ${boardColumns.find(stage => stage.id === value)?.label || value}`, remove: () => selectPhase(value) })),
    ...workflowFilter.map(value => ({ key: `work:${value}`, label: friendlyName(value), remove: () => setWorkflowFilter(workflowFilter.filter(item => item !== value)) })),
    ...labelFilter.map(value => ({ key: `label:${value}`, label: value, remove: () => setLabelFilter(labelFilter.filter(item => item !== value)) })),
    ...(search.trim() ? [{ key: 'search', label: `Search: ${search.trim()}`, remove: () => setSearch('') }] : []),
  ];
  return <div className="runs-page">
    <div className="tasks-toolbar">
      <h2 className="sr-only">Inbox work</h2>
      <TaskFilters assignees={assignees} setAssignees={setAssignees} jobs={jobs} availableWorkflows={workflows} workflow={workflowFilter} setWorkflow={setWorkflowFilter} filter={filter}
        setFilter={setFilter} phaseFilter={phaseFilter} setPhaseFilter={setPhaseFilter} phaseCounts={phaseCounts} labels={labelFilter} setLabels={setLabelFilter} options={nativeFilterOptions} disabled={!loaded} />
      <div className="tasks-tools">
        {sourceControls}
        <details ref={display} className="display-options" onKeyDown={event=>{if(event.key==='Escape'){event.stopPropagation();display.current.open=false;display.current.querySelector('summary').focus();}}}><summary aria-label="Display options"><SlidersHorizontal size={15}/></summary><div className="display-popover">
          <label>Grouping<select aria-label="Group work" value={grouping} onChange={event=>setGrouping?.(event.target.value)}><option value="none">None</option><option value="phase">Status</option><option value="native">Agent activity</option></select></label>
          <label>Ordering<select aria-label="Order work" value={ordering} onChange={event=>setOrdering?.(event.target.value)}><option value="recent">Last activity</option><option value="oldest">Oldest activity</option><option value="title">Title</option></select></label>
          <label>Filter rail<select aria-label="Filter rail" value={rail} onChange={event=>setRail(event.target.value)}><option value="repository">Repository workflow</option><option value="native">Native status</option></select></label>
          <div className="display-extra-filters"><TaskFilters advanced jobs={jobs} availableWorkflows={workflows} workflow={workflowFilter} setWorkflow={setWorkflowFilter} filter={filter} setFilter={setFilter} phaseFilter={phaseFilter} setPhaseFilter={setPhaseFilter} phaseCounts={phaseCounts} options={nativeFilterOptions} disabled={!loaded}/></div>
          <label className="display-checkbox"><input type="checkbox" checked={hideEmpty} onChange={event=>setHideEmpty(event.target.checked)}/>Hide empty board columns</label>
        </div></details>
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
    <div className="active-filters">
      <div className="results-summary">
        <span className="results-count" role="status">{loaded ? `${visibleJobs.length === jobs.length ? jobs.length : `${visibleJobs.length} of ${jobs.length}`} items` : "Loading work…"}</span>
        <div className="active-filter-chips" aria-label="Applied filters">{activeFilters.map(item => <button className="active-filter-chip" type="button" key={item.key} onClick={item.remove} aria-label={`Remove ${item.label} filter`} title={`Remove ${item.label} filter`}><span>{item.label}</span><X size={12} aria-hidden="true" /></button>)}</div>
        <button className="clear-all-filters" type="button" onClick={clearFilters} disabled={!filtering}>Clear filters</button>
      </div>
    </div>
    </div>
    {sourceNotice}

    {composer}

    {statusError && loaded && <div className="stale-banner" role="status"><span><strong>Status stale.</strong> Showing the last available task data. {statusError}</span><Button variant="outline" size="sm" onClick={refresh}>Refresh</Button></div>}

    <div className={cn("run-workspace", runsView === "board" && "is-board")}>
      {rail==='native' ? <TaskFilterRail counts={counts} loaded={loaded} filter={filter} setFilter={selectStatus} />
        : <RepositoryRail jobs={jobs} loaded={loaded} phaseFilter={phaseFilter} setPhaseFilter={setPhaseFilter} filter={filter} setFilter={setFilter}/> }
      <section className="task-results" aria-label="Work results">
        {!loaded && !statusError ? <TaskMessage kind="loading" title="Loading project work" description="Checking GitHub issues and native Codex history." />
          : !loaded && statusError ? <TaskMessage kind="error" title="Project status unavailable" description={statusError} action="Retry status" onAction={refresh} />
            : !jobs.length && sourceLoading ? <TaskMessage kind="loading" title="Loading repository work" description="Waiting for the requested provider page." />
            : !jobs.length && sourceUnavailable ? <TaskMessage kind="error" title="Repository issues unavailable" description="No issue snapshot is available. Refresh issues to retry the provider read." />
            : !visibleJobs.length ? <EmptyRuns filtered={filtering} clearFilters={clearFilters} openComposer={openComposer} />
                : runsView === "board" ? <RunBoard hideEmpty={hideEmpty} jobs={visibleJobs} phaseFilter={phaseFilter} selectPhase={selectPhase} filter={filter} setFilter={setFilter} />
                : <WorkList jobs={visibleJobs} grouping={grouping} phaseFilter={phaseFilter} selectPhase={selectPhase} filter={filter} setFilter={setFilter}/>}
      </section>
    </div>
  </div>;
}

function TaskFilterRail({ counts, loaded, filter, setFilter }) {
  const [open, setOpen] = useState(false), id = useId();
  return <aside className="task-filter-rail" aria-label="Filter work by native status" data-expanded={open}>
    <button type="button" className="status-rail-toggle" aria-expanded={open} aria-controls={id} onClick={() => setOpen(value => !value)}>Native status{filter.length > 0 && <span className="facet-count">{filter.length} selected</span>}<ChevronDown size={14} aria-hidden="true" /></button>
    <div className="native-filter-cards" id={id}>
      <button className="all-tasks-filter" type="button" aria-pressed={filter.length === 0} onClick={() => setFilter('all')} disabled={!loaded}><span>All native states</span><span>{loaded ? counts.all : '—'}</span></button>
      {statusGroups.map(group => <NativeStatusCard key={group.id} group={group} counts={counts} loaded={loaded} filter={filter} setFilter={setFilter} />)}
    </div>
  </aside>;
}

function NativeStatusCard({ group, counts, loaded, filter, setFilter }) {
  const [expanded, setExpanded] = useState(true), id = useId();
  const count = loaded ? counts[group.id] ?? 0 : '—';
  return <section className={`filter-card tone-${group.tone}`} aria-label={`${group.label} native status`}>
    <div className="filter-card-heading">
      <button className="filter-card-main" type="button" aria-label={`Filter by native category: ${group.label}`} aria-pressed={group.states.every(state => filter.includes(state))} disabled={!loaded} onClick={() => setFilter(group.id)}><LifecycleGlyph definition={group} size={14} /><span>{group.label}</span></button>
      <button className="filter-card-disclosure" type="button" aria-label={`${expanded ? 'Hide' : 'Show'} ${group.label.toLowerCase()} native states (${count})`} aria-expanded={expanded} aria-controls={id} onClick={() => setExpanded(value => !value)}>
        <span className="filter-card-count">{count}</span><ChevronDown className="filter-card-chevron" size={14} aria-hidden="true" />
      </button>
    </div>
    <div className="filter-card-children" id={id} hidden={!expanded}>{group.states.map(value => {
      const state = nativeState(value);
      return <button type="button" key={state.id} className={`filter-substate tone-${state.tone}`} aria-label={`Filter by native state: ${state.label}`} title={state.action} aria-pressed={filter.includes(state.id)} disabled={!loaded} onClick={() => setFilter(state.id)}><span><LifecycleGlyph definition={state} size={12} />{state.label}</span><span>{loaded ? counts[state.id] ?? 0 : '—'}</span></button>;
    })}</div>
  </section>;
}

function TaskMessage({ kind, title, description, action, onAction }) {
  return <div className={`task-message task-message-${kind}`} role={kind === "error" ? "alert" : "status"}>
    <h3>{title}</h3><p>{description}</p>
    {action && <Button variant="outline" size="sm" onClick={onAction}>{action}</Button>}
  </div>;
}

function RunBoard({ hideEmpty, jobs, phaseFilter, selectPhase, filter, setFilter }) {
  const groupedJobs = groupJobsByBoardColumn(jobs);
  return <div className="kanban-scroll" role="region" aria-label="Issue board — scroll horizontally" tabIndex={0}><div className="kanban-board">
    {boardColumns.filter(stage=>!hideEmpty || groupedJobs[stage.id].length).map(stage => <section key={stage.id} className={`run-column tone-${stage.tone}`} aria-labelledby={`board-${stage.id}`}>
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
      <WorkMetadata job={job} separatePeople />
    </div>
    <div className="task-row-details"><div className="task-row-labels">{job.work?.issue?.labels && <Labels labels={job.work.issue.labels}/>}</div>
    <div className="task-row-contributors">{job.work?.issue && <Contributors {...job.work.issue} compact/>}</div></div>
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

function WorkMetadata({ job, separatePeople=false }) {
  const record = job.work, workflow = job.workflow?.name || job.command, phase = taskPhase(job);
  const source = record?.issue;
  const sourceState = source?.state === 'closed' ? `Closed · ${closureReasonLabel(source.state_reason ?? source.stateReason)}`
    : source?.state === 'open' ? 'Open' : source ? `Source state unknown${source.state ? ` · ${source.state}` : ''}` : null;
  const activity = [
    job.updated_at ? <time dateTime={job.updated_at} title={`Last activity ${job.updated_at}`}>Last activity {relativeTime(job.updated_at)}</time> : null,
    [workflow, phase].filter(Boolean).map(friendlyName).join(' · '),
  ].filter(Boolean);
  const parts = [
    record?.identity ? <span title={record.identity.repository}>#{record.identity.number}</span> : record ? 'Local request' : null,
    sourceState,
    record?.source_status === 'stale' ? 'Source stale · last loaded metadata' : record?.source_status === 'not_loaded' ? 'Source not loaded' : null,
    record?.executions?.length ? `${record.executions.length} execution ${record.executions.length === 1 ? 'attempt' : 'attempts'}` : null,
  ].filter(Boolean);
  return <div className="work-metadata">
    {parts.length > 0 && <div className="task-row-meta">{parts.map((part, index) => <span className="work-meta-part" key={index}>{part}</span>)}</div>}
    {activity.length > 0 && <div className="task-row-meta">{activity.map((part, index) => <span className="work-meta-part" key={index}>{part}</span>)}</div>}
    {source && !separatePeople && <div className="task-row-meta task-row-people">{source.author && <span>Opened by {source.author}</span>}<Contributors {...source} compact />{Array.isArray(source.labels) && <Labels labels={source.labels} />}</div>}
  </div>;
}

function WorkList({ jobs, grouping, ...rowProps }) {
  const [collapsed,setCollapsed]=useState({});
  return <div className="grouped-work">{groupListJobs(jobs,grouping).map(group=>{
    const key=`${grouping}:${group.id}`,folded=Boolean(collapsed[key]),id=`work-group-${grouping}-${group.id}`;
    return <section key={key} className={`work-group tone-${group.tone||'neutral'}`}>
      {grouping!=='none' && <button className="work-group-heading" type="button" aria-expanded={!folded} aria-controls={id} onClick={()=>setCollapsed(previous=>({...previous,[key]:!folded}))}><ChevronDown size={14}/><LifecycleGlyph definition={group} size={14}/><span>{group.label}</span><span className="work-group-count">{group.jobs.length}</span></button>}
      <div id={id} className="task-list" role="list" hidden={grouping!=='none' && folded}>{group.jobs.map(job=><RunRow key={job.id} job={job} {...rowProps}/>)}</div>
    </section>;
  })}</div>;
}
