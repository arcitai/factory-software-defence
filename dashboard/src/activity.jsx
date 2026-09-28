import React, { useEffect, useState } from "react";
import { friendlyName, stateLabel } from "./task-display.jsx";

const labels = { phase_started: "Phase started", process_started: "Docker client started",
  message_completed: "Message completed", tool_completed: "Tool completed", process_exited: "Docker client exited",
  phase_completed: "Phase completed", phase_error: "Executor diagnostic: phase failed" };
const tools = { read: "read", edit: "edit", command: "command", search: "search", other: "other" };
const time = value => value ? new Date(value).toLocaleString() : "Unknown";

export function Activity({ jobID, run, csrfToken }) {
  const [state, setState] = useState(null), [refresh, setRefresh] = useState(0), [limit, setLimit] = useState(50);
  useEffect(() => {
    if (!run) return;
    const controller = new AbortController();
    let timer, cursor = null, events = [], truncated = false;
    setState(null);
    async function poll() {
      try {
        const response = await fetch(`/api/v1/jobs/${encodeURIComponent(jobID)}/runs/${encodeURIComponent(run.id)}/activity?limit=${limit}${cursor === null ? "" : `&after=${cursor}`}`,
          { headers: { "X-Factory-Session": csrfToken }, signal: AbortSignal.any([controller.signal, AbortSignal.timeout(5000)]) });
        if (!response.ok) throw new Error();
        const page = await response.json();
        if (controller.signal.aborted) return;
        if (page.job !== jobID || page.attempt !== run.id) throw new Error();
        const received = page.events.filter(event => Object.hasOwn(labels, event.kind));
        truncated ||= page.truncated || events.length + received.length > limit;
        events = [...events, ...received].slice(-limit); cursor = page.next_cursor;
        setState({ jobID, runID: run.id, page, events, truncated, stale: false, readAt: new Date().toISOString() });
        if (page.terminal && !page.has_more) return;
      } catch {
        if (controller.signal.aborted) return;
        setState(previous => ({ ...previous, jobID, runID: run.id, stale: true }));
      }
      timer = setTimeout(poll, 2000);
    }
    void poll();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [jobID, run?.id, csrfToken, refresh, limit]);
  if (!run) return null;
  const current = state?.jobID === jobID && state?.runID === run.id ? state : null;
  const page = current?.page;
  const events = current?.events || [];
  const gaps = page?.rejected > 0 || page?.write_errors > 0;
  const eventText = event => `${labels[event.kind]}${event.kind === "tool_completed" && Object.hasOwn(tools, event.tool) ? ` (${tools[event.tool]})` : ""}`;
  const eventList = (items, label, recent = false) => <ol tabIndex={0} aria-label={label} className="activity-events">{items.map(event => <li key={event.cursor}>
    <span>{recent && event === events.at(-1) && <span className="text-muted-foreground">Latest: </span>}{eventText(event)}</span>
    <span className="text-muted-foreground">{!recent && `#${event.cursor} · `}<time dateTime={event.at}>{time(event.at)}</time></span>
  </li>)}</ol>;
  return <section aria-label="Execution activity" className="execution-activity space-y-2 rounded-lg border border-border p-3 text-xs">
    <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-medium text-sm">Activity · {friendlyName(run.command)} · {stateLabel(run.state)}</h3>
      <button type="button" className="underline" onClick={() => setRefresh(value => value + 1)}>Refresh activity</button></div>
    {current?.stale && <p role="alert">Activity refresh unavailable. {page ? "Observations are stale. " : ""}Reconnecting…</p>}
    {!current && <p role="status">Refreshing activity…</p>}
    {page?.status === "unavailable" && <p>No retained activity for this attempt.</p>}
    {page?.status === "error" && <p role="alert">Activity record unavailable or invalid; observations may be missing.</p>}
    {page?.status === "available" && !events.length && <p>No activity observed yet.</p>}
    {page?.support === "unsupported" && <p>Only executor events available for this harness.</p>}
    {events.length > 0 && eventList(events.slice(-3), "Recent observations", true)}
    {page?.terminal ? <p>Attempt ended. {page.completion_observed ? "Executor end observed." : "Executor end not observed; final activity may be missing."}</p>
      : <p className="text-muted-foreground">No new event means activity is unknown.</p>}
    {(current?.truncated || page?.dropped > 0) && <p>Earlier events omitted from this bounded view.</p>}
    {gaps && <p role="alert">Observation gaps recorded. See observation details.</p>}
    {events.length > 0 && <details>
      <summary>Retained timeline ({events.length} events)</summary>
      {events.length > 3 && <p className="text-muted-foreground">Includes earlier events.</p>}
      {limit < 128 && current?.truncated && <button type="button" className="underline" onClick={() => setLimit(128)}>Show retained activity (up to 128 events)</button>}
      {eventList(events, "Observed events")}
    </details>}
    <details>
      <summary>Observation details</summary>
      <dl className="activity-facts">
        <div><dt>Attempt</dt><dd>{run.id}</dd></div>
        <div><dt>Phase / queue</dt><dd>{run.command} / {run.state}</dd></div>
        <div><dt>Container health</dt><dd>Unknown</dd></div>
        <div><dt>Last Docker client observation</dt><dd>{page?.process_observation === "process_started" ? "Started" : page?.process_observation === "process_exited" ? "Exited" : "Unknown"} · {time(page?.process_observed_at)}</dd></div>
        <div><dt>Phase started</dt><dd>{time(page?.phase_started_at || run.started_at)}</dd></div>
        <div><dt>Last stdout received</dt><dd>{time(page?.last_received_at)}</dd></div>
        <div><dt>Last successful refresh</dt><dd>{time(current?.readAt)}</dd></div>
        <div><dt>Saved snapshot</dt><dd>{time(page?.saved_at)}</dd></div>
        {gaps && <div><dt>Observation gaps</dt><dd>{page.rejected} rejected input lines; {page.write_errors} storage errors.</dd></div>}
        {page?.dropped > 0 && <div><dt>Retention</dt><dd>{page.dropped} earlier events dropped.</dd></div>}
      </dl>
      {page?.status === "unavailable" && <p>Older history is not reconstructed from logs.</p>}
      <p className="text-muted-foreground">Activity does not establish process health. Telemetry is not verification, usage or billing.</p>
    </details>
  </section>;
}
