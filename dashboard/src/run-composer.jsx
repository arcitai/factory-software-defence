import React, { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { IssuePublish } from './issue-publish.jsx';
import { IssueFields } from './issue-form.jsx';
import { repositoryLabel } from './project-identity.js';

export function RunComposer({onCreated,issueProvider,title:initialTitle='',identity,csrfToken,projectLinks,close}) {
  const dialog=useRef(null),mounted=useRef(true),pending=useRef(null);
  const [step,setStep]=useState('source'),[title,setTitle]=useState(initialTitle),[description,setDescription]=useState('');
  const [labels,setLabels]=useState([]),[catalog,setCatalog]=useState(null),[template,setTemplate]=useState(null),[answers,setAnswers]=useState({});
  const [recommendation,setRecommendation]=useState(null),[loading,setLoading]=useState(false),[publishing,setPublishing]=useState(false);
  const [intakeError,setIntakeError]=useState(''),[createdIssue,setCreatedIssue]=useState(null);
  const canCreate=Boolean(issueProvider?.capabilities?.create??projectLinks?.repository);
  useEffect(()=>{
    const focus=document.activeElement;mounted.current=true;dialog.current.showModal();
    if(canCreate)request('/api/v1/issue-templates',undefined,setCatalog);
    dialog.current.querySelector('[data-blank-issue]')?.focus();
    return()=>{mounted.current=false;pending.current?.abort();focus?.focus?.();};
  },[]);
  useEffect(()=>{if(step==='review')dialog.current.querySelector('[data-review-heading]')?.focus();else dialog.current.querySelector(step==='fields'?'input[name="issue-title"]':'[data-blank-issue]')?.focus();},[step]);
  async function request(path,input,accept) {
    pending.current?.abort();const controller=new AbortController();pending.current=controller;setLoading(true);setIntakeError('');
    try {const response=await fetch(path,{method:input===undefined?'GET':'POST',headers:{'Content-Type':'application/json','X-Factory-Session':csrfToken},...(input===undefined?{}:{body:JSON.stringify(input)}),signal:controller.signal});const value=await response.json();if(!response.ok)throw new Error(value.error||'Repository request failed.');if(mounted.current&&!controller.signal.aborted)accept(value);}
    catch(error){if(mounted.current&&!controller.signal.aborted)setIntakeError(error.message);}
    finally{if(mounted.current&&!controller.signal.aborted)setLoading(false);}
  }
  function choose(value){pending.current?.abort();setLoading(false);setIntakeError('');setTemplate(value);setAnswers({});setTitle(value?.title||'');setDescription('');setLabels(value?.labels||[]);setRecommendation(null);setStep('fields');}
  function prepare(event){event.preventDefault();if(loading||!title.trim())return;const input=template?{template:template.id,sha:template.sha,title,answers}:{spec:`${title.trim()}\n\n${description.trim()}`,labels};request(template?'/api/v1/issue-templates/draft':'/api/v1/intake/recommend',input,result=>{if(template){setTitle(result.title);setDescription(result.spec);setLabels(result.labels);}setRecommendation(result.recommendation||result);setStep('review');});}
  return <dialog ref={dialog} className="work-dialog" aria-labelledby="new-issue-title" aria-describedby="new-issue-description" onCancel={event=>{event.preventDefault();if(!publishing)close();}}>
    <header className="work-dialog-header"><div><h2 id="new-issue-title">{step==='review'?'Review issue':'New issue'}</h2><p id="new-issue-description">{repositoryLabel(issueProvider?.repository,identity)}</p></div><Button variant="ghost" size="icon" onClick={close} disabled={publishing||loading} aria-label="Close issue form"><X size={18}/></Button></header>
    {!canCreate?<p className="work-dialog-body" role="alert">GitHub issue creation is unavailable for this project identity.</p>:<form onSubmit={step==='review'?event=>event.preventDefault():prepare}>
      <fieldset disabled={publishing||Boolean(createdIssue)} className="work-dialog-body">
        {step==='source'&&<section className="template-chooser" aria-label="Issue templates"><p className="work-help">Choose a repository template. Creating an issue never starts native agent work.</p>{loading&&<p role="status" className="work-help">Loading templates…</p>}{catalog?.templates.map(item=><div className="template-choice" key={item.id}>{item.unavailable?<><strong>{item.name}</strong><p className="work-help">{item.unavailable}</p><a href={item.form_url} target="_blank" rel="noreferrer">Open on GitHub ↗</a></>:<button type="button" onClick={()=>choose(item)}><span><strong>{item.name}</strong><span>{item.description}</span></span><ArrowRight size={16}/></button>}</div>)}<div className="template-choice"><button type="button" data-blank-issue onClick={()=>choose(null)}><span><strong>Blank issue</strong><span>Write scoped work and acceptance criteria.</span></span><ArrowRight size={16}/></button></div>{catalog?.contacts.map(contact=><a className="template-contact" key={contact.url} href={contact.url} target="_blank" rel="noreferrer"><strong>{contact.name} ↗</strong><span>{contact.description}</span></a>)}{catalog?.warnings.map(warning=><p className="work-help" key={warning}>{warning}</p>)}</section>}
        {(step==='fields'||step==='review')&&<label><span className="field-label">Title *</span><input name="issue-title" readOnly={step==='review'} className="field-control" value={title} onChange={event=>setTitle(event.target.value)} required maxLength={160} placeholder="A short, clear title"/></label>}
        {step==='fields'&&template&&<><h3 className="template-form-name">{template.name}</h3><IssueFields template={template} answers={answers} setAnswers={setAnswers}/></>}
        {(step==='fields'&&!template||step==='review')&&<label><span className="field-label">{step==='review'?'Issue description':'Description and acceptance criteria'}</span><textarea className="field-control work-brief" value={description} onChange={event=>setDescription(event.target.value)} placeholder="Describe the scope, boundaries and observable acceptance criteria…" required/></label>}
        {step==='review'&&<section className="work-recommendation"><h3 tabIndex={-1} data-review-heading>Suggested work type · {recommendation?.work_type==='defensive'?'Scoped defensive investigation':'Software delivery'}</h3><p className="work-help">{recommendation?.reason||'Choose the work type explicitly when starting from the Inbox.'} Private security findings belong in the project’s private reporting channel, not a public issue.</p></section>}
      </fieldset>
      {step==='review'&&!createdIssue&&<IssuePublish key={template?.id||'blank'} title={title} spec={description} labels={labels} csrfToken={csrfToken} onBusy={setPublishing} onRecovered={onCreated} onCreated={result=>{setCreatedIssue(result);onCreated?.(result);}}/>}
      {createdIssue&&<section className="issue-created" role="status"><strong>Issue #{createdIssue.issue.number} created</strong><p><a href={createdIssue.issue.url} target="_blank" rel="noreferrer">View on GitHub ↗</a> · No native turn has started.</p>{createdIssue.issue.missing_labels?.length>0&&<p>Labels not applied: {createdIssue.issue.missing_labels.join(', ')}</p>}</section>}
      {intakeError&&<p role="alert" className="form-error">{intakeError}</p>}
      <footer className="work-dialog-footer">{step==='review'?<><Button type="button" variant="ghost" disabled={publishing||loading} onClick={()=>{if(createdIssue){close();return;}setStep('fields');setIntakeError('');}}><ArrowLeft size={14}/>{createdIssue?'Done':'Back'}</Button><span className="work-help">Start work later from the Inbox issue detail.</span></>:step==='fields'?<><Button type="button" variant="ghost" onClick={()=>{setStep('source');setIntakeError('');}}><ArrowLeft size={14}/>Templates</Button><Button disabled={loading||!title.trim()||!template&&!description.trim()}>{loading?'Preparing…':'Review issue'}<ArrowRight size={14}/></Button></>:<span className="work-help">No issue or native session is created until you submit.</span>}</footer>
    </form>}
  </dialog>;
}
