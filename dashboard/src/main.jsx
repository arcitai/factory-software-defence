import { Inbox } from './inbox.jsx';
import { RunComposer } from './run-composer.jsx';
import { Github } from './github-icon.jsx';
import { TaskDetail } from './task-detail.jsx';
import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/geist';
import { ExternalLink, Inbox as InboxGlyph, Menu, Moon, Plus, Sun, CircleHelp } from 'lucide-react';
import { cn } from './lib/utils';
import { routeFromHash } from './routes.js';
import { projectIdentity } from './project-identity.js';
import { createStatusLoader } from './status-loader.js';
import { UsageControl } from './usage-panel.jsx';
import './styles.css';

function App() {
  const [status,setStatus]=useState({jobs:[],csrf_token:''}),[statusError,setStatusError]=useState(''),[statusLoaded,setStatusLoaded]=useState(false);
  const [route,setRoute]=useState(()=>routeFromHash(window.location.hash)),[composerOpen,setComposerOpen]=useState(false),[taskActionError,setTaskActionError]=useState(''),[issueRefreshKey,setIssueRefreshKey]=useState(0);
  const [dark,setDark]=useState(()=>localStorage.getItem('factory-theme')==='dark'),[workNavigation,setWorkNavigation]=useState([]);
  const scrollPositions=useRef(new Map()),previousHash=useRef(window.location.hash),returnTask=useRef(null),loader=useRef(null);
  const view=route.view,identity=projectIdentity(status.repo),selectedJob=route.jobID?status.jobs.find(job=>job.id===route.jobID):undefined;
  if(!loader.current)loader.current=createStatusLoader({request:async()=>{const response=await fetch('/api/v1/status',{headers:{Accept:'application/json'}});if(!response.ok)throw new Error(`Status request failed (${response.status})`);return response.json();},apply:result=>{if(result.kind==='error'){setStatusError(result.message);return;}setStatus(result.status);setStatusError('');setStatusLoaded(true);}});
  useEffect(()=>{document.documentElement.classList.toggle('dark',dark);localStorage.setItem('factory-theme',dark?'dark':'light');},[dark]);
  useEffect(()=>{const update=()=>{const previousView=routeFromHash(previousHash.current).view;if(!['task','issue'].includes(previousView))scrollPositions.current.set(previousView,window.scrollY);if(['task','issue'].includes(previousView))returnTask.current=previousHash.current;previousHash.current=window.location.hash;setTaskActionError('');setRoute(routeFromHash(window.location.hash));};window.addEventListener('hashchange',update);return()=>window.removeEventListener('hashchange',update);},[]);
  useLayoutEffect(()=>{window.scrollTo({top:scrollPositions.current.get(view)||0,behavior:'instant'});if(view==='runs'&&returnTask.current){const link=[...document.querySelectorAll('.task-row-link,.run-card-link')].find(item=>item.getAttribute('href')===returnTask.current);link?.focus({preventScroll:true});returnTask.current=null;}},[view,route.jobID,route.issueKey]);
  useEffect(()=>{let stopped=false,timer;const refresh=async()=>{await loader.current.refresh();if(!stopped)timer=window.setTimeout(refresh,2000);};refresh();return()=>{stopped=true;loader.current.cancel();window.clearTimeout(timer);};},[]);
  async function refreshStatus(){return loader.current.refresh();}
  async function issueCreated(){setIssueRefreshKey(key=>key+1);await refreshStatus();}
  async function nativeAction(job,action,payload={}) {
    setTaskActionError('');
    const response=await fetch(`/api/v1/jobs/${encodeURIComponent(job.id)}/${action}`,{method:'POST',headers:{'Content-Type':'application/json','X-Factory-Session':status.csrf_token},body:JSON.stringify(payload)});
    if(!response.ok){const body=await response.json().catch(()=>({})),error=new Error(body.error||`Native ${action} failed (${response.status})`);setTaskActionError(error.message);throw error;}
    await refreshStatus();
  }
  async function started(job){await refreshStatus();window.location.hash=`#/runs/${encodeURIComponent(job.id)}`;}
  const showNewIssue=Boolean(status.issue_provider?.capabilities?.create);
  return <div className="app-shell min-h-screen bg-background text-foreground md:flex">
    <aside className="app-sidebar sticky top-0 z-20 flex shrink-0 items-center border-b border-border bg-sidebar px-4 py-2 md:h-screen md:w-[203px] md:flex-col md:items-stretch md:border-b-0 md:border-r md:px-4 md:py-5">
      <div className="brand-lockup flex h-10 shrink-0 items-center gap-3 px-1"><a href="#/inbox" className="brand-wordmark" aria-label="Factory home"><span>factory<span className="brand-period">.</span></span><span className="brand-descriptor">Software &amp; Defence</span></a></div>
      <nav className="desktop-nav" aria-label="Primary"><PrimaryLink view={view}/></nav>
      <details className="mobile-nav"><summary aria-label="Open navigation"><Menu className="size-4"/><span>Menu</span></summary><nav aria-label="Primary mobile"><PrimaryLink view={view} mobile/></nav></details>
      <div className="sidebar-bottom"><UsageControl token={status.csrf_token}/><button onClick={()=>setDark(value=>!value)} className="nav-item theme-switch" aria-label={`Switch to ${dark?'light':'dark'} theme`}>{dark?<Moon className="size-4"/>:<Sun className="size-4"/>}<span>{dark?'Dark':'Light'} theme</span></button></div>
      <div className="mobile-usage"><UsageControl token={status.csrf_token}/></div>
      <button onClick={()=>setDark(value=>!value)} className="mobile-theme ml-auto grid size-9 place-items-center text-muted-foreground md:hidden" aria-label={`Switch to ${dark?'light':'dark'} theme`}>{dark?<Moon className="size-4"/>:<Sun className="size-4"/>}</button>
    </aside>
    <main className="workshop min-w-0 flex-1">
      <ProjectContext identity={identity} links={status.project_links} compact={view==='task'||view==='issue'} loaded={statusLoaded} error={statusError} showNewIssue={view==='runs'&&showNewIssue} onNewIssue={()=>setComposerOpen(true)}/>
      {view==='task'?<TaskDetail identity={identity} links={status.project_links} navigation={workNavigation} csrfToken={status.csrf_token} job={selectedJob} loaded={statusLoaded} error={statusError} actionError={taskActionError} onWorkflowAction={nativeAction} capabilities={status.native_capabilities}/>:null}
      <div hidden={view!=='runs'&&view!=='issue'}>
        <Inbox jobs={status.jobs} loaded={statusLoaded} active={view==='runs'||view==='issue'} issueKey={route.issueKey} identity={identity} links={status.project_links} onNavigation={setWorkNavigation}
          detailProps={{actionError:taskActionError,onWorkflowAction:nativeAction,capabilities:status.native_capabilities}} onNewIssue={showNewIssue?()=>setComposerOpen(true):null}
          nativeReadiness={status.native_readiness} token={status.csrf_token} provider={status.issue_provider} statusError={statusError} refreshStatus={refreshStatus}
          refreshKey={issueRefreshKey} onStarted={started}/>
        {composerOpen&&<RunComposer identity={identity} issueProvider={status.issue_provider} csrfToken={status.csrf_token} projectLinks={status.project_links} onCreated={issueCreated} close={()=>setComposerOpen(false)}/>}
      </div>
    </main>
  </div>;
}
function PrimaryLink({view,mobile=false}) {return <a href="#/inbox" aria-current={['runs','task','issue'].includes(view)?'page':undefined} className={cn('nav-item',['runs','task','issue'].includes(view)&&'nav-item-active')} onClick={event=>{if(mobile)event.currentTarget.closest('details')?.removeAttribute('open');}}><InboxGlyph className="size-4"/><span>Inbox</span></a>;}
function ProjectContext({identity,links,compact,loaded,error,showNewIssue,onNewIssue}) {
  const title=identity?.name||(!loaded&&!error?'Loading configured project…':'Project identity unavailable');
  const freshness=error?loaded?'Status stale':'Status unavailable':loaded?'Status current':'Loading status';
  return <header aria-label="Configured project" className={cn('project-header',compact&&'project-header-compact')}><div className="project-heading"><div className="project-heading-copy"><h1 title={identity?.name}>{title}</h1><div className="project-context-line"><span className={cn('project-freshness',error&&'is-stale')} title={error||undefined} aria-label={error?`${freshness}: ${error}`:freshness} aria-live="polite"><span className="freshness-dot"/>{freshness}</span>{identity&&<ProjectTooltip path={identity.path}/>}</div></div><div className="project-actions">{links?.repository&&<a className="repo-action" href={links.repository} target="_blank" rel="noreferrer"><Github size={14}/>View repo<ExternalLink size={12}/></a>}{showNewIssue&&<button className="repo-action new-issue-action" type="button" onClick={onNewIssue} disabled={!loaded||Boolean(error)}><Plus size={14}/>New issue</button>}</div></div></header>;
}
function ProjectTooltip({path}) {const [open,setOpen]=useState(false),id=React.useId();return <span className="project-path" onMouseEnter={()=>setOpen(true)} onMouseLeave={()=>setOpen(false)} onBlur={()=>setOpen(false)} onKeyDown={event=>{if(event.key==='Escape')setOpen(false);}}><button type="button" aria-label="Project details" aria-describedby={open?id:undefined} onFocus={()=>setOpen(true)} onClick={()=>setOpen(true)}><CircleHelp size={13}/>Project details</button><span id={id} role="tooltip" hidden={!open}>Configured project<br/><code>{path}</code></span></span>;}

export const appRoot=createRoot(document.getElementById('root'));
appRoot.render(<App/>);
