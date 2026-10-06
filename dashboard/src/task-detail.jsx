import React, { useEffect, useState } from 'react';
import { ChevronUp, ChevronDown, Link2, X, FileText } from 'lucide-react';
import { Tabs } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { State, friendlyName, harnessLabel, stateLabel, TaskStateIcon } from './task-display.jsx';

const terminal = new Set(['needs_review','failed','interrupted']);
function time(value) {
  if(typeof value==='number')return new Date(value<1e12?value*1000:value).toLocaleString();
  return typeof value==='string'&&Number.isFinite(Date.parse(value))?new Date(value).toLocaleString():'Unavailable';
}
export function TaskDetail({source,identity,links,navigation=[],csrfToken,job,loaded,error,actionError,onWorkflowAction,capabilities={}}) {
  const [feedback,setFeedback]=useState(''),[busy,setBusy]=useState(false),[localError,setLocalError]=useState('');
  const [nativeResult,setNativeResult]=useState(null),[resultLoading,setResultLoading]=useState(false),[resultError,setResultError]=useState('');
  useEffect(()=>{setFeedback('');setBusy(false);setLocalError('');},[job?.id,job?.turn_id]);
  useEffect(()=>{setNativeResult(null);setResultError('');if(!job?.native||!csrfToken)return;const controller=new AbortController();setResultLoading(true);fetch(`/api/v1/jobs/${encodeURIComponent(job.id)}/result`,{headers:{'X-Factory-Session':csrfToken},signal:controller.signal}).then(async response=>{const value=await response.json();if(!response.ok)throw new Error(value.error||`Result request failed (${response.status})`);if(!controller.signal.aborted)setNativeResult(value);}).catch(error=>{if(!controller.signal.aborted)setResultError(error.message);}).finally(()=>{if(!controller.signal.aborted)setResultLoading(false);});return()=>controller.abort();},[job?.id,job?.turn_id,job?.state,csrfToken]);
  if(!job&&!source)return <div className="p-8"><a href="#/inbox" className="text-sm underline">Back to inbox</a><p className="mt-4">{!loaded?'Loading issue…':'Issue not found.'}</p>{error&&<p role="alert">{error}</p>}</div>;
  const item=source||{id:job.id,href:`#/runs/${encodeURIComponent(job.id)}`};
  if(!job)return <div className="task-detail-layout"><div className="task-detail-main"><DetailToolbar item={item} navigation={navigation}/><header className="task-detail-heading"><TaskStateIcon value="not_started"/><h2>{source.title}</h2></header>{source.panel}</div><aside className="task-metadata" aria-label="Issue details"><h3><FileText size={15}/>Metadata</h3>{source.metadata}</aside></div>;
  const resultJob=nativeResult?.id===job.id&&nativeResult.turn_id===job.turn_id?nativeResult:job;
  const canContinue=capabilities.continue_turn===true&&terminal.has(resultJob.state)&&Boolean(resultJob.turn_id)&&resultJob.native_turn_status!=='running';
  async function act(action,payload={}) {
    setBusy(true);setLocalError('');
    try {await onWorkflowAction?.(job,action,payload);if(action==='continue')setFeedback('');}
    catch(error){setLocalError(error.message||'Native action failed.');}
    finally {setBusy(false);}
  }
  const issueUrl=job.task?.source_url;
  const response=resultJob.native_result?.response;
  return <div className="task-detail-layout">
    <div className="task-detail-main">
      <DetailToolbar item={item} navigation={navigation}/>
      <header className="task-detail-heading"><TaskStateIcon value={job.state}/><h2>{source?.title||job.task?.title||`Native ${harnessLabel(job.harness)} work`}</h2>{error&&<p role="alert" className="text-sm text-danger">{error}</p>}</header>
      {source?.panel}
      <Tabs key={`${job.id}:${job.turn_id}`} label="Issue sections" items={[
        {id:'result',label:'Result',content:<Card className="task-result space-y-5 p-5 sm:p-6" aria-label={`Native ${harnessLabel(job.harness)} result`}>
          <h2 className="text-lg font-semibold">{harnessLabel(job.harness)} · {stateLabel(resultJob.state)}</h2>
          <p className="text-sm text-muted-foreground">{harnessLabel(job.harness)} owns execution and native history. A completed turn needs project checks and independent review before acceptance.</p>
          <dl className="grid gap-2 break-all text-sm sm:grid-cols-2"><div><dt className="text-muted-foreground">Thread ID</dt><dd><code>{job.thread_id||'Unconfirmed'}</code></dd></div><div><dt className="text-muted-foreground">Current turn ID</dt><dd><code>{job.turn_id||'Unconfirmed'}</code></dd></div></dl>
          {resultJob.native_result?.completed_at&&<p className="text-xs text-muted-foreground">Native completion · {time(resultJob.native_result.completed_at)}</p>}
          {resultLoading&&<p role="status" className="text-sm text-muted-foreground">Loading native result…</p>}
          {resultError&&<p role="alert" className="text-sm text-danger">Native result unavailable: {resultError}</p>}
          {response!==null&&response!==undefined?<section aria-label="Native agent response"><h3 className="mb-2 text-sm font-medium">{terminal.has(resultJob.state)?'Final agent response':'Latest agent response'}</h3><pre className="max-h-[32rem] overflow-auto whitespace-pre-wrap break-words rounded-md border border-border bg-muted/30 p-4 font-sans text-sm leading-6">{response}</pre></section>:!resultLoading&&<p className="text-sm text-muted-foreground">{resultJob.state==='unknown'?'Native status or result is unresolved. Inspect the native session before acting.':`${harnessLabel(job.harness)} has not recorded an agent response for this turn.`}</p>}
          {resultJob.state==='unknown'&&<p role="alert" className="text-sm text-danger">Native state is stale, disconnected or ambiguous. Factory will not retry or start another turn automatically.</p>}
          {job.native_state_note&&<p role="status" className="text-sm">{job.native_state_note}</p>}
          {actionError&&<p role="alert" className="text-sm text-danger">{actionError}</p>}{localError&&<p role="alert" className="text-sm text-danger">{localError}</p>}
          {capabilities.interrupt===true&&job.state==='running'&&<Button type="button" variant="outline" disabled={busy||!job.turn_id} onClick={()=>act('interrupt',{turn_id:job.turn_id})}>{busy?'Interrupting…':'Interrupt native turn'}</Button>}
          {capabilities.resume_thread===true&&job.thread_id&&job.state!=='running'&&<Button type="button" variant="outline" disabled={busy||resultJob.state==='unknown'} onClick={()=>act('resume')}>{busy?'Reconnecting…':'Reconnect without starting a turn'}</Button>}
          {capabilities.resume_thread===false&&job.thread_id&&resultJob.state==='unknown'&&<p className="text-xs text-muted-foreground">Inspect this session in the native CLI. Reconnecting to a running session is unavailable here.</p>}
          {canContinue&&<form className="space-y-3 border-t border-border pt-4" onSubmit={event=>{event.preventDefault();if(!feedback.trim()||busy)return;act('continue',{expected_turn_id:resultJob.turn_id,feedback});}}>
            <label className="block"><span className="field-label">Continue this {harnessLabel(job.harness)} session</span><textarea className="field-control min-h-28" maxLength={16000} value={feedback} onChange={event=>setFeedback(event.target.value)} placeholder={`Give ${harnessLabel(job.harness)} explicit feedback or the next bounded step…`} required/></label>
            <p className="text-xs text-muted-foreground">This records a new native turn after the displayed terminal turn. An ambiguous start remains blocked for inspection.</p>
            <Button type="submit" disabled={busy||!feedback.trim()}>{busy?'Continuing…':`Continue in ${harnessLabel(job.harness)}`}</Button>
          </form>}
        </Card>},
        {id:'history',label:'History',content:<ol className="space-y-4" aria-label="Native turn history">{(job.native_turns||[]).length?(job.native_turns||[]).slice().reverse().map(turn=><li key={turn.id} className="space-y-2 border-l-2 border-border pl-4"><div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-medium">Native turn</h3><State value={turn.state}/></div><p className="break-all text-xs text-muted-foreground">Turn <code>{turn.id}</code></p>{turn.started_at&&<p className="text-xs text-muted-foreground">Started · {time(turn.started_at)}</p>}{turn.completed_at&&<p className="text-xs text-muted-foreground">Completed · {time(turn.completed_at)}</p>}</li>):<li className="text-sm text-muted-foreground">Native turn history is unavailable.</li>}</ol>},
        {id:'instructions',label:'Issue',content:<pre className="whitespace-pre-wrap break-words font-sans leading-6">{job.task?.spec||'Issue details are read from GitHub when opened.'}</pre>},
      ]}/>
    </div>
    <aside className="task-metadata" aria-label="Issue details"><h3><FileText size={15}/>Metadata</h3>{source?.metadata}<dl>
      <div><dt>Native issue record</dt><dd><code className="source-revision-sha">{job.id}</code></dd></div><div><dt>Status</dt><dd><State value={job.state}/></dd></div>
      <div><dt>Work type</dt><dd>{friendlyName(job.workflow?.name||'unknown')}</dd></div><div><dt>Created</dt><dd>{time(job.created_at)}</dd></div>
      <div><dt>Thread</dt><dd><code className="source-revision-sha">{job.thread_id||'Unconfirmed'}</code></dd></div><div><dt>Turn</dt><dd><code className="source-revision-sha">{job.turn_id||'Unconfirmed'}</code></dd></div>
      {links?.repository&&<div><dt>Repository</dt><dd><a className="metadata-link" href={links.repository} target="_blank" rel="noreferrer">View repo</a></dd></div>}
      {issueUrl&&<div><dt>GitHub issue</dt><dd><a className="metadata-link" href={issueUrl} target="_blank" rel="noreferrer">Open issue</a></dd></div>}
      <div><dt>{harnessLabel(job.harness)} visibility</dt><dd>{job.harness==='claude'?'Native CLI session history in the dedicated Factory profile.':'Standalone CLI/app-server history. Desktop visibility depends on Codex support for this identity.'}</dd></div>
    </dl></aside>
  </div>;
}
function DetailToolbar({item,navigation}) {
  const [copyStatus,setCopyStatus]=useState('');
  useEffect(()=>{setCopyStatus('');const escape=event=>{if(event.key==='Escape'&&!event.defaultPrevented&&!event.target.closest?.('input, textarea, select'))window.location.hash='#/inbox';};window.addEventListener('keydown',escape);return()=>window.removeEventListener('keydown',escape);},[item.id]);
  const index=navigation.findIndex(entry=>entry.id===item.id||entry.executionID===item.id);
  return <div className="detail-toolbar"><div className="detail-position"><span>{index>=0?`${index+1} / ${navigation.length}`:'Issue'}</span><div>{[-1,1].map(delta=>{const adjacent=index>=0?navigation[index+delta]:null,Icon=delta<0?ChevronUp:ChevronDown,label=delta<0?'Previous issue':'Next issue';return adjacent?<a key={delta} href={adjacent.href||`#/runs/${encodeURIComponent(adjacent.id)}`} aria-label={label} title={adjacent.title}><Icon size={14}/></a>:<span key={delta} aria-label={`${label} unavailable`}><Icon size={14}/></span>;})}</div></div><div className="detail-toolbar-actions"><span role="status" className="copy-status">{copyStatus}</span><button type="button" aria-label="Copy issue link" onClick={async()=>{try{await navigator.clipboard.writeText(`${window.location.origin}/${item.href}`);setCopyStatus('Link copied');}catch{setCopyStatus('Unable to copy link');}}}><Link2 size={16}/></button><a href="#/inbox" aria-label="Close issue detail" title="Close issue detail (Esc)"><X size={18}/></a></div></div>;
}
