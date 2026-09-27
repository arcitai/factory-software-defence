import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement, act } from 'react';
import { JSDOM } from 'jsdom';
import { createServer } from 'vite';

test('retained PNG artifact opens as an image and revokes its object URL when closed', async t => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost/' });
  const prior = new Map();
  for (const [key, value] of Object.entries({
    window: dom.window, document: dom.window.document, navigator: dom.window.navigator,
    URL: dom.window.URL, Blob: dom.window.Blob, IS_REACT_ACT_ENVIRONMENT: true,
    fetch: async () => ({ ok: true, blob: async () => new dom.window.Blob(['bounded PNG fixture'], { type: 'image/png' }) }),
  })) {
    prior.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  }
  let nextURL = 'blob:factory-web-shot', created = [], revoked = [];
  dom.window.URL.createObjectURL = value => { created.push(value.type); return nextURL; };
  dom.window.URL.revokeObjectURL = value => { revoked.push(value); };
  const server = await createServer({ server: { middlewareMode: true, ws: false }, appType: 'custom' });
  const { createRoot } = await import('react-dom/client');
  const root = createRoot(document.getElementById('root'));
  t.after(async () => {
    await act(() => root.unmount());
    await server.close();
    dom.window.close();
    for (const [key, descriptor] of prior) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  });

  const { Artifacts } = await server.ssrLoadModule('/src/artifacts.jsx');
  const artifact = { id: 'job_a~run_b~web-story-result.png', run_id: 'run_b', path: 'web-story-result.png', size: 100, content_type: 'image/png' };
  await act(() => root.render(createElement(Artifacts, {
    artifacts: { byRun: { run_b: [artifact] }, error: '' }, runID: 'run_b', csrfToken: 'fixture-token',
  })));
  const view = [...document.querySelectorAll('button')].find(button => button.getAttribute('aria-label') === 'View web-story-result.png');
  assert(view, 'a bounded PNG is previewable');
  await act(async () => { view.click(); await new Promise(resolve => setTimeout(resolve, 0)); });
  const image = document.querySelector('img[alt="Browser verification screenshot web-story-result.png"]');
  assert.equal(image?.getAttribute('src'), 'blob:factory-web-shot');
  assert.deepEqual(created, ['image/png']);
  assert.equal(document.querySelector('iframe, object, embed'), null, 'retained screenshot evidence is never executable document content');
  const close = document.querySelector('button[aria-label="Close file preview"]');
  await act(() => close.click());
  assert.deepEqual(revoked, ['blob:factory-web-shot']);
  assert.equal(document.querySelector('img'), null);
});
