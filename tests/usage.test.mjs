import test from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CodexUsageParser, parseCodexJsonl, usageFields, MAX_USAGE_LINE_BYTES } from '../factory/usage.mjs';
import { BoundedLog } from '../factory/bounded-log.mjs';
import { retainedCodexUsage } from '../factory/processes.mjs';
import { createController } from '../factory/server.mjs';
import { JobQueue } from '../factory/queue.mjs';

const completed = usage => Buffer.from(`${JSON.stringify({ type: 'turn.completed', usage })}\n`);

test('Codex completion usage survives arbitrary stdout chunk boundaries and excludes subsets from the total', () => {
  const event = completed({ input_tokens: 5954949, cached_input_tokens: 5778688, cache_write_input_tokens: 0, output_tokens: 56198, reasoning_output_tokens: 39640 });
  const parser = new CodexUsageParser();
  for (let offset = 0; offset < event.length;) {
    const size = Math.min((offset % 7) + 1, event.length - offset);
    parser.write(event.subarray(offset, offset + size)); offset += size;
  }
  const usage = parser.finish();
  assert.deepEqual(usage, { input_tokens: '5954949', output_tokens: '56198', cached_input_tokens: '5778688', source: 'codex_jsonl', coverage: 'complete' });
  assert.deepEqual(usageFields(usage, { executor: 'codex' }, 'build'), { usage, token_usage: '6011147' });
});

test('only a top-level completion event is accepted; nested message/tool data is ignored', () => {
  const lines = [
    { type: 'event_msg', message: { type: 'turn.completed', usage: { input_tokens: 99, output_tokens: 1, cached_input_tokens: 0 } } },
    { type: 'response_item', item: { type: 'tool_output', text: JSON.stringify({ type: 'turn.completed', usage: { input_tokens: 99, output_tokens: 1, cached_input_tokens: 0 } }) } },
  ].map(value => `${JSON.stringify(value)}\n`).join('');
  assert.equal(parseCodexJsonl([Buffer.from(lines)]), null);
});

test('malformed, negative and inconsistent counts are rejected without inventing zero usage', () => {
  for (const usage of [
    { input_tokens: -1, output_tokens: 1, cached_input_tokens: 0 },
    { input_tokens: 5, output_tokens: 1, cached_input_tokens: 6 },
    { input_tokens: '2.5', output_tokens: 1, cached_input_tokens: 0 },
    { input_tokens: 5, output_tokens: 1 },
    { input_tokens: 5, output_tokens: 1, cached_input_tokens: 0, reasoning_output_tokens: 2 },
  ]) assert.equal(parseCodexJsonl([completed(usage)]), null);

  const parser = new CodexUsageParser();
  parser.write(Buffer.concat([completed({ input_tokens: 10, output_tokens: 2, cached_input_tokens: 4 }), completed({ input_tokens: -1, output_tokens: 1, cached_input_tokens: 0 })]));
  assert.deepEqual(parser.finish(), { input_tokens: '10', output_tokens: '2', cached_input_tokens: '4', source: 'codex_jsonl', coverage: 'partial' });

  const trailing = new CodexUsageParser();
  trailing.write(Buffer.concat([completed({ input_tokens: 10, output_tokens: 2, cached_input_tokens: 4 }), Buffer.from('{"type":"turn.completed","usage":oops}\n')]));
  assert.equal(trailing.finish().coverage, 'partial');
});

test('decimal string totals stay exact beyond JavaScript safe integers', () => {
  const usage = parseCodexJsonl([completed({ input_tokens: '900719925474099312345', output_tokens: '2', cached_input_tokens: '900719925474099312000' })]);
  assert.equal(usage.input_tokens, '900719925474099312345');
  assert.equal(usage.cached_input_tokens, '900719925474099312000');
  assert.equal(usageFields(usage, { executor: 'codex' }, 'build').token_usage, '900719925474099312347');
});

test('line memory is bounded and oversized input makes observed counts partial', () => {
  const oversized = Buffer.from(`${'x'.repeat(MAX_USAGE_LINE_BYTES + 100)}\n`);
  assert.equal(parseCodexJsonl([oversized]), null);
  const usage = parseCodexJsonl([oversized, completed({ input_tokens: 10, output_tokens: 2, cached_input_tokens: 4 })]);
  assert.equal(usage.coverage, 'partial');
});

test('missing evidence and deterministic work remain distinct from unreported Codex usage', () => {
  assert.deepEqual(usageFields(null, { executor: 'codex' }, 'build'), {
    usage: { status: 'unknown', source: 'codex_jsonl', coverage: 'unknown' }, token_usage: null,
  });
  assert.deepEqual(usageFields(null, { executor: 'pi' }, 'review'), {
    usage: { status: 'unknown', source: 'unsupported_executor', coverage: 'unknown' }, token_usage: null,
  });
  assert.deepEqual(usageFields(null, { executor: 'deterministic' }, 'verify'), {
    usage: { status: 'not_applicable', source: 'not_applicable', coverage: 'not_applicable' }, token_usage: null,
  });
});

function privateAttempt(t, { executor = 'codex', log, command = 'build' } = {}) {
  const state = mkdtempSync(join(tmpdir(), 'sdf-usage-'));
  t.after(() => rmSync(state, { recursive: true, force: true }));
  const job = { id: 'job_fixture' }, profile = { version: 1, executor, phase: command, policyHash: 'a'.repeat(64) };
  const runFolder = join(state, 'jobs', job.id, 'run_fixture'), artifactFolder = join(state, 'jobs', job.id, 'artifacts', 'run_fixture');
  mkdirSync(runFolder, { recursive: true, mode: 0o700 }); mkdirSync(artifactFolder, { recursive: true, mode: 0o700 });
  writeFileSync(join(artifactFolder, 'execution.json'), JSON.stringify(profile), { mode: 0o600 });
  if (log !== undefined) writeFileSync(join(runFolder, `${command}.log`), log, { mode: 0o600 });
  return { state, job, profile, attempt: { id: 'run_fixture', command, execution: profile } };
}

test('legacy recovery is read-only, profile-bound, bounded and only attributes stdout when stderr is empty', t => {
  const event = completed({ input_tokens: 20, output_tokens: 3, cached_input_tokens: 12 });
  const stdout = new BoundedLog(); stdout.write('stdout', event);
  const fixture = privateAttempt(t, { log: stdout.finish({ code: 1 }) });
  assert.deepEqual(retainedCodexUsage(fixture.state, fixture.job, fixture.attempt), {
    input_tokens: '20', output_tokens: '3', cached_input_tokens: '12', source: 'legacy_codex_log', coverage: 'complete',
  });

  const mixed = new BoundedLog(); mixed.write('stderr', event);
  const ambiguous = privateAttempt(t, { log: mixed.finish({ code: 1 }) });
  assert.equal(retainedCodexUsage(ambiguous.state, ambiguous.job, ambiguous.attempt), null);

  const nonCodex = privateAttempt(t, { executor: 'pi', log: stdout.finish({ code: 1 }) });
  assert.equal(retainedCodexUsage(nonCodex.state, nonCodex.job, nonCodex.attempt), null);
  const mismatch = privateAttempt(t, { log: stdout.finish({ code: 1 }) });
  mismatch.attempt.execution = { ...mismatch.profile, policyHash: 'd'.repeat(64) };
  assert.equal(retainedCodexUsage(mismatch.state, mismatch.job, mismatch.attempt), null);
  const absent = privateAttempt(t);
  assert.equal(retainedCodexUsage(absent.state, absent.job, absent.attempt), null);
  const linked = privateAttempt(t);
  const linkedPath = join(linked.state, 'jobs', linked.job.id, linked.attempt.id, 'build.log');
  const targetPath = join(linked.state, 'outside.log');
  writeFileSync(targetPath, stdout.finish({ code: 1 }), { mode: 0o600 }); symlinkSync(targetPath, linkedPath);
  assert.equal(retainedCodexUsage(linked.state, linked.job, linked.attempt), null);
  const publicLog = privateAttempt(t, { log: stdout.finish({ code: 1 }) });
  chmodSync(join(publicLog.state, 'jobs', publicLog.job.id, publicLog.attempt.id, 'build.log'), 0o644);
  assert.equal(retainedCodexUsage(publicLog.state, publicLog.job, publicLog.attempt), null);
});

test('truncated legacy logs retain supported events only as partial observed counts', t => {
  const log = new BoundedLog(64, 512);
  log.write('stdout', Buffer.from(`${'x'.repeat(10000)}\n`));
  log.write('stdout', completed({ input_tokens: 20, output_tokens: 3, cached_input_tokens: 12 }));
  const fixture = privateAttempt(t, { log: log.finish({ code: 124 }) });
  const usage = retainedCodexUsage(fixture.state, fixture.job, fixture.attempt);
  assert.equal(usage.input_tokens, '20'); assert.equal(usage.output_tokens, '3');
  assert.equal(usage.coverage, 'partial'); assert.equal(usage.source, 'legacy_codex_log');

  const tooLarge = privateAttempt(t, { log: 'x'.repeat(1024 * 1024 + 1) });
  assert.equal(retainedCodexUsage(tooLarge.state, tooLarge.job, tooLarge.attempt), null);
});

test('status exposes the same bounded fallback contract without rewriting historical queue bytes', async t => {
  const state = mkdtempSync(join(tmpdir(), 'sdf-usage-status-'));
  t.after(() => rmSync(state, { recursive: true, force: true }));
  writeFileSync(join(state, 'factory.json'), JSON.stringify({ version: 1, repo: state, agent: 'mock', command: ['mock'], model: null, image: 'fixture:1', port: 7347, timeoutSeconds: 10, memoryMiB: 256, network: 'none', check: 'true', scope: { project: 'p', service: 's', owner: 'test', environment: 'test' } }));
  writeFileSync(join(state, 'worker.token'), 'private-fixture-token', { mode: 0o600 });
  const controller = createController(state);
  await new Promise(resolve => controller.server.listen(0, '127.0.0.1', resolve)); t.after(() => controller.close());
  const profile = { version: 1, executor: 'codex', phase: 'build', policyHash: 'b'.repeat(64), requestedModel: 'model-a' };
  const event = new BoundedLog(); event.write('stdout', completed({ input_tokens: 20, output_tokens: 3, cached_input_tokens: 12 }));
  const runFolder = join(state, 'jobs', 'job_legacy', 'run_legacy'), artifactFolder = join(state, 'jobs', 'job_legacy', 'artifacts', 'run_legacy');
  mkdirSync(runFolder, { recursive: true, mode: 0o700 }); mkdirSync(artifactFolder, { recursive: true, mode: 0o700 });
  writeFileSync(join(artifactFolder, 'execution.json'), JSON.stringify(profile), { mode: 0o600 });
  writeFileSync(join(runFolder, 'build.log'), event.finish({ code: 1 }), { mode: 0o600 });
  const job = { id: 'job_legacy', state: 'failed', workflow: { name: 'software', steps: ['build'], current_step: 0 }, runs: [{ id: 'run_legacy', state: 'failed', command: 'build', started_at: '2026-01-01', execution: profile }] };
  controller.queue.save(job);
  const before = controller.queue.db.prepare('SELECT data FROM jobs WHERE id=?').get(job.id).data;
  const response = await fetch(`http://127.0.0.1:${controller.server.address().port}/api/v1/status`);
  const snapshot = await response.json(), run = snapshot.jobs[0].runs[0];
  assert.equal(run.token_usage, '23');
  assert.deepEqual(run.usage, { input_tokens: '20', output_tokens: '3', cached_input_tokens: '12', source: 'legacy_codex_log', coverage: 'complete' });
  assert.equal(controller.queue.db.prepare('SELECT data FROM jobs WHERE id=?').get(job.id).data, before);
  assert(!JSON.stringify(snapshot).includes('private-fixture-token'));
});

test('a failed actual attempt keeps completed Codex usage through SQLite restart', async t => {
  const state = mkdtempSync(join(tmpdir(), 'sdf-usage-queue-'));
  t.after(() => rmSync(state, { recursive: true, force: true }));
  const profile = { executor: 'codex', phase: 'defence', policyHash: 'c'.repeat(64) };
  const usage = { input_tokens: '900719925474099312345', output_tokens: '8', cached_input_tokens: '900719925474099312000', source: 'codex_jsonl', coverage: 'complete' };
  const queue = new JobQueue(state, {
    prepare: () => profile,
    execute: async () => ({ outcome: 'blocked', summary: 'Synthetic post-turn failure', usage }),
    stop: async () => {}, reconcile: async () => {},
  });
  const { id } = queue.submit({ workflow: 'defence', repository: 'app', spec: 'Fixture' });
  for (let i = 0; i < 200 && (queue.get(id).state !== 'failed' || queue.active); i++) await new Promise(resolve => setTimeout(resolve, 5));
  const retained = queue.get(id).runs[0];
  assert.equal(retained.state, 'failed'); assert.equal(retained.usage.coverage, 'complete');
  assert.equal(retained.token_usage, '900719925474099312353');
  await queue.close();
  const restarted = new JobQueue(state, { execute: async () => {}, stop: async () => {}, reconcile: async () => {} });
  assert.deepEqual(restarted.get(id).runs[0].usage, retained.usage);
  assert.equal(restarted.get(id).runs[0].token_usage, retained.token_usage);
  await restarted.close();
});
