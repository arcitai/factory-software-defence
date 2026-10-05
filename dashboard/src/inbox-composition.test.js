import test from 'node:test';
import assert from 'node:assert/strict';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import React, { act } from 'react';
import { JSDOM } from 'jsdom';
import { createServer } from 'vite';
import { ISSUE_STAGES, NATIVE_GROUPS, NATIVE_STATES } from '../../factory/issue-lifecycle.mjs';

// Synthetic interaction proof. jsdom cannot qualify rendered widths or colors;
// DESIGN.md's browser checks apply separately to the installed candidate.
test('approved composition keeps native disclosure, source phases and checkbox facets independent', async t => {
  const prior = Object.fromEntries(['window', 'document', 'localStorage', 'fetch', 'IS_REACT_ACT_ENVIRONMENT'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://127.0.0.1/' });
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, localStorage: dom.window.localStorage, IS_REACT_ACT_ENVIRONMENT: true });
  const calls = [];
  let navigation=[];
  const repository = 'https://github.com/example/project';
  const issues = NATIVE_STATES.map((state, index) => ({
    number: index + 1, url: `${repository}/issues/${index + 1}`, title: `Issue ${state.id} ${'long-title-'.repeat(8)}`,
    state: state.id === 'running' ? 'closed' : 'open', state_reason: state.id === 'running' ? 'completed' : null,
    labels: [{ name: 'factory:implementing', color: '1d76db' }, { name: index % 2 ? 'blue label' : 'red label', color: index % 2 ? '0075ca' : 'd73a4a' }],
    author: 'source-author', author_avatar_url: 'https://avatars.githubusercontent.com/u/42?v=4', author_profile_url: 'https://github.com/source-author',
    assignees: [{ login: 'actual-assignee', profile_url: 'https://github.com/actual-assignee' }], updated_at: '2026-09-29T09:00:00Z',
  }));
  const jobs = NATIVE_STATES.filter(state => state.id !== 'not_started').map((state, index) => ({
    id: `native-${state.id}`, state: state.id, workflow: { name: index % 2 ? 'defensive' : 'software' },
    task: { source_url: issues.find(issue => issue.title.startsWith(`Issue ${state.id} `)).url },
  }));
  globalThis.fetch = async path => {
    calls.push(path);
    assert.match(path, /^\/api\/v1\/issues\?/, 'view and filter interactions only read the provider page');
    return { ok: true, json: async () => ({ issues, state: 'open', page: 1, loaded_count: issues.length, total: null }) };
  };
  const dashboardRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const vite = await createServer({ configFile: resolve(dashboardRoot, 'vite.config.js'), root: dashboardRoot,
    server: { middlewareMode: true, hmr: false }, appType: 'custom', logLevel: 'silent' });
  const { createRoot } = await import('react-dom/client');
  const root = createRoot(document.getElementById('root'));
  t.after(async () => {
    await act(async () => root.unmount());
    await vite.close();
    dom.window.close();
    for (const [key, descriptor] of Object.entries(prior)) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  });
  const { Inbox } = await vite.ssrLoadModule('/src/inbox.jsx');
  const click = async element => { assert.ok(element); await act(async () => {
    element.dispatchEvent(new window.Event('pointerdown', { bubbles: true }));
    element.focus();
    element.click();
  }); };
  const category = label => document.querySelector(`.filter-card-main[aria-label="Filter by native category: ${label}"]`);
  const titles = () => [...document.querySelectorAll('.task-row-title,.run-card-title')].map(node => node.textContent.split(' ')[1]);
  const clear = () => click(document.querySelector('.clear-all-filters'));
  const facet = label => document.querySelector(`.task-facet[aria-label="Filter by ${label}"]`);
  const option = (label, id) => [...facet(label).closest('.facet-container').querySelectorAll('.facet-option')].find(button => button.textContent.includes(id));

  for (const theme of ['light', 'dark']) {
    document.documentElement.classList.toggle('dark', theme === 'dark');
    await act(async () => root.render(React.createElement(Inbox, { key: theme, token: 'synthetic', issueKey: '', jobs, loaded: true,
      onNavigation:value=>{navigation=value;}, provider: { supported: true }, nativeReadiness: { ready: true }, statusError: '', refreshStatus: () => {} })));
    const phaseCard=document.querySelector('[aria-label="Implementing repository phase"]');
    await click(phaseCard.querySelector('[aria-label="Expand Implementing"]'));
    await click(phaseCard.querySelector('.phase-subheading button'));
    assert.equal(titles().includes('running'),false,'closed source remains outside Implementing even while native running');
    assert.ok([...phaseCard.querySelectorAll('[role="checkbox"]')].every(button=>button.getAttribute('aria-checked')==='true'),'Select all visibly selects each actual child');
    await click([...phaseCard.querySelectorAll('[role="checkbox"]')].find(button=>button.textContent.includes('Failed')));
    assert.equal(titles().includes('failed'),false,'individual deselection after phase Select all changes the list');
    assert.equal(titles().length,4);
    await clear();
    const groupSelect=document.querySelector('[aria-label="Group work"]');
    await act(async()=>{groupSelect.value='phase';groupSelect.dispatchEvent(new window.Event('change',{bubbles:true}));});
    assert.deepEqual(navigation.map(item=>item.title),[...document.querySelectorAll('.task-row-title')].map(node=>node.textContent),'detail navigation follows grouped display order');
    const groupHeading=document.querySelector('.work-group-heading');
    assert.ok(groupHeading);
    await click(groupHeading);
    assert.equal(document.getElementById(groupHeading.getAttribute('aria-controls')).hidden,true);
    await click(groupHeading);
    assert.equal(document.getElementById(groupHeading.getAttribute('aria-controls')).hidden,false);
    await click(facet('native state'));
    await click(option('native state','Running'));
    await click(option('native state','Unknown'));
    await click(facet('phase'));
    await click(option('phase','Done'));
    await click(option('phase','Implementing'));
    const phaseName=phaseCard.querySelector('.filter-card-main');
    await click(phaseName);
    assert.deepEqual(titles(),['running'],'phase name preserves Done and native Running selection');
    await click(phaseName);
    assert.deepEqual(titles().sort(),['running','unknown']);
    await click([...phaseCard.querySelectorAll('[role="checkbox"]')].find(button=>button.textContent.includes('Unknown')));
    assert.deepEqual(titles(),['running'],'child deselection preserves other phases and native constraints');
    assert.equal(document.querySelector('[aria-label="Filter by phase: Done"]').getAttribute('aria-pressed'),'true');
    await clear();
    const railSelect=document.querySelector('[aria-label="Filter rail"]');
    await act(async()=>{railSelect.value='native';railSelect.dispatchEvent(new window.Event('change',{bubbles:true}));});
    assert.equal(document.querySelectorAll('.task-row').length, issues.length);
    assert.equal(document.querySelectorAll('.filter-card').length, NATIVE_GROUPS.length);
    assert.equal(document.querySelectorAll('button button,a a').length, 0);
    assert.equal(facet('models'), null, 'configuration or historical samples cannot create measured model evidence');
    assert.ok(document.querySelector('.status-rail-toggle')?.textContent.includes('Native status'), 'collapsed discovery remains labelled');
    const attention = category('Needs attention').closest('.filter-card');
    const disclosure = attention.querySelector('.filter-card-disclosure');
    const children = document.getElementById(disclosure.getAttribute('aria-controls'));
    const countsBefore = [...document.querySelectorAll('.filter-card-count,.filter-substate > span:last-child')].map(node => node.textContent);
    assert.equal(disclosure.getAttribute('aria-expanded'), 'true');
    assert.equal(children.hidden, false);
    assert.ok(children.querySelector('.filter-substate.tone-red'), 'failed uses its own red native tone within orange attention');
    await click(disclosure);
    assert.equal(disclosure.getAttribute('aria-expanded'), 'false');
    assert.equal(children.hidden, true);
    assert.equal(titles().length, issues.length, 'count disclosure does not filter');
    await click(category('Needs attention'));
    assert.deepEqual(titles().sort(), ['failed', 'interrupted', 'unknown']);
    assert.equal(children.hidden, true, 'category name does not expand details');
    assert.equal(category('Needs attention').getAttribute('aria-pressed'), 'true');
    await click(disclosure);
    await click(children.querySelector('[aria-label="Filter by native state: Failed"]'));
    assert.deepEqual(titles().sort(), ['interrupted', 'unknown'], 'substate deselection works after category selection');
    assert.equal(category('Needs attention').getAttribute('aria-pressed'), 'false');
    assert.deepEqual([...document.querySelectorAll('.filter-card-count,.filter-substate > span:last-child')].map(node => node.textContent), countsBefore, 'scope counts remain stable during filtering');
    await clear();

    await click(facet('native state'));
    await click(option('native state', 'Select all'));
    await click(option('native state', 'Failed'));
    assert.equal(titles().length, issues.length - 1);
    assert.equal(titles().includes('failed'), false);
    assert.equal(facet('native state').getAttribute('aria-expanded'), 'true');
    await click(facet('native state').closest('.facet-container').querySelector('.facet-popover-heading button'));
    await click(option('native state', 'Running'));
    await click(option('native state', 'Unknown'));
    assert.deepEqual(titles().sort(), ['running', 'unknown'], 'native facet uses OR');
    await click(facet('phase'));
    const phaseOptions = [...facet('phase').closest('.facet-container').querySelectorAll('.facet-options .facet-option')];
    assert.deepEqual(phaseOptions.map(button => button.querySelector('.phase-option-label').textContent), ISSUE_STAGES.map(stage => stage.label));
    await click(option('phase', 'Done'));
    assert.deepEqual(titles(), ['running'], 'phase intersects native selection without treating completion as acceptance');
    assert.ok(document.querySelector('.task-row .phase-filter-badge.tone-green'));
    assert.ok(document.querySelector('.task-row .task-state.tone-blue'));
    await click(option('phase', 'Implementing'));
    assert.deepEqual(titles().sort(), ['running', 'unknown'], 'repository phase uses OR');
    await clear();

    await click(facet('contributors'));
    await click(option('contributors','Unassigned'));
    assert.equal(titles().length,0,'the author does not count as an assignee');
    await clear();
    await click(facet('contributors'));
    await click(option('contributors','actual-assignee'));
    assert.equal(titles().length,issues.length,'actual source assignees filter all matching issues');
    await clear();

    await click(facet('labels'));
    assert.equal(option('labels', 'blue label').querySelector('.facet-label-dot').style.backgroundColor, 'rgb(0, 117, 202)', 'facet color comes from the provider');
    await click(option('labels', 'blue label'));
    await click(option('labels', 'red label'));
    assert.equal(titles().length, issues.length, 'labels use OR');
    await click(facet('work type'));
    await click(option('work type', 'Software'));
    assert.deepEqual(titles().sort(), ['failed', 'running', 'unknown']);
    await click(option('work type', 'Defensive'));
    assert.equal(titles().length, jobs.length, 'work types use OR while unstarted issues have no invented work type');
    const workTrigger = facet('work type');
    await act(async () => document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    assert.equal(workTrigger.getAttribute('aria-expanded'), 'false');
    assert.equal(document.activeElement, workTrigger);
    await clear();

    const row = document.querySelector('.task-row');
    assert.equal(row.querySelectorAll('.work-metadata > .task-row-meta').length, 2, 'source and activity have readable rows');
    assert.ok(row.querySelector('.task-row-labels .label-summary'));
    assert.ok(row.querySelector('.task-row-contributors .issue-contributors'), 'responsibility has a distinct metadata column');
    assert.ok(row.querySelector('[aria-label="Author: source-author"] img'));
    assert.ok(row.querySelector('[aria-label="Assignee: actual-assignee"]'));
    assert.ok(row.querySelector('.label-summary[aria-label^="2 labels:"]'));
    assert.doesNotMatch(document.body.textContent, /\b(?:tokens|cost|awaiting acceptance|succeeded)\b/i);
    await click(document.querySelector('[aria-label="Board"]'));
    const board = document.querySelector('.kanban-scroll');
    assert.equal(board.tabIndex, 0);
    assert.match(board.getAttribute('aria-label'), /scroll horizontally/);
    assert.equal(document.querySelectorAll('.run-column').length, ISSUE_STAGES.length);
    assert.equal(titles().length, issues.length);
    await click(document.querySelector('[aria-label="List"]'));
    assert.equal(titles().length, issues.length);
  }
  assert.equal(calls.length, 2, 'one source read per theme; filters, disclosures and views never start native work');
});
