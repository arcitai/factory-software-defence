import { inspectDefinition, previewDefinition, previewRollback, changeDefinition } from './definition-store.mjs';
import { associateIssue, backlogHistory, readinessMapping, workRecords } from './issue-lifecycle.mjs';
import { harnessOf } from './lib.mjs';
import http from 'node:http';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, lstatSync, realpathSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { issueProvider, providerInfo } from './issue-provider.mjs';
import { IssueSubmissions } from './issue-submissions.mjs';
import { recommendWork } from './intake.mjs';
import { machineInfo } from './machine.mjs';
import { factoryDefinition } from './definition.mjs';
import { JobQueue, QueueError } from './queue.mjs';
import { executors } from './processes.mjs';
import { configAt, ROOT } from './lib.mjs';
import { VERSION } from './updates.mjs';
import { readProjectLinks } from './project-links.mjs';
import { attemptPresentation } from './execution-profile.mjs';
import { SourceAdmissionStore, publicSourceAdmission, publicContinuation } from './source-admission.mjs';
import { deliveryProvider, deliveryProviderInfo } from './delivery-provider.mjs';
import { DeliveryService } from './delivery.mjs';
import { MAX_WEB_SCREENSHOT_BYTES } from './web-verification.mjs';

function equal(a, b) { return typeof a === 'string' && Buffer.byteLength(a) === Buffer.byteLength(b) && timingSafeEqual(Buffer.from(a), Buffer.from(b)); }
async function body(request) {
  let text = '';
  for await (const part of request) { text += part; if (Buffer.byteLength(text) > 256000) throw new QueueError('Request too large', 413); }
  try { const value = JSON.parse(text); if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(); return value; }
  catch { throw new QueueError('Expected a JSON object', 400); }
}
function artifacts(state, jobId) {
  const root = join(state, 'jobs', jobId, 'artifacts'); if (!existsSync(root)) return [];
  return readdirSync(root).filter(name => /^run_[a-f0-9]+$/.test(name)).flatMap(runId => {
    const runFolder = join(root, runId), screenshots = new Map();
    try {
      const proofPath = join(runFolder, 'web-verification.json'), proofStat = lstatSync(proofPath);
      if (proofStat.isFile() && !proofStat.isSymbolicLink() && proofStat.size <= 1024 * 1024) {
        const proof = JSON.parse(readFileSync(proofPath, 'utf8'));
        for (const story of Array.isArray(proof.stories) ? proof.stories : []) {
          const shot = story?.screenshot;
          if (shot && /^web-story-[a-z0-9-]+\.png$/.test(shot.file || '')
            && /^[a-f0-9]{64}$/.test(shot.sha256 || '') && Number.isSafeInteger(shot.bytes)
            && shot.bytes >= 8 && shot.bytes <= MAX_WEB_SCREENSHOT_BYTES) screenshots.set(shot.file, shot);
        }
      }
    } catch { /* Invalid browser evidence cannot expose an image artifact. */ }
    return readdirSync(runFolder).filter(name => /^[\w.-]+\.(?:md|json|patch|log|png)$/.test(name)).flatMap(name => {
      const path = join(runFolder, name), stat = lstatSync(path);
      if (!stat.isFile() || stat.isSymbolicLink()) return [];
      if (name.endsWith('.png')) {
        const expected = screenshots.get(name);
        if (!expected || stat.size !== expected.bytes || stat.size > MAX_WEB_SCREENSHOT_BYTES) return [];
        const bytes = readFileSync(path);
        if (bytes.length < 8 || !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
          || createHash('sha256').update(bytes).digest('hex') !== expected.sha256) return [];
      }
      const content_type = name.endsWith('.png') ? 'image/png' : 'text/plain';
      return [{ id: `${jobId}~${runId}~${name}`, run_id: runId, path: name, storagePath: `${runId}/${name}`, size: stat.size, bytes: stat.size, content_type }];
    });
  });
}
export function createController(state, adapter = executors(state), integrations = {}) {
  const config = configAt(state), csrf = randomBytes(32).toString('hex');
  const token = readFileSync(join(state, 'worker.token'), 'utf8').trim();
  const sourceAdmission = new SourceAdmissionStore(state, config.repo, config.sourceRef || 'HEAD');
  const queue = new JobQueue(state, { ...adapter, sourceAdmission });
  const provider = integrations.issueProvider || issueProvider(config.repo);
  const submissions = new IssueSubmissions(queue, provider);
  const deliveryAdapter = deliveryProvider(config, integrations);
  const delivery = new DeliveryService(queue, state, { config: () => configAt(state), sourceAdmission, provider: deliveryAdapter });
  const projectLinks = readProjectLinks(config.repo);
  const host = machineInfo();
  const catalog = () => ({ ...factoryDefinition(configAt(state)), role_definition: inspectDefinition(state) });
  const server = http.createServer(async (request, response) => {
    const send = (status, value, type = 'application/json; charset=utf-8') => { response.writeHead(status, { 'Content-Type': type }); response.end(type.startsWith('application/json') ? JSON.stringify(value) : value); };
    response.setHeader('Cache-Control', 'no-store'); response.setHeader('X-Content-Type-Options', 'nosniff'); response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' blob:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    try {
      const port = server.address().port, hosts = [`localhost:${port}`, `127.0.0.1:${port}`];
      if (!hosts.includes(request.headers.host)) throw new QueueError('Host is not allowed', 403);
      if (request.headers.origin && !hosts.map(host => `http://${host}`).includes(request.headers.origin)) throw new QueueError('Origin is not allowed', 403);
      if (request.headers['sec-fetch-site'] === 'cross-site') throw new QueueError('Cross-site access is not allowed', 403);
      const url = new URL(request.url, `http://${request.headers.host}`);
      const authenticated = equal(request.headers.authorization, `Bearer ${token}`) || equal(request.headers['x-factory-session'], csrf);
      if (request.method === 'GET' && url.pathname === '/api/v1/status') {
        const definitions = catalog();
        const jobs = queue.all().map(job => ({ ...job, source_admission: publicSourceAdmission(job.source_admission),
          continuation: publicContinuation(job.continuation), continuation_status: queue.continuationStatus(job),
          source_history: (job.source_history || []).map(publicSourceAdmission), can_request_changes: queue.canRequestChanges(job),
          can_remove: queue.canRemove(job), removal_block_reason: queue.removalBlockReason(job),
          delivery_removal_blocked: Boolean(job.delivery && !['published', 'abandoned'].includes(job.delivery.state)),
          delivery_status: delivery.summary(job), runs: job.runs.map(attempt => attemptPresentation({ ...attempt,
          outcome: attempt.outcome || (attempt.state === 'succeeded' ? 'complete' : undefined) }, adapter.usage?.(job, attempt))) }));
        return send(200, { version: 1, runtime_version: VERSION, maintenance: queue.maintenance, workflows: Object.keys(definitions.workflows), commands: [], triggers: [], jobs, issue_history: backlogHistory(jobs, []), work_records: workRecords(jobs, []), csrf_token: csrf,
          infrastructure: { host, controller: { connected: !queue.closing }, workers: [{ id: 'local-executor', name: 'Local worker', host: host.hostname, connected: !queue.closing }] },
          automations: [], automation_control: definitions.automations, issue_provider: providerInfo(provider),
          delivery_configuration: deliveryProviderInfo(configAt(state), deliveryAdapter),
          workers: [{ name: 'Local worker', machine: host, instance_id: 'local-executor', repositories: ['app'], connected: !queue.closing, last_seen_at: new Date().toISOString() }], // v1 compatibility view
          repositories: ['app'], repo: config.repo, project_links: projectLinks, source_ref_default: config.sourceRef || 'HEAD', harness: harnessOf(config), agent: harnessOf(config) });
      }
      if (request.method === 'GET' && url.pathname === '/api/v1/definitions') {
        return send(200, catalog());
      }
      if (request.method === 'GET' && url.pathname === '/api/v1/definition') {
        if (!authenticated) throw new QueueError('Session required', 403);
        return send(200, inspectDefinition(state));
      }
      if (request.method === 'GET' && url.pathname === '/api/v1/issues') {
        if (!authenticated) throw new QueueError('Session required', 403);
        try {
          const page = Number(url.searchParams.get('page') || 1), state = url.searchParams.get('state') || 'open';
          if (!Number.isSafeInteger(page) || page < 1 || page > 10000 || !['open','closed','all'].includes(state)) throw new QueueError('Choose a valid issue page and state.', 400);
          const result = provider.supported ? await provider.list(page, state) : {repository:provider.repository, issues:[],next_page:null};
          const jobs = queue.all(), issues = result.issues.map(issue => associateIssue(issue, jobs, readinessMapping(config.issueReadinessLabels)));
          return send(200, { ...result, issues, provider:providerInfo(provider), page, state, loaded_count:issues.length, total:null,
            history:backlogHistory(jobs, issues), work_records:workRecords(jobs, issues) });
        }
        catch (error) { throw new QueueError(error.message, error.status || 400); }
      }
      if (request.method === 'GET' && url.pathname === '/api/v1/issue-templates') {
        if (!authenticated) throw new QueueError('Session required', 403);
        try { return send(200, await provider.templates()); }
        catch (error) { throw new QueueError(error.message, error.status || 400); }
      }
      if (request.method === 'GET' && ['/api/v1/issue-connection','/api/v1/issue-submissions'].includes(url.pathname)) {
        if (!authenticated) throw new QueueError('Session required', 403);
        return send(200, url.pathname.endsWith('issue-submissions') ? submissions.list() : { ...providerInfo(provider), ...(provider.supported ? await provider.context() : {}) });
      }
      const content = url.pathname.match(/^\/api\/v1\/artifacts\/(job_[a-f0-9]+)~(run_[a-f0-9]+)~([\w.-]+)\/content$/);
      const artifactList = url.pathname.match(/^\/api\/v1\/jobs\/(job_[a-f0-9]+)\/artifacts$/);
      if (request.method === 'GET' && (artifactList || content)) {
        if (!authenticated) throw new QueueError('Session required', 403);
        const jobId = (artifactList || content)[1]; queue.get(jobId);
        const entries = artifacts(state, jobId), file = content ? `${content[2]}/${content[3]}` : url.searchParams.get('file');
        if (!file) return send(200, entries);
        const artifact = entries.find(item => item.storagePath === file
          && item.bytes <= (item.content_type === 'image/png' ? MAX_WEB_SCREENSHOT_BYTES : 1024 * 1024));
        if (!artifact) throw new QueueError('Artifact not available', 404);
        const root = realpathSync(join(state, 'jobs', jobId, 'artifacts')), path = realpathSync(resolve(root, file));
        if (!path.startsWith(root + sep)) throw new QueueError('Artifact path rejected', 403);
        return send(200, readFileSync(path), artifact.content_type === 'image/png' ? 'image/png' : 'text/plain; charset=utf-8');
      }
      if (request.method === 'POST') {
        if (!authenticated) throw new QueueError('Session required', 403);
        if (!(request.headers['content-type'] || '').startsWith('application/json')) throw new QueueError('Use application/json', 415);
        const input = await body(request);
        if (url.pathname === '/api/v1/issues') return send(201, await submissions.create(input));
        const recovery = url.pathname.match(/^\/api\/v1\/issue-submissions\/([A-Za-z0-9_-]{16,100})\/recover$/);
        if (recovery) return send(200, await submissions.recover(recovery[1]));
        if (url.pathname === '/api/v1/maintenance') {
          if (!equal(request.headers.authorization, `Bearer ${token}`)) throw new QueueError('Operator token required for maintenance', 403);
          return send(200, queue.setMaintenance(input.enabled));
        }
        if (['/api/v1/definition/validate', '/api/v1/definition/diff'].includes(url.pathname)) {
          if (url.pathname.endsWith('/diff') && input.rollback === true && Object.keys(input).length === 1) return send(200, previewRollback(state));
          if (Object.keys(input).some(key => key !== 'definition')) throw new QueueError('Expected definition only', 400);
          return send(200, previewDefinition(state, input.definition));
        }
        if (['/api/v1/definition/apply', '/api/v1/definition/rollback'].includes(url.pathname))
          return send(200, changeDefinition(state, queue, input, url.pathname.endsWith('/rollback')));
        if (url.pathname === '/api/v1/issues/preview') {
          try { return send(200, associateIssue(await provider.preview(input.url), queue.all(), readinessMapping(config.issueReadinessLabels))); }
          catch (error) { throw new QueueError(error.message, error.status || 400); }
        }
        if (url.pathname === '/api/v1/issue-templates/draft') {
          try { return send(200, await provider.draft(input)); }
          catch (error) { throw new QueueError(error.message, error.status || 400); }
        }
        if (url.pathname === '/api/v1/intake/recommend') {
          try { return send(200, recommendWork(input)); }
          catch (error) { throw new QueueError(error.message, error.status || 400); }
        }
        if (url.pathname === '/api/v1/issues/start') {
          let issue;
          try { issue = associateIssue(await provider.preview(input.url), queue.all(), readinessMapping(config.issueReadinessLabels)); }
          catch (error) { throw new QueueError(error.message, error.status || 400); }
          if (issue.start_block_reason) throw new QueueError(issue.start_block_reason);
          if (input.expected_spec !== issue.spec) throw new QueueError('Issue content changed. Refresh the issue context before starting; your operator brief is preserved.');
          if (input.brief !== undefined && (typeof input.brief !== 'string' || input.brief.length > 16000)) throw new QueueError('Operator brief must be under 16000 characters.', 400);
          input.title = issue.title; input.source_url = issue.url;
          input.spec = issue.spec + (input.brief?.trim() ? `\n\nOperator brief:\n${input.brief.trim()}` : '');
          input.repository = 'app';
        }
        if (['/api/v1/jobs', '/api/v1/issues/start'].includes(url.pathname)) {
          const created = queue.submit(input);
          return send(201, { id: created.id, source_admission: publicSourceAdmission(created.source_admission) });
        }
        const action = url.pathname.match(/^\/api\/v1\/jobs\/(job_[a-f0-9]+)\/(approve|cancel|retry|request_changes|publish|abandon-delivery)$/);
        if (action) return send(200, action[2] === 'publish'
          ? await delivery.publish(action[1], input)
          : action[2] === 'abandon-delivery'
            ? await delivery.abandonDelivery(action[1], input)
            : await queue.action(action[1], action[2], input));
      }
      const removal = url.pathname.match(/^\/api\/v1\/jobs\/(job_[a-f0-9]+)$/);
      if (request.method === 'DELETE' && removal) {
        if (!authenticated) throw new QueueError('Session required', 403);
        return send(200, await queue.remove(removal[1]));
      }
      const asset = url.pathname.match(/^\/assets\/([\w.-]+\.(js|css|woff2))$/);
      if (request.method === 'GET' && (url.pathname === '/' || asset)) {
        const name = asset ? `assets/${asset[1]}` : 'index.html';
        const types = { js: 'text/javascript', css: 'text/css', woff2: 'font/woff2' };
        const path = join(ROOT, 'factory/ui', name);
        if (!existsSync(path)) throw new QueueError('Asset not found', 404);
        return send(200, readFileSync(path), asset ? types[asset[2]] : 'text/html; charset=utf-8');
      }
      throw new QueueError('Not found', 404);
    } catch (error) { if (!error.status) console.error(error); send(error.status || 500, { error: error.status ? error.message : 'Controller error; see private logs' }); }
  });
  server.requestTimeout = 20000; server.headersTimeout = 15000; server.on('listening', () => queue.schedule());
  return { server, queue, async close() { await queue.close(); await new Promise(resolve => server.close(resolve)); } };
}
