import test from 'node:test';
import assert from 'node:assert/strict';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { act } from 'react';
import { JSDOM } from 'jsdom';
import { createServer } from 'vite';
import { canonicalIssue, projectIssuePhase } from '../../factory/issue-lifecycle.mjs';

const dashboardRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repository = 'https://github.com/acme/factory';
const session = 'test-session-token';

function repositoryIssue(number, title, labels = [{ name: 'factory:ready', color: 'd9dde5' }]) {
  const url = `${repository}/issues/${number}`;
  return {
    number, title, url, state: 'open', state_reason: null, author: 'operator', author_profile_url: 'https://github.com/operator',
    author_avatar_url: 'https://avatars.githubusercontent.com/u/42?v=4',
    assignees: number === 117 ? [] : number === 119
      ? [{ login: 'builder', profile_url: 'https://github.com/builder', avatar_url: null }, { login: 'reviewer', profile_url: 'https://github.com/reviewer', avatar_url: null }]
      : [{ login: 'builder', profile_url: 'https://github.com/builder', avatar_url: null }], labels,
    created_at: '2026-09-29T09:00:00Z', updated_at: '2026-09-29T09:00:00Z',
    identity: canonicalIssue(url), readiness: { state: 'unknown', label: 'Readiness unknown' },
  };
}

function jsonResponse(value, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => value };
}

function setValue(element, value, window) {
  const descriptor = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(element), 'value');
  descriptor.set.call(element, value);
  element.dispatchEvent(new window.Event('input', { bubbles: true }));
  element.dispatchEvent(new window.Event('change', { bubbles: true }));
}

async function click(element) {
  assert.ok(element, 'expected an interactive element');
  await act(async () => { element.click(); });
}

async function waitFor(predicate, message) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) return;
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 5)); });
  }
  assert.fail(message);
}

function buttonMatching(document, matcher) {
  return [...document.querySelectorAll('button')].find(button => matcher(button.textContent.trim()));
}

test('Inbox refreshes from created receipts without losing filters, board choice, or issue drafts', async t => {
  const priorWindow = globalThis.window;
  const priorDocument = globalThis.document;
  const priorFetch = globalThis.fetch;
  const priorActEnvironment = globalThis.IS_REACT_ACT_ENVIRONMENT;
  const priorNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  const priorLocalStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const priorHTMLElement = Object.getOwnPropertyDescriptor(globalThis, 'HTMLElement');
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
    url: 'http://127.0.0.1:7332/', pretendToBeVisual: true,
  });
  const { window } = dom;
  window.scrollTo = () => {};
  window.HTMLDialogElement.prototype.showModal = function showModal() { this.setAttribute('open', ''); };

  const issues = [
    repositoryIssue(117, 'Draft target issue', [
      { name: 'factory:ready', color: 'd9dde5' }, { name: 'track:software', color: 'd5dfe8' },
      { name: 'bug', color: 'd73a4a' }, { name: 'documentation', color: '0075ca' },
    ]),
    repositoryIssue(118, 'Prior needs review', [{ name: 'factory:review', color: '8254a8' }]),
    repositoryIssue(119, 'Prior failed', [{ name: 'factory:implementing', color: '1d76db' }]),
    repositoryIssue(120, 'Prior interrupted', [{ name: 'factory:blocked', color: 'd87624' }]),
    repositoryIssue(114, 'Earlier page issue', [{ name: 'factory:triage', color: 'd9dde5' }]),
    repositoryIssue(115, 'Second page fixture', [{ name: 'factory:spec', color: 'd9dde5' }]),
    repositoryIssue(116, 'Second page fixture two', [{ name: 'factory:ready', color: 'd9dde5' }]),
  ];
  const previewOverrides = new Map();
  issues.find(issue => issue.number === 120).author_profile_url = 'javascript:alert(1)';
  issues.find(issue => issue.number === 120).author_avatar_url = 'data:text/html,unsafe';
  issues.find(issue => issue.number === 120).assignees = null;
  for (const [number, reason] of [[113, 'completed'], [112, 'not_planned'], [111, null], [110, 'future_reason']]) {
    const closed = repositoryIssue(number, `Closed fixture ${number}`, []);
    closed.state = 'closed';
    closed.state_reason = reason;
    issues.push(closed);
  }
  const jobs = [
    ['prior-review', 118, 'needs_review'],
    ['prior-failed', 119, 'failed'],
    ['prior-interrupted', 120, 'interrupted'],
  ].map(([id, number, state]) => ({
    id, state, workflow: { name: 'software' }, task: { title: `Prior job ${number}`, source_url: `${repository}/issues/${number}` },
    created_at: '2026-09-28T09:00:00Z', updated_at: '2026-09-28T10:00:00Z',
  }));
  const receipts = new Map();
  const upstreamReceipts = new Map();
  const requests = [];
  let nextIssueNumber = 121;
  let issueListReads = 0;
  let statusReads = 0;
  let failNextIssueListRead = false;
  let failNextIssuePreviewRead = false;
  const provider = { id: 'github', label: 'GitHub', repository, supported: true, capabilities: { issues: true, templates: true, create: true } };
  const status = {
    jobs, csrf_token: session, repo: '/workspace/software-and-defence-factory',
    project_links: { repository }, issue_provider: provider,
    native_readiness: { ready: true, gaps: [] },
  };
  const template = {
    id: 'feature.yml', sha: 'a'.repeat(40), name: 'Feature request', description: 'A scoped change',
    title: 'Template issue', labels: [], fields: [
      { id: 'problem', type: 'textarea', label: 'Problem', required: true, value: '' },
      { id: 'acceptance', type: 'textarea', label: 'Acceptance criteria', required: true, value: '' },
    ],
  };

  const mockFetch = async (input, options = {}) => {
    const url = new URL(String(input), 'http://127.0.0.1:7332');
    const method = options.method || 'GET';
    requests.push({ pathname: url.pathname, search: url.search, method, body: options.body ? JSON.parse(options.body) : undefined });
    if (url.pathname === '/api/v1/status') {
      statusReads += 1;
      return jsonResponse(status);
    }
    if (url.pathname === '/api/v1/issues' && method === 'GET') {
      issueListReads += 1;
      if (failNextIssueListRead) {
        failNextIssueListRead = false;
        return jsonResponse({ error: 'Provider read timed out.' }, 503);
      }
      const stateFilter = url.searchParams.get('state');
      const page = Number(url.searchParams.get('page') || 1);
      const selected = issues.filter(issue => stateFilter === 'all' || issue.state === stateFilter).sort((a, b) => b.number - a.number);
      const pageIssues = selected.slice((page - 1) * 6, page * 6);
      return jsonResponse({ issues: pageIssues, page, state: stateFilter, loaded_count: pageIssues.length, total: null, next_page: selected.length > page * 6 ? page + 1 : null });
    }
    if (url.pathname === '/api/v1/issues/preview') {
      const input = JSON.parse(options.body);
      const issue = issues.find(item => item.url === input.url);
      if (failNextIssuePreviewRead) {
        failNextIssuePreviewRead = false;
        return jsonResponse({ error: 'Provider preview timed out.' }, 503);
      }
      const current = { ...issue, ...previewOverrides.get(issue.url) };
      return jsonResponse({
        ...current, phase: projectIssuePhase(current), body: current.body || `Current body for ${issue.title}`, spec: issue.title,
        recommendation: { work_type: 'software', reason: 'Use the project software workflow.' },
        start_block_reason: null,
      });
    }
    if (url.pathname === '/api/v1/issue-templates') {
      return jsonResponse({ repository, templates: [template], contacts: [], warnings: [] });
    }
    if (url.pathname === '/api/v1/issue-templates/draft') {
      const input = JSON.parse(options.body);
      return jsonResponse({
        title: input.title.trim(), spec: `# ${input.title.trim()}\n\n### Problem\n\n${input.answers.problem}\n\n### Acceptance criteria\n\n${input.answers.acceptance}`,
        labels: [], recommendation: { work_type: 'software', reason: 'Use the project software workflow.' },
      });
    }
    if (url.pathname === '/api/v1/issue-connection') {
      return jsonResponse({ id: 'github', label: 'GitHub', repository, actor: 'operator', actor_id: 42, available: true });
    }
    if (url.pathname === '/api/v1/issue-submissions' && method === 'GET') {
      return jsonResponse([...receipts.values()]);
    }
    if (url.pathname === '/api/v1/issues' && method === 'POST') {
      const input = JSON.parse(options.body);
      const issue = repositoryIssue(nextIssueNumber++, input.title);
      issues.push(issue);
      const receipt = {
        request_id: input.request_id, state: 'created', provider: 'github', repository, actor: 'operator',
        title: input.title, issue: { number: issue.number, url: issue.url, missing_labels: [] },
      };
      upstreamReceipts.set(input.request_id, receipt);
      if (input.title.startsWith('Unconfirmed ')) {
        receipts.set(input.request_id, { ...receipt, state: 'uncertain', issue: undefined });
        throw new Error('Creation outcome is uncertain. Check submission.');
      }
      receipts.set(input.request_id, receipt);
      if (input.title === 'Lost response recovered issue') throw new Error('Browser response was lost after HTTP 201.');
      return jsonResponse(receipt, 201);
    }
    if (/^\/api\/v1\/issue-submissions\/[^/]+\/recover$/.test(url.pathname) && method === 'POST') {
      const requestId = url.pathname.split('/')[4];
      const prior = receipts.get(requestId);
      if (prior?.state === 'uncertain') {
        const recovered = upstreamReceipts.get(requestId);
        assert.ok(recovered, 'recovery only finds an already-created upstream issue');
        receipts.set(requestId, recovered);
        return jsonResponse(recovered);
      }
      return jsonResponse(prior);
    }
    throw new Error(`Unexpected dashboard request: ${method} ${url.pathname}`);
  };

  globalThis.window = window;
  globalThis.document = window.document;
  globalThis.localStorage = window.localStorage;
  globalThis.HTMLElement = window.HTMLElement;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: window.navigator });
  globalThis.fetch = mockFetch;
  window.localStorage.setItem('factory-runs-view', 'board');

  const vite = await createServer({
    configFile: resolve(dashboardRoot, 'vite.config.js'), root: dashboardRoot,
    server: { middlewareMode: true, hmr: false }, appType: 'custom', logLevel: 'silent',
  });
  let appRoot;
  t.after(async () => {
    if (appRoot) await act(async () => { appRoot.unmount(); });
    await vite.close();
    dom.window.close();
    globalThis.window = priorWindow;
    globalThis.document = priorDocument;
    globalThis.fetch = priorFetch;
    globalThis.IS_REACT_ACT_ENVIRONMENT = priorActEnvironment;
    if (priorNavigator) Object.defineProperty(globalThis, 'navigator', priorNavigator);
    else delete globalThis.navigator;
    if (priorLocalStorage) Object.defineProperty(globalThis, 'localStorage', priorLocalStorage);
    else delete globalThis.localStorage;
    if (priorHTMLElement) Object.defineProperty(globalThis, 'HTMLElement', priorHTMLElement);
    else delete globalThis.HTMLElement;
  });

  await act(async () => { appRoot = (await vite.ssrLoadModule('/src/main.jsx')).appRoot; });
  await waitFor(() => issueListReads >= 1 && document.querySelector('.run-card-link'), 'initial Inbox issues should load');

  assert.equal(document.querySelector('button[aria-label="Board"]')?.getAttribute('aria-pressed'), 'true');
  assert.ok(document.querySelector('.run-column-heading [data-lucide="inbox"]') || document.querySelector('#board-triage'), 'phase catalog drives board columns');
  assert.ok(document.querySelector('.run-card .phase-filter-badge[aria-label="Filter by repository phase: Needs review"]'));
  const reviewPhaseCard = document.querySelector('.phase-filter-option[aria-label="Filter by repository phase: Needs review"]');
  assert.ok(reviewPhaseCard?.classList.contains('phase-filter-card') && reviewPhaseCard.classList.contains('tone-violet') && reviewPhaseCard.querySelector('svg'), 'the rail restores an individual catalog-colored phase card and category glyph');
  await act(async () => { reviewPhaseCard.focus(); });
  const railTooltip = reviewPhaseCard.closest('.phase-rail-control').querySelector('[role="tooltip"]');
  assert.equal(railTooltip.hidden, false, 'keyboard focus opens the filter card description');
  assert.match(railTooltip.textContent, /independent review/);
  await act(async () => { reviewPhaseCard.blur(); });
  assert.ok(document.querySelector('.run-card .native-filter-badge[aria-label="Filter by native state: Native turn completed · needs review"]'));
  assert.ok(document.querySelector('.run-card .native-filter-badge svg'), 'native outcome badges reuse their catalogued category glyph');
  const unstartedCard = [...document.querySelectorAll('.run-card')].find(card => card.querySelector('.run-card-title')?.textContent.includes('Draft target issue'));
  assert.ok(unstartedCard?.querySelector('.phase-filter-badge[aria-label="Filter by repository phase: Ready to implement"]'));
  assert.ok(unstartedCard?.querySelector('.native-filter-badge[aria-label="Filter by native state: Not started"] .task-state.tone-neutral'), 'unstarted loaded work keeps its separate neutral native state in Kanban');
  assert.doesNotMatch(unstartedCard?.textContent || '', /\b\d+ attempts?\b/, 'empty native history does not create an attempt count');
  assert.equal(document.querySelectorAll('a a').length, 0, 'issue detail links never wrap contributor profile links');
  assert.ok(document.querySelector('.run-card .issue-contributors.is-compact .contributor[aria-label="Author: operator"]'));
  assert.ok(document.querySelector('.run-card .issue-contributors.is-compact .contributor[aria-label="Assignee: builder"]'), 'an actual assignee has its own avatar');
  assert.ok(document.querySelector('.run-card .contributor-placeholder[aria-label="Assignee: Unassigned"]'), 'unassigned is represented without a repeated verbose row');
  assert.ok(document.querySelector('.run-card .contributor-placeholder[aria-label="Assignee: Assignment information unavailable"]'), 'missing assignment metadata is not presented as unassigned');
  assert.equal(document.querySelector('a[href^="javascript:"]'), null, 'invalid profile URLs do not become links');
  assert.equal(document.querySelector('img[src^="data:"]'), null, 'invalid avatar URLs are ignored');
  const reviewLabels = document.querySelector('button.label-summary[aria-label^="1 label: factory:review"]');
  assert.ok(reviewLabels, 'issue labels render as a compact color count');
  assert.match(reviewLabels.textContent, /1 label/, 'the visible summary includes its accurate label count');
  const fourLabels = [...document.querySelectorAll('.run-card .label-summary')].find(button => button.textContent.includes('4 labels'));
  assert.equal(fourLabels?.querySelectorAll('.label-dot').length, 4, 'label summary keeps colored dots and the full source count together');
  assert.match(fourLabels?.getAttribute('aria-label') || '', /^4 labels: /);
  await act(async () => { reviewLabels.focus(); });
  const labelTooltip = reviewLabels.parentElement.querySelector('[role="tooltip"]');
  assert.equal(labelTooltip.hidden, false, 'keyboard focus opens label names and colors');
  assert.equal(labelTooltip.style.position, 'fixed', 'label disclosure escapes clipped Kanban columns and scroll containers');
  assert.match(labelTooltip.textContent, /factory:review/);
  assert.match(labelTooltip.textContent, /#8254A8/);
  const avatar = document.querySelector('.run-card img[src^="https://avatars.githubusercontent.com/"]');
  assert.ok(avatar, 'validated GitHub avatar is rendered');
  const avatarContainer = avatar.closest('.contributor-avatar');
  await act(async () => { avatar.dispatchEvent(new window.Event('error')); });
  assert.equal(avatarContainer.textContent, 'OP', 'avatar failures fall back to the known login');

  const sourceScope = document.querySelector('button[aria-label="Repository scope: Open issues"]');
  assert.ok(sourceScope?.textContent.includes('Open issues'), 'the current bounded provider scope is visible in the stable toolbar');
  const nativeActionsBeforeViewChange = requests.filter(request => request.pathname.endsWith('/start') || /\/api\/v1\/jobs\/[^/]+\/(?:continue|resume|interrupt)$/.test(request.pathname)).length;
  await click(document.querySelector('button[aria-label="List"]'));
  const reviewRow = [...document.querySelectorAll('.task-row')].find(row => row.textContent.includes('Prior needs review'));
  assert.ok(reviewRow, 'list view preserves the accepted row layout');
  assert.ok(reviewRow.querySelector('.phase-row-icon.tone-violet'), 'the left category glyph uses the shared review tone');
  assert.ok(reviewRow.querySelector('.task-row-actions .phase-filter-badge[aria-label="Filter by repository phase: Needs review"]'), 'the source phase is compact and on the right');
  assert.ok(reviewRow.querySelector('.task-row-actions .native-filter-badge[aria-label="Filter by native state: Native turn completed · needs review"]'), 'native history stays separate from repository phase');
  assert.equal(reviewRow.querySelectorAll('a a').length, 0);
  assert.equal(reviewRow.querySelector('.contributor-role'), null, 'list rows keep contributor roles out of repeated visible metadata');
  assert.equal(reviewRow.querySelector('.contributor-login'), null, 'list rows keep logins in avatar disclosure');
  const reviewAuthor = reviewRow.querySelector('.issue-contributors .contributor[aria-label="Author: operator"][title="Author: operator"]');
  assert.ok(reviewAuthor);
  await act(async () => { reviewAuthor.focus(); });
  assert.equal(reviewAuthor.querySelector('.contributor-tip')?.textContent, 'Author: operator', 'keyboard focus exposes contributor role and login');
  assert.equal(reviewAuthor.querySelector('.contributor-tip')?.style.position, 'fixed', 'focused contributor disclosure is positioned outside clipped board content');
  const multiAssigneeRow = [...document.querySelectorAll('.task-row')].find(row => row.textContent.includes('Prior failed'));
  assert.equal(multiAssigneeRow.querySelectorAll('.issue-contributors a[aria-label^="Assignee:"]').length, 2, 'multiple real assignees retain separate profile links');
  const rowReviewPhase = reviewRow.querySelector('.task-row-actions .phase-filter-badge');
  await act(async () => { rowReviewPhase.focus(); });
  const phaseTooltip = rowReviewPhase.closest('.phase-filter-control').querySelector('[role="tooltip"]');
  assert.equal(phaseTooltip.hidden, false, 'keyboard focus opens the repository phase description');
  assert.match(phaseTooltip.textContent, /independent review/);
  assert.equal(phaseTooltip.style.position, 'fixed', 'phase tooltip escapes clipped content');
  await click(rowReviewPhase);
  assert.deepEqual([...document.querySelectorAll('.task-row-title')].map(node => node.textContent), ['Prior needs review'], 'the right-hand source badge filters the same projected phase');
  await click(rowReviewPhase);
  assert.ok(document.querySelectorAll('.task-row-title').length > 1);
  assert.equal(requests.filter(request => request.pathname.endsWith('/start') || /\/api\/v1\/jobs\/[^/]+\/(?:continue|resume|interrupt)$/.test(request.pathname)).length,
    nativeActionsBeforeViewChange, 'switching views and phases does not start or continue native work');
  const unstartedRow = [...document.querySelectorAll('.task-row')].find(row => row.querySelector('.task-row-title')?.textContent.includes('Draft target issue'));
  assert.ok(unstartedRow?.querySelector('.task-row-actions .phase-filter-badge[aria-label="Filter by repository phase: Ready to implement"]'));
  assert.ok(unstartedRow?.querySelector('.task-row-actions .native-filter-badge[aria-label="Filter by native state: Not started"] .task-state.tone-neutral'), 'unstarted loaded work keeps its separate neutral native state in list view');
  assert.doesNotMatch(unstartedRow?.textContent || '', /\b\d+ attempts?\b/, 'empty native history stays out of attempt counts');
  await click(document.querySelector('button[aria-label="Board"]'));
  assert.equal(document.querySelectorAll('a a').length, 0, 'board issue and contributor links also remain valid siblings');

  const reviewPhaseBadge = document.querySelector('.run-card .phase-filter-badge[aria-label="Filter by repository phase: Needs review"]');
  await click(reviewPhaseBadge);
  assert.equal(reviewPhaseBadge.getAttribute('aria-pressed'), 'true');
  assert.deepEqual([...document.querySelectorAll('.run-card-title')].map(node => node.textContent), ['Prior needs review'], 'phase badge filters its actual GitHub phase');
  await click(reviewPhaseBadge);
  assert.equal(reviewPhaseBadge.getAttribute('aria-pressed'), 'false');

  const phaseFacet = document.querySelector('button[aria-label="Filter by phase"]');
  await click(phaseFacet);
  const phaseOption = [...phaseFacet.closest('.facet-container').querySelectorAll('.facet-option[role="checkbox"]')].find(button => button.textContent.includes('Needs review'));
  await click(phaseOption);
  assert.deepEqual([...document.querySelectorAll('.run-card-title')].map(node => node.textContent), ['Prior needs review'], 'phase facet uses the same repository projection as row badges');
  await click(buttonMatching(phaseFacet.closest('.facet-container'), text => text === 'Reset'));
  assert.ok(document.querySelectorAll('.run-card-title').length > 1, 'facet reset clears the selected phase');
  assert.equal(phaseFacet.getAttribute('aria-expanded'), 'true', 'reset keeps the filter popover open');

  const labelFacet = document.querySelector('button[aria-label="Filter by labels"]');
  await click(labelFacet);
  const reviewLabelOption = [...labelFacet.closest('.facet-container').querySelectorAll('.facet-option[role="checkbox"]')].find(button => button.textContent.includes('factory:review'));
  await click(reviewLabelOption);
  assert.deepEqual([...document.querySelectorAll('.run-card-title')].map(node => node.textContent), ['Prior needs review'], 'label facet filters the actual provider label');
  await click(buttonMatching(labelFacet.closest('.facet-container'), text => text === 'Reset'));
  assert.ok(document.querySelectorAll('.run-card-title').length > 1, 'label reset restores the loaded records');

  await click(document.querySelector('button[aria-label^="Repository scope:"]'));
  await click(buttonMatching(document, text => text === 'Next page'));
  await waitFor(() => document.querySelector('.repository-scope')?.textContent.includes('Page 2'), 'next page loads the bounded provider page');
  assert.ok([...document.querySelectorAll('.run-card')].some(card => card.textContent.includes('Prior job 118')
    && card.querySelector('[aria-label="Filter by repository phase: Source not loaded"]')
    && card.querySelector('[aria-label="Filter by native state: Native turn completed · needs review"]')), 'off-page native history retains its identity and native state');
  const unloadedHistoryCard = [...document.querySelectorAll('.run-card')].find(card => card.textContent.includes('Prior job 118'));
  assert.equal(unloadedHistoryCard.querySelector('.label-summary, .label-summary-empty'), null, 'missing source metadata is not presented as zero labels');
  assert.equal(unloadedHistoryCard.querySelector('.contributor-source-unknown'), null, 'unknown contributors do not add repeated row noise');
  await click(buttonMatching(document, text => text === 'Previous page'));
  await waitFor(() => document.querySelector('.repository-scope')?.textContent.includes('Page 1'), 'previous page restores the provider page');

  async function toggleNativeReviewFilter() {
    const trigger = document.querySelector('button[aria-label="Filter by native state"]');
    if (trigger.getAttribute('aria-expanded') !== 'true') await click(trigger);
    const option = [...trigger.closest('.facet-container').querySelectorAll('.facet-option[role="checkbox"]')].find(button => button.textContent.includes('Needs review'));
    await click(option);
  }
  const nativeReviewSelected = () => document.querySelector('button[aria-label="Filter by native state"]')?.classList.contains('is-selected');

  const targetLink = [...document.querySelectorAll('.run-card-link')].find(link => link.textContent.includes('Draft target issue'));
  await click(targetLink);
  await waitFor(() => document.querySelector('.issue-context textarea[maxlength="16000"]'), 'issue detail should load its start draft');
  const contributorDetail = document.querySelector('.task-metadata .issue-contributors:not(.is-compact)');
  assert.match(contributorDetail?.textContent || '', /Authoroperator[\s\S]*Unassigned/, 'issue detail keeps author and unassigned assignee roles explicit');
  const operatorBrief = 'Keep this unsent detail draft while creating a separate issue.';
  await act(async () => { setValue(document.querySelector('.issue-context textarea[maxlength="16000"]'), operatorBrief, window); });
  const detailPosition = document.querySelector('.detail-position')?.textContent;
  const detailField = label => [...document.querySelectorAll('.task-metadata dt')].find(node => node.textContent === label)?.nextElementSibling?.textContent;
  const failedPreviewStarts = requests.filter(request => request.pathname === '/api/v1/issues/start').length;
  failNextIssuePreviewRead = true;
  await click(buttonMatching(document, text => text === 'Refresh issue context'));
  await waitFor(() => document.querySelector('[aria-label="Repository issue context"] [role="alert"]')?.textContent.includes('Provider preview timed out.'), 'preview failure should be exposed in issue detail');
  assert.match(detailField('Repository phase') || '', /^Source stale · Last loaded phase: Ready to implement/);
  assert.equal(detailField('Readiness · last loaded'), 'Readiness unknown', 'retained readiness is identified as last loaded');
  assert.match(detailField('Labels · last loaded') || '', /factory:ready/, 'retained labels are identified as last loaded');
  assert.match(detailField('Contributors · last loaded') || '', /Authoroperator[\s\S]*Unassigned/, 'retained contributors are identified as last loaded');
  assert.equal(document.querySelector('.inbox-body')?.textContent, 'Current body for Draft target issue');
  assert.match(document.querySelector('.issue-context details summary')?.textContent || '', /last loaded/);
  assert.equal(document.querySelector('.issue-context textarea[maxlength="16000"]')?.value, operatorBrief, 'preview failure preserves the operator draft');
  assert.equal(buttonMatching(document, text => text === 'Start work')?.disabled, true, 'start stays disabled while preview data is stale');
  assert.equal(requests.filter(request => request.pathname === '/api/v1/issues/start').length, failedPreviewStarts, 'failed preview never submits native work');
  assert.equal(document.querySelector('.detail-position')?.textContent, detailPosition, 'preview failure preserves filtered detail navigation');

  const targetIssue = issues.find(issue => issue.number === 117);
  previewOverrides.set(targetIssue.url, {
    labels: [{ name: 'factory:review', color: '8254a8' }], body: 'Refreshed issue body after provider recovery.',
    author: 'maintainer', author_profile_url: 'https://github.com/maintainer', author_avatar_url: 'https://avatars.githubusercontent.com/u/77?v=4',
    assignees: [{ login: 'reviewer', profile_url: 'https://github.com/reviewer', avatar_url: 'https://avatars.githubusercontent.com/u/78?v=4' }],
  });
  await click(buttonMatching(document, text => text === 'Refresh issue context'));
  await waitFor(() => detailField('Repository phase') === 'Needs review' && document.querySelector('.inbox-body')?.textContent === 'Refreshed issue body after provider recovery.', 'successful preview recovery restores current phase and body');
  assert.equal(detailField('Readiness'), 'Readiness unknown');
  assert.match(detailField('Labels') || '', /factory:review/);
  const recoveredContributors = document.querySelector('.task-metadata .issue-contributors:not(.is-compact)');
  assert.ok(recoveredContributors?.querySelector('[aria-label="Author: maintainer"]'), 'preview recovery restores current author data');
  assert.ok(recoveredContributors?.querySelector('[aria-label="Assignee: reviewer"]'), 'preview recovery restores current assignee data');
  assert.equal(document.querySelector('.task-metadata dt') && [...document.querySelectorAll('.task-metadata dt')].some(node => /last loaded/.test(node.textContent)), false, 'recovered metadata is no longer marked stale');
  assert.equal(document.querySelector('.issue-context details summary')?.textContent, 'Issue context');
  assert.equal(document.querySelector('.issue-context textarea[maxlength="16000"]')?.value, operatorBrief, 'successful preview recovery preserves the operator draft');
  assert.equal(buttonMatching(document, text => text === 'Start work')?.disabled, false, 'successful preview recovery restores start eligibility');
  assert.equal(document.querySelector('.detail-position')?.textContent, detailPosition, 'preview recovery preserves filtered detail navigation');
  const closeDetail = document.querySelector('a[aria-label="Close issue detail"]');
  await click(closeDetail);
  await waitFor(() => document.querySelector('.new-issue-action'), 'Inbox should return from issue detail');

  const search = document.querySelector('input[aria-label="Search loaded work"]');
  await act(async () => { setValue(search, 'preserved search phrase', window); });
  await toggleNativeReviewFilter();
  assert.equal(nativeReviewSelected(), true, 'native outcome facet filters independently from repository phase');

  async function createFromTemplate(title, lostResponse = false, recovery = null) {
    const priorListReads = issueListReads;
    await click(document.querySelector('.new-issue-action'));
    await waitFor(() => buttonMatching(document, text => text.includes('Feature request')), 'template chooser should load');
    await click(buttonMatching(document, text => text.includes('Feature request')));
    await waitFor(() => document.querySelector('input[name="issue-title"]'), 'template fields should open');
    await act(async () => {
      setValue(document.querySelector('input[name="issue-title"]'), title, window);
      const fields = document.querySelectorAll('textarea.issue-form-textarea');
      setValue(fields[0], `Problem described for ${title}.`, window);
      setValue(fields[1], `Acceptance for ${title}.`, window);
    });
    await click(buttonMatching(document, text => text === 'Review issue'));
    await waitFor(() => document.querySelector('[data-review-heading]') && document.querySelector('.issue-publish strong'), 'review should show the selected host identity');
    assert.match(document.querySelector('.issue-publish').textContent, /acme\/factory[\s\S]*operator/);
    const receiptReadsBeforeCreate = requests.filter(request => request.pathname === '/api/v1/issue-submissions' && request.method === 'GET').length;
    await click(buttonMatching(document, text => text.startsWith('Create issue on')));
    if (recovery) {
      await waitFor(() => buttonMatching(document, text => text === 'Check submission'), 'uncertain creation should offer explicit recovery');
      assert.equal(document.querySelector('.issue-created'), null, 'an uncertain receipt is not completion');
      const issueCount = issues.length;
      const createCount = requests.filter(request => request.pathname === '/api/v1/issues' && request.method === 'POST').length;
      if (recovery === 'edited') {
        await act(async () => { setValue(document.querySelector('textarea.work-brief'), 'Changed scope that has not been submitted.', window); });
      }
      await click(buttonMatching(document, text => text === 'Check submission'));
      assert.equal(issues.length, issueCount, 'recovery must not create another upstream issue');
      assert.equal(requests.filter(request => request.pathname === '/api/v1/issues' && request.method === 'POST').length, createCount, 'recovery must not replay creation');
      if (recovery === 'edited') {
        await waitFor(() => document.querySelector('.issue-publish [role="status"]')?.textContent.includes(title), 'recovery identifies the original issue separately from an edited draft');
        assert.equal(document.querySelector('.issue-created'), null, 'a prior submitted key must not confirm changed content');
        assert.equal(document.querySelector('fieldset')?.disabled, false);
        assert.equal(document.querySelector('textarea.work-brief')?.value, 'Changed scope that has not been submitted.');
        await waitFor(() => issueListReads > priorListReads, 'recovered original issue still refreshes the Inbox');
        await click(document.querySelector('button[aria-label="Close issue form"]'));
        return;
      }
    }
    await waitFor(() => document.querySelector('.issue-created strong')?.textContent.includes('created'), 'creation receipt should be shown');
    assert.equal(document.querySelector('fieldset')?.disabled, true, 'a confirmed current submission locks the form');
    assert.equal(buttonMatching(document, text => text.startsWith('Create issue on')), undefined, 'confirmed submission cannot be re-created from this form');
    if (lostResponse) assert.ok(requests.filter(request => request.pathname === '/api/v1/issue-submissions' && request.method === 'GET').length > receiptReadsBeforeCreate, 'lost POST response should reconcile against stored receipts');
    await waitFor(() => issueListReads > priorListReads, 'successful receipt should reload the repository issue page');
    assert.equal(document.querySelector('input[aria-label="Search loaded work"]')?.value, 'preserved search phrase');
    assert.equal(document.querySelector('button[aria-label="Board"]')?.getAttribute('aria-pressed'), 'true');
    assert.equal(nativeReviewSelected(), true, 'refresh preserves native outcome filters');
    await click(buttonMatching(document, text => text === 'Done'));
    await waitFor(() => !document.querySelector('dialog[open]'), 'Done should return to the refreshed Inbox');
  }

  await createFromTemplate('Ordinary template issue');
  await click(buttonMatching(document, text => text.startsWith('Clear filters')));
  await waitFor(() => [...document.querySelectorAll('.run-card-link')].some(link => link.textContent.includes('Ordinary template issue')), 'ordinary created issue should be present in the retained board');

  await click(document.querySelector('button[aria-label^="Repository scope:"]'));
  const scopeSelect = document.querySelector('select[aria-label="Repository issue scope"]');
  assert.deepEqual([...scopeSelect.options].map(option => option.textContent), ['Open issues', 'History (closed issues)', 'All issues'], 'bounded history scope is discoverable and accessible');
  await act(async () => { setValue(scopeSelect, 'closed', window); });
  await waitFor(() => requests.some(request => request.pathname === '/api/v1/issues' && request.method === 'GET' && request.search.includes('state=closed')), 'closed issue state should load');
  assert.ok(document.querySelector('button[aria-label="Repository scope: History"]'), 'closed source state is visibly identified as History');
  const doneCard = [...document.querySelectorAll('.run-card')].find(card => card.textContent.includes('Closed fixture 113'));
  assert.ok(doneCard?.querySelector('[aria-label="Filter by repository phase: Done"]'));
  assert.match(doneCard.querySelector('.task-row-meta')?.textContent || '', /Closed · Completed/, 'Done requires the provider completion reason');
  const declinedCard = [...document.querySelectorAll('.run-card')].find(card => card.textContent.includes('Closed fixture 112'));
  assert.ok(declinedCard?.querySelector('[aria-label="Filter by repository phase: Closed · Not planned"]'));
  const missingReasonCard = [...document.querySelectorAll('.run-card')].find(card => card.textContent.includes('Closed fixture 111'));
  assert.ok(missingReasonCard?.querySelector('[aria-label="Filter by repository phase: Closed"]'));
  assert.match(missingReasonCard.querySelector('.task-row-meta')?.textContent || '', /Closed · reason unavailable/, 'missing closure reasons stay explicitly unknown');
  const unknownReasonCard = [...document.querySelectorAll('.run-card')].find(card => card.textContent.includes('Closed fixture 110'));
  assert.match(unknownReasonCard.querySelector('.task-row-meta')?.textContent || '', /Closed · unrecognized reason/, 'unrecognized normalized closure reasons are not treated as completion');
  await act(async () => { setValue(document.querySelector('input[aria-label="Search loaded work"]'), 'preserved search phrase', window); });
  await toggleNativeReviewFilter();

  failNextIssueListRead = true;
  await createFromTemplate('Lost response recovered issue', true);
  assert.match(document.querySelector('[role="alert"]')?.textContent || '', /Repository data stale\. Provider read timed out\./, 'a failed post-receipt issue read keeps the previous snapshot marked stale');
  assert.equal(document.body.textContent.includes('No issues on this page.'), false, 'a failed read is not presented as an empty closed page');
  await click(document.querySelector('button[aria-label^="Repository scope:"]'));
  await click(buttonMatching(document, text => text === 'Refresh issues'));
  await waitFor(() => ![...document.querySelectorAll('[role="alert"]')].some(node => node.textContent.includes('Repository data stale.')), 'manual issue refresh should clear the stale notice after a successful read');
  const priorOpenReads = requests.filter(request => request.pathname === '/api/v1/issues' && request.method === 'GET' && request.search.includes('state=open')).length;
  await act(async () => { setValue(document.querySelector('select[aria-label="Repository issue scope"]'), 'open', window); });
  await waitFor(() => requests.filter(request => request.pathname === '/api/v1/issues' && request.method === 'GET' && request.search.includes('state=open')).length > priorOpenReads && document.querySelector('.repository-scope')?.textContent.includes('6 loaded'), 'switching back to open should reload the open issue page');
  await click(buttonMatching(document, text => text.startsWith('Clear filters')));
  await waitFor(() => [...document.querySelectorAll('.run-card-link')].some(link => link.textContent.includes('Lost response recovered issue')), 'reconciled issue should appear after clearing the retained search and status filters');

  const manualRequestId = 'browser_existing_receipt_0001';
  receipts.set(manualRequestId, { request_id: manualRequestId, state: 'uncertain', title: 'Manual receipt recovered issue' });
  const manualIssue = repositoryIssue(nextIssueNumber++, 'Manual receipt recovered issue');
  issues.push(manualIssue);
  upstreamReceipts.set(manualRequestId, { request_id: manualRequestId, state: 'created', title: manualIssue.title, repository, actor: 'operator', issue: { number: manualIssue.number, url: manualIssue.url, missing_labels: [] } });
  await act(async () => { setValue(document.querySelector('input[aria-label="Search loaded work"]'), 'preserved search phrase', window); });
  await toggleNativeReviewFilter();
  const readsBeforeManualRecovery = issueListReads;
  await click(document.querySelector('.new-issue-action'));
  await waitFor(() => buttonMatching(document, text => text.includes('Feature request')), 'template chooser should load for explicit receipt recovery');
  await click(buttonMatching(document, text => text.includes('Feature request')));
  await waitFor(() => document.querySelector('input[name="issue-title"]'), 'template fields should open for explicit receipt recovery');
  await act(async () => {
    setValue(document.querySelector('input[name="issue-title"]'), 'Different unsent draft', window);
    const fields = document.querySelectorAll('textarea.issue-form-textarea');
    setValue(fields[0], 'Recovered existing submission.', window);
    setValue(fields[1], 'Confirm the recovered issue appears.', window);
  });
  await click(buttonMatching(document, text => text === 'Review issue'));
  await waitFor(() => buttonMatching(document, text => text === 'Check submission'), 'uncertain receipt should offer reconciliation');
  await click(buttonMatching(document, text => text === 'Check submission'));
  await waitFor(() => [...document.querySelectorAll('.issue-publish [role="status"]')].some(node => node.textContent.includes('Manual receipt recovered issue')), 'recovery should identify the earlier issue separately');
  assert.equal(document.querySelector('.issue-created'), null, 'recovery must not mark the current draft as created');
  assert.equal(document.querySelector('input[name="issue-title"]')?.value, 'Different unsent draft');
  assert.equal(document.querySelector('textarea.work-brief')?.disabled, false, 'current draft stays editable');
  assert.match(document.querySelector('textarea.work-brief')?.value || '', /Different unsent draft/);
  assert.ok(requests.some(request => request.pathname === `/api/v1/issue-submissions/${manualRequestId}/recover` && request.method === 'POST'), 'recovery should use the existing request identity');
  await waitFor(() => issueListReads > readsBeforeManualRecovery, 'explicit receipt recovery should reload the issue page');
  assert.equal(requests.filter(request => request.pathname === '/api/v1/issues' && request.method === 'POST').length, 2, 'recovery does not issue another creation request');
  assert.equal(document.querySelector('input[aria-label="Search loaded work"]')?.value, 'preserved search phrase');
  assert.equal(nativeReviewSelected(), true, 'explicit recovery preserves the chosen native outcome filter');
  await click(document.querySelector('button[aria-label="Close issue form"]'));
  await waitFor(() => !document.querySelector('dialog[open]'), 'closing the test draft should return to the Inbox');
  await click(buttonMatching(document, text => text.startsWith('Clear filters')));
  await waitFor(() => [...document.querySelectorAll('.run-card-link')].some(link => link.textContent.includes('Manual receipt recovered issue')), 'explicitly recovered issue should appear after clearing filters');

  await act(async () => { setValue(document.querySelector('input[aria-label="Search loaded work"]'), 'preserved search phrase', window); });
  await toggleNativeReviewFilter();
  await createFromTemplate('Unconfirmed current issue', false, 'current');
  await createFromTemplate('Unconfirmed edited issue', false, 'edited');
  await click(buttonMatching(document, text => text.startsWith('Clear filters')));
  await waitFor(() => [...document.querySelectorAll('.run-card-link')].some(link => link.textContent.includes('Unconfirmed current issue')), 'explicitly confirmed current issue appears after clearing filters');

  await click(document.querySelector('button[aria-label^="Repository scope:"]'));
  await click(buttonMatching(document, text => text === 'Next page'));
  await waitFor(() => document.querySelector('.repository-scope')?.textContent.includes('Page 2'), 'the older target remains available on the next provider page');
  const reopenedTarget = [...document.querySelectorAll('.run-card-link')].find(link => link.textContent.includes('Draft target issue'));
  await click(reopenedTarget);
  await waitFor(() => document.querySelector('.issue-context textarea[maxlength="16000"]')?.value === operatorBrief, 'existing issue detail draft should survive receipt refreshes');
  assert.deepEqual(jobs.map(job => job.state), ['needs_review', 'failed', 'interrupted']);
  assert.equal(statusReads >= 3, true, 'receipt callbacks refresh native status as before');
  assert.deepEqual(requests.filter(request => request.pathname.endsWith('/start') || /\/api\/v1\/jobs\/[^/]+\/(?:continue|resume|interrupt)$/.test(request.pathname)), []);
  assert.equal(requests.filter(request => request.pathname === '/api/v1/issues' && request.method === 'POST').length, 4);
});
