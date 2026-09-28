import React, { useEffect, useId, useRef, useState } from 'react';
import { Check, ChevronDown, Layers, Tag } from 'lucide-react';
import { issueLabelTone } from './issue-labels.js';
import { friendlyName } from './task-display.jsx';

const selections=value=>Array.isArray(value)?value:value?[value]:[];
export function filterTaskFacets(jobs,workTypes) {
  const chosen=selections(workTypes);
  return jobs.filter(job=>!chosen.length||chosen.includes(job.workflow?.name||job.command));
}
export function TaskFilters({jobs,availableWorkflows=[],workflow,setWorkflow,filter,setFilter,options,disabled,labels=[],setLabels}) {
  const workTypes=[...new Set([...availableWorkflows,...jobs.map(job=>job.workflow?.name||job.command)].filter(Boolean))].sort();
  return <div className="task-facets" aria-label="Work filters">
    <Facet label="Work type" value={workflow} change={setWorkflow} disabled={disabled} Icon={Layers} options={workTypes.map(id=>({id,label:friendlyName(id)}))}/>
    {setLabels&&<Facet label="Labels" value={labels} change={setLabels} disabled={disabled} Icon={Tag} searchable options={[...new Map(jobs.flatMap(job=>job.work?.issue?.labels||[]).map(label=>[label.name,label])).values()].sort((a,b)=>a.name.localeCompare(b.name)).map(label=>({id:label.name,label:label.name,color:label.color}))}/>}
    <Facet label="Statuses" value={filter} change={setFilter} disabled={disabled} Icon={Tag} options={options.filter(option=>option.id!=='all')}/>
  </div>;
}
function Facet({label,value,change,disabled,Icon,options,searchable=false}) {
  const [open,setOpen]=useState(false),root=useRef(null),trigger=useRef(null),id=useId(),[query,setQuery]=useState('');
  const selected=selections(value),all=options.length>0&&options.every(option=>selected.includes(option.id));
  useEffect(()=>{if(!open)return;const outside=event=>{if(!root.current?.contains(event.target))setOpen(false);};const escape=event=>{if(event.key==='Escape'){event.stopPropagation();setOpen(false);trigger.current?.focus();}};document.addEventListener('pointerdown',outside);document.addEventListener('focusin',outside);document.addEventListener('keydown',escape);return()=>{document.removeEventListener('pointerdown',outside);document.removeEventListener('focusin',outside);document.removeEventListener('keydown',escape);};},[open]);
  return <div ref={root} className="facet-container"><button ref={trigger} type="button" className={`task-facet${selected.length?' is-selected':''}`} aria-label={`Filter by ${label.toLowerCase()}`} aria-expanded={open} aria-controls={id} disabled={disabled} onClick={()=>setOpen(value=>!value)}><Icon size={14} aria-hidden="true"/><span>{label}</span>{selected.length>0&&<span className="facet-count">{selected.length}</span>}<ChevronDown size={12} aria-hidden="true"/></button>
    {open&&<div id={id} className="facet-popover" role="group" aria-label={`${label} filter options`}><div className="facet-popover-heading"><span>{label}</span><button type="button" aria-disabled={!selected.length} onClick={()=>{if(selected.length)change([]);}}>Reset</button></div>{searchable&&<input className="facet-search" aria-label={`Filter ${label.toLowerCase()} options`} placeholder="Filter" value={query} onChange={event=>setQuery(event.target.value)}/>}<button type="button" role="checkbox" aria-checked={all} className="facet-option facet-select-all" disabled={!options.length} onClick={()=>change(all?[]:options.map(option=>option.id))}><span className="facet-check" aria-hidden="true">{all&&<Check size={12}/>}</span>Select all</button><div className="facet-options">{options.length?options.filter(option=>option.label.toLowerCase().includes(query.toLowerCase())).map(option=><button type="button" role="checkbox" aria-checked={selected.includes(option.id)} className="facet-option" key={option.id} onClick={()=>change(selected.includes(option.id)?selected.filter(item=>item!==option.id):[...selected,option.id])}><span className="facet-check" aria-hidden="true">{selected.includes(option.id)&&<Check size={12}/>}</span><span className={option.color?`issue-label label-${issueLabelTone(option.color)}`:undefined}>{option.label}</span></button>):<p className="facet-empty">No recorded options</p>}</div></div>}
  </div>;
}
