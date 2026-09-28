import { Inbox } from "./inbox.jsx";
import { RunComposer } from "./run-composer.jsx";
import { Github } from "./github-icon.jsx";
import { TaskDetail } from "./task-detail.jsx";
import { friendlyName } from "./task-display.jsx";
import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource-variable/geist";
import { Activity, BarChart3, Bot, Menu, Moon, Plus, Server, Sun, BookOpen, Settings2, TimerReset, ExternalLink, CircleHelp } from "lucide-react";
import { Analytics } from "@/analytics";
import { DefinitionPage, InfrastructurePage, AutomationsPage } from "@/catalog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { routeFromHash } from "@/routes";
import { projectIdentity } from "@/project-identity";
import { createStatusLoader } from "@/status-loader";
import "./styles.css";


function App() {
  const [status, setStatus] = useState({ jobs: [], workers: [], commands: [], repositories: [], triggers: [], csrf_token: "" });
  const [selection, setSelection] = useState("");
  const [repository, setRepository] = useState("");
 const [prompt, setPrompt] = useState("");
 const [title,setTitle]=useState("");
 const [sourceURL,setSourceURL]=useState("");
 const [sourceRef,setSourceRef]=useState("");
  const [model, setModel] = useState("");
  const [statusError, setStatusError] = useState("");
  const [statusLoaded, setStatusLoaded] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [taskActionError, setTaskActionError] = useState("");
  const [deliveryActionError, setDeliveryActionError] = useState("");
  const [removalError,setRemovalError] = useState("");
  const [deletingJob, setDeletingJob] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [composerOpen, setComposerOpen] = useState(false);
  const [composerLocal,setComposerLocal] = useState(false);
  const [inboxRefresh,setInboxRefresh] = useState(0);
  const [workNavigation, setWorkNavigation] = useState([]);
  const [dark, setDark] = useState(() => localStorage.getItem("factory-theme") === "dark");
  const [route, setRoute] = useState(() => routeFromHash(window.location.hash));
  const view = route.view;
  const scrollKey = hash => routeFromHash(hash).view === "runs" ? "inbox" : hash;
  const scrollPositions = useRef(new Map());
  const previousHash = useRef(window.location.hash);
  const returnTask = useRef(null);
  useLayoutEffect(() => {
    const key = (route.view === "task" || route.view === "issue") ? "" : scrollKey(window.location.hash);
    window.scrollTo({ top: scrollPositions.current.get(key) || 0, behavior: "instant" });
    if (route.view === "runs" && returnTask.current) {
      const link = [...document.querySelectorAll('.task-row-link, .run-card-link')].find(item => item.getAttribute('href') === returnTask.current);
      link?.focus({ preventScroll: true });
      returnTask.current = null;
    }
  }, [route.view, route.jobID, route.issueKey]);
  const statusLoader = useRef(null);
  if (!statusLoader.current) statusLoader.current = createStatusLoader({
    request: async () => {
      const response = await fetch("/api/v1/status", { headers: { Accept: "application/json" } });
      if (!response.ok) throw new Error(`Status request failed (${response.status})`);
      return response.json();
    },
    apply: (result) => {
      if (result.kind === "error") {
        setStatusError(result.message);
        return;
      }
      const next = result.status;
      setStatus(next);
      setStatusError("");
      setStatusLoaded(true);
      const available = new Set(selectionChoices(next).map((choice) => choice.value));
      setSelection((current) => available.has(current) ? current : available.has(localStorage.getItem("factory-workflow")) ? localStorage.getItem("factory-workflow") : firstSelection(next));
      const availableRepositories = next.repositories || [];
      setRepository((current) => availableRepositories.includes(current) ? current : availableRepositories.includes(localStorage.getItem("factory-repository")) ? localStorage.getItem("factory-repository") : availableRepositories[0] || "");
    },
  });

  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
    localStorage.setItem("factory-theme", dark ? "dark" : "light");
  }, [dark]);

  useEffect(() => {
    const updateView = () => {
      scrollPositions.current.set(scrollKey(previousHash.current), window.scrollY);
      if (["task", "issue"].includes(routeFromHash(previousHash.current).view)) returnTask.current = previousHash.current;
      previousHash.current = window.location.hash;
      setTaskActionError("");
      setDeliveryActionError("");
      setRemovalError("");
      setRoute(routeFromHash(window.location.hash));
    };
    window.addEventListener("hashchange", updateView);
    return () => window.removeEventListener("hashchange", updateView);
  }, []);

  useEffect(() => {
    let stopped = false;
    let timer;
    const load = async () => {
      await statusLoader.current.refresh();
      if (!stopped) timer = window.setTimeout(load, 2000);
    };
    load();
    return () => {
      stopped = true;
      statusLoader.current.cancel();
      window.clearTimeout(timer);
    };
  }, []);

  const choices = useMemo(() => selectionChoices(status), [status.commands, status.workflows]);

  const repositories = status.repositories;
  const identity = projectIdentity(status.repo);

  const selectedJob = route.jobID ? status.jobs.find((job) => job.id === route.jobID) : undefined;

  async function submit(event) {
    event.preventDefault();
    setSubmitting(true);
    setSubmitError("");
    try {
      const response = await fetch("/api/v1/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Factory-Session": status.csrf_token },
        body: JSON.stringify({ repository, model: model.trim(), ...(selection.startsWith("workflow:") ? { workflow: selection.slice(9),title: title || prompt.trim().split("\n")[0].slice(0,100),source_url:sourceURL,spec:prompt,...(sourceRef.trim()?{source_ref:sourceRef.trim()}:{}) } : { command: selection.slice(8),prompt }) }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error || `Submission failed (${response.status})`);
      }
      localStorage.setItem("factory-workflow",selection); localStorage.setItem("factory-repository",repository);
      const created = await response.json();
      setPrompt(""); setTitle(""); setSourceURL(""); setSourceRef("");
      setComposerOpen(false);
      await statusLoader.current.refresh();
      window.location.hash = `#/runs/${created.id}`;
    } catch (requestError) {
      setSubmitError(requestError.message);
    } finally {
      setSubmitting(false);
    }
  }

  async function workflowAction(job, action, stopped = false, feedback = "", sourceRef = "", revision = {}) {
    const deliveryAction = ["publish", "abandon-delivery"].includes(action);
    if (deliveryAction) setDeliveryActionError("");
    else setTaskActionError("");
    try {
      const body = action === "publish"
        ? { run_id: job.runs.at(-1)?.id }
        : action === "abandon-delivery"
          ? { run_id: job.runs.at(-1)?.id, delivery_identity: job.delivery_status?.identity, branch_sha: job.delivery_status?.remote_collision?.sha }
          : { run_id: job.runs.at(-1)?.id, ...revision, previous_process_stopped: stopped, feedback, ...(sourceRef.trim()?{source_ref:sourceRef.trim()}:{}) };
      const response = await fetch(`/api/v1/jobs/${encodeURIComponent(job.id)}/${action}`, {
        method: "POST", headers: { "Content-Type": "application/json", "X-Factory-Session": status.csrf_token },
        body: JSON.stringify(body),
      });
      if (!response.ok) { const body = await response.json().catch(() => ({})); throw new Error(body.error || "Unable to update job"); }
      await statusLoader.current.refresh();
    } catch (error) {
      if (deliveryAction) setDeliveryActionError(error.message);
      else setTaskActionError(error.message);
    }
  }

  async function deleteJob(job) {
    if (!window.confirm(`Remove local execution ${shortId(job.id)} from history? Private evidence is retained. The repository issue is unchanged.`)) return;
    setDeletingJob(job.id);
    setRemovalError("");
    try {
      const response = await fetch(`/api/v1/jobs/${encodeURIComponent(job.id)}`, {
        method: "DELETE",
        headers: { "X-Factory-Session": status.csrf_token },
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error || `Removal failed (${response.status})`);
      }
      await statusLoader.current.refresh();
      window.location.hash = "#/runs";
    } catch (requestError) {
      setRemovalError(requestError.message);
    } finally {
      setDeletingJob("");
    }
  }

  return (
    <div className="app-shell min-h-screen bg-background text-foreground md:flex">
      <aside className="app-sidebar sticky top-0 z-20 flex shrink-0 items-center border-b border-border bg-sidebar px-4 py-2 md:h-screen md:w-[203px] md:flex-col md:items-stretch md:border-b-0 md:border-r md:px-4 md:py-5">
        <div className="brand-lockup flex h-10 shrink-0 items-center gap-3 px-1">
          <a href="#/runs" className="brand-wordmark" aria-label="Factory home"><span>factory<span className="brand-period">.</span></span><span className="brand-descriptor">Software &amp; Defence</span></a>
        </div>
        <nav className="desktop-nav" aria-label="Primary">
          <PrimaryLinks view={view} native={status.native} />
        </nav>
        <details className="mobile-nav">
          <summary aria-label="Open navigation"><Menu className="size-4" /><span>Menu</span></summary>
          <nav aria-label="Primary mobile">
            <PrimaryLinks view={view} mobile native={status.native} />
            {!status.native && <div className="mobile-settings"><DefinitionLink view={view} mobile /></div>}
          </nav>
        </details>
        <div className="sidebar-bottom">
          {!status.native && <nav aria-label="Settings"><DefinitionLink view={view} /></nav>}
          <button onClick={() => setDark((value) => !value)} className="nav-item theme-switch" aria-label={`Switch to ${dark ? "light" : "dark"} theme`}>
            {dark ? <Moon className="size-4" /> : <Sun className="size-4" />}<span>{dark ? "Dark" : "Light"} theme</span>
          </button>
        </div>
        <button onClick={() => setDark((value) => !value)} className="mobile-theme ml-auto grid size-9 place-items-center text-muted-foreground md:hidden" aria-label={`Switch to ${dark ? "light" : "dark"} theme`}>
          {dark ? <Moon className="size-4" /> : <Sun className="size-4" />}
        </button>
      </aside>

      <main className="workshop min-w-0 flex-1">
        <ProjectContext identity={identity} links={status.project_links} compact={view === "task" || view === "issue"} loaded={statusLoaded} error={statusError} showNewTask={view === "runs" && (!status.native || status.issue_provider?.capabilities?.create)} onNewTask={() => (setComposerLocal(false), setSubmitError(""), setComposerOpen(true))} />
        {view === "task" ? <TaskDetail identity={identity} links={status.project_links} navigation={workNavigation} csrfToken={status.csrf_token} job={selectedJob} loaded={statusLoaded} error={statusError} actionError={taskActionError} removalError={removalError} deliveryActionError={deliveryActionError} deleting={deletingJob === route.jobID} onDelete={deleteJob} onWorkflowAction={workflowAction} />
          : view === "analytics" ? <Analytics jobs={status.jobs} workflows={status.workflows || []} loaded={statusLoaded} error={statusError} />
            : view === "infrastructure" ? <InfrastructurePage infrastructure={status.infrastructure} workers={status.workers} identity={identity} loaded={statusLoaded} error={statusError} />
              : view === "automations" ? <AutomationsPage control={status.automation_control} loaded={statusLoaded} error={statusError} />
                  : ["agents", "skills", "definition"].includes(view) ? <DefinitionPage key={view} section={view} csrfToken={status.csrf_token} />
                  : null}
        <div hidden={view !== "runs" && view !== "issue"}>
          <Inbox jobs={status.jobs} loaded={statusLoaded} active={view === "runs" || view === "issue"} issueKey={route.issueKey} identity={identity} links={status.project_links} onNavigation={setWorkNavigation}
            detailProps={{ actionError:taskActionError, removalError, deliveryActionError, deleting:Boolean(deletingJob), onDelete:deleteJob, onWorkflowAction:workflowAction }}
            onLocalRequest={status.native ? null : ()=>{setComposerLocal(true);setSubmitError("");setComposerOpen(true);}}
            onNewIssue={status.native && !status.issue_provider?.capabilities?.create ? null : ()=>{setComposerLocal(false);setSubmitError("");setComposerOpen(true);}}
            native={status.native} nativeReadiness={status.native_readiness}
            token={status.csrf_token} provider={status.issue_provider} statusError={statusError} refreshKey={inboxRefresh}
            refreshStatus={()=>statusLoader.current.refresh()} synthetic={(status.harness ?? status.agent) === "mock"}
            onStarted={async created=>{await statusLoader.current.refresh();window.location.hash=`#/runs/${created.id}`;}} />
          {composerOpen && <RunComposer localOnly={composerLocal} onCreated={()=>setInboxRefresh(value=>value+1)} issueProvider={status.issue_provider} csrfToken={status.csrf_token} projectLinks={status.project_links} sourceRefDefault={status.source_ref_default || "HEAD"} sourceRef={sourceRef} setSourceRef={setSourceRef} error={submitError} title={title} setTitle={setTitle} sourceURL={sourceURL} setSourceURL={setSourceURL} choices={choices} repositories={repositories} identity={identity} selection={selection} setSelection={setSelection} repository={repository} setRepository={setRepository} prompt={prompt} setPrompt={setPrompt} model={model} setModel={setModel} submitting={submitting} submit={submit} close={() => setComposerOpen(false)} />}
        </div>
      </main>
    </div>
  );
}

function DefinitionLink({ view, mobile = false }) {
  return <a href="#/definition" title="Factory settings and definition" aria-current={view === "definition" ? "page" : undefined} className={cn("nav-item", view === "definition" && "nav-item-active")} onClick={event => { if (mobile) event.currentTarget.closest("details")?.removeAttribute("open"); }}><Settings2 className="size-4" /><span>Definition</span></a>;
}

function PrimaryLinks({ view, mobile = false, native = false }) {
  const link = (href, Icon, label, active) => <a href={href} aria-current={active ? "page" : undefined} className={cn("nav-item", active && "nav-item-active")} onClick={(event) => { if (mobile) event.currentTarget.closest("details")?.removeAttribute("open"); }}>
    <Icon className="size-4" /><span>{label}</span>
  </a>;
  return <>
    {link("#/inbox", Activity, "Inbox", view === "runs" || view === "task" || view === "issue")}
    {!native && <>
    {link("#/analytics", BarChart3, "Analytics", view === "analytics")}
    {link("#/agents", Bot, "Agents", view === "agents")}
    {link("#/skills", BookOpen, "Skills", view === "skills")}
    {link("#/automations", TimerReset, "Automations", view === "automations")}
    {link("#/infrastructure", Server, "Infrastructure", view === "infrastructure")}
    </>}
  </>;
}

function ProjectContext({ identity, links, compact, loaded, error, showNewTask, onNewTask }) {
  const title = identity?.name || (!loaded && !error ? "Loading configured project…" : "Project identity unavailable");
  const freshness = error ? loaded ? "Status stale" : "Status unavailable" : loaded ? "Status current" : "Loading status";
  return <header aria-label="Configured project" className={cn("project-header", compact && "project-header-compact")}>
    <div className="project-heading">
      <div className="project-heading-copy">
        <h1 title={identity?.name}>{title}</h1>
        <div className="project-context-line">
          <span className={cn("project-freshness", error && "is-stale")} title={error || undefined} aria-label={error ? `${freshness}: ${error}` : freshness} aria-live="polite"><span className="freshness-dot" />{freshness}</span>
          {identity && <ProjectTooltip path={identity.path} />}
        </div>
      </div>
      <div className="project-actions">
        {links?.repository && <a className="repo-action" href={links.repository} target="_blank" rel="noreferrer"><Github size={14} />View repo<ExternalLink size={12} /></a>}
        {showNewTask && <button className="repo-action new-issue-action" type="button" onClick={onNewTask} disabled={!loaded || Boolean(error)}><Plus size={14} />New issue</button>}

      </div>
    </div>
  </header>;
}

function ProjectTooltip({ path }) {
  const [open, setOpen] = useState(false), id = React.useId();
  return <span className="project-path" onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)} onBlur={() => setOpen(false)} onKeyDown={event => { if (event.key === "Escape") setOpen(false); }}>
    <button type="button" aria-label="Project details" aria-describedby={open ? id : undefined} onFocus={() => setOpen(true)} onClick={() => setOpen(true)}><CircleHelp size={13} />Project details</button>
    <span id={id} role="tooltip" hidden={!open}>Configured project<br /><code>{path}</code></span>
  </span>;
}



function selectionChoices(status) {
 const workflows=status.workflows || [];
 return workflows.length ? workflows.map(name=>({value:`workflow:${name}`,label:friendlyName(name)})) : (status.commands || []).map(name=>({value:`command:${name}`,label:friendlyName(name)}));
}
function firstSelection(status) { return selectionChoices(status)[0]?.value || ""; }
function shortId(id) { const [, value = id] = id.split("_", 2); return value.slice(0, 8); }
export const appRoot = createRoot(document.getElementById("root"));
appRoot.render(<App />);
