import { useEffect, useState } from "react";
import { Server, Bot, ShieldCheck, Code2, BookOpen } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { PageHeading, QuietState } from "@/components/ui/page-heading";

export function InfrastructurePage({ infrastructure, workers = [], loaded, error }) {
  const host = infrastructure?.host || workers[0]?.machine;
  const execution = infrastructure?.workers || workers.map(worker => ({ id: worker.instance_id, name: "Local worker", connected: worker.connected }));
  return <Page title="Infrastructure" description="The host and execution capacity for this project.">
    {error && <Failure value={error} />}
    {!loaded && !error ? <Loading /> : loaded && <div className="infrastructure-grid">
      <Card className="infrastructure-card"><h2><Server size={17} />Host</h2>{host ? <><strong>{host.hostname}</strong><p>{host.hardware || "Hardware name unavailable"}</p><dl className="workflow-settings">{[["System",`${host.platform} · ${host.architecture}`],["OS release",host.osRelease],["Capacity",`${host.logicalCpus} logical CPUs · ${Math.round(host.memoryMiB / 1024)} GiB memory`]].map(([label,value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl></> : <p>Host information unavailable.</p>}</Card>
      <Card className="infrastructure-card"><h2><Bot size={17} />Execution</h2><p>One controller owns this project's queue. Its worker runs isolated jobs on the host.</p>{execution.map(worker => <div className="infrastructure-worker" key={worker.id}><span>{worker.name || "Local worker"}<small>{worker.id}</small></span><Badge>{worker.connected ? "Available" : "Stopping"}</Badge></div>)}{!execution.length && <p>No worker status available.</p>}<a href="#/definition">View job resource limits</a></Card>
    </div>}
  </Page>;
}

const displayName = name => String(name || "Unknown").replaceAll("_", " ").replaceAll("-", " ").replace(/^./, c => c.toUpperCase());

export function DefinitionPage({ section = "definition" }) {
  const definitions = useDefinitions(), [selection, setSelection] = useState("software");
  const data = definitions.value, config = data.configuration;
  const names = Object.keys(data.workflows || {}), selected = names.includes(selection) ? selection : names[0];
  const steps = data.workflows?.[selected] || [];
  return <Page title={displayName(section)} description={section === "agents" ? "The roles that implement, review and investigate work." : section === "skills" ? "Instructions for agents and operators." : "This project's effective Factory settings."}>
    {definitions.loading ? <Loading /> : definitions.error ? <Failure value={definitions.error} /> : <div className="workflow-page">
      {section === "agents" && <>
        <div className="workflow-choices" role="group" aria-label="Work type">{names.map(name => <button type="button" key={name} aria-pressed={selected === name} onClick={() => setSelection(name)}>{name === "defence" ? <ShieldCheck size={16} /> : <Code2 size={16} />}<span>{displayName(name)}</span></button>)}</div>
        {config && <div className="workflow-profile"><Bot size={15} /><span>Harness <strong>{displayName(config.harness ?? config.agent)}</strong></span><span>Model <strong>{config.model || "Harness default"}</strong></span></div>}
        <ol className="workflow-steps">{steps.map((step,index) => {
          const command = data.commands.find(command => command.name === step.name);
          return <li key={step.name}><span className="step-number">{index+1}</span><div className="step-body"><div className="step-heading"><h2>{command?.title || displayName(step.name)}</h2><Badge>{step.approval ? "Operator approval" : command?.owner === "agent" ? "Agent role" : "Deterministic check"}</Badge></div><p>{command?.description || command?.prompt}</p>
            {step.name === "verify" && config && <code className="workflow-check">{config.check || "No check configured"}</code>}
            {!!command?.skills?.length && <div className="step-skills"><BookOpen size={13} /><span>{command.skills.join(" · ")}</span></div>}
          </div></li>;
        })}</ol>
        <p className="catalog-note">These steps form the {selected} workflow. Agent roles currently share one harness and model profile. Triage and specification happen before admission.</p>
      </>}
      {section === "skills" && <>
        <p className="catalog-note">Read-only instructions available to Factory agents. Expand a skill to inspect its contents and source.</p>
        <SkillLibrary skills={data.skills || []} />
        <h2 className="catalog-section-title">Operator setup</h2><p className="catalog-note">Factory Foundation guides repository and host setup. Use it explicitly before adopting Factory.</p><SkillLibrary skills={data.operator_skills || []} />
      </>}
      {section === "definition" && <>
        {config && <dl className="workflow-settings">{[["Harness",displayName(config.harness ?? config.agent)],["Model",config.model || "Harness default"],["Check command",config.check || "Not configured"],["Phase time limit",`${config.timeoutSeconds} seconds`],["Job resources",`${config.cpus} CPUs · ${config.memoryMiB} MiB`]].map(([label,value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>}
        {config?.issueReadinessLabels && <section aria-label="Issue readiness labels"><h2 className="catalog-section-title">Issue readiness labels</h2><p className="catalog-note">Planning metadata only; these labels do not start agents.</p><dl className="workflow-settings">{Object.entries(config.issueReadinessLabels).map(([state,label])=><div key={state}><dt>{displayName(state)}</dt><dd>{label}</dd></div>)}</dl></section>}
        <p className="catalog-note">Edit the private installation's factory.json while stopped, then restart. Workflow order and packaged skills follow the installed release.</p>
        <details className="definition-terms"><summary>Factory concepts</summary><dl className="workflow-settings">{Object.entries(data.terminology || {}).map(([term,meaning]) => <div key={term}><dt>{displayName(term)}</dt><dd>{meaning}</dd></div>)}</dl></details>
      </>}
    </div>}
  </Page>;
}
function SkillLibrary({ skills }) { return <div className="skill-library">{skills.map(skill => <details key={skill.id} className="skill-card"><summary><BookOpen size={16} /><span><strong>{skill.id}</strong><small>{skill.purpose}</small></span></summary><div className="skill-instructions"><p>{skill.path}</p><pre tabIndex={0} aria-label={`${skill.id} instructions`}>{skill.content}</pre><small>Installed file SHA-256: {skill.sha256}</small></div></details>)}</div>; }
export function AutomationsPage({ loaded, error, control }) {
  return <Page title="Automations" description="Scheduled work belongs to your agent harness.">{error && <Failure value={error} />}{!loaded && !error ? <Loading /> : loaded && <Card><QuietState title="Managed in your harness" description={`Configure schedules in ${control?.harness || "your selected harness"}, where supported, and call the Factory CLI/API. Factory owns execution and review; it runs no cron scheduler. External schedules are not discovered or listed here.`} /></Card>}</Page>;
}
function Page({ title, description, children }) { return <div className="secondary-page space-y-6"><PageHeading title={title} description={description} />{children}</div>; }
function Loading() { return <Card><QuietState title="Loading" description="Reading the current installation." role="status" /></Card>; }
function Failure({ value }) { return <div role="alert" className="rounded-md border border-danger/35 bg-danger/10 px-3 py-2 text-sm text-danger">{value}</div>; }
function useDefinitions() {
  const [result, setResult] = useState({ loading: true, error: "", value: { commands: [] } });
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/v1/definitions", { headers: { Accept: "application/json" }, signal: controller.signal }).then(async response => {
      if (!response.ok) { const body = await response.json().catch(() => ({})); throw new Error(body.error || `Definitions request failed (${response.status})`); }
      return response.json();
    }).then(value => setResult({ loading: false, error: "", value })).catch(error => { if (error.name !== "AbortError") setResult(current => ({ ...current, loading: false, error: error.message })); });
    return () => controller.abort();
  }, []);
  return result;
}
