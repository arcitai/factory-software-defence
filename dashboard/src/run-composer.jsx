import React, { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Play, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { IssuePublish } from './issue-publish.jsx';
import { IssueFields } from './issue-form.jsx';
import { repositoryLabel } from './project-identity.js';

export function RunComposer({ localOnly = false, onCreated, issueProvider, title, setTitle, sourceRef, setSourceRef, sourceRefDefault, choices, identity, selection, setSelection, repository, prompt, setPrompt, model, setModel, submitting, submit, close, csrfToken, projectLinks, error }) {
  const dialog = useRef(null), mounted = useRef(true), pending = useRef(null), selectionOverride = useRef(false);
  const [step, setStep] = useState('source');
  const [loading, setLoading] = useState(false), [intakeError, setIntakeError] = useState('');
  const [labels, setLabels] = useState([]), [suggestion, setSuggestion] = useState(null), [suggestionStale, setSuggestionStale] = useState(false);
  const [catalog, setCatalog] = useState(null), [template, setTemplate] = useState(null), [answers, setAnswers] = useState({});
  const remoteSupported = !localOnly && (issueProvider?.capabilities?.create ?? Boolean(projectLinks?.repository));
  const canReadTemplates = issueProvider?.capabilities?.templates ?? Boolean(projectLinks?.repository);
  const providerLabel = issueProvider?.label || 'GitHub';
  const destination = remoteSupported ? 'remote' : 'local';
  const [publishing,setPublishing] = useState(false), [createdIssue,setCreatedIssue] = useState(null);
  const isDefence = selection === 'workflow:defence';
  useEffect(() => {
    const focus = document.activeElement;
    mounted.current = true;
    dialog.current.showModal();
    if (canReadTemplates) loadTemplates();
    dialog.current.querySelector('[data-blank-issue]')?.focus();
    return () => { mounted.current = false; pending.current?.abort(); focus?.focus?.(); };
  }, []);
  useEffect(() => {
    if (step === 'review') dialog.current.querySelector('[data-review-heading]')?.focus();
    else dialog.current.querySelector(step === 'fields' ? 'input[name="issue-title"]' : '[data-blank-issue]')?.focus();
  }, [step]);
  async function request(path, input, accept) {
    pending.current?.abort();
    const controller = new AbortController(); pending.current = controller;
    setLoading(true); setIntakeError('');
    try {
      const response = await fetch(path, { method:input === undefined ? 'GET' : 'POST', headers:{'Content-Type':'application/json','X-Factory-Session':csrfToken}, ...(input === undefined ? {} : {body:JSON.stringify(input)}), signal:controller.signal });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Could not load this issue. Try again.');
      if (mounted.current && !controller.signal.aborted) accept(result);
    } catch (error) { if (mounted.current && !controller.signal.aborted) setIntakeError(error.message); }
    finally { if (mounted.current && !controller.signal.aborted) setLoading(false); }
  }
  function review(recommendation) {
    setSuggestion(recommendation); setSuggestionStale(false); if (!selectionOverride.current) setSelection(`workflow:${recommendation.workflow}`); setStep('review');
  }
  function loadTemplates() {
    return request('/api/v1/issue-templates', undefined, setCatalog);
  }
  function chooseTemplate(value) {
    pending.current?.abort(); setLoading(false); setIntakeError(''); setTemplate(value); setAnswers({}); selectionOverride.current = false;
    setTitle(value?.title || ''); setPrompt(''); setLabels(value?.labels || []); setSuggestion(null); setStep('fields');
  }
  function continueBrief(event) {
    event.preventDefault();
    if (step !== 'fields' || loading || submitting) return;
    if (template) request('/api/v1/issue-templates/draft', {template:template.id,sha:template.sha,title,answers}, result => { setTitle(result.title);setPrompt(result.spec);setLabels(result.labels);review(result.recommendation); });
    else if (prompt.trim()) request('/api/v1/intake/recommend', {spec:[title,prompt].join('\n'), labels}, review);
  }
  return <dialog ref={dialog} className="work-dialog" aria-labelledby="start-work-title" aria-describedby="start-work-description" onCancel={event => { event.preventDefault(); if (!submitting && !publishing) close(); }}>
    <header className="work-dialog-header"><div><h2 id="start-work-title">{step === 'review' ? 'Review issue' : remoteSupported ? 'New issue' : 'Local execution request'}</h2><p id="start-work-description">{repositoryLabel(repository, identity)}</p></div><Button variant="ghost" size="icon" onClick={close} disabled={submitting || publishing} aria-label="Close start work form"><X size={18} /></Button></header>
    <form onSubmit={step !== 'review' ? continueBrief : event => { if (!prompt.trim() || submitting || loading) { event.preventDefault(); return; } if(destination === 'remote'){event.preventDefault();return;} submit(event); }}>
      <fieldset disabled={submitting || publishing || Boolean(createdIssue)} className="work-dialog-body">
        {step === 'source' && <>
          <section className="template-chooser" aria-label="Issue templates">
            <p className="work-help">Choose a template for the issue.</p>
            {loading && <p role="status" className="work-help">Loading repository templates…</p>}
            {catalog?.templates.map(item => <div className="template-choice" key={item.id}>{item.unavailable ? <><strong>{item.name}</strong><p className="work-help">{item.unavailable}</p><a href={item.form_url} target="_blank" rel="noreferrer">Open on GitHub ↗</a></> : <button type="button" onClick={() => chooseTemplate(item)}><span><strong>{item.name}</strong><span>{item.description}</span></span><ArrowRight size={16} /></button>}</div>)}
            <div className="template-choice"><button type="button" data-blank-issue onClick={() => chooseTemplate(null)}><span><strong>Blank issue</strong><span>Write your own title, instructions and acceptance criteria.</span></span><ArrowRight size={16} /></button></div>
            {catalog?.contacts.map(contact => <a className="template-contact" key={contact.url} href={contact.url} target="_blank" rel="noreferrer"><strong>{contact.name} ↗</strong><span>{contact.description}</span></a>)}
            {catalog?.warnings.map(warning => <p className="work-help" key={warning}>{warning}</p>)}
            {!loading && canReadTemplates && <Button type="button" variant="ghost" size="sm" onClick={loadTemplates}>{intakeError ? 'Retry templates' : 'Refresh templates'}</Button>}
          </section>

        </>}
        {(step === 'fields' || step === 'review') && <label><span className="field-label">Title *</span><input name="issue-title" readOnly={step === 'review'} className="field-control" value={title} onChange={event => setTitle(event.target.value)} required maxLength={160} placeholder="A short, clear title" /></label>}
        {step === 'fields' && template && <><h3 className="template-form-name">{template.name}</h3><IssueFields template={template} answers={answers} setAnswers={setAnswers} /></>}
        {(step === 'fields' && !template || step === 'review') && <label><span className="field-label">{step === 'review' ? 'Instructions and acceptance criteria' : 'Description and acceptance criteria'}</span><textarea className="field-control work-brief" value={prompt} onChange={event => { pending.current?.abort(); setLoading(false); setPrompt(event.target.value); if (step === 'review') setSuggestionStale(true); }} placeholder="Describe the work, its boundaries and how we will know it is done…" required /></label>}
        {step === 'review' && <>

          {destination === 'local' && <section className="work-recommendation"><h3 tabIndex={-1} data-review-heading>Suggested: {suggestion.workflow === 'defence' ? 'Defence' : 'Software'}</h3><p className="work-help">{suggestionStale ? "Instructions changed. Keep your chosen type or refresh the suggestion." : suggestion.reason}</p>{suggestionStale && <Button type="button" variant="outline" size="sm" disabled={loading || !prompt.trim()} onClick={() => request("/api/v1/intake/recommend", {spec:[title,prompt].join('\n'),labels}, review)}>Refresh suggestion</Button>}<div className="workflow-choices" role="group" aria-label="Work type">{choices.map(choice => <button type="button" key={choice.value} aria-pressed={selection === choice.value} onClick={() => { selectionOverride.current = true; setSelection(choice.value); }}>{choice.label}</button>)}</div><p className="work-help">{isDefence ? 'Investigates supplied, non-sensitive evidence and produces a private draft. For validated incident intake, use incident --file in the CLI.' : 'Implements the change, runs checks and requests an independent review.'}</p></section>}

          {destination === 'local' && <details className="work-options"><summary>Additional options</summary><div className="work-options-fields"><label><span className="field-label">Source ref · optional</span><input className="field-control" value={sourceRef} onChange={event => setSourceRef(event.target.value)} maxLength={256} placeholder={`Configured ref: ${sourceRefDefault}`} /><span className="work-help">Factory resolves this ref in the configured repository and retains that commit before admitting the job.</span></label><label><span className="field-label">Model override · optional</span><input className="field-control" value={model} onChange={event => setModel(event.target.value)} maxLength={128} placeholder="Use the configured model" /></label></div></details>}
        </>}
      </fieldset>
      {step === 'review' && destination === 'remote' && !createdIssue && <IssuePublish key={template?.id || 'blank'} title={title} spec={prompt} labels={labels} csrfToken={csrfToken} onBusy={setPublishing} onCreated={result=>{setCreatedIssue(result);onCreated?.(result);}} />}
      {createdIssue && <section className="issue-created" role="status"><strong>Issue #{createdIssue.issue.number} created</strong><p><a href={createdIssue.issue.url} target="_blank" rel="noreferrer">View on {providerLabel} ↗</a> · No execution has started.</p>{createdIssue.issue.missing_labels?.length>0 && <p>Labels not applied: {createdIssue.issue.missing_labels.join(', ')}</p>}</section>}
      {(intakeError || error) && <p role="alert" className="form-error">{intakeError || error}</p>}
      <footer className="work-dialog-footer">
        {step === 'review' ? <><Button type="button" variant="ghost" disabled={submitting || publishing} onClick={() => { if(createdIssue){close();return;} pending.current?.abort(); setLoading(false); setStep('fields'); setIntakeError(''); }}><ArrowLeft size={14} />{createdIssue?'Done':'Back'}</Button>{(destination === 'local' && !createdIssue) && <Button disabled={submitting || publishing || loading || !prompt.trim() || !title.trim() || !selection || !repository}>{submitting ? 'Starting…' : !createdIssue ? 'Start local execution' : 'Start work'}<Play size={14} /></Button>}</> : step === 'fields' ? <><Button type="button" variant="ghost" onClick={() => { pending.current?.abort();setLoading(false);setIntakeError('');setStep('source'); }}><ArrowLeft size={14} />Templates</Button><Button disabled={loading || !title.trim() || !template && !prompt.trim()}>{loading ? 'Preparing…' : 'Continue'}<ArrowRight size={14} /></Button></> : <p>{remoteSupported ? 'Choose a repository template or blank issue. Nothing starts.' : localOnly ? 'Local execution request: no repository issue will be published.' : 'Local execution request: this host has no supported issue publisher.'}</p>}
      </footer>
    </form>
  </dialog>;
}
