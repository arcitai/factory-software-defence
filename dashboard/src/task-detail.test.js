import test from 'node:test';
import assert from 'node:assert/strict';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { JSDOM } from 'jsdom';
import { createServer } from 'vite';

test('native detail respects capabilities and a newer unresolved result',async t=>{
  const prior={window:globalThis.window,document:globalThis.document,fetch:globalThis.fetch,IS_REACT_ACT_ENVIRONMENT:globalThis.IS_REACT_ACT_ENVIRONMENT};
  const dom=new JSDOM('<!doctype html><div id="root"></div>',{url:'http://127.0.0.1:7332/'});
  Object.assign(globalThis,{window:dom.window,document:dom.window.document,IS_REACT_ACT_ENVIRONMENT:true});
  const dashboardRoot=resolve(dirname(fileURLToPath(import.meta.url)),'..');
  const vite=await createServer({root:dashboardRoot,configFile:resolve(dashboardRoot,'vite.config.js'),server:{middlewareMode:true,hmr:false},appType:'custom',logLevel:'silent'});
  const root=createRoot(document.getElementById('root'));
  t.after(async()=>{await act(async()=>root.unmount());await vite.close();dom.window.close();Object.assign(globalThis,prior);});
  const {TaskDetail}=await vite.ssrLoadModule('/src/task-detail.jsx');
  const job={id:'job_abcd',native:true,harness:'claude',state:'needs_review',thread_id:'session',turn_id:'input',native_turn_status:'needs_review',task:{title:'Bounded issue'},native_turns:[]};
  const requests=[],actions=[];
  let result={...job,native_result:{response:'Finished.',completed_at:'2026-10-06T08:00:00Z'}};
  globalThis.fetch=async(url,options)=>{requests.push({url,method:options.method||'GET'});return {ok:true,json:async()=>result};};
  const render=props=>act(async()=>root.render(React.createElement(TaskDetail,{job,csrfToken:'fixture',loaded:true,onWorkflowAction:(...args)=>actions.push(args),...props})));
  const buttons=()=>[...document.querySelectorAll('button')].map(button=>button.textContent);
  await render({capabilities:{continue_turn:true,resume_thread:false,interrupt:true}});
  assert.ok(buttons().includes('Continue in Claude'));
  assert.ok(!buttons().some(text=>text.includes('Reconnect')));
  assert.match(document.querySelector('.task-result').textContent,/Claude/);

  result={...job,turn_id:'new-input',state:'unknown',native_turn_status:'unknown',native_result:null};
  await render({job:{...job,turn_id:'new-input'},capabilities:{continue_turn:true,resume_thread:false,interrupt:true}});
  assert.ok(!buttons().includes('Continue in Claude'),'fresh unknown history overrides the earlier completed list row');
  assert.match(document.querySelector('.task-result').textContent,/Native state is stale, disconnected or ambiguous/);
  assert.ok(requests.every(request=>request.method==='GET'));assert.deepEqual(actions,[]);

  result={...job,harness:'codex',turn_id:'codex-input'};
  await render({job:result,capabilities:{continue_turn:true,resume_thread:true,interrupt:true}});
  assert.ok(buttons().includes('Continue in Codex'));
  assert.ok(buttons().includes('Reconnect without starting a turn'));
});
