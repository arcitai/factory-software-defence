import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { JSDOM } from 'jsdom';
import { createServer } from 'vite';

async function setup(t, request, initialHistory=[]) {
  const dom=new JSDOM('<div id="root"></div>',{url:'http://localhost/#/inbox'}), prior=new Map();
  for(const[key,value]of Object.entries({window:dom.window,document:dom.window.document,navigator:dom.window.navigator,IS_REACT_ACT_ENVIRONMENT:true,fetch:async(path,options)=>{
    if(path!=='/api/v1/definitions')assert.equal(options.headers['X-Factory-Session'],'fixture');return request(path,options);
  }})){prior.set(key,Object.getOwnPropertyDescriptor(globalThis,key));Object.defineProperty(globalThis,key,{configurable:true,writable:true,value});}
  const server=await createServer({server:{middlewareMode:true,ws:false},appType:'custom'}), {createRoot}=await import('react-dom/client');
  const root=createRoot(document.getElementById('root')), {Inbox}=await server.ssrLoadModule('/src/inbox.jsx');
  t.after(async()=>{await act(()=>root.unmount());await server.close();dom.window.close();for(const[key,value]of prior){if(value)Object.defineProperty(globalThis,key,value);else delete globalThis[key];}});
  let props={token:'fixture',provider:{id:'github',label:'GitHub',repository:'https://github.com/example/project',supported:true},history:initialHistory,onStarted:()=>{},executionView:React.createElement('p',null,'Execution history view')};
  const render=async patch=>{props={...props,...patch};await act(()=>root.render(React.createElement(Inbox,props)));};await render({});
  const button=text=>[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===text);
  const click=async text=>act(()=>{assert(button(text),text);button(text).click();});
  const edit=async(selector,value)=>act(()=>{const input=document.querySelector(selector),proto=input.tagName==='TEXTAREA'?dom.window.HTMLTextAreaElement.prototype:input.tagName==='SELECT'?dom.window.HTMLSelectElement.prototype:dom.window.HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(proto,'value').set.call(input,value);input.dispatchEvent(new dom.window.Event(input.tagName==='SELECT'?'change':'input',{bubbles:true}));});
  return {render,button,click,edit,definition:async()=>{const {DefinitionPage}=await server.ssrLoadModule('/src/catalog.jsx');await act(()=>root.render(React.createElement(DefinitionPage)));}};
}
const response=(value,ok=true)=>({ok,json:async()=>value});
const issue=n=>({number:n,title:`Repository request ${n}`,url:`https://github.com/example/project/issues/${n}`,identity:{key:`github:https://github.com/example/project:${n}`,number:n,repository:'https://github.com/example/project'},state:'open',labels:[{name:'factory:triage',color:'ff0000'}],readiness:{state:'triage',label:'Needs triage'},executions:[],active_execution:null,latest_execution:null,start_block_reason:null});
const page=(n,issues)=>({page:n,state:'open',issues,loaded_count:issues.length,next_page:n===1?2:null,total:null});
const context=n=>({...issue(n),body:'Literal <script>untrusted</script> context',spec:'Accepted bounded context',recommendation:{workflow:'defence',reason:'Investigate supplied evidence'}});

test('unlabelled issues omit label spacing in list and context while labels and linked work remain visible',async t=>{
  const unlabelled={...issue(42),labels:[]},execution={id:'job_active',state:'running',workflow:'software',phase:'build'};
  const ui=await setup(t,async path=>response(path==='/api/v1/issues/preview'?{...context(42),labels:[]}:page(1,[unlabelled,issue(43)])),[{...unlabelled,key:unlabelled.identity.key,executions:[execution],active_execution:execution,latest_execution:execution}]);
  const rows=document.querySelectorAll('.inbox-rows .inbox-row');
  assert.equal(rows[0].querySelector('.issue-choice-meta')===null,true,'unlabelled row has no label container');
  assert.match(rows[0].textContent,/Active execution: Software/);
  assert.equal(rows[0].querySelector('a').getAttribute('href'),'#/runs/job_active');
  assert.equal(rows[1].querySelector('.issue-choice-meta').textContent,'factory:triage');
  await act(()=>rows[0].querySelector('button').click());
  assert.equal(document.querySelector('.inbox-detail .issue-choice-meta')===null,true,'unlabelled context has no label container');
  assert.equal(document.querySelector('.inbox-detail a[href="#/runs/job_active"]').textContent.includes('Software'),true);
  assert.equal(ui.button('Start work').disabled,true);
  await ui.click('Back to Inbox');
  assert.equal(document.querySelectorAll('.inbox-rows .issue-choice-meta').length,1);
});

test('Inbox shows provider failure, retries and pages without starting; drafts survive navigation and denied start',async t=>{
  let fail=true,starts=0,failStart=true,started;
  const ui=await setup(t,async(path,options)=>{
    if(path.startsWith('/api/v1/issues?'))return fail?response({error:'Controller host authentication unavailable'},false):response(path.includes('page=2')?page(2,[issue(43)]):page(1,[issue(42)]));
    if(path==='/api/v1/issues/preview')return response(context(JSON.parse(options.body).url.endsWith('/43')?43:42));
    assert.equal(path,'/api/v1/issues/start');starts++;started=JSON.parse(options.body);return failStart?response({error:'Issue content changed; refresh context'},false):response({id:'job_started'});
  });
  assert.match(document.body.textContent,/Repository issues unavailable/);assert.doesNotMatch(document.body.textContent,/No issues on this page/);assert.equal(starts,0);
  fail=false;await ui.click('Refresh issues');assert.match(document.body.textContent,/1 issues loaded on page 1.*total unknown/);assert.match(document.body.textContent,/Needs triage/);assert.doesNotMatch(document.body.textContent,/Triaging/);
  fail=true;await ui.click('Refresh issues');assert.match(document.body.textContent,/Repository data stale/);assert.match(document.body.textContent,/Repository request 42/);
  fail=false;await ui.click('Next page');assert.match(document.body.textContent,/Repository request 43/);assert.doesNotMatch(document.body.textContent,/Repository request 42/);
  await act(()=>document.querySelector('.inbox-issue-title').click());assert.equal(starts,0);assert.match(document.querySelector('.inbox-body').textContent,/<script>untrusted/);assert.equal(document.querySelector('script'),null);
  await ui.edit('textarea','Operator boundary retained');await ui.edit('.inbox-start select','software');await ui.click('Back to Inbox');await act(()=>document.querySelector('.inbox-issue-title').click());assert.equal(document.querySelector('textarea').value,'Operator boundary retained');assert.equal(document.querySelector('.inbox-start select').value,'software');
  await ui.click('Start work');assert.equal(starts,1);assert.equal(started.url,issue(43).url);assert.equal(started.expected_spec,'Accepted bounded context');assert.equal(started.brief,'Operator boundary retained');assert.match(document.body.textContent,/Issue content changed/);assert.equal(document.querySelector('textarea').value,'Operator boundary retained');assert.equal(ui.button('Start work').disabled,true);
  await ui.click('Refresh issue context');assert.equal(document.querySelector('textarea').value,'Operator boundary retained');failStart=false;await ui.click('Start work');assert.equal(starts,2);
});

test('canonical issue grouping shows attempts once, with local and off-page records retained and active start disabled',async t=>{
  const execution={id:'job_prior',state:'cancelled',workflow:'software',phase:'build'},active={...execution,id:'job_active',state:'running'};
  const history=[{...issue(42),title:'Old execution title',key:issue(42).identity.key,executions:[active,execution],active_execution:active,latest_execution:active}, {...issue(99),key:issue(99).identity.key,executions:[{...execution,id:'job_missing'}]}, {key:'local:one',title:'Private local request',identity:null,executions:[{...execution,id:'job_local'}]}];
  const ui=await setup(t,async path=>response(path==='/api/v1/issues/preview'?context(42):page(1,[issue(42)])),history);
  assert.match(document.body.textContent,/Repository request 42/);assert.doesNotMatch(document.body.textContent,/Old execution title/);
  await ui.edit('input[type=search]','job_active');assert.equal(document.querySelectorAll('.inbox-row').length,1);await ui.edit('input[type=search]','');
  assert.equal(document.querySelectorAll('.inbox-row').length,3);assert.equal(document.querySelectorAll('a[href="#/runs/job_active"]').length,1);assert.match(document.body.textContent,/2 execution attempts/);assert.match(document.body.textContent,/Local execution/);assert.match(document.body.textContent,/Source not loaded/);
  await act(()=>document.querySelector('.inbox-issue-title').click());assert.equal(ui.button('Start work').disabled,true);assert.match(document.body.textContent,/active or unresolved/);assert.equal(document.querySelectorAll('.inbox-attempts a').length,2);
});

test('late paging and previews cannot overwrite a newer selection or filter',async t=>{
  let releasePage,releasePreview;
  const ui=await setup(t,async(path,options)=>{
    if(path.includes('page=2'))return new Promise(resolve=>{releasePage=()=>resolve(response(page(2,[issue(43)])));});
    if(path.includes('state=closed'))return response({...page(1,[]),state:'closed'});
    if(path==='/api/v1/issues/preview')return new Promise(resolve=>{releasePreview=()=>resolve(response(context(42)));});
    return response(page(1,[issue(42)]));
  });
  await act(()=>document.querySelector('.inbox-issue-title').click());await ui.click('Back to Inbox');await act(()=>releasePreview());assert.equal(document.querySelector('.inbox-body'),null);
  await ui.click('Next page');await ui.edit('.inbox-controls select','closed');await act(()=>releasePage());assert.match(document.body.textContent,/page 1 \(closed\)/);assert.doesNotMatch(document.body.textContent,/Repository request 43/);
});


test('Definition renders the effective configured readiness mapping as planning metadata',async t=>{
  const ui=await setup(t,async path=>response(path==='/api/v1/definitions'?{workflows:{},commands:[],configuration:{harness:'mock',issueReadinessLabels:{triage:'scope:needed',spec:'plan:needed',ready:'scope:approved',blocked:'scope:blocked'}},terminology:{}}:page(1,[])));
  await ui.definition();const mapping=document.querySelector('[aria-label="Issue readiness labels"]');assert(mapping);
  for(const label of ['scope:needed','plan:needed','scope:approved','scope:blocked'])assert(mapping.textContent.includes(label));
  assert.match(mapping.textContent,/do not start agents/);
});
