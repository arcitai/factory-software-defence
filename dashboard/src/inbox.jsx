import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { Button } from './components/ui/button';
import { Labels } from './issue-labels.jsx';
import { stateLabel, friendlyName, formatTimestamp } from './task-display.jsx';
import { TaskDetail } from './task-detail.jsx';
import { RunsOverview } from './runs-overview.jsx';
import { workRecords, canonicalIssue } from '../../factory/issue-lifecycle.mjs';
import { filterJobs, searchJobs, jobsByRecentActivity, jobCounts } from './runs-board.js';
import { filterTaskFacets } from './task-filters.jsx';

const issueHref = key => `#/issues/${encodeURIComponent(key)}`;
export function Inbox({ token, provider, jobs = [], loaded, refreshKey, onStarted, onNewIssue, statusError, refreshStatus, nativeReadiness, issueKey, active = true, identity, links, onNavigation, detailProps = {} }) {
  const [state,setState] = useState('open');
  const [snapshot,setSnapshot] = useState(null), [loading,setLoading] = useState(false), [error,setError] = useState('');
  const [drafts,setDrafts] = useState({}), [previewBusy,setPreviewBusy] = useState(false), [previewError,setPreviewError] = useState(''), [starting,setStarting] = useState(false);
  const [filter,setFilter] = useState([]), [search,setSearch] = useState(''), [workflowFilter,setWorkflowFilter] = useState([]), [labelFilter,setLabelFilter] = useState([]);
  const [runsView,setRunsView] = useState(()=>window.localStorage.getItem('factory-runs-view') === 'board' ? 'board' : 'list');
  const pending=useRef(null), previewPending=useRef(null), alive=useRef(true);
  const draftsRef=useRef(drafts);draftsRef.current=drafts;
  const records=useMemo(()=>workRecords(jobs,snapshot?.issues || []),[jobs,snapshot]);
  const overviewJobs=useMemo(()=>records.map(record=>{
    const job=jobs.find(item=>item.id===record.execution_id);
    return {...job, id:record.key, work:record, state:record.state, task:{...job?.task,title:record.title,source_url:record.url},
      updated_at:job?.updated_at || record.issue?.updated_at, runs:job?.runs || [],
      href:record.identity ? issueHref(record.key) : `#/runs/${record.execution_id}`};
  }),[records,jobs]);
  const facetJobs=useMemo(()=>filterTaskFacets(searchJobs(overviewJobs,search),workflowFilter).filter(job=>!labelFilter.length || job.work.issue?.labels.some(label=>labelFilter.includes(label.name))),[overviewJobs,search,workflowFilter,labelFilter]);
  const visibleJobs=useMemo(()=>jobsByRecentActivity(filterJobs(facetJobs,filter)),[facetJobs,filter]);
  const navigation=useMemo(()=>visibleJobs.map(job=>({id:job.id,executionID:job.work.execution_id,title:job.task.title,href:job.href})),[visibleJobs]);
  useEffect(()=>{onNavigation?.(navigation);},[navigation,onNavigation]);
  const clearFilters=()=>{setFilter([]);setSearch('');setWorkflowFilter([]);setLabelFilter([]);};
  const fallbackIdentity=issueKey && canonicalIssue(issueKey.replace(/^github:/,'').replace(/:(\d+)$/,'/issues/$1'));
  const selected=records.find(row=>row.key===issueKey) || (fallbackIdentity ? {key:issueKey,identity:fallbackIdentity,title:`Issue #${fallbackIdentity.number}`,url:fallbackIdentity.url,executions:[],source_status:'not_loaded'} : null);
  const edit=patch=>setDrafts(previous=>({...previous,[issueKey]:{...previous[issueKey],...patch}}));
  async function api(path,input,signal) {
    const response=await fetch(path,{method:input===undefined?'GET':'POST',headers:{'Content-Type':'application/json','X-Factory-Session':token},...(input===undefined?{}:{body:JSON.stringify(input)}),signal});
    const result=await response.json();if(!response.ok)throw Error(result.error || 'Repository request failed.');return result;
  }
  async function load(page=1) {
    pending.current?.abort();const controller=new AbortController();pending.current=controller;setLoading(true);setError('');
    try {const result=await api(`/api/v1/issues?page=${page}&state=${state}`,undefined,controller.signal);
      if(!controller.signal.aborted && alive.current)setSnapshot({...result,fetched_at:new Date().toLocaleTimeString()});
    } catch(e) {if(!controller.signal.aborted && alive.current)setError(e.message);}
    finally {if(!controller.signal.aborted && alive.current)setLoading(false);}
  }
  useEffect(()=>{alive.current=true;return()=>{alive.current=false;pending.current?.abort();previewPending.current?.abort();};},[]);
  useEffect(()=>{if(token)load();},[token,state,refreshKey]);
  async function open(issue,refresh=false) {
    previewPending.current?.abort();setPreviewError('');
    if(!refresh && draftsRef.current[issue.key]?.context){setPreviewBusy(false);return;}
    const controller=new AbortController();previewPending.current=controller;setPreviewBusy(true);
    try {const context=await api('/api/v1/issues/preview',{url:issue.url},controller.signal);
      if(!controller.signal.aborted && alive.current)setDrafts(previous=>({...previous,[issue.key]:{brief:'',workType:context.recommendation.work_type||context.recommendation.workflow,...previous[issue.key],context}}));
    } catch(e) {if(!controller.signal.aborted && alive.current)setPreviewError(e.message);}
    finally {if(!controller.signal.aborted && alive.current)setPreviewBusy(false);}
  }
  useEffect(()=>{
    if(active && selected && token)open(selected);
    return()=>{previewPending.current?.abort();};
  },[issueKey,active,token]);
  const draft=selected && drafts[issueKey], context=draft?.context;
  const blocked=selected?.active_execution ? 'Native work is active or unresolved. Open its history to inspect it.' : context?.start_block_reason || (jobs.some(job=>['running','unknown'].includes(job.state)) ? 'The native workspace has active or unresolved work. Inspect Codex history first.' : null) || (!nativeReadiness?.ready ? `Native Codex unavailable: ${(nativeReadiness?.gaps || ['readiness unknown']).join('; ')}` : null);
  async function start(event) {
    event.preventDefault();if(starting || !context || blocked || previewError || statusError)return;setStarting(true);setPreviewError('');
    try {const created=await api('/api/v1/issues/start',{url:context.url,expected_spec:context.spec,brief:draft.brief,work_type:draft.workType});
      if(alive.current){await onStarted(created);load(snapshot?.page || 1);}
    } catch(e) {if(alive.current)setPreviewError(e.message);}
    finally {if(alive.current)setStarting(false);}
  }
  const sourceControls=<RepositoryControls snapshot={snapshot} state={state} setState={setState} loading={loading} token={token} load={load} records={records} />;
  const sourceNotice=<>
    {!provider?.supported && provider && <p className="source-boundary">GitHub issues are unavailable for this project identity. Select a supported GitHub repository to use the Inbox.</p>}
    {error && <p role="alert" className="form-error">{snapshot?'Repository data stale. ':'Repository issues unavailable. '}{error}</p>}
    {loading && <p role="status" className="source-boundary">Loading repository issues…</p>}
    {!nativeReadiness?.ready && <p role="alert" className="source-boundary">Native Codex unavailable: {(nativeReadiness?.gaps || ['readiness unknown']).join('; ')}</p>}
    {snapshot && !snapshot.issues?.length && !error && !loading && <p className="source-boundary">No issues on this page. Other pages or states may contain issues.</p>}
  </>;
  const panel=selected && <section className="issue-context" aria-label="Repository issue context">
    <Button variant="outline" size="sm" disabled={starting || previewBusy} onClick={()=>open(selected,true)}>Refresh issue context</Button>
    {previewBusy && <p role="status">Loading issue context…</p>}
    {previewError && <p role="alert" className="form-error">{context?'Context may be stale. ':''}{previewError}</p>}
    {statusError && <p role="alert" className="form-error">Native history status is stale: {statusError}</p>}
    {context && <>
      <details open={!selected.execution_id}><summary>Issue context</summary><pre className="inbox-body">{context.body}</pre></details>
      <details open={!selected.execution_id}><summary>Start work · explicit scope and options</summary>
        <form onSubmit={start} className="inbox-start">
          <p className="work-help">Suggested: {friendlyName(context.recommendation.work_type||context.recommendation.workflow)}. {context.recommendation.reason}</p>
          <label><span className="field-label">Work type</span><select className="field-control" value={draft.workType} onChange={event=>edit({workType:event.target.value})}><option value="software">Software</option><option value="defensive">Scoped defensive investigation</option></select></label>
          <p className="work-help">{draft.workType==='defensive'?'Use supplied, non-sensitive evidence. Keep private security findings in the project’s private reporting channel; no production recovery is performed.':'Implement scoped changes, run project checks and request independent review.'}</p>
          <details><summary>Operator brief and additional options</summary>
            <label><span className="field-label">Operator brief · optional</span><textarea className="field-control" maxLength={16000} value={draft.brief} onChange={event=>edit({brief:event.target.value})} /></label>
          </details>
          {blocked && <p className="work-help">{blocked}</p>}
          <Button disabled={starting || previewBusy || !loaded || Boolean(previewError) || Boolean(statusError) || Boolean(blocked)}>{starting?'Starting…':'Start work'}</Button>
        </form>
      </details>
    </>}
    <details open={!selected.execution_id}><summary>Linked native history ({selected.executions.length})</summary>
      <div className="inbox-attempts">{selected.executions.length ? selected.executions.map(execution=><a key={execution.id} href={`#/runs/${execution.id}`}>{friendlyName(execution.workflow)} · {stateLabel(execution.state)} <small>{execution.id}</small></a>) : <p className="work-help">No native history. Browsing does not start work.</p>}</div>
    </details>
  </section>;
  const metadata=selected && <dl>
    <div><dt>Repository issue</dt><dd><a href={selected.url} target="_blank" rel="noreferrer">#{selected.identity.number} · View original issue ↗</a></dd></div>
    <div><dt>Source state</dt><dd>{context?.state || selected.issue?.state || 'Not loaded'}{previewError?' · unavailable / stale':''}</dd></div>
    <div><dt>Readiness</dt><dd>{context?.readiness.label || selected.issue?.readiness.label || 'Unknown'}</dd></div>
    <div><dt>Labels</dt><dd><Labels labels={context?.labels || selected.issue?.labels} /></dd></div>
    <div><dt>Created</dt><dd>{formatTimestamp(context?.created_at || selected.issue?.created_at)}</dd></div>
    <div><dt>Author</dt><dd>{context?.author || selected.issue?.author || 'Unknown'}</dd></div>
    {!selected.execution_id && <><div><dt>Codex</dt><dd>Not started</dd></div><div><dt>Work type</dt><dd>Choose when starting work</dd></div></>}
  </dl>;
  return <>
    <section className="inbox-page" aria-label="Project Inbox" hidden={Boolean(issueKey)}>
      <RunsOverview visibleJobs={visibleJobs} jobs={overviewJobs} workflows={['software','defensive']} counts={jobCounts(facetJobs)} loaded={loaded} statusError={statusError}
        filter={filter} setFilter={setFilter} search={search} setSearch={setSearch} workflowFilter={workflowFilter} setWorkflowFilter={setWorkflowFilter}
        labelFilter={labelFilter} setLabelFilter={setLabelFilter} clearFilters={clearFilters} runsView={runsView} setRunsView={value=>{setRunsView(value);window.localStorage.setItem('factory-runs-view',value);}}
        refresh={refreshStatus} openComposer={onNewIssue} sourceControls={sourceControls} sourceNotice={sourceNotice} sourceLoading={loading && !snapshot} sourceUnavailable={Boolean(error) && !snapshot} />
    </section>
    {active && issueKey && <TaskDetail {...detailProps} identity={identity} links={links} csrfToken={token} job={jobs.find(job=>job.id===selected?.execution_id)} loaded={loaded} error={statusError}
      navigation={navigation} source={selected && {id:selected.key,href:issueHref(selected.key),title:context?.title || selected.title,panel,metadata}} />}
  </>;
}

function RepositoryControls({ snapshot, state, setState, loading, token, load, records }) {
  const [open,setOpen]=useState(false), root=useRef(null), trigger=useRef(null), id=useId();
  useEffect(()=>{
    if(!open)return;
    const outside=event=>{if(!root.current?.contains(event.target))setOpen(false);};
    const escape=event=>{if(event.key==='Escape'){event.stopPropagation();setOpen(false);trigger.current?.focus();}};
    document.addEventListener('pointerdown',outside);document.addEventListener('focusin',outside);document.addEventListener('keydown',escape);
    return()=>{document.removeEventListener('pointerdown',outside);document.removeEventListener('focusin',outside);document.removeEventListener('keydown',escape);};
  },[open]);
  const issues=records.filter(record=>record.identity).length;
  const turns=records.reduce((sum,record)=>sum+record.executions.length,0);
  return <div className="repository-control" ref={root}>
    <button type="button" className="repository-trigger" ref={trigger} aria-label="Repository" aria-describedby={`${id}-scope`} aria-expanded={open} aria-controls={id} onClick={()=>setOpen(value=>!value)}>
      <span>Repository <ChevronDown size={12} aria-hidden="true" /></span>
      <span className="repository-scope" id={`${id}-scope`}>{snapshot?`${snapshot.loaded_count} loaded · Page ${snapshot.page}`:'Page not loaded'}</span>
    </button>
    {open && <div id={id} className="repository-popover" role="group" aria-label="Repository tools">
      <div className="source-controls">
        <label>Issue state <select aria-label="Repository issue state" value={state} onChange={event=>setState(event.target.value)}><option value="open">Open</option><option value="closed">Closed</option><option value="all">All states</option></select></label>
        <Button variant="ghost" size="sm" disabled={loading || !token} onClick={()=>load(snapshot?.state===state?snapshot.page:1)}>Refresh issues</Button>
        {snapshot?.page>1 && <Button variant="ghost" size="sm" disabled={loading} onClick={()=>load(snapshot.page-1)}>Previous page</Button>}
        {snapshot?.next_page && <Button variant="ghost" size="sm" disabled={loading} onClick={()=>load(snapshot.next_page)}>Next page</Button>}
      </div>
      <p className="source-boundary">{snapshot?`${snapshot.loaded_count} issues loaded on page ${snapshot.page} (${snapshot.state}); ${snapshot.total == null?'total unknown':`${snapshot.total} total`}. Read at ${snapshot.fetched_at}.`:'Repository page not loaded.'} Search covers loaded issues and retained native history only.{snapshot && snapshot.state!==state?' Showing the previous issue-state filter until refresh succeeds.':''}</p>
      <p className="source-boundary">{records.length} project issues with {turns} native issue histories, including histories outside the loaded page. Codex remains the source of turn status and results.</p>
    </div>}
  </div>;
}
