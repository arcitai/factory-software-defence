import test from 'node:test';
import assert from 'node:assert/strict';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { act } from 'react';
import { JSDOM } from 'jsdom';
import { createServer } from 'vite';
import { canonicalIssue } from '../../factory/issue-lifecycle.mjs';

const dashboardRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repository = 'https://github.com/acme/factory';
const session = 'test-session-token';

function repositoryIssue(number, title) {
  const url = `${repository}/issues/${number}`;
  return {
    number, title, url, state: 'open', author: 'operator', labels: [],
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
    repositoryIssue(117, 'Draft target issue'),
    repositoryIssue(118, 'Prior needs review'),
    repositoryIssue(119, 'Prior failed'),
    repositoryIssue(120, 'Prior interrupted'),
  ];
  const jobs = [
    ['prior-review', 118, 'needs_review'],
    ['prior-failed', 119, 'failed'],
    ['prior-interrupted', 120, 'interrupted'],
  ].map(([id, number, state]) => ({
    id, state, workflow: { name: 'software' }, task: { title: `Prior job ${number}`, source_url: `${repository}/issues/${number}` },
    created_at: '2026-09-28T09:00:00Z', updated_at: '2026-09-28T10:00:00Z',
  }));
  const receipts = new Map();
  const requests = [];
  let nextIssueNumber = 121;
  let issueListReads = 0;
  let statusReads = 0;
  let failNextIssueListRead = false;
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
      const selected = issues.filter(issue => stateFilter === 'all' || issue.state === stateFilter);
      return jsonResponse({ issues: selected, page: 1, state: stateFilter, loaded_count: selected.length, total: null, next_page: null });
    }
    if (url.pathname === '/api/v1/issues/preview') {
      const input = JSON.parse(options.body);
      const issue = issues.find(item => item.url === input.url);
      return jsonResponse({
        ...issue, body: `Current body for ${issue.title}`, spec: issue.title,
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
      receipts.set(input.request_id, receipt);
      if (input.title === 'Lost response recovered issue') throw new Error('Browser response was lost after HTTP 201.');
      return jsonResponse(receipt, 201);
    }
    if (/^\/api\/v1\/issue-submissions\/[^/]+\/recover$/.test(url.pathname) && method === 'POST') {
      const requestId = url.pathname.split('/')[4];
      const prior = receipts.get(requestId);
      if (prior?.state === 'uncertain') {
        const issue = repositoryIssue(nextIssueNumber++, prior.title);
        issues.push(issue);
        const recovered = { ...prior, state: 'created', repository, actor: 'operator', issue: { number: issue.number, url: issue.url, missing_labels: [] } };
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
  const targetLink = [...document.querySelectorAll('.run-card-link')].find(link => link.textContent.includes('Draft target issue'));
  await click(targetLink);
  await waitFor(() => document.querySelector('.issue-context textarea[maxlength="16000"]'), 'issue detail should load its start draft');
  const operatorBrief = 'Keep this unsent detail draft while creating a separate issue.';
  await act(async () => { setValue(document.querySelector('.issue-context textarea[maxlength="16000"]'), operatorBrief, window); });
  const closeDetail = document.querySelector('a[aria-label="Close issue detail"]');
  await click(closeDetail);
  await waitFor(() => document.querySelector('.new-issue-action'), 'Inbox should return from issue detail');

  const search = document.querySelector('input[aria-label="Search loaded work"]');
  const statusFilter = [...document.querySelectorAll('.filter-card-main')].find(button => button.textContent.includes('Needs review'));
  assert.ok(statusFilter, 'fixture exposes a Needs review filter');
  await act(async () => { setValue(search, 'preserved search phrase', window); });
  await click(statusFilter);
  assert.equal(statusFilter.getAttribute('aria-pressed'), 'true');

  async function createFromTemplate(title, lostResponse = false) {
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
    await waitFor(() => document.querySelector('.issue-created strong')?.textContent.includes('created'), 'creation receipt should be shown');
    if (lostResponse) assert.ok(requests.filter(request => request.pathname === '/api/v1/issue-submissions' && request.method === 'GET').length > receiptReadsBeforeCreate, 'lost POST response should reconcile against stored receipts');
    await waitFor(() => issueListReads > priorListReads, 'successful receipt should reload the repository issue page');
    assert.equal(document.querySelector('input[aria-label="Search loaded work"]')?.value, 'preserved search phrase');
    assert.equal(document.querySelector('button[aria-label="Board"]')?.getAttribute('aria-pressed'), 'true');
    assert.equal([...document.querySelectorAll('.filter-card-main')].find(button => button.textContent.includes('Needs review'))?.getAttribute('aria-pressed'), 'true');
    await click(buttonMatching(document, text => text === 'Done'));
    await waitFor(() => !document.querySelector('dialog[open]'), 'Done should return to the refreshed Inbox');
  }

  await createFromTemplate('Ordinary template issue');
  await click(buttonMatching(document, text => text.startsWith('Clear filters')));
  await waitFor(() => [...document.querySelectorAll('.run-card-link')].some(link => link.textContent.includes('Ordinary template issue')), 'ordinary created issue should be present in the retained board');

  await click(document.querySelector('button[aria-label="Repository"]'));
  await act(async () => { setValue(document.querySelector('select[aria-label="Repository issue state"]'), 'closed', window); });
  await waitFor(() => requests.some(request => request.pathname === '/api/v1/issues' && request.method === 'GET' && request.search.includes('state=closed')), 'closed issue state should load');
  await act(async () => { setValue(document.querySelector('input[aria-label="Search loaded work"]'), 'preserved search phrase', window); });
  await click([...document.querySelectorAll('.filter-card-main')].find(button => button.textContent.includes('Needs review')));

  failNextIssueListRead = true;
  await createFromTemplate('Lost response recovered issue', true);
  assert.match(document.querySelector('[role="alert"]')?.textContent || '', /Repository data stale\. Provider read timed out\./, 'a failed post-receipt issue read keeps the previous snapshot marked stale');
  assert.equal(document.body.textContent.includes('No issues on this page.'), false, 'a failed read is not presented as an empty closed page');
  await click(document.querySelector('button[aria-label="Repository"]'));
  await click(buttonMatching(document, text => text === 'Refresh issues'));
  await waitFor(() => ![...document.querySelectorAll('[role="alert"]')].some(node => node.textContent.includes('Repository data stale.')), 'manual issue refresh should clear the stale notice after a successful read');
  const priorOpenReads = requests.filter(request => request.pathname === '/api/v1/issues' && request.method === 'GET' && request.search.includes('state=open')).length;
  await act(async () => { setValue(document.querySelector('select[aria-label="Repository issue state"]'), 'open', window); });
  await waitFor(() => requests.filter(request => request.pathname === '/api/v1/issues' && request.method === 'GET' && request.search.includes('state=open')).length > priorOpenReads && document.querySelector('.repository-scope')?.textContent.includes('6 loaded'), 'switching back to open should reload the open issue page');
  await click(buttonMatching(document, text => text.startsWith('Clear filters')));
  await waitFor(() => [...document.querySelectorAll('.run-card-link')].some(link => link.textContent.includes('Lost response recovered issue')), 'reconciled issue should appear after clearing the retained search and status filters');

  const manualRequestId = 'browser_existing_receipt_0001';
  receipts.set(manualRequestId, { request_id: manualRequestId, state: 'uncertain', title: 'Manual receipt recovered issue' });
  await act(async () => { setValue(document.querySelector('input[aria-label="Search loaded work"]'), 'preserved search phrase', window); });
  await click([...document.querySelectorAll('.filter-card-main')].find(button => button.textContent.includes('Needs review')));
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
  assert.equal([...document.querySelectorAll('.filter-card-main')].find(button => button.textContent.includes('Needs review'))?.getAttribute('aria-pressed'), 'true');
  await click(document.querySelector('button[aria-label="Close issue form"]'));
  await waitFor(() => !document.querySelector('dialog[open]'), 'closing the test draft should return to the Inbox');
  await click(buttonMatching(document, text => text.startsWith('Clear filters')));
  await waitFor(() => [...document.querySelectorAll('.run-card-link')].some(link => link.textContent.includes('Manual receipt recovered issue')), 'explicitly recovered issue should appear after clearing filters');

  const reopenedTarget = [...document.querySelectorAll('.run-card-link')].find(link => link.textContent.includes('Draft target issue'));
  await click(reopenedTarget);
  await waitFor(() => document.querySelector('.issue-context textarea[maxlength="16000"]')?.value === operatorBrief, 'existing issue detail draft should survive receipt refreshes');
  assert.deepEqual(jobs.map(job => job.state), ['needs_review', 'failed', 'interrupted']);
  assert.equal(statusReads >= 3, true, 'receipt callbacks refresh native status as before');
  assert.deepEqual(requests.filter(request => request.pathname.endsWith('/start') || /\/api\/v1\/jobs\/[^/]+\/(?:continue|resume|interrupt)$/.test(request.pathname)), []);
  assert.equal(requests.filter(request => request.pathname === '/api/v1/issues' && request.method === 'POST').length, 2);
});
