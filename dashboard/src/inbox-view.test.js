import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { JSDOM } from 'jsdom';
import { createServer } from 'vite';

async function setup(t, request, initialHistory=[]) {
  const dom=new JSDOM('<div id="root"></div>',{url:'http://localhost/#/inbox'}), prior=new Map();
  for(const[key,value]of Object.entries({window:dom.window,document:dom.window.document,navigator:dom.window.navigator,IS_REACT_ACT_ENVIRONMENT:true,fetch:async(path,options)=>{
    if(path.includes('/artifacts'))return {ok:true,json:async()=>[]};if(path!=='/api/v1/definitions')assert.equal(options.headers['X-Factory-Session'],'fixture');return request(path,options);
  }})){prior.set(key,Object.getOwnPropertyDescriptor(globalThis,key));Object.defineProperty(globalThis,key,{configurable:true,writable:true,value});}
  const server=await createServer({server:{middlewareMode:true,ws:false},appType:'custom'}), {createRoot}=await import('react-dom/client');
  const root=createRoot(document.getElementById('root')), {Inbox}=await server.ssrLoadModule('/src/inbox.jsx');
  t.after(async()=>{await act(()=>root.unmount());await server.close();dom.window.close();for(const[key,value]of prior){if(value)Object.defineProperty(globalThis,key,value);else delete globalThis[key];}});
  const jobs=initialHistory.flatMap(row=>row.executions.map(execution=>({...execution,created_at:execution.id,task:{title:row.title,source_url:row.identity?row.url:''},workflow:execution.workflow?{name:execution.workflow,steps:[execution.phase],current_step:0}:null,runs:[]})));
  let props={loaded:true,jobs,token:'fixture',provider:{id:'github',label:'GitHub',repository:'https://github.com/example/project',supported:true},onStarted:()=>{}};
  const render=async patch=>{props={...props,...patch};await act(()=>root.render(React.createElement(Inbox,props)));};await render({});
  const button=text=>[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===text);
  const repository=async()=>act(()=>document.querySelector('[aria-label="Repository"]').click());
  const click=async text=>act(()=>{assert(button(text),text);button(text).click();});
  const edit=async(selector,value)=>act(()=>{const input=document.querySelector(selector),proto=input.tagName==='TEXTAREA'?dom.window.HTMLTextAreaElement.prototype:input.tagName==='SELECT'?dom.window.HTMLSelectElement.prototype:dom.window.HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(proto,'value').set.call(input,value);input.dispatchEvent(new dom.window.Event(input.tagName==='SELECT'?'change':'input',{bubbles:true}));});
  const route=async hash=>{window.location.hash=hash;await render({issueKey:hash.startsWith('#/issues/')?decodeURIComponent(hash.slice(9)):undefined});};
  const open=async(index=0)=>route(document.querySelectorAll('.task-row a')[index].getAttribute('href'));
  const close=async()=>route('#/inbox');
  return {render,button,click,repository,edit,open,close,route,definition:async()=>{const {DefinitionPage}=await server.ssrLoadModule('/src/catalog.jsx');await act(()=>root.render(React.createElement(DefinitionPage)));}};
}
const response=(value,ok=true)=>({ok,json:async()=>value});
const issue=n=>({number:n,title:`Repository request ${n}`,url:`https://github.com/example/project/issues/${n}`,identity:{key:`github:https://github.com/example/project:${n}`,number:n,repository:'https://github.com/example/project'},state:'open',labels:[{name:'factory:triage',color:'ff0000'}],readiness:{state:'triage',label:'Needs triage'},executions:[],active_execution:null,latest_execution:null,start_block_reason:null});
const page=(n,issues)=>({page:n,state:'open',issues,loaded_count:issues.length,next_page:n===1?2:null,total:null});
const context=n=>({...issue(n),body:'Literal <script>untrusted</script> context',spec:'Accepted bounded context',recommendation:{workflow:'defence',reason:'Investigate supplied evidence'}});

test('unlabelled issues omit label spacing in list and context while labels and linked work remain visible',async t=>{
  const unlabelled={...issue(42),labels:[]},execution={id:'job_active',state:'running',workflow:'software',phase:'build'};
  const ui=await setup(t,async path=>response(path==='/api/v1/issues/preview'?{...context(42),labels:[]}:page(1,[unlabelled,issue(43)])),[{...unlabelled,key:unlabelled.identity.key,executions:[execution],active_execution:execution,latest_execution:execution}]);
  const rows=document.querySelectorAll('.task-row');
  assert.equal(rows[0].querySelector('.issue-choice-meta')===null,true,'unlabelled row has no label container');
  assert.match(rows[0].textContent,/Software/);assert.match(rows[0].textContent,/Running/);
  assert.match(rows[0].querySelector('a').getAttribute('href'),/^#\/issues\//);
  assert.equal(rows[1].querySelector('.issue-choice-meta').textContent,'factory:triage');
  await ui.open();
  assert.equal(document.querySelector('.task-metadata .issue-choice-meta')===null,true,'unlabelled context has no label container');
  assert.equal(document.querySelector('.issue-context a[href="#/runs/job_active"]').textContent.includes('Software'),true);
  assert.equal(ui.button('Start work').disabled,true);
  await ui.close();
  assert.equal(document.querySelectorAll('.task-row .issue-choice-meta').length,1);
});

test('Inbox shows provider failure, retries and pages without starting; drafts survive navigation and denied start',async t=>{
  let fail=true,starts=0,failStart=true,started;
  const ui=await setup(t,async(path,options)=>{
    if(path.startsWith('/api/v1/issues?'))return fail?response({error:'Controller host authentication unavailable'},false):response(path.includes('page=2')?page(2,[issue(43)]):page(1,[issue(42)]));
    if(path==='/api/v1/issues/preview')return response(context(JSON.parse(options.body).url.endsWith('/43')?43:42));
    assert.equal(path,'/api/v1/issues/start');starts++;started=JSON.parse(options.body);return failStart?response({error:'Issue content changed; refresh context'},false):response({id:'job_started'});
  });
  assert.match(document.body.textContent,/Repository issues unavailable/);assert.doesNotMatch(document.body.textContent,/No issues on this page|No loaded work yet/);assert.equal(starts,0);
  fail=false;await ui.repository();await ui.click('Refresh issues');assert.match(document.body.textContent,/1 issues loaded on page 1.*total unknown/);assert.match(document.body.textContent,/Needs triage/);assert.doesNotMatch(document.body.textContent,/Triaging/);
  fail=true;await ui.click('Refresh issues');assert.match(document.body.textContent,/Repository data stale/);assert.match(document.body.textContent,/Repository request 42/);
  fail=false;await ui.click('Next page');assert.match(document.body.textContent,/Repository request 43/);assert.doesNotMatch(document.body.textContent,/Repository request 42/);
  await ui.open();assert.equal(starts,0);assert.match(document.querySelector('.inbox-body').textContent,/<script>untrusted/);assert.equal(document.querySelector('script'),null);
  await ui.edit('textarea','Operator boundary retained');await ui.edit('.inbox-start select','software');await ui.close();await ui.open();assert.equal(document.querySelector('textarea').value,'Operator boundary retained');assert.equal(document.querySelector('.inbox-start select').value,'software');
  await ui.click('Start work');assert.equal(starts,1);assert.equal(started.url,issue(43).url);assert.equal(started.expected_spec,'Accepted bounded context');assert.equal(started.brief,'Operator boundary retained');assert.match(document.body.textContent,/Issue content changed/);assert.equal(document.querySelector('textarea').value,'Operator boundary retained');assert.equal(ui.button('Start work').disabled,true);
  await ui.click('Refresh issue context');assert.equal(document.querySelector('textarea').value,'Operator boundary retained');failStart=false;await ui.click('Start work');assert.equal(starts,2);
});

test('canonical issue grouping shows attempts once, with local and off-page records retained and active start disabled',async t=>{
  const execution={id:'job_prior',state:'cancelled',workflow:'software',phase:'build'},active={...execution,id:'job_active',state:'running'};
  const history=[{...issue(42),title:'Old execution title',key:issue(42).identity.key,executions:[active,execution],active_execution:active,latest_execution:active}, {...issue(99),key:issue(99).identity.key,executions:[{...execution,id:'job_missing'}]}, {key:'local:one',title:'Private local request',identity:null,executions:[{...execution,id:'job_local'}]}];
  const ui=await setup(t,async path=>response(path==='/api/v1/issues/preview'?context(42):page(1,[issue(42)])),history);
  assert.match(document.body.textContent,/Repository request 42/);assert.doesNotMatch(document.body.textContent,/Old execution title/);
  await ui.edit('input[type=search]','job_active');assert.equal(document.querySelectorAll('.task-row').length,1);await ui.edit('input[type=search]','');
  assert.equal(document.querySelectorAll('.task-row').length,3);assert.equal(document.querySelectorAll('.task-row a[href^="#/issues/"]').length,2);assert.match(document.body.textContent,/2 attempts/);assert.match(document.body.textContent,/Local request/);assert.match(document.body.textContent,/Source not loaded/);
  await ui.open();assert.equal(ui.button('Start work').disabled,true);assert.match(document.body.textContent,/active or unresolved/);assert.equal(document.querySelectorAll('.inbox-attempts a').length,2);
});

test('late paging and previews cannot overwrite a newer selection or filter',async t=>{
  let releasePage,releasePreview;
  const ui=await setup(t,async(path,options)=>{
    if(path.includes('page=2'))return new Promise(resolve=>{releasePage=()=>resolve(response(page(2,[issue(43)])));});
    if(path.includes('state=closed'))return response({...page(1,[]),state:'closed'});
    if(path==='/api/v1/issues/preview')return new Promise(resolve=>{releasePreview=()=>resolve(response(context(42)));});
    return response(page(1,[issue(42)]));
  });
  await ui.open();await ui.close();await act(()=>releasePreview());assert.equal(document.querySelector('.inbox-body'),null);
  await ui.repository();await ui.click('Next page');await ui.edit('select[aria-label="Repository issue state"]','closed');await act(()=>releasePage());assert.match(document.body.textContent,/page 1 \(closed\)/);assert.doesNotMatch(document.body.textContent,/Repository request 43/);
});


test('Definition renders the effective configured readiness mapping as planning metadata',async t=>{
  const ui=await setup(t,async path=>response(path==='/api/v1/definitions'?{workflows:{},commands:[],configuration:{harness:'mock',issueReadinessLabels:{triage:'scope:needed',spec:'plan:needed',ready:'scope:approved',blocked:'scope:blocked'}},terminology:{}}:page(1,[])));
  await ui.definition();const mapping=document.querySelector('[aria-label="Issue readiness labels"]');assert(mapping);
  for(const label of ['scope:needed','plan:needed','scope:approved','scope:blocked'])assert(mapping.textContent.includes(label));
  assert.match(mapping.textContent,/do not start agents/);
});

test('primary all-work board shares label/search/state intersections, reset and progressive navigation without admitting work', async t=>{
  let starts=0;
  const active={id:'job_active',state:'running',workflow:'software',phase:'build'};
  const labelled={...issue(43),labels:[{name:'product:ui',color:'0088ff'}]};
  const ui=await setup(t,async(path)=>{
    if(path==='/api/v1/issues/preview')return response(context(42));
    if(path==='/api/v1/issues/start')starts++;
    return response(page(1,[issue(42),labelled]));
  },[{...issue(43),executions:[active],active_execution:active,latest_execution:active}]);
  assert.equal(document.querySelector('[aria-label="Inbox records"]'),null);
  assert.equal(document.querySelectorAll('.task-row').length,2);
  assert.equal(document.querySelector('.active-filters > [role=status]').textContent,'2 items');
  assert.doesNotMatch([...document.querySelectorAll('.task-row')].find(row=>row.textContent.includes('Repository request 42')).textContent,/Work type unassigned|Model unknown|0 attempts/);
  await ui.click('Board');
  const board=document.querySelector('.kanban-scroll');assert.equal(board.tabIndex,0);
  assert.equal(document.querySelector('#board-not_started').textContent,'Not started');
  assert.equal(document.querySelectorAll('.run-card-link').length,2);
  board.scrollLeft=240;
  await act(()=>document.querySelector('[aria-label="Filter by labels"]').click());
  await ui.edit('[aria-label="Filter labels options"]','triage');
  assert.equal(document.querySelectorAll('.facet-options button').length,1);
  await act(()=>document.querySelector('.facet-options button').click());
  assert.equal(document.querySelectorAll('.run-card-link').length,1);
  assert.equal(document.querySelector('.facet-options button').getAttribute('aria-checked'),'true');
  await act(()=>document.dispatchEvent(new window.KeyboardEvent('keydown',{key:'Escape',bubbles:true})));
  assert.equal(document.querySelector('.facet-popover'),null);
  await ui.edit('[aria-label="Search loaded work"]','Repository request 42');
  await act(()=>document.querySelector('.filter-card-main').click());
  assert.equal(document.querySelectorAll('.run-card-link').length,1);
  await ui.route(document.querySelector('.run-card-link').getAttribute('href'));
  assert.equal(starts,0);
  assert.match(document.querySelector('.detail-position').textContent,/1 \/ 1/);
  assert(document.querySelector('.task-detail-main .inbox-start'));
  assert.match(document.querySelector('.task-metadata').textContent,/Unassigned \/ unknown/);
  await ui.close();
  assert.equal(ui.button('Board').getAttribute('aria-pressed'),'true');
  assert.equal(document.querySelector('.kanban-scroll'),board,'return retains the actual board DOM and its scroll position');
  assert.equal(board.scrollLeft,240);
  assert.equal(document.querySelectorAll('.run-card-link').length,1);
  assert.equal(document.querySelector('.active-filters > [role=status]').textContent,'1 of 2 items');
  await ui.click('Clear filters');assert.equal(document.querySelectorAll('.run-card-link').length,2);
  assert.equal(document.querySelector('.active-filters > [role=status]').textContent,'2 items');
  assert.equal(ui.button('Clear filters').disabled,true);
  await ui.click('List');assert.equal(document.querySelectorAll('.task-row').length,2);
  await ui.open();assert(document.querySelector('a[aria-label="Next issue"]'));
  assert.equal(starts,0);
});


test('Repository disclosure keeps counts and page tools secondary, closes with Escape and focus exit, and preserves failures',async t=>{
  let release,local=0;
  const ui=await setup(t,async path=>{
    if(path.includes('page=2'))return response(page(2,[issue(43)]));
    if(path.includes('state=closed'))return new Promise(resolve=>{release=()=>resolve(response({error:'Read denied'},false));});
    return response(page(1,[issue(42)]));
  });
  await ui.render({onLocalRequest:()=>local++});
  const trigger=document.querySelector('[aria-label="Repository"]');
  assert.equal(trigger.getAttribute('aria-expanded'),'false');
  assert.match(trigger.textContent,/1 loaded · Page 1/);
  assert.equal(document.querySelector('.repository-popover'),null);
  assert.doesNotMatch(document.body.textContent,/total unknown|Read at|execution attempts/);
  await ui.repository();
  assert.equal(trigger.getAttribute('aria-expanded'),'true');
  assert.equal(document.querySelector('.repository-popover').id,trigger.getAttribute('aria-controls'));
  assert.match(document.querySelector('.repository-popover').textContent,/1 items: 1 repository issues and 0 local requests, with 0 execution attempts/);
  assert.match(document.querySelector('.repository-popover').textContent,/Search covers loaded issues and retained execution history only/);
  assert.equal(ui.button('Previous page'),undefined);
  await ui.click('Next page');assert.equal(ui.button('Next page'),undefined);assert(ui.button('Previous page'));
  await ui.click('Previous page');
  await act(()=>document.dispatchEvent(new window.KeyboardEvent('keydown',{key:'Escape',bubbles:true})));
  assert.equal(document.querySelector('.repository-popover'),null);assert.equal(document.activeElement,trigger);
  await ui.repository();
  await act(()=>document.querySelector('[aria-label="Search loaded work"]').focus());
  assert.equal(trigger.getAttribute('aria-expanded'),'false');
  await ui.repository();await ui.click('Local execution request');assert.equal(local,1);assert.equal(trigger.getAttribute('aria-expanded'),'false');
  await ui.repository();await ui.edit('[aria-label="Repository issue state"]','closed');
  assert.match(document.body.textContent,/Loading repository issues/);
  assert.equal(ui.button('Refresh issues').disabled,true);
  await ui.repository();await act(()=>release());
  assert.equal(document.querySelector('.repository-popover'),null);
  assert.match(document.querySelector('[role="alert"]').textContent,/Repository data stale.*Read denied/);
  assert.match(document.querySelector('.task-row').textContent,/Repository request 42/);
  await ui.repository();assert.match(document.querySelector('.repository-popover').textContent,/previous issue-state filter/);
});

test('rows and cards share compact source/activity/readiness metadata and preserve detail history',async t=>{
  const source={...issue(42),author:'contributor',updated_at:'2026-09-26T12:00:00Z'};
  const previous={id:'job_previous',state:'failed',workflow:'software',phase:'build'},active={...previous,id:'job_active',state:'running'};
  const ui=await setup(t,async path=>response(path==='/api/v1/issues/preview'?{...context(42),author:source.author}:page(1,[source])),[{...source,executions:[previous,active]}]);
  const row=document.querySelector('.task-row'),metadata=row.querySelector('.task-row-meta').textContent;
  for(const value of ['#42 by contributor','Software','Build','open','Needs triage','2 attempts'])assert(metadata.includes(value),value);
  assert.equal(row.querySelectorAll('.task-row-meta').length,1);
  assert.equal(row.querySelectorAll('.issue-choice-meta').length,1);
  assert.doesNotMatch(row.textContent,/Opened by|execution attempts|Work type unassigned|Model unknown/);
  assert.equal(row.querySelector('.task-state').textContent,'Running');
  await ui.click('Board');assert.equal(document.querySelector('.run-card-link .task-row-meta').textContent,metadata);
  await ui.route(document.querySelector('.run-card-link').getAttribute('href'));
  assert.equal(document.querySelectorAll('.inbox-attempts a').length,2);
  assert.equal([...document.querySelectorAll('.task-metadata dt')].find(node=>node.textContent==='Readiness').textContent,'Readiness');
  assert.equal(ui.button('Start work').disabled,true);
});
