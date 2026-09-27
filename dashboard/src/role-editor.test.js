import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { JSDOM } from 'jsdom';
import { createServer } from 'vite';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createController } from '../../factory/server.mjs';

// DOM interaction against the real local API/parser/store. Rendered viewport and
// theme inspection remains a separate browser qualification gate.
test('role editor previews before apply, retains failed drafts, reads applied state and rolls back through the API', async t => {
  const state = mkdtempSync(join(tmpdir(), 'factory-role-ui-'));
  writeFileSync(join(state, 'factory.json'), JSON.stringify({ version: 1, repo: state, harness: 'codex', command: ['codex', 'exec', '-'],
    model: 'installed', image: 'fixture:1', port: 7350, timeoutSeconds: 30, memoryMiB: 256, network: 'none', check: 'true', scope: { project: 'p', service: 's', environment: 'e', owner: 'o' } }));
  writeFileSync(join(state, 'worker.token'), 'fixture');
  const controller = createController(state, { execute: async () => ({ outcome: 'blocked' }), stop: async () => {}, reconcile: async () => {} });
  await new Promise(r => controller.server.listen(0, '127.0.0.1', r));
  const origin = `http://127.0.0.1:${controller.server.address().port}`, nativeFetch = globalThis.fetch;
  const status = await (await nativeFetch(origin + '/api/v1/status')).json();
  const dom = new JSDOM('<div id="root"></div>', { url: origin + '/#/definition' }), prior = new Map();
  const writes = [];
  for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document, navigator: dom.window.navigator,
    IS_REACT_ACT_ENVIRONMENT: true, fetch: (path, options) => { if (options?.method === 'POST') writes.push({ path, body: JSON.parse(options.body) }); return nativeFetch(origin + path, options); } })) {
    prior.set(key, Object.getOwnPropertyDescriptor(globalThis, key)); Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  }
  const vite = await createServer({ server: { middlewareMode: true, ws: false }, appType: 'custom' });
  const { createRoot } = await import('react-dom/client'), root = createRoot(document.getElementById('root'));
  t.after(async () => { await act(() => root.unmount()); await vite.close(); await controller.close(); dom.window.close();
    for (const [key, value] of prior) { if (value) Object.defineProperty(globalThis, key, value); else delete globalThis[key]; }
    rmSync(state, { recursive: true, force: true }); });
  const { DefinitionPage } = await vite.ssrLoadModule('/src/catalog.jsx');
  const button = text => [...document.querySelectorAll('button')].find(b => b.textContent === text);
  async function settle(predicate) { for (let i = 0; i < 100; i++) { if (predicate()) return; await act(() => new Promise(r => setTimeout(r, 10))); } assert(predicate(), document.body.textContent); }
  async function change(id, value) {
    const element = document.getElementById(id);
    await act(() => { const prototype = element.tagName === 'SELECT' ? dom.window.HTMLSelectElement.prototype : dom.window.HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(prototype, 'value').set.call(element, value);
      element.dispatchEvent(new dom.window.Event(element.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true })); });
  }
  await act(() => root.render(React.createElement(DefinitionPage, { section: 'definition', csrfToken: status.csrf_token })));
  await settle(() => document.getElementById('review-harness'));
  assert.equal(button('Apply definition'), undefined);
  await change('review-harness', 'pi');
  assert.equal(document.getElementById('review-effort').disabled, true);
  await act(() => button('Validate and preview diff').click());
  await settle(() => document.querySelector('[role="alert"]'));
  assert.match(document.querySelector('[role="alert"]').textContent, /provider\/model/);
  assert.equal(document.getElementById('review-harness').value, 'pi');
  assert.equal(button('Apply definition'), undefined);
  await change('review-model-mode', 'explicit'); await change('review-model', 'anthropic/reviewer');
  await act(() => button('Validate and preview diff').click()); await settle(() => button('Apply definition'));
  assert.match(document.querySelector('[aria-label="Definition diff"]').textContent, /Before: codex.*After: pi/s);
  assert.equal(writes.some(write => write.path.endsWith('/apply')), false);
  // Busy apply preserves the candidate draft and installed state.
  controller.queue.active = { jobId: 'controlled-busy' };
  await act(() => button('Apply definition').click()); await settle(() => document.querySelector('[role="alert"]'));
  assert.match(document.querySelector('[role="alert"]').textContent, /busy/);
  assert.equal(document.getElementById('review-model').value, 'anthropic/reviewer');
  controller.queue.active = null;
  await act(() => button('Validate and preview diff').click()); await settle(() => button('Apply definition'));
  await act(() => button('Apply definition').click()); await settle(() => document.body.textContent.includes('Role definition applied.'));
  await settle(() => !button('Preview rollback').disabled);
  assert.match(document.querySelector('.role-editor-grid').textContent, /Installed: pi · anthropic\/reviewer/);
  assert.equal(controller.queue.all().length, 0);
  await act(() => button('Preview rollback').click()); await settle(() => button('Apply rollback'));
  assert.match(document.querySelector('[aria-label="Definition diff"]').textContent, /After: codex/);
  await act(() => button('Apply rollback').click()); await settle(() => document.body.textContent.includes('Previous role definition restored.'));
  await settle(() => document.getElementById('review-harness').value === 'inherit');
  assert.equal(writes.at(-1).path, '/api/v1/definition/rollback');
  assert.deepEqual(Object.keys(writes.at(-1).body), ['expected_revision']);
});
