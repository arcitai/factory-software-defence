import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement, act } from 'react';
import { JSDOM } from 'jsdom';
import { createServer } from 'vite';

test('Analytics and issue detail show the same Pi observations, cache writes and coverage limits', async t => {
  const dom=new JSDOM('<div id="root"></div>',{url:'http://localhost/'}), prior=new Map();
  for(const [key,value] of Object.entries({window:dom.window,document:dom.window.document,navigator:dom.window.navigator,IS_REACT_ACT_ENVIRONMENT:true,fetch:async()=>({ok:true,json:async()=>[]})})) {
    prior.set(key,Object.getOwnPropertyDescriptor(globalThis,key));Object.defineProperty(globalThis,key,{configurable:true,writable:true,value});
  }
  const server=await createServer({server:{middlewareMode:true,ws:false},appType:'custom'});
  const {createRoot}=await import('react-dom/client');
  const root=createRoot(document.getElementById('root'));
  t.after(async()=>{await act(()=>root.unmount());await server.close();dom.window.close();for(const [key,descriptor]of prior){if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key];}});
  const {Analytics}=await server.ssrLoadModule('/src/analytics.jsx');
  const {TaskDetail}=await server.ssrLoadModule('/src/task-detail.jsx');
  const stamp=new Date().toISOString();
  const local={id:'run_pi',state:'failed',command:'build',started_at:stamp,completed_at:stamp,duration_millis:1234,executor:'pi',model:'frozen-local',execution:{runtimeVersion:'0.15.4',inferenceProvider:'factory-local',role:'implement'},token_usage:'38',usage:{input_tokens:'35',output_tokens:'3',cached_input_tokens:'20',cache_write_input_tokens:'5',source:'pi_jsonl',coverage:'partial'}};
  const cloud={id:'run_cloud',state:'succeeded',command:'review',completed_at:stamp,executor:'codex',model:'explicit-cloud',execution:{runtimeVersion:'0.15.4',inferenceProvider:'openai',role:'review'},token_usage:'12',usage:{input_tokens:'10',output_tokens:'2',cached_input_tokens:'4',source:'codex_jsonl',coverage:'complete'}};
  const job={id:'job_fixture',state:'failed',created_at:stamp,repository:'app',task:{title:'Pi usage fixture'},workflow:{name:'software',steps:['build','verify','review','handoff'],current_step:0},runs:[local,cloud]};
  await act(()=>root.render(createElement(Analytics,{jobs:[job],loaded:true,workflows:['software']})));
  let text=document.body.textContent;
  assert.match(text,/Total reported tokens50/);assert.match(text,/2 of 2 AI runs · 1 partial/);
  assert.match(text,/5 cache-write tokens reported by 1 runs/);
  assert.match(text,/Summary calls and failed provider requests may be missing/);
  assert.match(text,/Provider costNot reported/);assert.match(text,/38 · partial/);
  await act(()=>root.render(createElement(TaskDetail,{job,loaded:true})));
  text=document.body.textContent;
  assert.match(text,/50 tokens reported · partial/);assert.match(text,/45 input/);assert.match(text,/5 output/);
  assert.match(text,/24 cached input/);assert.match(text,/5 cache writes reported \(1 runs\)/);
  assert.match(text,/Monetary costNot reported/);
  await act(()=>document.querySelector('[role="tab"][id$="history"]').click());
  text=document.body.textContent;
  assert.match(text,/frozen-local/);assert.match(text,/explicit-cloud/);
  assert.match(text,/Pi stdout · assistant messages only/);
  // An unknown historical run adds no invented zero cache-write attribution.
  job.runs=[{...local,token_usage:null,usage:{status:'unknown',source:'unsupported_executor',coverage:'unknown'}}];
  await act(()=>root.render(createElement(TaskDetail,{job,loaded:true})));
  assert(!document.body.textContent.includes('cache writes reported'));
  assert.match(document.body.textContent,/Not reported/);
});
