import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";

const title = role => role === "implement" ? "Implement" : role === "review" ? "Review" : "Investigate";
const describe = profile => `${profile.harness} · ${profile.model || "Harness default"}${profile.reasoningEffort ? ` · ${profile.reasoningEffort} reasoning` : ""} (${profile.source === "installed" ? "installed harness" : "maintained preset"}, ${profile.modelSource === "installed" ? "installed model" : profile.modelSource === "role" ? "role model" : "default model"})`;

export function RoleEditor({ installed, csrfToken, onApplied }) {
  const [draft, setDraft] = useState(installed.definition), [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [notice, setNotice] = useState("");
  useEffect(() => { setDraft(installed.definition); setPreview(null); }, [installed]);
  function edit(role, update) {
    setDraft(current => ({ ...current, roles: { ...current.roles, [role]: update } }));
    setPreview(null); setError(""); setNotice("");
  }
  async function request(action, body) {
    const response = await fetch(`/api/v1/definition/${action}`, { method: "POST", headers: { "Content-Type": "application/json", "X-Factory-Session": csrfToken }, body: JSON.stringify(body) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || `Definition request failed (${response.status})`);
    return result;
  }
  async function perform(action) {
    setBusy(true); setError(""); setNotice("");
    try {
      if (action === "preview" || action === "rollback-preview") {
        setPreview(await request("diff", action === "preview" ? { definition: draft } : { rollback: true }));
      } else {
        const result = await request(preview.rollback ? "rollback" : "apply", { expected_revision: preview.revision, ...(preview.rollback ? {} : { definition: preview.definition }) });
        setDraft(result.definition); setPreview(null);
        setNotice(preview.rollback ? "Previous role definition restored. No work was started." : "Role definition applied. No work was started.");
        await onApplied();
      }
    } catch (failure) { setError(`${failure.message}. Reload installed settings or preview again; your draft is retained.`); setPreview(null); }
    finally { setBusy(false); }
  }
  function download() {
    const url = URL.createObjectURL(new Blob([JSON.stringify(installed.definition, null, 2) + "\n"], { type: "application/json" }));
    const link = document.createElement("a"); link.href = url; link.download = "factory-roles.json"; link.click(); URL.revokeObjectURL(url);
  }
  return <section className="role-editor" aria-label="Role profiles">
    <div className="role-editor-heading"><h2>Role profiles</h2><Button variant="outline" onClick={download} disabled={busy}>Export installed definition</Button></div>
    <p className="catalog-note">Inherit preserves the installed private harness command. Explicit Codex or Pi uses the maintained preset. Changing harness resets model and effort to defaults. Applying requires an idle controller, including no work awaiting approval.</p>
    <p className="role-revision">Current revision <code>{installed.revision}</code></p>
    <div className="role-editor-grid">{installed.capabilities.roles.map(role => {
      const selection = draft.roles[role], effective = installed.effective[role];
      const selectedHarness = selection.harness === "inherit" ? installed.inherited_harness : selection.harness;
      const supportsModel = ["codex", "pi"].includes(selectedHarness);
      const efforts = installed.capabilities.reasoningEffort[selectedHarness] || [];
      const modelMode = (!Object.hasOwn(selection, "model") || (selection.harness !== "inherit" && selection.model === null)) ? "inherit" : selection.model === null ? "default" : "explicit";
      return <fieldset key={role} disabled={busy} className="role-profile"><legend>{title(role)}</legend>
        <p className="role-effective">Installed: {describe(effective)}</p>
        <label htmlFor={`${role}-harness`}>Harness</label>
        <select id={`${role}-harness`} value={selection.harness} onChange={event => edit(role, { harness: event.target.value })}>
          {installed.capabilities.harnesses.map(value => <option key={value} value={value}>{value === "inherit" ? "Inherit installed harness" : value === "codex" ? "Codex preset" : "Pi preset"}</option>)}
        </select>
        <label htmlFor={`${role}-model-mode`}>Model selection</label>
        <select id={`${role}-model-mode`} value={modelMode} disabled={!supportsModel} onChange={event => {
          const next = { ...selection }; delete next.model;
          if (event.target.value !== "inherit") next.model = event.target.value === "default" ? null : "";
          edit(role, next);
        }}>
          <option value="inherit">{selection.harness === "inherit" ? "Inherit installed model" : "Harness default"}</option>
          {selection.harness === "inherit" && <option value="default">Harness default</option>}
          <option value="explicit">Choose model</option>
        </select>
        {modelMode === "explicit" && <><label htmlFor={`${role}-model`}>Model identifier</label><input id={`${role}-model`} value={selection.model} maxLength={128} autoComplete="off" spellCheck={false} onChange={event => edit(role, { ...selection, model: event.target.value })} /></>}
        {selectedHarness === "pi" && selection.harness !== "inherit" && <small>Choose a model with a supported provider prefix, for example anthropic/model-name.</small>}
        {!supportsModel && <small>Model overrides are unavailable for this inherited harness.</small>}
        <label htmlFor={`${role}-effort`}>Reasoning effort</label>
        <select id={`${role}-effort`} disabled={!efforts.length} value={selection.reasoningEffort || ""} onChange={event => {
          const next = { ...selection }; delete next.reasoningEffort;
          if (event.target.value) next.reasoningEffort = event.target.value;
          edit(role, next);
        }}><option value="">{efforts.length ? "Inherited / harness default" : "Unavailable in this adapter"}</option>{efforts.map(value => <option key={value} value={value}>{value}</option>)}</select>
      </fieldset>;
    })}</div>
    <p className="catalog-note">Validation checks configuration only. Model access, supported effort and quality require qualification. Skills and resources stay shared; Check is deterministic and Handoff remains an operator gate.</p>
    {preview && <section className="role-diff" aria-label="Definition diff"><h3>{preview.rollback ? "Rollback preview" : "Proposed changes"}</h3>
      <p className="role-revision">Based on revision <code>{preview.revision}</code></p>
      {preview.changes.length ? <ul>{preview.changes.map(change => <li key={change.role}><strong>{title(change.role)}</strong><span>Before: {describe(change.before)}</span><span>After: {describe(change.after)}</span></li>)}</ul> : <p>No role changes.</p>}
      <Button disabled={busy || !csrfToken || !preview.changes.length} onClick={() => perform("apply")}>{busy ? "Applying…" : preview.rollback ? "Apply rollback" : "Apply definition"}</Button>
    </section>}
    {error && <p className="role-error" role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}
    <div className="role-editor-actions"><Button variant="outline" disabled={busy || !csrfToken} onClick={() => perform("preview")}>{busy ? "Working…" : "Validate and preview diff"}</Button>
      <Button variant="outline" disabled={busy || !csrfToken || !installed.rollback_available} onClick={() => perform("rollback-preview")}>Preview rollback</Button>
      <Button variant="ghost" disabled={busy} onClick={async () => { setBusy(true); setError(""); try { await onApplied(); setPreview(null); setNotice("Installed settings reloaded."); } catch (failure) { setError(failure.message); } finally { setBusy(false); } }}>Reload installed settings</Button>
    </div>
  </section>;
}
