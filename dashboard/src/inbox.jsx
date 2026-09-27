import React, { useEffect, useRef, useState } from 'react';
import { CircleDot, CircleCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { issueLabelTone } from './issue-labels.js';
import { stateLabel, friendlyName } from './task-display.jsx';

function Labels({ labels = [] }) {
  return labels.length ? <div className="issue-choice-meta">{labels.map(label => <span key={label.name} className={`issue-label label-${issueLabelTone(label.color)}`}>{label.name}</span>)}</div> : null;
}
function Attempts({ executions = [] }) {
  return <div className="inbox-attempts">{executions.length ? executions.map(execution => <a key={execution.id} href={`#/runs/${execution.id}`} className="task-row-link">{friendlyName(execution.workflow)} · {stateLabel(execution.state)} · {friendlyName(execution.phase)} <small>{execution.id}</small></a>) : <p className="work-help">No executions. Browsing does not start work.</p>}</div>;
}

export function Inbox({ token, provider, history = [], refreshKey, onStarted, onLocalRequest, executionView, statusError }) {
  const [tab,setTab] = useState('issues'), [state,setState] = useState('open'), [search,setSearch] = useState('');
  const [snapshot,setSnapshot] = useState(null), [loading,setLoading] = useState(false), [error,setError] = useState('');
  const [selected,setSelected] = useState(null), [drafts,setDrafts] = useState({}), [previewBusy,setPreviewBusy] = useState(false), [previewError,setPreviewError] = useState(''), [starting,setStarting] = useState(false);
  const pending=useRef(null), previewPending=useRef(null), alive=useRef(true);
  const draftsRef=useRef(drafts);draftsRef.current=drafts;
  const edit = patch => setDrafts(previous=>({...previous,[selected.identity.key]:{...previous[selected.identity.key],...patch}}));
  async function api(path, input, signal) {
    const response=await fetch(path,{method:input===undefined?'GET':'POST',headers:{'Content-Type':'application/json','X-Factory-Session':token},...(input===undefined?{}:{body:JSON.stringify(input)}),signal});
    const result=await response.json();if(!response.ok)throw Error(result.error || 'Repository request failed.');return result;
  }
  async function load(page=1) {
    pending.current?.abort();const controller=new AbortController();pending.current=controller;setLoading(true);setError('');
    try { const result=await api(`/api/v1/issues?page=${page}&state=${state}`,undefined,controller.signal);
      if(!controller.signal.aborted && alive.current)setSnapshot({...result,fetched_at:new Date().toLocaleTimeString()});
    } catch(e) { if(!controller.signal.aborted && alive.current)setError(e.message); }
    finally { if(!controller.signal.aborted && alive.current)setLoading(false); }
  }
  useEffect(()=>{alive.current=true;return()=>{alive.current=false;pending.current?.abort();previewPending.current?.abort();};},[]);
  useEffect(()=>{if(token)load();},[token,state,refreshKey]);
  useEffect(()=>{if(refreshKey){setState('open');setSelected(null);setTab('issues');}},[refreshKey]);
  async function open(issue, refresh=false) {
    previewPending.current?.abort();setSelected(issue);setPreviewError('');
    if(!refresh && draftsRef.current[issue.identity.key]?.context){setPreviewBusy(false);return;}
    const controller=new AbortController();previewPending.current=controller;setPreviewBusy(true);
    try { const context=await api('/api/v1/issues/preview',{url:issue.url},controller.signal);
      if(!controller.signal.aborted && alive.current)setDrafts(previous=>({...previous,[issue.identity.key]:{brief:'',workflow:context.recommendation.workflow,sourceRef:'',model:'',...previous[issue.identity.key],context}}));
    } catch(e) { if(!controller.signal.aborted && alive.current)setPreviewError(e.message); }
    finally { if(!controller.signal.aborted && alive.current)setPreviewBusy(false); }
  }
  const associations=new Map(history.filter(row=>row.identity).map(row=>[row.identity.key,row]));
  const issues=(snapshot?.issues || []).map(issue=>{
    const { executions=[], active_execution=null, latest_execution=null } = associations.get(issue.identity.key) || {};
    return {...issue,executions,active_execution,latest_execution};
  });
  const loadedKeys=new Set(issues.map(issue=>issue.identity.key));
  const other=history.filter(row=>!row.identity || !loadedKeys.has(row.identity.key));
  const matches=row=>`${row.title} ${row.identity?.number || ''} ${row.identity?.repository || ''} ${(row.labels||[]).map(label=>label.name).join(' ')} ${(row.executions || []).map(item=>`${item.id} ${item.workflow} ${stateLabel(item.state)} ${friendlyName(item.phase)}`).join(' ')}`.toLowerCase().includes(search.trim().toLowerCase());
  const draft=selected && drafts[selected.identity.key], context=draft?.context;
  const linked=selected ? associations.get(selected.identity.key) : null;
  const blocked=linked?.active_execution ? 'An execution is active or unresolved. Open its history to continue or cancel it.' : context?.start_block_reason;
  async function start(event) {
    event.preventDefault();if(starting || !context)return;setStarting(true);setPreviewError('');
    try { const created=await api('/api/v1/issues/start',{url:context.url,expected_spec:context.spec,brief:draft.brief,workflow:draft.workflow,...(draft.sourceRef.trim()?{source_ref:draft.sourceRef.trim()}:{}),model:draft.model.trim()});
      if(alive.current){await onStarted(created);load(snapshot?.page || 1);}
    } catch(e) {if(alive.current)setPreviewError(e.message);}
    finally {if(alive.current)setStarting(false);}
  }
  return <section className="inbox-page" aria-label="Project Inbox">
    <div className="inbox-tabs" role="group" aria-label="Inbox records"><Button variant="ghost" aria-pressed={tab==='issues'} onClick={()=>setTab('issues')}>Repository issues</Button><Button variant="ghost" aria-pressed={tab==='executions'} onClick={()=>setTab('executions')}>Execution history</Button>{onLocalRequest && <Button variant="ghost" onClick={onLocalRequest}>Local execution request</Button>}</div>
    {tab==='executions' ? executionView : <>
      <p className="inbox-provider">{provider?.label || 'Repository provider'} · {provider?.repository || provider?.host || 'Local project'}</p>
      {statusError && <p role="alert" className="form-error">Execution history stale: {statusError}</p>}
      {selected ? <section className="inbox-detail" aria-label="Repository issue context">
        <div className="inbox-controls"><Button variant="ghost" disabled={starting} onClick={()=>{previewPending.current?.abort();setPreviewBusy(false);setSelected(null);}}>Back to Inbox</Button><Button variant="outline" disabled={starting || previewBusy} onClick={()=>open(selected,true)}>Refresh issue context</Button></div>
        <h2>#{selected.identity.number} {context?.title || selected.title}</h2>
        <a href={selected.url} target="_blank" rel="noreferrer">View repository issue ↗</a>
        <p>{context?.state || 'State not loaded'} · {context?.readiness.label || 'Readiness unknown'}</p><Labels labels={context?.labels || selected.labels} />
        {previewBusy && <p role="status">Loading issue context…</p>}
        {previewError && <p role="alert" className="form-error">{context ? 'Context may be stale. ' : ''}{previewError}</p>}
        {context && <><pre className="inbox-body">{context.body}</pre><form onSubmit={start} className="inbox-start">
          <label><span className="field-label">Operator brief · optional</span><textarea className="field-control" maxLength={16000} value={draft.brief} onChange={event=>edit({brief:event.target.value})} /></label>
          <p className="work-help">Suggested: {friendlyName(context.recommendation.workflow)}. {context.recommendation.reason}</p>
          <label><span className="field-label">Work type</span><select className="field-control" value={draft.workflow} onChange={event=>edit({workflow:event.target.value})}><option value="software">Software</option><option value="defence">Defence</option></select></label>
          <p className="work-help">{draft.workflow==='defence'?'Investigates supplied, non-sensitive evidence and produces a private draft. Private security reports use incident --file, never public issues.':'Implements scoped changes, runs checks and requests independent review. Security remediation can be Software work.'}</p>
          <details><summary>Additional options</summary><label><span className="field-label">Source ref · optional</span><input className="field-control" maxLength={256} value={draft.sourceRef} onChange={event=>edit({sourceRef:event.target.value})} /></label><label><span className="field-label">Model override · optional</span><input className="field-control" maxLength={128} value={draft.model} onChange={event=>edit({model:event.target.value})} /></label></details>
          {blocked && <p className="work-help">{blocked}</p>}<Button disabled={starting || previewBusy || Boolean(previewError) || Boolean(statusError) || Boolean(blocked)}>{starting?'Starting…':'Start work'}</Button>
        </form></>}
        <h3>Linked execution attempts</h3><Attempts executions={linked?.executions || context?.executions} />
      </section> : <>
        <div className="inbox-controls"><label>Issue state<select className="field-control" value={state} onChange={event=>setState(event.target.value)}><option value="open">Open</option><option value="closed">Closed</option><option value="all">All states</option></select></label><label>Search loaded records<input type="search" className="field-control" value={search} onChange={event=>setSearch(event.target.value)} /></label><Button variant="outline" disabled={loading || !token} onClick={()=>load(snapshot?.state===state ? snapshot.page : 1)}>Refresh issues</Button></div>
        {!provider?.supported && provider && <p className="work-help">Remote issue browsing and publication are unsupported on this host. New issue offers an explicitly local execution request.</p>}
        {error && <p role="alert" className="form-error">{snapshot?'Repository data stale. ':'Repository issues unavailable. '}{error}</p>}
        {loading && <p role="status">Loading repository issues…</p>}
        {snapshot && <p className="work-help">{snapshot.loaded_count} issues loaded on page {snapshot.page} ({snapshot.state}); total unknown. Read at {snapshot.fetched_at}.{snapshot.state!==state?' Showing the previous filter until refresh succeeds.':''} Search covers loaded records only.</p>}
        <div className="inbox-rows">{issues.filter(matches).map(issue=><article key={issue.identity.key} className="inbox-row">
          <button className="inbox-issue-title" onClick={()=>open(issue)}><strong className="inbox-title-line">{issue.state==='closed'?<CircleCheck size={16} aria-hidden="true"/>:<CircleDot size={16} aria-hidden="true"/>}<span>{issue.title}</span></strong><span>#{issue.number} · {issue.state} · {issue.readiness.label}</span></button>
          <Labels labels={issue.labels}/>
          <p className="work-help">{issue.active_execution ? `Active execution: ${friendlyName(issue.active_execution.workflow)} · ${stateLabel(issue.active_execution.state)} · ${friendlyName(issue.active_execution.phase)}` : issue.latest_execution ? `Latest execution: ${stateLabel(issue.latest_execution.state)}` : 'No execution started'}</p>
          {!!issue.executions.length && <details><summary>{issue.executions.length} execution attempts</summary><Attempts executions={issue.executions}/></details>}
        </article>)}</div>
        {snapshot && !loading && !error && !issues.filter(matches).length && <p className="work-help">{search?'No matching loaded issues.':'No issues on this page. Other pages or states may contain issues.'}</p>}
        <div className="inbox-controls"><Button variant="outline" disabled={loading || !snapshot || snapshot.page<=1} onClick={()=>load(snapshot.page-1)}>Previous page</Button><Button variant="outline" disabled={loading || !snapshot?.next_page} onClick={()=>load(snapshot.next_page)}>Next page</Button></div>
        <h3>Local and other execution history</h3><p className="work-help">{other.length} identities outside this loaded page. Repository sources may be closed, missing or on another page; their state is not inferred.</p>
        {other.filter(matches).map(row=><article className="inbox-row" key={row.key}>
          {row.identity?<button className="inbox-issue-title" onClick={()=>open(row)}><strong>{row.title}</strong><span>#{row.identity.number} · {row.identity.repository} · Source not loaded</span></button>:<strong>{row.title} · Local execution</strong>}
          <Attempts executions={row.executions}/>
        </article>)}
      </>}
    </>}
  </section>;
}
