import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { JSDOM } from 'jsdom';
import { createServer } from 'vite';
import { factoryDefinition } from '../../factory/definition.mjs';

test('Skills presents the installed job and operator catalogs with exact content and provenance', async t => {
  const definition = factoryDefinition({ harness: 'codex', timeoutSeconds: 30 });
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost/#/skills' });
  const prior = new Map();
  for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document,
    navigator: dom.window.navigator, IS_REACT_ACT_ENVIRONMENT: true,
    fetch: async path => {
      assert.equal(path, '/api/v1/definitions');
      return { ok: true, json: async () => definition };
    },
  })) {
    prior.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  }
  const server = await createServer({ server: { middlewareMode: true, ws: false }, appType: 'custom' });
  const { createRoot } = await import('react-dom/client');
  const root = createRoot(document.getElementById('root'));
  t.after(async () => {
    await act(() => root.unmount());
    await server.close(); dom.window.close();
    for (const [key, value] of prior) {
      if (value) Object.defineProperty(globalThis, key, value); else delete globalThis[key];
    }
  });
  const { DefinitionPage } = await server.ssrLoadModule('/src/catalog.jsx');
  await act(() => root.render(React.createElement(DefinitionPage, { section: 'skills' })));
  const libraries = document.querySelectorAll('.skill-library');
  assert.equal(libraries.length, 2);
  for (const [index, skills] of [definition.skills, definition.operator_skills].entries()) {
    const cards = libraries[index].querySelectorAll('details');
    assert.equal(cards.length, skills.length);
    for (const [i, skill] of skills.entries()) {
      await act(() => cards[i].querySelector('summary').click());
      assert.equal(cards[i].open, true);
      assert.equal(cards[i].querySelector('pre').textContent, skill.content);
      assert.equal(cards[i].querySelector('.skill-instructions p').textContent, skill.path);
      assert.equal(cards[i].querySelector('.skill-instructions small').textContent, `Installed file SHA-256: ${skill.sha256}`);
    }
  }
  assert.deepEqual([...document.querySelectorAll('.catalog-note')].map(note => note.textContent), [
    'Read-only instructions available to Factory agents. Expand a skill to inspect its contents and source.',
    'Factory Foundation guides repository and host setup. Use it explicitly before adopting Factory.',
  ]);
});
