import React, { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';

// The same reviewed content and identity reuses its receipt even after closing
// the composer or losing the browser response. No draft or credential is stored.
async function requestKey(context, title, spec, labels) {
  const intent = JSON.stringify({provider:context.id,repository:context.repository,actor:context.actor_id ?? context.actor,title:title.trim(),spec:spec.trim(),labels:[...new Set(labels)].sort()});
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(intent));
  return `browser_${Array.from(new Uint8Array(digest), byte=>byte.toString(16).padStart(2,'0')).join('')}`;
}

export function IssuePublish({ title, spec, labels, csrfToken, onCreated, onRecovered, onBusy }) {
  const key = useRef(null), alive = useRef(true);
  const [connection,setConnection] = useState(null), [receipts,setReceipts] = useState([]);
  const [busy,setBusy] = useState(false), [error,setError] = useState(''), [recovered,setRecovered] = useState(null);
  async function api(path, input, signal) {
    const response = await fetch(path, {method:input===undefined?'GET':'POST',headers:{'Content-Type':'application/json','X-Factory-Session':csrfToken},...(input===undefined?{}:{body:JSON.stringify(input)}),signal});
    const value = await response.json();
    if (!response.ok) throw new Error(value.error || 'Repository request failed.');
    return value;
  }
  async function load(signal) {
    setError('');
    try {
      const [context,previous] = await Promise.all([api('/api/v1/issue-connection',undefined,signal),api('/api/v1/issue-submissions',undefined,signal)]);
      if (alive.current && !signal?.aborted) { setConnection(context);setReceipts(previous.filter(item=>['pending','uncertain'].includes(item.state))); }
    } catch (e) { if (alive.current && !signal?.aborted) setError(e.message); }
  }
  useEffect(()=>{alive.current=true;const controller=new AbortController();load(controller.signal);return()=>{alive.current=false;controller.abort();};},[]);
  async function perform(action) {
    setBusy(true);onBusy(true);setError('');
    try { await action(); }
    catch (e) {
      if (alive.current) {
        setError(e.message);
        try {
          const previous=await api('/api/v1/issue-submissions');
          if(alive.current){
            const own=previous.find(item=>item.request_id===key.current && item.state==='created');
            if(own){onCreated(own);return;}
            setReceipts(previous.filter(item=>['pending','uncertain'].includes(item.state)));
          }
        } catch { /* The original failure remains visible. */ }
      }
    } finally { onBusy(false);if(alive.current)setBusy(false); }
  }
  return <section className="issue-publish" aria-label="Repository issue creation">
    {connection ? <p className="work-help">Create in <strong>{connection.repository}</strong> as <strong>{connection.actor}</strong>. No execution starts.</p> : <p className="work-help">{error ? 'Repository connection unavailable.' : 'Checking repository identity…'}</p>}
    {labels.length>0 && <p className="work-help">Labels: {labels.join(', ')}</p>}
    {error && <p role="alert" className="form-error">{error}</p>}
    {receipts.map(receipt=><div className="issue-receipt" key={receipt.request_id}><strong>Unconfirmed: {receipt.title}</strong><p className="work-help">Check this earlier submission before creating another copy.</p><Button type="button" variant="outline" disabled={busy} onClick={()=>perform(async()=>{const result=await api(`/api/v1/issue-submissions/${receipt.request_id}/recover`,{});if(alive.current){setReceipts(items=>items.filter(item=>item.request_id!==receipt.request_id));if(result.issue){setRecovered(result);onRecovered?.(result);}}})}>Check submission</Button></div>)}
    {recovered?.issue && <p role="status"><a href={recovered.issue.url} target="_blank" rel="noreferrer">Recovered #{recovered.issue.number}: {recovered.title} ↗</a>. This is an earlier submission; your current draft is unchanged.</p>}
    <div className="issue-publish-actions"><Button type="button" variant="ghost" disabled={busy} onClick={()=>load()}>Refresh connection</Button><Button type="button" disabled={busy || !connection?.available || !title.trim() || !spec.trim()} onClick={()=>perform(async()=>{
      key.current=await requestKey(connection,title,spec,labels);
      const result=await api('/api/v1/issues',{title,spec,labels,request_id:key.current,repository:connection.repository,actor:connection.actor});
      if(alive.current)onCreated(result);
    })}>{busy?'Creating…':`Create issue on ${connection?.label || 'repository'}`}</Button></div>
  </section>;
}
