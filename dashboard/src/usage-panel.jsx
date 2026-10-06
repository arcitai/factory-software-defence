import React, { useEffect, useRef, useState } from 'react';
import { Activity, RefreshCw, X } from 'lucide-react';

const time=value=>value ? new Date(value).toLocaleString(undefined,{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'}) : 'Not reported';
const harnessName=value=>({codex:'Codex',claude:'Claude Code'})[value]||value||'Native harness';

export function UsageControl({token}) {
  const [open,setOpen]=useState(false),trigger=useRef(null);
  return <><button ref={trigger} className="nav-item usage-control" onClick={()=>setOpen(true)} aria-haspopup="dialog"><Activity size={16}/><span>Usage</span></button>
    {open&&<UsagePanel token={token} close={()=>{setOpen(false);trigger.current?.focus();}}/>}</>;
}
export function UsagePanel({token,close}) {
  const dialog=useRef(null),[data,setData]=useState(null),[error,setError]=useState(''),[loading,setLoading]=useState(false),[tick,setTick]=useState(Date.now());
  const request=useRef(0),mounted=useRef(true);
  async function refresh() {
    const id=++request.current;
    setLoading(true);
    try {
      const response=await fetch('/api/v1/usage',{headers:{Accept:'application/json','X-Factory-Session':token},signal:AbortSignal.timeout(55000)});
      if(!response.ok)throw Error('Usage could not be refreshed.');
      const result=await response.json();
      if(!Array.isArray(result.profiles))throw Error('Usage response is unavailable.');
      if(mounted.current&&id===request.current){setData(result);setError('');}
    }catch(error){if(mounted.current&&id===request.current)setError(error.message);}
    finally{if(mounted.current&&id===request.current){setLoading(false);setTick(Date.now());}}
  }
  useEffect(()=>{
    mounted.current=true;dialog.current?.showModal();
    if(token)refresh();
    const timer=setInterval(()=>setTick(Date.now()),30000);
    return()=>{mounted.current=false;request.current++;clearInterval(timer);};
  },[token]);
  return <dialog ref={dialog} className="usage-dialog" aria-labelledby="usage-title" onCancel={event=>{event.preventDefault();close();}}>
    <header><div><span className="usage-eyebrow">CONNECTED HARNESSES</span><h2 id="usage-title">Usage</h2></div><button className="usage-close" onClick={close} aria-label="Close usage"><X size={18}/></button></header>
    <p className="usage-intro">Account limits include work outside this project. Each window is separate.</p>
    <div className="usage-tools"><span aria-live="polite">{loading?'Reading native usage…':error||'Limits reported by your harnesses'}</span><button onClick={refresh} disabled={loading||!token} aria-label="Refresh usage"><RefreshCw size={14}/>Refresh</button></div>
    {!token&&<p>Waiting for the Factory connection…</p>}
    {data?.profiles?.map(profile=><UsageProfile key={profile.id} profile={profile} now={tick} stale={Boolean(error)}/>)}
    {data?.profiles?.length===0&&<p>No connected usage profiles.</p>}
    <footer>Readings refresh at most every two minutes. Unknown limits remain unavailable. These percentages are not token costs or charges.</footer>
  </dialog>;
}
function UsageProfile({profile,now,stale}) {
  const expired=profile.windows?.some(limit=>limit.resets_at&&Date.parse(limit.resets_at)<=now);
  const lastKnown=stale||profile.status==='last_known'||expired||(profile.checked_at&&now-Date.parse(profile.checked_at)>120000);
  return <section className={`usage-profile usage-${profile.harness}`} aria-label={`${harnessName(profile.harness)} usage`}>
    <div className="usage-profile-heading"><h3>{harnessName(profile.harness)}</h3>{profile.plan&&<span className="usage-plan">{profile.plan}</span>}<span className={`usage-state ${lastKnown?'is-stale':''}`}>{lastKnown?'Last known':profile.status==='reported'?'Reported':'Unavailable'}</span></div>
    {profile.windows?.length ? <div className="usage-windows">{profile.windows.map(limit=>{
      const used=limit.used_percent,valid=typeof used==='number'&&Number.isFinite(used)&&used>=0&&used<=100;
      const past=limit.resets_at&&Date.parse(limit.resets_at)<=now;
      return <div className="usage-window" key={limit.id}><div className="usage-window-heading"><span>{limit.label}</span><strong>{valid?`${Number(used.toFixed(1))}% used`:'Unavailable'}</strong></div>
        {valid&&<meter className={used>=90?'usage-high':used>=70?'usage-elevated':''} min="0" max="100" value={used} aria-label={`${limit.label}: ${used}% used`}/>}
        <div className="usage-window-detail"><span>{valid?`${Number((100-used).toFixed(1))}% remaining in this reading`:'No percentage reported'}</span><span>{past?'Reset time passed · refresh':limit.resets_at?`Resets ${time(limit.resets_at)}`:'Reset not reported'}</span></div>
      </div>;
    })}</div>:<p className="usage-empty">The harness has not reported its limits. No usage has been inferred.</p>}
    <div className="usage-source">{profile.source||'Native account limits'}<span>{profile.checked_at?'Read':'Last attempt'} {time(profile.checked_at||profile.attempted_at)}</span></div>
    {profile.note&&<p className="usage-note">{profile.note}</p>}
  </section>;
}
