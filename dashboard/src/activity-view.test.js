import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement, act } from 'react';
import { JSDOM } from 'jsdom';
import { createServer } from 'vite';

test('activity keeps attempts separate, uses safe enum labels and rejects stale async responses', async t => {
  const dom=new JSDOM('<div id="root"></div>',{url:'http://localhost/'}),prior=new Map(),requests=[];
  const fetch=async(path,options)=>new Promise(resolve=>requests.push({path,options,resolve}));
  for(const [key,value] of Object.entries({window:dom.window,document:dom.window.document,navigator:dom.window.navigator,IS_REACT_ACT_ENVIRONMENT:true,fetch})) {
    prior.set(key,Object.getOwnPropertyDescriptor(globalThis,key));Object.defineProperty(globalThis,key,{configurable:true,writable:true,value});
  }
  const server=await createServer({server:{middlewareMode:true,ws:false},appType:'custom'});
  const {createRoot}=await import('react-dom/client'),root=createRoot(document.getElementById('root'));
  t.after(async()=>{await act(()=>root.unmount());await server.close();dom.window.close();for(const [key,descriptor] of prior){if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key];}});
  const {Activity}=await server.ssrLoadModule('/src/activity.jsx');
  const render=id=>act(()=>root.render(createElement(Activity,{jobID:'job_a',run:{id,command:'build',state:'cancelled'},csrfToken:'fixture'})));
  await render('run_a');await render('run_b');
  assert(requests[0].options.signal.aborted);assert.equal(requests[1].options.headers['X-Factory-Session'],'fixture');
  const page=(attempt,events)=>({job:'job_a',attempt,status:'available',terminal:true,has_more:false,completion_observed:false,next_cursor:2,events});
  await act(async()=>{requests[1].resolve({ok:true,json:async()=>page('run_b',[
    {cursor:1,kind:'tool_completed',tool:'read',at:'2026-09-28T00:00:00.000Z',text:'<script>PRIVATE</script>'},
    {cursor:2,kind:'<img src=x onerror=alert(1)>',at:'2026-09-28T00:00:00.000Z'}])});});
  assert.match(document.body.textContent,/Tool completed \(read\)/);assert.doesNotMatch(document.body.textContent,/PRIVATE|onerror/);
  assert.equal(document.querySelector('script,img,iframe'),null);assert.match(document.body.textContent,/Executor end not observed/);
  await act(async()=>{requests[0].resolve({ok:true,json:async()=>page('run_a',[{cursor:1,kind:'message_completed',at:'2026-09-27T00:00:00.000Z'}])});});
  assert.match(document.body.textContent,/Attemptrun_b/);assert.doesNotMatch(document.body.textContent,/Message completed/);
  await act(()=>[...document.querySelectorAll('button')].find(b=>b.textContent==='Refresh activity').click());
  await act(async()=>{requests[2].resolve({ok:false});});
  assert.match(document.body.textContent,/refresh unavailable/);
});


test('activity defaults to three observations and discloses retained events and diagnostics without hiding gaps', async t => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost/' });
  const prior = new Map(), requests = [];
  for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document,
    navigator: dom.window.navigator, IS_REACT_ACT_ENVIRONMENT: true,
    fetch: async (path, options) => new Promise(resolve => requests.push({ path, options, resolve })) })) {
    prior.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  }
  const server = await createServer({ server: { middlewareMode: true, ws: false }, appType: 'custom' });
  const { createRoot } = await import('react-dom/client'), root = createRoot(document.getElementById('root'));
  t.after(async () => {
    await act(() => root.unmount()); await server.close(); dom.window.close();
    for (const [key, descriptor] of prior) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key];
    }
  });
  const { Activity } = await server.ssrLoadModule('/src/activity.jsx');
  const stamp = '2026-09-28T00:00:00.000Z', attempt = `run_${'a'.repeat(120)}`;
  const page = { job: 'job_a', attempt, status: 'available', terminal: true, has_more: false,
    completion_observed: true, next_cursor: 5, truncated: true, dropped: 2, rejected: 3, write_errors: 1,
    process_observation: 'process_exited', process_observed_at: stamp, phase_started_at: stamp,
    last_received_at: stamp, saved_at: stamp,
    events: ['phase_started', 'process_started', 'message_completed', 'tool_completed', 'phase_completed']
      .map((kind, i) => ({ cursor: i + 1, kind, tool: 'read', at: stamp })) };
  await act(() => root.render(createElement(Activity, { jobID: 'job_a',
    run: { id: attempt, command: 'build', state: 'succeeded' }, csrfToken: 'fixture' })));
  assert.match(document.querySelector('[role="status"]').textContent, /Refreshing activity/);
  const respond = async body => act(async () => requests.at(-1).resolve({ ok: true, json: async () => body }));
  await respond(page);
  const card = document.querySelector('[aria-label="Execution activity"]');
  const recent = card.querySelector('[aria-label="Recent observations"]');
  assert.equal(recent.children.length, 3);
  assert.deepEqual([...recent.querySelectorAll('li > span:first-child')].map(node => node.textContent),
    ['Message completed', 'Tool completed (read)', 'Latest: Phase completed']);
  assert.equal(recent.querySelector('time').dateTime, stamp);
  const [timeline, details] = card.querySelectorAll('details');
  assert(!timeline.open && !details.open, 'both native keyboard disclosures start closed');
  const visible = card.cloneNode(true);
  visible.querySelectorAll('details').forEach(node => node.replaceChildren(node.querySelector('summary')));
  assert.doesNotMatch(visible.textContent, /run_a|Container|Docker|stdout|snapshot|billing|Phase started/);
  assert.match(visible.textContent, /Earlier events omitted/);
  assert.match(visible.textContent, /Observation gaps recorded/);
  assert.match(visible.textContent, /Attempt ended. Executor end observed/);
  assert.match(details.textContent, /Attemptrun_a{120}/);
  for (const label of ['Phase / queue', 'Container health', 'Last Docker client observation', 'Phase started',
    'Last stdout received', 'Last successful refresh', 'Saved snapshot', '3 rejected input lines; 1 storage errors',
    '2 earlier events dropped', 'Telemetry is not verification, usage or billing']) assert(details.textContent.includes(label));
  const summary = details.querySelector('summary');
  summary.focus(); assert.equal(document.activeElement, summary);
  await act(() => summary.click()); assert(details.open);
  await act(() => timeline.querySelector('summary').click()); assert(timeline.open);
  assert.equal(timeline.querySelectorAll('li').length, 5);
  assert.match(timeline.querySelector('li').textContent, /#1/);
  await act(() => timeline.querySelector('button').click());
  assert.match(requests.at(-1).path, /limit=128$/);
  await respond(page);
  assert.equal(card.querySelector('details button'), null, 'retained expansion remains capped');

  const refresh = async () => act(() => [...card.querySelectorAll('button')].find(b => b.textContent === 'Refresh activity').click());
  await refresh(); await respond({ ...page, events: [], truncated: false, dropped: 0, rejected: 0, write_errors: 0 });
  assert.match(card.textContent, /No activity observed yet/);
  await refresh(); await respond({ ...page, status: 'unavailable', events: [] });
  assert.match(card.textContent, /No retained activity for this attempt/);
  assert.match(card.querySelector('details').textContent, /Older history is not reconstructed/);
  await refresh(); await respond({ ...page, status: 'error', events: [] });
  assert.match(card.querySelector('[role="alert"]').textContent, /record unavailable or invalid/);

  // Drive one automatic refresh to verify a failed read leaves a visibly stale snapshot.
  const originalTimeout = globalThis.setTimeout;
  let poll;
  t.mock.method(globalThis, 'setTimeout', (callback, ...args) => {
    if (callback.name === 'poll') { poll = callback; return undefined; }
    return originalTimeout(callback, ...args);
  });
  await refresh(); await respond({ ...page, terminal: false, support: 'unsupported' });
  assert.match(card.textContent, /Only executor events available/);
  assert.match(card.textContent, /No new event means activity is unknown/);
  let pending;
  await act(() => { pending = poll(); });
  await act(async () => { requests.at(-1).resolve({ ok: false }); await pending; });
  assert.match(card.querySelector('[role="alert"]').textContent, /Observations are stale.*Reconnecting/);
  assert.equal(card.querySelector('[aria-label="Recent observations"]').children.length, 3);
});
