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
  let captured, denied=true, deliveryActionError='';
  const render=async()=>act(()=>root.render(createElement(TaskDetail,{job,loaded:true,csrfToken:'fixture',deliveryActionError,onWorkflowAction:async(...args)=>{captured=args;/* parent retains job and exposes API error on rejection */if(!denied)job.state='queued';}})));
  const click=target=>act(async()=>{target.click();await Promise.resolve();});
  await render();
  const close = document.querySelector('a[aria-label="Close issue detail"]');
  assert.equal(close.getAttribute('href'), '#/runs');
  let copied;
  Object.defineProperty(navigator, 'clipboard', { configurable:true, value:{writeText:async value=>{copied=value;}} });
  await click(document.querySelector('button[aria-label="Copy issue link"]'));
  assert.equal(copied, 'http://localhost/#/runs/job_fixture');
  assert.match(document.body.textContent,/Link copied/);
  navigator.clipboard.writeText=async()=>{throw new Error('denied');};
  await click(document.querySelector('button[aria-label="Copy issue link"]'));
  assert.match(document.body.textContent,/Unable to copy link/);
  assert(document.querySelector('[aria-label="Issue details"]'));
  assert.match(document.querySelector('[aria-label="Issue details"]').textContent,/a{40}/);
  const button=name=>[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===name);
  assert.match(document.body.textContent,/Agent-reported text/);
  assert.equal(document.querySelector('a[href="https://github.com/example/app/pull/42"]'),null,'a model summary does not create a verified PR action');
  assert(button('Request changes'));assert(![...document.querySelectorAll('button')].some(b=>b.textContent.startsWith('Approve')));
  await click(button('Request changes'));
  const area=document.querySelector('textarea');assert(area);
  const submit=[...document.querySelectorAll('button')].find(b=>b.textContent.includes('Send feedback'));
  assert(submit?.disabled,'empty feedback is rejected in the form');
  await act(()=>{Object.getOwnPropertyDescriptor(dom.window.HTMLTextAreaElement.prototype,'value').set.call(area,'Address exact review concern');area.dispatchEvent(new dom.window.Event('input',{bubbles:true}));});
  const newBase=document.querySelector('input[placeholder^="Keep "]');assert(newBase);await act(()=>{Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype,'value').set.call(newBase,'next');newBase.dispatchEvent(new dom.window.Event('input',{bubbles:true}));});
  await click(submit);assert.equal(captured[1],'request_changes');assert.equal(captured[3],'Address exact review concern');assert.equal(captured[4],'next');assert.equal(area.value,'Address exact review concern');assert.equal(job.state,'failed');
  await click(button('Keep reviewing'));
  await click(document.querySelector('[role="tab"][id$="details"]'));
  assert.match(document.body.textContent,/requested-model/);assert.match(document.body.textContent,/test-version/);assert.match(document.body.textContent,/policy-fixture/);
  await click(document.querySelector('[role="tab"][id$="history"]'));
  assert.match(document.body.textContent,/Not recorded \(legacy\/unknown\)/);
  for(const [executor,label] of [['mock','Not applicable'],['custom','Not recorded by custom executor']]) {
    Object.assign(runs[1],{executor,model:null});await render();
    await click(document.querySelector('[role="tab"][id$="details"]'));
    const text=document.querySelector('[role="tabpanel"]:not([hidden])').textContent;
    assert.match(text,new RegExp(label));assert(!text.includes('Provider default requested'));
  }
  job.can_request_changes=false;await render();
  await click(document.querySelector('[role="tab"][id$="result"]'));assert(!button('Request changes'));

  for (const state of ['blocked', 'timed_out']) {
    job.state=state; await render();
    assert(![...document.querySelectorAll('button')].some(b=>b.textContent.trim().startsWith('Retry ')), `${state} cannot retry under controller policy`);
    assert.equal(Boolean(button('Cancel work')), state==='blocked');
  }
  job.state='cancelled';await render();
  const retry=button('Retry review');assert(retry?.disabled);
  await click(document.querySelector('input[type="checkbox"]'));
  assert.equal(button('Retry review').disabled,false);
  await click(button('Retry review'));assert.equal(captured[1],'retry');assert.equal(captured[2],true);

  job.state='awaiting_approval';job.workflow.current_step=3;job.can_request_changes=true;
  runs.push({id:'run_handoff',command:'handoff',state:'awaiting_approval',reviewed_run_id:'run_b'});
  await render();
  assert.match(document.body.textContent,/Awaiting acceptance/);
  assert(button('Approve and start handoff'));
  await click(button('Approve and start handoff'));
  assert.equal(captured[1],'approve','approval is the explicit action that starts handoff');
  assert(![...document.querySelectorAll('button')].some(b=>b.textContent.trim()==='Open PR'));

  job.state='succeeded';runs[2].state='succeeded';runs[2].outcome='complete';job.can_request_changes=false;
  job.delivery_status={state:'patch_only',repository:null,target:null,can_publish:false,integration:'separate',deployment:'separate'};
  await render();
  assert.match(document.body.textContent,/Patch-only handoff/);
  assert(!button('Publish accepted candidate as draft PR'),'patch-only mode has no publish action');
  job.delivery_status={state:'blocked',repository:'https://github.com/example/project',target:'dev',can_publish:false,
    error:'Synthetic or unknown build, check or review evidence cannot authorize trusted PR publication.',integration:'separate',deployment:'separate'};
  await render();
  assert(!button('Publish accepted candidate as draft PR'),'synthetic or unknown evidence has no dashboard publish action');
  assert.match(document.body.textContent,/Synthetic or unknown build, check or review evidence/);
  job.delivery_status={state:'ready',repository:'https://github.com/example/project',target:'dev',can_publish:true,action_mode:'publish',integration:'separate',deployment:'separate'};
  await render();
  assert.match(document.body.textContent,/Ready for explicit draft PR delivery/);
  assert.match(document.body.textContent,/target dev/);
  await click(button('Publish accepted candidate as draft PR'));
  assert.equal(captured[1],'publish','publishing is a deliberate accepted-result action');
  job.delivery_status={state:'published',repository:'https://github.com/example/project',target:'dev',can_publish:true,action_mode:'reconcile',accepted_base_sha:'e'.repeat(40),
    pull_request:{number:29,url:'https://github.com/example/project/pull/29',state:'open',draft:true,merged:false,branch:'factory/job_fixture',target:'dev',base_sha:'a'.repeat(40),head_sha:'c'.repeat(40),tree:'d'.repeat(40)},
    checks:{state:'pending',check_runs:[{name:'build',status:'queued'}],commit_statuses:[]},integration:'separate',deployment:'separate'};
  await render();
  assert(document.querySelector('a[href="https://github.com/example/project/pull/29"]'));
  assert.match(document.body.textContent,/#29 · open · draft/);
  assert.match(document.body.textContent,/Accepted basee{40}/);
  assert.match(document.body.textContent,/PR basea{40}/);
  assert.match(document.body.textContent,/Pending/);
  assert(button('Refresh PR readback and checks'));
  assert.match(document.body.textContent,/Integration and deployment are separate/);
  job.delivery_status={...job.delivery_status,state:'conflict'};
  await render();
  assert(button('Reconcile PR delivery'),'a conflict with a saved PR receipt is a read-only reconciliation action');
  assert(!button('Publish accepted candidate as draft PR'),'a conflicted receipt must not be labeled as a new publication');
  assert.match(document.querySelector('[aria-label="Trusted PR delivery action"]').textContent,/does not publish new content/);
  await click(button('Reconcile PR delivery'));
  assert.equal(captured[1],'publish','the reconciliation label still calls the shared readback action');
  job.delivery_status.state='published';
  job.delivery_status.pull_request.state='closed';
  job.delivery_status.pull_request.draft=false;
  job.delivery_status.pull_request.merged=true;
  await render();
  assert.match(document.body.textContent,/#29 · closed · merged/);
  job.delivery_status.checks={state:'success',check_runs:[
    {name:'Executed check',kind:'check_run',status:'completed',conclusion:'success'},
    {name:'Skipped publish job',kind:'check_run',status:'completed',conclusion:'skipped'},
    {name:'Neutral cleanup job',kind:'check_run',status:'completed',conclusion:'neutral'},
  ],commit_statuses:[]};
  await render();
  assert.match(document.body.textContent,/Passed · success/);
  assert.match(document.body.textContent,/Skipped · skipped/);
  assert.match(document.body.textContent,/Neutral · neutral/);
  job.delivery_status.checks={state:'non_blocking',check_runs:[
    {name:'Skipped publish job',kind:'check_run',status:'completed',conclusion:'skipped'},
    {name:'Neutral cleanup job',kind:'check_run',status:'completed',conclusion:'neutral'},
  ],commit_statuses:[]};
  await render();
  assert.match(document.querySelector('[aria-label="Delivery status"]').textContent,/Non-blocking results/);

  job.delivery_status={...job.delivery_status,state:'uncertain',can_publish:true,action_mode:'reconcile',branch:'factory/job_fixture-candidate',source_ref:'release',pull_request:null};
  job.can_remove=false;job.delivery_removal_blocked=true;
  job.removal_block_reason='Trusted PR delivery is unresolved. Reconcile the saved delivery or inspect its remote collision before deleting this issue.';
  await render();
  assert(button('Reconcile PR delivery'),'an uncertain response remains recoverable in the task view');
  assert.match(document.body.textContent,/Delivery branch\s*factory\/job_fixture-candidate/);
  assert.match(document.body.textContent,/Source ref at admission\s*release/);
  await click(document.querySelector('[role="tab"][id$="details"]'));
  assert.equal(button('Delete issue').disabled,true,'the UI disables deletion while remote delivery is unresolved');
  assert.match(document.body.textContent,/Reconcile the saved delivery or inspect its remote collision before deleting this issue/);
  deliveryActionError='Current Factory policy changed; fresh checks, review and approval are required.';
  await render();
  const deliveryAction=document.querySelector('[aria-label="Trusted PR delivery action"]');
  const deliveryAlert=deliveryAction.querySelector('[role="alert"]');
  assert.equal(deliveryAlert.textContent,deliveryActionError,'delivery failure is placed beside the delivery action');
  assert.equal(button('Reconcile PR delivery').getAttribute('aria-describedby'),deliveryAlert.id,'the action references its accessible error');

  const foreignSha='9'.repeat(40);
  job.delivery_status={...job.delivery_status,state:'conflict',can_publish:false,action_mode:null,can_abandon:true,identity:'delivery-intent-fixture',
    remote_collision:{kind:'branch',repository:'https://github.com/example/project',target:'dev',branch:'factory/job_fixture-candidate',sha:foreignSha,node_id:'foreign-node'}};
  deliveryActionError='';await render();
  assert.match(document.body.textContent,new RegExp(foreignSha),'the exact conflicting remote identity is visible before resolution');
  assert(!button('Publish accepted candidate as draft PR'),'a branch-only collision never offers publication');
  assert(button('Abandon local delivery; keep remote branch'));
  await click(button('Abandon local delivery; keep remote branch'));
  assert.equal(captured[1],'abandon-delivery','the dashboard calls the explicit shared resolution action');
  assert.equal(captured[0].delivery_status.identity,'delivery-intent-fixture');
  assert.equal(captured[0].delivery_status.remote_collision.sha,foreignSha,'the action is bound to the displayed remote head');
  deliveryActionError='The inspected branch identity changed; review the refreshed status before resolving.';await render();
  assert.equal(document.querySelector('[aria-label="Trusted PR delivery action"] [role="alert"]').textContent,deliveryActionError,
    'a stale resolution result is visible beside its action');
  job.delivery_status={...job.delivery_status,state:'abandoned',can_abandon:false,can_publish:false,action_mode:null,
    resolution:{inspected:{repository:'example/project',branch:'factory/job_fixture-candidate',sha:foreignSha}}};
  deliveryActionError='';await render();
  assert.match(document.querySelector('[aria-label="Delivery status"]').textContent,/Local delivery was abandoned/);
  assert.match(document.querySelector('[aria-label="Delivery status"]').textContent,/no provider write was made/);
  assert(!button('Abandon local delivery; keep remote branch'));

  job.state='failed';delete job.source_admission;job.can_request_changes=false;await render();
  assert.match(document.body.textContent,/legacy job has no admission-time source record and cannot be retried or revised/);
  assert(![...document.querySelectorAll('button')].some(b=>b.textContent.trim().startsWith('Retry ')));
  assert(!button('Request changes'));
  job.workflow.name='defence';job.state='succeeded';job.delivery_status={state:'patch_only',can_publish:false};await render();
  assert.equal(document.querySelector('[aria-label="Delivery status"]'),null,'PR handoff status is not presented for Defence investigations');
});
