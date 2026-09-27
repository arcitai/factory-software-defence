import assert from 'node:assert/strict';
import test from 'node:test';
import { EventEmitter } from 'node:events';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createElement, act } from 'react';
import { JSDOM } from 'jsdom';
import { createServer } from 'vite';
import { executors } from '../../factory/processes.mjs';
import { createController } from '../../factory/server.mjs';
import { save } from '../../factory/lib.mjs';

test('unsuccessful executor evidence reaches queue, status, Result and History without opening acceptance', async t => {
  const state = mkdtempSync(join(tmpdir(), 'sdf-web-evidence-'));
  t.after(() => rmSync(state, { recursive: true, force: true }));
  execFileSync('git', ['init', state], { stdio: 'ignore' });
  writeFileSync(join(state, 'source.txt'), 'controlled source fixture\n');
  execFileSync('git', ['-C', state, 'add', 'source.txt']);
  execFileSync('git', ['-C', state, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@localhost', 'commit', '-m', 'Fixture'], { stdio: 'ignore' });
  save(join(state, 'factory.json'), { version: 1, repo: state, agent: 'mock', command: ['mock'], port: 7332,
    timeoutSeconds: 10, memoryMiB: 256, image: 'fixture:1', network: 'none', check: 'true',
    scope: { project: 'fixture', service: 'fixture', environment: 'test', owner: 'fixture' } });
  writeFileSync(join(state, 'worker.token'), 'controlled-session-token');
  let browserStatus, exitCode, executorOutcome;
  const supervisor = executors(state, {
    // Controlled executor completion; no Docker, browser or agent is launched.
    spawn: (_command, args, options) => {
      const child = new EventEmitter(); child.pid = 5454;
      child.stdin = { on() {}, end() {} };
      const verify = args.at(-1) === 'verify';
      const evidence = { status: browserStatus, candidate: 'c'.repeat(40), attempt: options.env.SDF_RUN_ID,
        policyHash: 'd'.repeat(64), adapter: 'playwright', version: '1.63.0', browser: 'chromium',
        browser_version: '153.0.0', platform: 'linux-container', coverage: 'web',
        stories: [{ id: 'result', contentHash: 'e'.repeat(64), status: browserStatus,
          screenshot: { file: 'web-story-result.png' }, trace: [{ index: 0, op: 'expect-text', role: 'status',
            name: 'Save status', expectedText: 'Saved', status: browserStatus, durationMs: 5, message: 'Controlled browser evidence' }] }] };
      save(options.env.SDF_STEP_RESULT_PATH, { outcome: verify ? executorOutcome : 'complete',
        summary: verify ? `Required browser verification ${browserStatus}` : 'Controlled build',
        ...(verify ? { web_verification: evidence } : {}) });
      queueMicrotask(() => child.emit('close', verify ? exitCode : 0));
      return child;
    },
  });
  const controller = createController(state, { ...supervisor, reconcile: async () => {},
    prepare: (job, attempt) => { save(join(state, 'jobs', job.id, attempt.id, 'execution-config.json'), { timeoutSeconds: 10 }); },
  });
  await new Promise(resolve => controller.server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${controller.server.address().port}`;
  const dom = new JSDOM('<div id="root"></div>', { url: origin }), prior = new Map();
  for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document,
    navigator: dom.window.navigator, IS_REACT_ACT_ENVIRONMENT: true })) {
    prior.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  }
  const vite = await createServer({ server: { middlewareMode: true, ws: false }, appType: 'custom' });
  const { createRoot } = await import('react-dom/client');
  const root = createRoot(document.getElementById('root'));
  t.after(async () => {
    await act(() => root.unmount()); await vite.close(); await controller.close(); dom.window.close();
    for (const [key, descriptor] of prior) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key];
    }
  });
  const { TaskDetail } = await vite.ssrLoadModule('/src/task-detail.jsx');
  const { id } = controller.queue.submit({ workflow: 'software', repository: 'app', spec: 'Controlled browser boundary' });
  const retained = [];
  for (const scenario of [['failed', 1, 'blocked'], ['unavailable', 0, 'blocked'], ['inconclusive', 1, 'complete'], ['failed', 1, 'blocked']]) {
    [browserStatus, exitCode, executorOutcome] = scenario;
    if (retained.length) await controller.queue.action(id, 'retry', { run_id: retained.at(-1).attempt });
    for (let i = 0; i < 200 && controller.queue.get(id).state !== 'failed'; i++)
      await new Promise(resolve => setTimeout(resolve, 5));
    const status = await (await fetch(origin + '/api/v1/status')).json();
    const job = status.jobs.find(job => job.id === id), run = job.runs.at(-1);
    const exported = JSON.parse(readFileSync(join(state, 'jobs', id, 'artifacts', run.id, 'result.json'), 'utf8'));
    assert.equal(job.state, 'failed'); assert.equal(run.command, 'verify'); assert.equal(run.outcome, 'blocked');
    assert.equal(run.summary, `Required browser verification ${browserStatus}`);
    assert.deepEqual(run.web_verification, exported.web_verification, 'the real adapter retains the executor summary through queue and HTTP status');
    retained.push(exported.web_verification);
    assert.deepEqual(job.runs.filter(run => run.web_verification).map(run => run.web_verification), retained);
    assert.equal(job.runs.some(run => ['review', 'handoff'].includes(run.command)), false);
    await assert.rejects(controller.queue.action(id, 'approve', { run_id: run.id }), /not awaiting/);
    await act(() => root.render(createElement(TaskDetail, { job, loaded: true, csrfToken: status.csrf_token })));
    // Rerender preserves the selected tab. Select Result explicitly after History.
    for (const name of ['result', 'history']) {
      const tab = document.querySelector(`[role="tab"][id$="${name}"]`);
      await act(() => tab.click());
      assert.equal(tab.getAttribute('aria-selected'), 'true');
      const panel = document.getElementById(tab.getAttribute('aria-controls'));
      assert.equal(panel.hidden, false);
      const evidence = [...panel.querySelectorAll('[aria-label="Browser verification"]')];
      const expected = name === 'result' ? retained.slice(-1) : retained.slice(0, -1);
      assert.equal(evidence.length, expected.length);
      for (const record of expected) {
        const current = evidence.find(item => item.textContent.includes(`attempt ${record.attempt}`));
        assert(current);
        assert.match(current.textContent, new RegExp(record.status, 'i'));
        assert.match(current.textContent, /Screenshot retained: web-story-result\.png/);
        assert.match(current.textContent, /Controlled browser evidence/);
      }
    }
  }
});
