import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { executors } from '../factory/processes.mjs';
import { VERSION } from '../factory/updates.mjs';

const jobID = `job_${'a'.repeat(24)}`;
const attempt = `run_${'b'.repeat(24)}`;

test('interrupted Codex inference env is removed only after process and container reconciliation', async t => {
  const state = mkdtempSync(join(tmpdir(), 'sdf-process-recovery-'));
  t.after(() => rmSync(state, { recursive: true, force: true }));
  const folder = join(state, 'jobs', jobID), attemptFolder = join(folder, attempt);
  mkdirSync(attemptFolder, { recursive: true, mode: 0o700 });
  const lock = join(folder, 'active.json'), environment = join(attemptFolder, '.model-build.env');
  writeFileSync(lock, JSON.stringify({ pid: 4242, pgid: 4343, attempt, phase: 'build' }), { mode: 0o600 });
  writeFileSync(environment, 'FACTORY_CODEX_AUTH_JSON={"inert":"sentinel"}\n', { mode: 0o600 });

  const unconfirmed = executors(state, { stopContainers: () => { throw new Error('container still present'); } });
  await assert.rejects(unconfirmed.reconcile(jobID, 'build'), /container still present/);
  assert.equal(existsSync(environment), true, 'do not remove credentials while container shutdown is unknown');
  assert.equal(existsSync(lock), true, 'do not clear the recovery fence');

  const reconciled = executors(state, { stopContainers: () => {}, alive: () => false, run: () => '' });
  await reconciled.reconcile(jobID, 'build');
  assert.equal(existsSync(environment), false, 'reconciliation removes the interrupted phase env copy');
  assert.equal(existsSync(lock), false, 'the fence is cleared only after safe cleanup');
});

test('forced stop cleans the attempt env after executor exit and confirmed container shutdown', async t => {
  const state = mkdtempSync(join(tmpdir(), 'sdf-process-stop-'));
  t.after(() => rmSync(state, { recursive: true, force: true }));
  const folder = join(state, 'jobs', jobID), attemptFolder = join(folder, attempt);
  mkdirSync(attemptFolder, { recursive: true, mode: 0o700 });
  const artifacts = join(folder, 'artifacts', attempt);
  mkdirSync(artifacts, { recursive: true, mode: 0o700 });
  const lock = join(folder, 'active.json'), environment = join(attemptFolder, '.model-build.env');
  writeFileSync(lock, JSON.stringify({ pid: 5454, pgid: 5454, attempt, phase: 'build' }), { mode: 0o600 });
  writeFileSync(environment, 'FACTORY_CODEX_AUTH_JSON={"inert":"sentinel"}\n', { mode: 0o600 });
  writeFileSync(join(attemptFolder, 'execution-config.json'), JSON.stringify({ timeoutSeconds: 10 }), { mode: 0o600 });
  const execution = { phase: 'build', executor: 'codex', runtimeVersion: VERSION, policyHash: 'a'.repeat(64) };
  let child, groupAlive = true, containersStopped = false;
  const supervisor = executors(state, {
    spawn: () => {
      child = new EventEmitter(); child.pid = 5454;
      child.stdin = { on() {}, end() {} };
      return child;
    },
    sleep: async () => {},
    alive: () => groupAlive,
    killGroup: (pid, signal) => {
      assert.equal(pid, -5454);
      if (signal === 'SIGKILL') { groupAlive = false; child.emit('close', 137, 'SIGKILL'); }
    },
    stopContainers: () => { containersStopped = true; },
  });
  const executed = supervisor.execute({ id: jobID, prompt: 'fixture' }, { id: attempt, command: 'build', execution });
  await supervisor.stop(jobID);
  const result = await executed;
  assert.equal(result.outcome, 'blocked');
  assert.equal(containersStopped, true);
  assert.equal(existsSync(environment), false);
  assert.equal(existsSync(lock), false);
});
