import React, { useId, useState } from 'react';
import { Check, ChevronDown } from 'lucide-react';
import { ISSUE_STAGES, NATIVE_STATES } from '../../factory/issue-lifecycle.mjs';
import { LifecycleGlyph } from './task-display.jsx';

// The catalog owns phase order; provider labels and native records own counts.
// Children explicitly describe native activity, never invented workflow badges.
export function RepositoryRail({ jobs, loaded, phaseFilter, setPhaseFilter, filter, setFilter }) {
  const [open,setOpen]=useState(false), id=useId();
  return <aside className="task-filter-rail repository-rail" aria-label="Repository workflow" data-expanded={open}>
    <button className="status-rail-toggle" type="button" aria-expanded={open} aria-controls={id} onClick={()=>setOpen(!open)}>Repository workflow<ChevronDown size={14}/></button>
    <div className="native-filter-cards" id={id}>
      <button className="all-tasks-filter" type="button" aria-pressed={!phaseFilter.length && !filter.length} onClick={()=>{setPhaseFilter([]);setFilter([]);}} disabled={!loaded}>All work<span>{loaded?jobs.length:'—'}</span></button>
      {ISSUE_STAGES.map(stage=><PhaseCard key={stage.id} stage={stage} jobs={jobs.filter(job=>(job.work?.phase?.id||'unresolved')===stage.id)} loaded={loaded} phaseFilter={phaseFilter} setPhaseFilter={setPhaseFilter} filter={filter} setFilter={setFilter}/>)}
    </div>
  </aside>;
}
function PhaseCard({ stage, jobs, loaded, phaseFilter, setPhaseFilter, filter, setFilter }) {
  const [expanded,setExpanded]=useState(false), id=useId();
  const selected=phaseFilter.includes(stage.id);
  const states=NATIVE_STATES.filter(state=>jobs.some(job=>job.state===state.id));
  const selectedStates=selected ? (filter.length?filter:states.map(state=>state.id)) : [];
  const all=selected && (!filter.length || states.every(state=>filter.includes(state.id)));
  const chooseAll=()=>{setPhaseFilter(all?[]:[stage.id]);setFilter([]);};
  function toggleState(state) {
    const values=selectedStates.includes(state)?selectedStates.filter(value=>value!==state):[...selectedStates,state];
    // An empty native facet means no constraint. Keep that distinction explicit:
    // deselecting the last child clears this phase selection as well.
    setPhaseFilter(values.length?[stage.id]:[]);setFilter(values);
  }
  return <section className={`filter-card tone-${stage.tone}`} aria-label={`${stage.label} repository phase`}>
    <div className="filter-card-heading">
      <button type="button" className="filter-card-main" aria-label={`Filter by phase: ${stage.label}`} aria-pressed={selected} disabled={!loaded} onClick={chooseAll} title={stage.description}><LifecycleGlyph definition={stage} size={14}/><span>{stage.label}</span></button>
      <button className="filter-card-disclosure" type="button" aria-label={`${expanded?'Collapse':'Expand'} ${stage.label}`} aria-expanded={expanded} aria-controls={id} onClick={()=>setExpanded(!expanded)}><span className="filter-card-count">{loaded?jobs.length:'—'}</span><ChevronDown className="filter-card-chevron" size={13}/></button>
    </div>
    <div className="phase-disclosure" data-expanded={expanded} inert={!expanded} id={id}><div className="phase-disclosure-inner">
      <div className="phase-subheading"><span>Agent activity</span><button type="button" onClick={chooseAll} aria-pressed={all} disabled={!loaded}>{all?'Selected':'Select all'}</button></div>
      {states.length?states.map(state=><button type="button" key={state.id} className={`filter-substate tone-${state.tone}`} role="checkbox" aria-checked={selectedStates.includes(state.id)} onClick={()=>toggleState(state.id)}><span><span className="substate-check">{selectedStates.includes(state.id)&&<Check size={11}/>}</span>{state.label}</span><span>{jobs.filter(job=>job.state===state.id).length}</span></button>):<p className="phase-empty">No loaded work</p>}
    </div></div>
  </section>;
}
