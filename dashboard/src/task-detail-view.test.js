import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement, act } from 'react';
import { JSDOM } from 'jsdom';
import { createServer } from 'vite';

test('failed review offers explicit revision, preserves denied/stale feedback, and labels recorded versus unknown history', async t => {
  const dom=new JSDOM('<div id="root"></div>',{url:'http://localhost/'}), prior=new Map();
  for(const [key,value] of Object.entries({window:dom.window,document:dom.window.document,navigator:dom.window.navigator,IS_REACT_ACT_ENVIRONMENT:true,fetch:async()=>({ok:true,json:async()=>[]})})) {
    prior.set(key,Object.getOwnPropertyDescriptor(globalThis,key));Object.defineProperty(globalThis,key,{configurable:true,writable:true,value});
  }
  const server=await createServer({server:{middlewareMode:true,ws:false},appType:'custom'});
  const {createRoot}=await import('react-dom/client');
  const root=createRoot(document.getElementById('root'));
  t.after(async()=>{await act(()=>root.unmount());await server.close();dom.window.close();for(const [key,descriptor]of prior){if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key];}});
  const {TaskDetail}=await server.ssrLoadModule('/src/task-detail.jsx');
  const runs=[{id:'run_a',command:'build',state:'failed',started_at:'2026-09-25T00:00:00Z',summary:'Old failed build'},
    {id:'run_b',command:'review',state:'failed',outcome:'blocked',review_verdict:'changes',started_at:'2026-09-25T01:00:00Z',summary:'Fix the concern. Claimed PR: https://github.com/example/app/pull/42',executor:'codex',model:'requested-model',worker_name:'fixture',execution:{runtimeVersion:'test-version',image:'sha256:fixture',policyHash:'policy-fixture'}}];
  const job={id:'job_fixture',state:'failed',repository:'app',task:{title:'Revision fixture'},source_admission:{status:'retained',requested_ref:'main',resolved_sha:'a'.repeat(40),repository_identity:`sha256:${'b'.repeat(64)}`},workflow:{name:'software',steps:['build','verify','review','handoff'],current_step:2},runs,can_request_changes:true};
  let captured, denied=true;
  const render=async()=>act(()=>root.render(createElement(TaskDetail,{job,loaded:true,csrfToken:'fixture',onWorkflowAction:async(...args)=>{captured=args;/* parent retains job and exposes API error on rejection */if(!denied)job.state='queued';}})));
  await render();
  const close = document.querySelector('a[aria-label="Close issue detail"]');
  assert.equal(close.getAttribute('href'), '#/runs');
  let copied;
  Object.defineProperty(navigator, 'clipboard', { configurable:true, value:{writeText:async value=>{copied=value;}} });
  await act(()=>document.querySelector('button[aria-label="Copy issue link"]').click());
  assert.equal(copied, 'http://localhost/#/runs/job_fixture');
  assert.match(document.body.textContent,/Link copied/);
  navigator.clipboard.writeText=async()=>{throw new Error('denied');};
  await act(()=>document.querySelector('button[aria-label="Copy issue link"]').click());
  assert.match(document.body.textContent,/Unable to copy link/);
  assert(document.querySelector('[aria-label="Issue details"]'));
  assert.match(document.querySelector('[aria-label="Issue details"]').textContent,/a{40}/);
  const button=name=>[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===name);
  assert.match(document.body.textContent,/Agent-reported text/);
  assert.equal(document.querySelector('a[href="https://github.com/example/app/pull/42"]'),null,'a model summary does not create a verified PR action');
  assert(button('Request changes'));assert(![...document.querySelectorAll('button')].some(b=>b.textContent.startsWith('Approve')));
  await act(()=>button('Request changes').click());
  const area=document.querySelector('textarea');assert(area);
  const submit=[...document.querySelectorAll('button')].find(b=>b.textContent.includes('Send feedback'));
  assert(submit?.disabled,'empty feedback is rejected in the form');
  await act(()=>{Object.getOwnPropertyDescriptor(dom.window.HTMLTextAreaElement.prototype,'value').set.call(area,'Address exact review concern');area.dispatchEvent(new dom.window.Event('input',{bubbles:true}));});
  const newBase=document.querySelector('input[placeholder^="Keep "]');assert(newBase);await act(()=>{Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype,'value').set.call(newBase,'next');newBase.dispatchEvent(new dom.window.Event('input',{bubbles:true}));});
  await act(()=>submit.click());assert.equal(captured[1],'request_changes');assert.equal(captured[3],'Address exact review concern');assert.equal(captured[4],'next');assert.equal(area.value,'Address exact review concern');assert.equal(job.state,'failed');
  await act(()=>button('Keep reviewing').click());
  await act(()=>document.querySelector('[role="tab"][id$="details"]').click());
  assert.match(document.body.textContent,/requested-model/);assert.match(document.body.textContent,/test-version/);assert.match(document.body.textContent,/policy-fixture/);
  await act(()=>document.querySelector('[role="tab"][id$="history"]').click());
  assert.match(document.body.textContent,/Not recorded \(legacy\/unknown\)/);
  for(const [executor,label] of [['mock','Not applicable'],['custom','Not recorded by custom executor']]) {
    Object.assign(runs[1],{executor,model:null});await render();
    await act(()=>document.querySelector('[role="tab"][id$="details"]').click());
    const text=document.querySelector('[role="tabpanel"]:not([hidden])').textContent;
    assert.match(text,new RegExp(label));assert(!text.includes('Provider default requested'));
  }
  job.can_request_changes=false;await render();
  await act(()=>document.querySelector('[role="tab"][id$="result"]').click());assert(!button('Request changes'));

  for (const state of ['blocked', 'timed_out']) {
    job.state=state; await render();
    assert(![...document.querySelectorAll('button')].some(b=>b.textContent.trim().startsWith('Retry ')), `${state} cannot retry under controller policy`);
    assert.equal(Boolean(button('Cancel work')), state==='blocked');
  }
  job.state='cancelled';await render();
  const retry=button('Retry review');assert(retry?.disabled);
  await act(()=>document.querySelector('input[type="checkbox"]').click());
  assert.equal(button('Retry review').disabled,false);
  await act(()=>button('Retry review').click());assert.equal(captured[1],'retry');assert.equal(captured[2],true);

  job.state='awaiting_approval';job.workflow.current_step=3;job.can_request_changes=true;
  runs.push({id:'run_handoff',command:'handoff',state:'awaiting_approval',reviewed_run_id:'run_b'});
  await render();
  assert.match(document.body.textContent,/Awaiting acceptance/);
  assert(button('Approve and start handoff'));
  await act(()=>button('Approve and start handoff').click());
  assert.equal(captured[1],'approve','approval is the explicit action that starts handoff');
  assert(![...document.querySelectorAll('button')].some(b=>b.textContent.trim()==='Open PR'));

  job.state='succeeded';runs[2].state='succeeded';runs[2].outcome='complete';job.can_request_changes=false;
  job.delivery_status={state:'patch_only',repository:null,target:null,can_publish:false,integration:'separate',deployment:'separate'};
  await render();
  assert.match(document.body.textContent,/Patch-only handoff/);
  assert(!button('Publish accepted candidate as draft PR'),'patch-only mode has no publish action');
  job.delivery_status={state:'ready',repository:'https://github.com/example/project',target:'dev',can_publish:true,integration:'separate',deployment:'separate'};
  await render();
  assert.match(document.body.textContent,/Ready for explicit draft PR delivery/);
  assert.match(document.body.textContent,/target dev/);
  await act(()=>button('Publish accepted candidate as draft PR').click());
  assert.equal(captured[1],'publish','publishing is a deliberate accepted-result action');
  job.delivery_status={state:'published',repository:'https://github.com/example/project',target:'dev',can_publish:true,
    pull_request:{number:29,url:'https://github.com/example/project/pull/29',state:'open',draft:true,branch:'factory/job_fixture',target:'dev',base_sha:'a'.repeat(40),head_sha:'c'.repeat(40),tree:'d'.repeat(40)},
    checks:{state:'pending',check_runs:[{name:'build',status:'queued'}],commit_statuses:[]},integration:'separate',deployment:'separate'};
  await render();
  assert(document.querySelector('a[href="https://github.com/example/project/pull/29"]'));
  assert.match(document.body.textContent,/Pending/);
  assert(button('Refresh PR readback and checks'));
  assert.match(document.body.textContent,/Integration and deployment are separate/);

  job.state='failed';delete job.source_admission;job.can_request_changes=false;await render();
  assert.match(document.body.textContent,/legacy job has no admission-time source record and cannot be retried or revised/);
  assert(![...document.querySelectorAll('button')].some(b=>b.textContent.trim().startsWith('Retry ')));
  assert(!button('Request changes'));
});
