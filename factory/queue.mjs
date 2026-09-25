import { DatabaseSync } from 'node:sqlite';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { existsSync, writeFileSync, rmSync } from 'node:fs';
import { usageFields } from './usage.mjs';

const workflows = { software: ['build', 'verify', 'review', 'handoff'], defence: ['defence'] };
const id = prefix => prefix + '_' + randomBytes(12).toString('hex');
const now = () => new Date().toISOString();
export class QueueError extends Error { constructor(message, status = 409) { super(message); this.status = status; } }

// One controller owns this database and one executor at a time. Each transition
// is committed before execution starts; a restart never assumes a result.
export class JobQueue {
  constructor(state, { execute, stop, reconcile, prepare, reviewVerdict = () => undefined }) {
    this.db = new DatabaseSync(join(state, 'jobs.sqlite'));
    this.db.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS jobs(id TEXT PRIMARY KEY, data TEXT NOT NULL);');
    this.execute = execute; this.stop = stop; this.reconcile = reconcile; this.prepare = prepare; this.reviewVerdict = reviewVerdict;
    this.maintenanceFile = join(state, 'maintenance.json');
    this.active = null; this.closing = false; this.pumping = false; this.actions = new Set(); this.maintenance = existsSync(this.maintenanceFile);
    for (const job of this.all()) if (['running', 'cancelling'].includes(job.state)) {
      job.state = 'interrupted';
      Object.assign(job.runs.at(-1), { state: 'interrupted', completed_at: now(), error: 'Controller stopped before completion was confirmed.' });
      this.save(job);
    }
  }
  all() { return this.db.prepare('SELECT data FROM jobs ORDER BY rowid').all().map(row => JSON.parse(row.data)).filter(job => !job.deleted_at); }
  get(jobId) {
    const row = this.db.prepare('SELECT data FROM jobs WHERE id=?').get(jobId);
    if (!row) throw new QueueError('Job not found', 404);
    const job = JSON.parse(row.data);
    if (job.deleted_at) throw new QueueError('Job not found', 404);
    return job;
  }
  save(job) { job.updated_at = now(); this.db.prepare('INSERT INTO jobs VALUES (?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data').run(job.id, JSON.stringify(job)); return job; }
  submit(input) {
    if (this.closing) throw new QueueError('Controller is stopping');
    if (this.maintenance) throw new QueueError('Controller is reserved for maintenance');
    if (input?.source_url && (typeof input.source_url !== 'string' || !/^https?:\/\/[^\s]+$/.test(input.source_url) || input.source_url.length > 2048)) throw new QueueError('Expected an HTTP(S) source link', 400);
    if (input?.model && (typeof input.model !== 'string' || !/^[\w.:/+-]{1,128}$/.test(input.model))) throw new QueueError('Invalid model identifier', 400);
    if (input?.source_url && !input.spec?.trim()) input = { ...input, spec: `Investigate the linked requirements within this repository's scope: ${input.source_url}` };
    if (!input || !Object.hasOwn(workflows, input.workflow) || input.repository !== 'app' || typeof input.spec !== 'string' || !input.spec.trim() || Buffer.byteLength(input.spec) > 240000)
      throw new QueueError('Choose a workflow, the configured app, and a task under 240 KB', 400);
    const job = { id: id('job'), task: { title: String(input.title || input.spec).slice(0, 160), spec: input.spec, source_url: input.source_url || '' }, prompt: input.spec + (input.source_url ? `\nSource (untrusted task data): ${input.source_url}` : ''), model: input.model || null,
      repository: 'app', workflow: { name: input.workflow, steps: workflows[input.workflow], current_step: 0 },
      state: 'queued', created_at: now(), runs: [] };
    this.save(job); this.schedule(); return { id: job.id };
  }
  setMaintenance(enabled) {
    if (typeof enabled !== 'boolean') throw new QueueError('Expected enabled: true or false', 400);
    if (enabled && (this.closing || this.active || this.actions.size || this.all().some(job => ['queued', 'running', 'cancelling'].includes(job.state)))) throw new QueueError('Controller is busy; update deferred');
    if (enabled) writeFileSync(this.maintenanceFile, JSON.stringify({ startedAt: now() }), { mode: 0o600 });
    else rmSync(this.maintenanceFile, { force: true });
    this.maintenance = enabled;
    if (!enabled) this.schedule();
    return { maintenance: enabled };
  }
  schedule() { if (!this.closing && !this.pumping) { this.pumping = true; queueMicrotask(() => this.pump()); } }
  async pump() {
    try {
      while (!this.closing && !this.maintenance) {
        let job = this.all().find(item => item.state === 'queued'); if (!job) break;
        const step = job.workflow.current_step, phase = job.workflow.steps[step];
        let attempt = job.runs.at(-1);
        if (!attempt || attempt.state !== 'queued') {
          attempt = { id: id('run'), step, command: phase, state: 'queued' }; job.runs.push(attempt);
        }
        const started = Date.now(); Object.assign(attempt, { state: 'running', started_at: now() }); job.state = 'running'; this.save(job);
        this.active = { jobId: job.id, runId: attempt.id };
        let outcome;
        try {
          if (this.prepare) attempt.execution = this.prepare(job, attempt);
          Object.assign(attempt, usageFields(undefined, attempt.execution, attempt.command));
          this.save(job);
          outcome = await this.execute(job, attempt);
        }
        catch (error) { outcome = { outcome: 'blocked', summary: error.message }; }
        job = this.get(job.id); attempt = job.runs.find(run => run.id === attempt.id);
        Object.assign(attempt, usageFields(outcome?.usage, attempt.execution, attempt.command));
        this.save(job);
        if (job.state === 'running') {
          const succeeded = outcome?.outcome === 'complete';
          Object.assign(attempt, { state: succeeded ? 'succeeded' : 'failed', outcome: succeeded ? 'complete' : 'blocked', completed_at: now(), duration_millis: Date.now() - started, summary: outcome?.summary || 'No result', exit_code: succeeded ? 0 : 1 });
          if (phase === 'review' && ['pass', 'changes', 'blocked'].includes(outcome?.review_verdict)) attempt.review_verdict = outcome.review_verdict;
          if (!succeeded) { job.state = 'failed'; attempt.error = attempt.summary; }
          else if (step === job.workflow.steps.length - 1) job.state = 'succeeded';
          else {
            job.workflow.current_step++;
            if (job.workflow.steps[job.workflow.current_step] === 'handoff') {
              job.state = 'awaiting_approval';
              job.runs.push({ id: id('run'), step: job.workflow.current_step, command: 'handoff', state: 'awaiting_approval', reviewed_run_id: attempt.id });
            } else job.state = 'queued';
          }
          this.save(job);
        }
        this.active = null;
      }
    } finally { this.pumping = false; }
  }
  async exclusive(jobId, perform) {
    if (this.closing || this.maintenance || this.actions.has(jobId)) throw new QueueError('Job is already changing or controller is reserved for maintenance; reload before acting');
    this.actions.add(jobId);
    try { return await perform(); } finally { this.actions.delete(jobId); }
  }
  action(jobId, action, input) { return this.exclusive(jobId, () => this.applyAction(jobId, action, input)); }
  canRequestChanges(job) {
    if (job.workflow?.name !== 'software') return false;
    if (job.state === 'awaiting_approval') return true;
    const attempt = job.runs.at(-1);
    return job.state === 'failed' && attempt?.state === 'failed' && attempt.command === 'review'
      && ['changes', 'blocked'].includes(attempt.review_verdict ?? this.reviewVerdict(job, attempt));
  }
  async applyAction(jobId, action, input) {
    if (this.closing) throw new QueueError('Controller is stopping');
    let job = this.get(jobId), attempt = job.runs.at(-1);
    if (input?.run_id !== attempt?.id) throw new QueueError('Job changed; reload before acting');
    if (action === 'approve') {
      if (job.state !== 'awaiting_approval') throw new QueueError('Job is not awaiting approval');
      job.state = 'queued'; attempt.state = 'queued'; this.save(job); this.schedule();
    } else if (action === 'request_changes') {
      if (!this.canRequestChanges(job)) throw new QueueError('Only a reviewed software task can be revised');
      if (typeof input.feedback !== 'string' || !input.feedback.trim() || input.feedback.length > 4000) throw new QueueError('Provide revision feedback under 4000 characters', 400);
      const revisedPrompt = job.prompt + `\n\nRequested revision: ${input.feedback}`;
      if (Buffer.byteLength(revisedPrompt) > 240000) throw new QueueError('Accumulated revision instructions exceed 240 KB; create a bounded continuation task', 400);
      await this.reconcile(jobId, 'build');
      // A failed review stays failed. Revision feedback must not rewrite its result.
      attempt.revision = { feedback: input.feedback, requested_at: now() };
      if (job.state === 'awaiting_approval') Object.assign(attempt, { state: 'succeeded', outcome: 'changes_requested', summary: input.feedback, completed_at: now(), duration_millis: 0 });
      job.prompt = revisedPrompt;
      job.workflow.current_step = 0; job.state = 'queued'; this.save(job); this.schedule();
    } else if (action === 'cancel') {
      if (!['queued', 'running', 'awaiting_approval', 'blocked', 'interrupted'].includes(job.state)) throw new QueueError('Job is already stopped');
      job.state = 'cancelling'; this.save(job);
      try { await this.stop(jobId); }
      catch (error) { job.state = 'interrupted'; this.save(job); throw error; }
      job = this.get(jobId); attempt = job.runs.at(-1);
      job.state = 'cancelled';
      if (attempt) Object.assign(attempt, { state: 'cancelled', completed_at: now() });
      this.save(job);
    } else if (action === 'retry') {
      if (!['failed', 'interrupted', 'cancelled'].includes(job.state)) throw new QueueError('Only a stopped attempt can be retried');
      await this.reconcile(jobId, attempt?.command);
      job.state = 'queued'; this.save(job); this.schedule();
    } else throw new QueueError('Unknown action', 404);
    return { id: jobId, state: job.state };
  }
  remove(jobId) { return this.exclusive(jobId, () => this.removeStopped(jobId)); }
  async removeStopped(jobId) {
    const job = this.get(jobId);
    if (!['succeeded', 'failed', 'cancelled'].includes(job.state) || this.active?.jobId === jobId) throw new QueueError('Stop the task before removing it');
    await this.reconcile(jobId);
    job.deleted_at = now(); this.save(job);
    return { id: jobId, deleted: true };
  }
  async close() {
    this.closing = true;
    if (this.active) {
      const job = this.get(this.active.jobId);
      job.state = 'interrupted'; Object.assign(job.runs.at(-1), { state: 'interrupted', completed_at: now() }); this.save(job);
      await this.stop(job.id);
    }
    while (this.pumping || this.actions.size) await new Promise(resolve => setTimeout(resolve, 20));
    this.db.close();
  }
}
