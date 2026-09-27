import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { digest } from '../factory/lib.mjs';
import { createController } from '../factory/server.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const job = `job_${'c'.repeat(24)}`;
const attempt = `run_${'d'.repeat(24)}`;
const inertAuth = 'inert-executor-auth-sentinel';
const inertApiKey = 'inert-executor-api-key-sentinel';

function fixture(t, mode, phase = 'review', harness = 'codex') {
  const rootDir = mkdtempSync(join(tmpdir(), 'sdf-executor-container-recovery-'));
  t.after(() => rmSync(rootDir, { recursive: true, force: true }));
  const dockerRoot = mkdtempSync(join(root, '.sdf-controlled-docker-'));
  t.after(() => rmSync(dockerRoot, { recursive: true, force: true }));
  const state = join(rootDir, 'state'), bin = join(dockerRoot, 'bin');
  const folder = join(state, 'jobs', job), attemptFolder = join(folder, attempt);
  const artifacts = join(folder, 'artifacts', attempt), workspace = join(folder, 'checkout');
  const output = artifacts, dockerState = join(rootDir, 'docker-state.json');
  mkdirSync(attemptFolder, { recursive: true, mode: 0o700 });
  mkdirSync(artifacts, { recursive: true, mode: 0o700 });
  mkdirSync(workspace, { recursive: true, mode: 0o700 });
  mkdirSync(bin, { mode: 0o700 });

  execFileSync('git', ['-C', workspace, 'init', '--quiet', '-b', 'main']);
  writeFileSync(join(workspace, 'fixture.txt'), 'review fixture\n');
  execFileSync('git', ['-C', workspace, 'add', 'fixture.txt']);
  execFileSync('git', ['-C', workspace, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@localhost', 'commit', '--quiet', '-m', 'Fixture']);
  const head = execFileSync('git', ['-C', workspace, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  const tree = execFileSync('git', ['-C', workspace, 'rev-parse', 'HEAD^{tree}'], { encoding: 'utf8' }).trim();

  const config = {
    harness, command: harness === 'mock' ? ['fixture-mock'] : ['fixture-agent'], image: 'fixture/image:latest',
    memoryMiB: 512, cpus: 1, network: 'none', timeoutSeconds: 30, check: 'true',
  };
  const policyHash = digest(JSON.stringify(config));
  const execution = { phase, executor: harness, runtimeVersion: 'fixture', policyHash,
    requestedModel: harness === 'mock' ? null : 'fixture-model',
    modelSelection: harness === 'mock' ? 'not_applicable' : 'explicit' };
  writeFileSync(join(attemptFolder, 'execution-config.json'), JSON.stringify(config));
  writeFileSync(join(artifacts, 'execution.json'), JSON.stringify(execution));
  writeFileSync(join(folder, 'candidate.json'), JSON.stringify({ base: head, head, tree }));
  writeFileSync(join(folder, 'checks.json'), JSON.stringify({ passed: true, head, policyHash }));
  const outsideReport = join(rootDir, 'outside-report.txt');
  writeFileSync(outsideReport, `outside sentinel ${inertAuth}\n`, { mode: 0o600 });
  writeFileSync(join(state, 'model.env'), `OPENAI_API_KEY=${inertApiKey}\nFACTORY_CODEX_AUTH_JSON={"auth_mode":"fixture","tokens":{"access_token":"${inertAuth}"}}\n`, { mode: 0o600 });
  writeFileSync(dockerState, JSON.stringify({
    mode, present: false, running: false, id: 'fixture-container-id', outsideReport,
    labels: {}, initialRemoveFailed: ['present', 'unknown', 'outer-cleanup', 'verify-present', 'verify-unknown', 'verify-outer-cleanup', 'redaction-uncertain'].includes(mode),
    outerRemoveFailed: ['present', 'success-still-present', 'verify-present', 'redaction-uncertain'].includes(mode),
    listingUnknown: ['unknown', 'verify-unknown'].includes(mode),
    recoveryAllowed: false, launchSawSelectedEnvironment: false, launchAttempted: false,
    firstRmScratchExists: null, firstRmMarkerExists: null, firstRmRunning: null,
  }));

  const docker = join(bin, 'docker');
const dockerProgram = `#!/usr/bin/env node
import { chmodSync, existsSync, mkdirSync, readFileSync, statSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
const statePath = process.env.SDF_DOCKER_STATE;
const state = JSON.parse(readFileSync(statePath, 'utf8'));
const [command, ...args] = process.argv.slice(2);
const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
const save = () => writeFileSync(statePath, JSON.stringify(state));
const fail = (message) => { process.stderr.write(message + '\\n'); process.exit(1); };
const output = value => process.stdout.write(value ? value + '\\n' : '');
if (command === 'run') {
  state.launchAttempted = true;
  const envIndex = args.indexOf('--env-file');
  const envPath = envIndex >= 0 ? args[envIndex + 1] : null;
  state.selectedEnvironmentPath = envPath;
  const selectedEnvironment = envPath && existsSync(envPath) ? readFileSync(envPath, 'utf8') : '';
  state.launchSawSelectedEnvironment = Boolean(envPath?.endsWith('.model-review.env')
    && selectedEnvironment.includes('FACTORY_CODEX_AUTH_JSON')
    && selectedEnvironment.includes('inert-executor-auth-sentinel')
    && selectedEnvironment.includes('inert-executor-api-key-sentinel')
    && (statSync(envPath).mode & 0o777) === 0o600);
  const nameIndex = args.indexOf('--name');
  state.name = nameIndex >= 0 ? args[nameIndex + 1] : null;
  state.labels = Object.fromEntries(args.filter(value => value.startsWith('sdf.')).map(value => value.split('=')));
  const mountArgs = [];
  for (let i = 0; i < args.length - 1; i++) if (args[i] === '--mount') mountArgs.push(args[i + 1]);
  const scratchMount = mountArgs.find(value => /(?:^|,)target=\\/scratch(?:,|$)/.test(value));
  state.scratchPath = scratchMount?.match(/(?:^|,)source=([^,]+),target=\\/scratch(?:,|$)/)?.[1] ?? null;
  if (state.scratchPath) {
    const cache = state.scratchPath + '/fixture-cache';
    mkdirSync(cache, { recursive: true });
    state.scratchMarkerPath = cache + '/partial-check-output.txt';
    writeFileSync(state.scratchMarkerPath, 'controlled partial check output\\n');
    chmodSync(cache, 0o500);
  }
  const outputMount = mountArgs.find(value => /(?:^|,)target=\\/output(?:,|$)/.test(value));
  const outputDir = outputMount?.match(/(?:^|,)source=([^,]+),target=\\/output(?:,|$)/)?.[1];
  if (outputDir) {
    writeFileSync(outputDir + '/review.json', JSON.stringify({ verdict: 'pass', summary: 'Controlled executor fixture', findings: [] }));
    writeFileSync(outputDir + '/agent-report.md', 'Controlled executor fixture.\\n');
  }
  if (outputDir && state.mode.startsWith('redaction-')) {
    writeFileSync(outputDir + '/review.json', JSON.stringify({ verdict: 'pass', summary: 'Useful review content with inert-executor-auth-sentinel', findings: [{ note: 'Key inert-executor-api-key-sentinel' }] }));
    writeFileSync(outputDir + '/agent-report.md', 'Useful agent report. Auth: {"access_token":"inert-executor-auth-sentinel"}. Key: inert-executor-api-key-sentinel.\\n');
    if (state.mode === 'redaction-oversized')
      writeFileSync(outputDir + '/agent-report.md', 'Useful agent report. inert-executor-auth-sentinel\\n' + 'x'.repeat(1024 * 1024));
    if (state.mode === 'redaction-symlink') {
      unlinkSync(outputDir + '/agent-report.md');
      symlinkSync(state.outsideReport, outputDir + '/agent-report.md');
      state.symlinkCreated = true; save();
    }
  }
  if (state.mode.startsWith('redaction-')) {
    process.stdout.write('Useful stdout before inert-executor-auth-');
    await delay(15);
    process.stdout.write('sentinel\\n' + JSON.stringify({ type: 'turn.completed', usage: { input_tokens: 12, output_tokens: 4, cached_input_tokens: 3 } }) + '\\n');
    process.stderr.write('Useful stderr before inert-executor-api-');
    await delay(15);
    process.stderr.write('key-sentinel\\n');
  }
  if (state.mode === 'redaction-error') {
    state.present = true; state.running = false; save(); process.stderr.write('controlled nonzero Docker completion\\n'); process.exit(42);
  }
  if (state.mode === 'client-failure-absent' || state.mode === 'verify-client-failure-absent') {
    save(); process.stderr.write('simulated Docker client failure\\n'); process.exit(42);
  }
  if (state.mode === 'verify-present' || state.mode === 'verify-unknown') {
    state.present = true;
    state.running = true;
    save(); process.stderr.write('simulated Docker client exit while container is still running\\n'); process.exit(42);
  }
  state.present = true;
  state.running = false;
  save();
  process.exit(0);
}
if (command === 'ps') {
  if (state.listingUnknown) fail('simulated Docker listing failure');
  const filter = args[args.indexOf('--filter') + 1] || '';
  const matches = state.present && (
    filter === 'label=sdf.factory=' + state.labels['sdf.factory'] ||
    filter === 'name=^/' + state.name + '$'
  );
  output(matches ? state.id : '');
  process.exit(0);
}
if (command === 'inspect') {
  if (!state.present || args[0] !== state.id) fail('No such object');
  output(JSON.stringify([{ Id: state.id, Config: { Labels: state.labels }, State: { Running: state.running } }]));
  process.exit(0);
}
if (command === 'stop') {
  if (!state.present) fail('No such container');
  state.running = false; save(); output(state.id); process.exit(0);
}
if (command === 'rm') {
  const force = args.includes('-f');
  if (state.firstRmScratchExists === null) {
    state.firstRmScratchExists = Boolean(state.scratchPath && existsSync(state.scratchPath));
    state.firstRmMarkerExists = Boolean(state.scratchMarkerPath && existsSync(state.scratchMarkerPath));
    state.firstRmRunning = state.running;
    save();
  }
  if (!state.present) fail('No such container');
  if (!force) state.outerRemovalSawSelectedEnvironment = Boolean(state.selectedEnvironmentPath && existsSync(state.selectedEnvironmentPath));
  if (!force) state.outerRemovalSawScratch = Boolean(state.scratchPath && existsSync(state.scratchPath));
  if (force && state.mode === 'success-still-present') { output(state.id); process.exit(0); }
  if ((force && state.initialRemoveFailed) || (!force && state.outerRemoveFailed && !state.recoveryAllowed))
    fail('simulated Docker remove failure');
  state.present = false; state.running = false; save(); output(state.id); process.exit(0);
}
fail('unsupported controlled Docker operation');
`;
  writeFileSync(docker, mode === 'spawn-error-absent' ? '#!/sdf-test-missing-interpreter\n' : dockerProgram, { mode: 0o700 });
  chmodSync(docker, 0o700);

  return {
    rootDir, state, folder, attemptFolder, artifacts, output, dockerState, docker, dockerProgram, outsideReport,
    selectedEnvironment: join(attemptFolder, '.model-review.env'),
    verifyScratch: join(attemptFolder, 'check-workspace'),
    phase,
    lock: join(folder, 'active.json'),
    executorEnv: {
      ...process.env,
      PATH: `${bin}:${process.env.PATH}`,
      SDF_DOCKER_STATE: dockerState,
      SDF_JOB_ID: job,
      SDF_RUN_ID: attempt,
      SDF_OUTPUT_DIR: output,
      SDF_STEP_RESULT_PATH: join(output, 'result.json'),
      SDF_SOURCE_ADMISSION: 'null',
    },
  };
}

function runExecutor(f) {
  return spawnSync(process.execPath, [join(root, 'factory/executor.mjs'), f.state, f.phase], {
    input: 'bounded executor cleanup fixture', encoding: 'utf8', env: f.executorEnv, timeout: 30_000,
  });
}

function stateOf(f) { return JSON.parse(readFileSync(f.dockerState, 'utf8')); }

function enableRecovery(f) {
  const state = stateOf(f);
  state.listingUnknown = false;
  state.recoveryAllowed = true;
  writeFileSync(f.dockerState, JSON.stringify(state));
}

function restoreDockerClient(f) {
  writeFileSync(f.docker, f.dockerProgram, { mode: 0o700 });
  chmodSync(f.docker, 0o700);
}

function runOrdinaryRecovery(f) {
  const script = join(f.rootDir, 'reconcile.mjs');
  const module = pathToFileURL(join(root, 'factory/processes.mjs')).href;
  writeFileSync(script, `import { executors } from ${JSON.stringify(module)};\nawait executors(process.argv[2], { alive: () => false, run: () => '' }).reconcile(process.argv[3], ${JSON.stringify(f.phase)});\n`);
  return spawnSync(process.execPath, [script, f.state, job], {
    encoding: 'utf8', env: f.executorEnv, timeout: 30_000,
  });
}

test('executor retains the selected inference file and fence when removal is present or unknown, then normal recovery clears them', async t => {
  for (const mode of ['present', 'unknown', 'success-still-present']) await t.test(mode, t => {
    const f = fixture(t, mode);
    const execution = runExecutor(f);
    assert.notEqual(execution.status, 0, 'uncertain container termination blocks the executor');
    assert.equal(stateOf(f).launchSawSelectedEnvironment, true, 'the selected private env file reached the Docker launch boundary');
    assert.equal(existsSync(f.selectedEnvironment), true, 'selected inference settings remain available while the container may exist');
    assert.equal(existsSync(f.lock), true, 'the recovery fence remains until process and container shutdown are established');
    assert.doesNotMatch(execution.stdout + execution.stderr, new RegExp(inertAuth));

    enableRecovery(f);
    const recovered = runOrdinaryRecovery(f);
    assert.equal(recovered.status, 0, recovered.stderr || recovered.stdout);
    assert.equal(stateOf(f).outerRemovalSawSelectedEnvironment, true, 'the private file remains available while recovery removes the container');
    assert.equal(existsSync(f.selectedEnvironment), false, 'ordinary recovery removes the phase copy after Docker confirms absence');
    assert.equal(existsSync(f.lock), false, 'ordinary recovery clears the fence after process and container checks');
  });
});

test('confirmed successful removal cleans the selected file and fence', t => {
  const f = fixture(t, 'success');
  const execution = runExecutor(f);
  assert.equal(execution.status, 0, execution.stderr || execution.stdout);
  assert.equal(stateOf(f).launchSawSelectedEnvironment, true);
  assert.equal(stateOf(f).present, false, 'the controlled Docker client removed its container');
  assert.equal(existsSync(f.selectedEnvironment), false);
  assert.equal(existsSync(f.lock), false);
  assert.doesNotMatch(execution.stdout + execution.stderr, new RegExp(inertAuth));
});

test('mock review artifact is explicitly marked synthetic by the host executor', t => {
  const f = fixture(t, 'success', 'review', 'mock');
  const execution = runExecutor(f);
  assert.equal(execution.status, 0, execution.stderr || execution.stdout);
  assert.equal(JSON.parse(readFileSync(join(f.folder, 'review.json'), 'utf8')).synthetic, true);
  assert.equal(JSON.parse(readFileSync(join(f.output, 'review.json'), 'utf8')).synthetic, true);
});

test('outer stopContainers cleanup owns file and fence removal after inner uncertainty', t => {
  const f = fixture(t, 'outer-cleanup');
  const execution = runExecutor(f);
  assert.notEqual(execution.status, 0, 'the phase records the initial removal failure');
  assert.equal(stateOf(f).present, false, 'outer cleanup removed the container and verified absence');
  assert.equal(stateOf(f).outerRemovalSawSelectedEnvironment, true, 'outer cleanup leaves the file in place until Docker removal is confirmed');
  assert.equal(existsSync(f.selectedEnvironment), false, 'outer cleanup removes the phase file after confirmed absence');
  assert.equal(existsSync(f.lock), false, 'outer cleanup then releases the recovery fence');
  assert.doesNotMatch(execution.stdout + execution.stderr, new RegExp(inertAuth));
});

test('a Docker client failure with confirmed prelaunch absence does not leave the selected private file behind', t => {
  const f = fixture(t, 'client-failure-absent');
  const execution = runExecutor(f);
  assert.notEqual(execution.status, 0, 'the failed Docker client blocks this phase');
  const docker = stateOf(f);
  assert.equal(docker.launchAttempted, true);
  assert.equal(docker.launchSawSelectedEnvironment, true, 'the phase file existed at the attempted launch');
  assert.equal(docker.present, false, 'the controlled client failed before creating a container');
  assert.equal(existsSync(f.selectedEnvironment), false, 'the absence probe permits ordinary private-file cleanup');
  assert.equal(existsSync(f.lock), false, 'confirmed absence lets the executor release its fence');
  assert.doesNotMatch(execution.stdout + execution.stderr, new RegExp(inertAuth));
});

test('a Docker spawn error retains the file and fence until ordinary recovery confirms absence', t => {
  const f = fixture(t, 'spawn-error-absent');
  const execution = runExecutor(f);
  assert.notEqual(execution.status, 0, 'a missing Docker client blocks the phase');
  assert.equal(stateOf(f).launchAttempted, false);
  assert.equal(existsSync(f.selectedEnvironment), true, 'the failed launch cannot establish that no environment-bearing container exists');
  assert.equal(existsSync(f.lock), true, 'the executor fence survives unknown Docker availability');
  assert.doesNotMatch(execution.stdout + execution.stderr, new RegExp(inertAuth));

  restoreDockerClient(f);
  enableRecovery(f);
  const recovered = runOrdinaryRecovery(f);
  assert.equal(recovered.status, 0, recovered.stderr || recovered.stdout);
  assert.equal(existsSync(f.selectedEnvironment), false);
  assert.equal(existsSync(f.lock), false);
});

test('verify preserves scratch while shutdown is present or unknown, then recovery removes it', async t => {
  for (const mode of ['verify-present', 'verify-unknown']) await t.test(mode, t => {
    const f = fixture(t, mode, 'verify');
    const execution = runExecutor(f);
    const docker = stateOf(f);
    assert.notEqual(execution.status, 0, 'uncertain container termination blocks verification');
    assert.equal(docker.firstRmScratchExists, true, 'scratch still exists at the first Docker remove attempt');
    assert.equal(docker.firstRmMarkerExists, true, 'partial check output remains in the mounted scratch directory');
    assert.equal(docker.firstRmRunning, true, 'the Docker client exit did not imply that the container stopped');
    assert.equal(existsSync(f.verifyScratch), true, 'host cleanup waits while the container may still write scratch');
    assert.equal(existsSync(join(f.verifyScratch, 'fixture-cache', 'partial-check-output.txt')), true);
    assert.equal(existsSync(f.lock), true, 'the recovery fence remains while shutdown is uncertain');

    enableRecovery(f);
    const recovered = runOrdinaryRecovery(f);
    assert.equal(recovered.status, 0, recovered.stderr || recovered.stdout);
    assert.equal(existsSync(f.verifyScratch), false, 'confirmed recovery removes verify scratch');
    assert.equal(existsSync(join(f.verifyScratch, 'fixture-cache', 'partial-check-output.txt')), false);
    assert.equal(existsSync(f.lock), false, 'confirmed recovery releases the fence');
  });
});

test('verify removes scratch after confirmed absence on success and Docker client failure', async t => {
  for (const mode of ['success', 'verify-client-failure-absent']) await t.test(mode, t => {
    const f = fixture(t, mode, 'verify');
    const execution = runExecutor(f);
    const docker = stateOf(f);
    if (mode === 'success') assert.equal(execution.status, 0, execution.stderr || execution.stdout);
    else assert.notEqual(execution.status, 0, 'the client failure blocks verification');
    assert.equal(docker.firstRmScratchExists, true, 'scratch remains available until the absence probe follows the client exit');
    assert.equal(docker.firstRmMarkerExists, true, 'partial check output remains available through the absence probe');
    assert.equal(docker.present, false, 'the controlled case confirms that no container remains');
    assert.equal(existsSync(f.verifyScratch), false, 'confirmed absence permits scratch cleanup');
    assert.equal(existsSync(join(f.verifyScratch, 'fixture-cache', 'partial-check-output.txt')), false);
    assert.equal(existsSync(f.lock), false, 'confirmed absence permits fence cleanup');
  });
});

test('outer stopContainers cleanup removes verify scratch only after confirming shutdown', t => {
  const f = fixture(t, 'verify-outer-cleanup', 'verify');
  const execution = runExecutor(f);
  const docker = stateOf(f);
  assert.notEqual(execution.status, 0, 'the inner remove failure remains visible to the phase');
  assert.equal(docker.firstRmScratchExists, true, 'scratch survives through the inner remove attempt');
  assert.equal(docker.outerRemovalSawScratch, true, 'outer container removal still sees scratch before confirmed shutdown');
  assert.equal(docker.present, false, 'outer stopContainers cleanup confirms removal');
  assert.equal(existsSync(f.verifyScratch), false, 'outer cleanup removes scratch after shutdown confirmation');
  assert.equal(existsSync(join(f.verifyScratch, 'fixture-cache', 'partial-check-output.txt')), false);
  assert.equal(existsSync(f.lock), false, 'outer cleanup then releases the recovery fence');
});

test('verify spawn failure retains scratch until ordinary recovery confirms absence', t => {
  const f = fixture(t, 'spawn-error-absent', 'verify');
  const execution = runExecutor(f);
  assert.notEqual(execution.status, 0, 'a missing Docker client blocks verification');
  assert.equal(existsSync(f.verifyScratch), true, 'a spawn error cannot establish that the container is absent');
  assert.equal(existsSync(f.lock), true, 'the executor fence survives unknown Docker availability');

  restoreDockerClient(f);
  enableRecovery(f);
  const recovered = runOrdinaryRecovery(f);
  assert.equal(recovered.status, 0, recovered.stderr || recovered.stdout);
  assert.equal(existsSync(f.verifyScratch), false, 'confirmed recovery removes scratch after a spawn failure');
  assert.equal(existsSync(f.lock), false);
});

test('selected inference credentials are redacted from retained logs and reports after recovery confirms shutdown', t => {
  const f = fixture(t, 'redaction-uncertain');
  const execution = runExecutor(f);
  assert.notEqual(execution.status, 0, 'the first removal remains uncertain');
  assert.equal(existsSync(f.selectedEnvironment), true, 'selected credentials stay available behind the active fence');
  assert.equal(existsSync(f.lock), true);
  const logPath = join(f.attemptFolder, 'review.log');
  const logBeforeRecovery = readFileSync(logPath, 'utf8');
  assert.doesNotMatch(logBeforeRecovery, /inert-executor-(?:auth|api-key)-sentinel/);
  assert.match(logBeforeRecovery, /Useful stdout/);
  assert.match(logBeforeRecovery, /Useful stderr/);
  assert.match(logBeforeRecovery, /turn\.completed/);
  assert.match(logBeforeRecovery, /stdout=\d+ bytes stderr=\d+ bytes/);
  assert.doesNotMatch(execution.stdout + execution.stderr, /inert-executor-(?:auth|api-key)-sentinel/);
  const rawReport = join(f.attemptFolder, 'review', 'agent-report.md');
  assert.match(readFileSync(rawReport, 'utf8'), /inert-executor-auth-sentinel/, 'the mounted output remains private while its container is still present');

  enableRecovery(f);
  const recovered = runOrdinaryRecovery(f);
  assert.equal(recovered.status, 0, recovered.stderr || recovered.stdout);
  const reportAfterRecovery = readFileSync(rawReport, 'utf8');
  assert.doesNotMatch(reportAfterRecovery, /inert-executor-(?:auth|api-key)-sentinel/);
  assert.match(reportAfterRecovery, /Useful agent report/);
  const reviewAfterRecovery = JSON.parse(readFileSync(join(f.attemptFolder, 'review', 'review.json'), 'utf8'));
  assert.equal(reviewAfterRecovery.verdict, 'pass');
  assert.match(reviewAfterRecovery.summary, /Useful review content/);
  assert.doesNotMatch(JSON.stringify(reviewAfterRecovery), /inert-executor-(?:auth|api-key)-sentinel/);
  assert.equal(existsSync(f.selectedEnvironment), false);
  assert.equal(existsSync(f.lock), false);
});

async function reviewArtifactFromApi(f) {
  writeFileSync(join(f.state, 'factory.json'), JSON.stringify({ version: 1, repo: join(f.folder, 'checkout'), harness: 'codex',
    command: ['fixture-agent'], port: 7339, timeoutSeconds: 30, memoryMiB: 512, image: 'fixture/image:latest', network: 'none', check: 'true',
    scope: { project: 'fixture', service: 'fixture', environment: 'test', owner: 'operator' } }));
  writeFileSync(join(f.state, 'worker.token'), 'controlled-api-token', { mode: 0o600 });
  const controller = createController(f.state, { execute: async () => ({ outcome: 'blocked' }), stop: async () => {}, reconcile: async () => {} });
  await new Promise(resolve => controller.server.listen(0, '127.0.0.1', resolve));
  controller.queue.save({ id: job, state: 'failed', runs: [], workflow: { name: 'software', steps: [], current_step: 0 } });
  try {
    const origin = `http://127.0.0.1:${controller.server.address().port}`;
    const response = await fetch(`${origin}/api/v1/jobs/${job}/artifacts?file=${attempt}%2Freview.json`, {
      headers: { Authorization: 'Bearer controlled-api-token' },
    });
    const text = await response.text();
    assert.equal(response.status, 200, text);
    return text;
  } finally { await controller.close(); }
}

test('selected inference secrets are removed from raw and promoted review artifacts served by the API', async t => {
  const f = fixture(t, 'redaction-success');
  const execution = runExecutor(f);
  assert.equal(execution.status, 0, execution.stderr || execution.stdout);
  const rawReportPath = join(f.attemptFolder, 'review', 'agent-report.md');
  const rawReviewPath = join(f.attemptFolder, 'review', 'review.json');
  for (const path of [rawReportPath, rawReviewPath, join(f.attemptFolder, 'review.log'), join(f.folder, 'review.json'), join(f.output, 'review.json')]) {
    const content = readFileSync(path, 'utf8');
    assert.doesNotMatch(content, /inert-executor-(?:auth|api-key)-sentinel/, `${path} must not retain selected credential values`);
  }
  assert.match(readFileSync(rawReportPath, 'utf8'), /Useful agent report/);
  const review = JSON.parse(readFileSync(join(f.output, 'review.json'), 'utf8'));
  assert.equal(review.verdict, 'pass');
  assert.match(review.summary, /Useful review content/);
  assert.match(review.findings[0].note, /Key/);
  const result = JSON.parse(readFileSync(join(f.output, 'result.json'), 'utf8'));
  assert.deepEqual(result.usage, { input_tokens: '12', output_tokens: '4', cached_input_tokens: '3', source: 'codex_jsonl', coverage: 'complete' });
  assert.equal(existsSync(f.selectedEnvironment), false);
  assert.equal(existsSync(f.lock), false);

  const apiArtifact = await reviewArtifactFromApi(f);
  assert.doesNotMatch(apiArtifact, /inert-executor-(?:auth|api-key)-sentinel/);
  assert.match(apiArtifact, /Useful review content/);
  assert.equal(JSON.parse(apiArtifact).verdict, 'pass');
});

test('nonzero Docker completion still redacts reports and output before ordinary cleanup', t => {
  const f = fixture(t, 'redaction-error');
  const execution = runExecutor(f);
  assert.notEqual(execution.status, 0, 'the controlled nonzero Docker exit fails the phase');
  const log = readFileSync(join(f.attemptFolder, 'review.log'), 'utf8');
  const report = readFileSync(join(f.attemptFolder, 'review', 'agent-report.md'), 'utf8');
  assert.doesNotMatch(log + report + execution.stdout + execution.stderr, /inert-executor-(?:auth|api-key)-sentinel/);
  assert.match(log, /Useful stdout/);
  assert.match(log, /Useful stderr/);
  assert.match(report, /Useful agent report/);
  assert.match(log, /code=42/);
  assert.equal(existsSync(f.selectedEnvironment), false, 'confirmed shutdown still permits env-file cleanup');
  assert.equal(existsSync(f.lock), false, 'confirmed shutdown permits fence cleanup on an error exit');
  assert.equal(existsSync(join(f.output, 'review.json')), false, 'a failed review is not promoted');
});

test('agent-created report symlinks are rejected without changing their outside target', t => {
  const f = fixture(t, 'redaction-symlink');
  const outsideBefore = readFileSync(f.outsideReport, 'utf8');
  const execution = runExecutor(f);
  assert.notEqual(execution.status, 0, 'a symlinked report blocks promotion');
  assert.equal(stateOf(f).symlinkCreated, true, 'the controlled container created the untrusted output symlink');
  assert.equal(readFileSync(f.outsideReport, 'utf8'), outsideBefore, 'sanitization does not follow or rewrite the symlink target');
  assert.doesNotMatch(readFileSync(join(f.attemptFolder, 'review.log'), 'utf8'), /inert-executor-(?:auth|api-key)-sentinel/);
  assert.equal(existsSync(join(f.output, 'review.json')), false);
  assert.doesNotMatch(execution.stdout + execution.stderr, /inert-executor-(?:auth|api-key)-sentinel/);
});

test('oversized credential-bearing reports retain the exact recovery source and fence until repaired', t => {
  const f = fixture(t, 'redaction-oversized');
  const candidateBefore = readFileSync(join(f.folder, 'candidate.json'));
  const checksBefore = readFileSync(join(f.folder, 'checks.json'));
  const executionStarted = Date.now();
  const execution = runExecutor(f);
  assert.ok(Date.now() - executionStarted < 5000, 'oversized output fails promptly');
  assert.notEqual(execution.status, 0, 'report retention refuses the oversized worker output promptly');
  const rawReport = join(f.attemptFolder, 'review', 'agent-report.md');
  assert.ok(statSync(rawReport).size > 1024 * 1024);
  assert.match(readFileSync(rawReport, 'utf8'), /inert-executor-auth-sentinel/, 'the private unfiltered report remains available for recovery');
  assert.equal(existsSync(join(f.folder, 'review.json')), false, 'unfiltered review content is not promoted');
  assert.equal(existsSync(join(f.output, 'review.json')), false, 'unfiltered review content is not exposed as an artifact');
  assert.equal(existsSync(f.selectedEnvironment), true, 'selected credential values remain available to sanitize the owned report');
  assert.equal(existsSync(f.lock), true, 'the recovery fence remains while retained output may still contain a credential');
  assert.doesNotMatch(execution.stdout + execution.stderr, /inert-executor-(?:auth|api-key)-sentinel/);
  assert.deepEqual(readFileSync(join(f.folder, 'candidate.json')), candidateBefore, 'cleanup does not rewrite candidate identity');
  assert.deepEqual(readFileSync(join(f.folder, 'checks.json')), checksBefore, 'cleanup does not rewrite check identity');

  const refusedRecovery = runOrdinaryRecovery(f);
  assert.notEqual(refusedRecovery.status, 0, 'recovery fails closed while the report is still oversized');
  assert.equal(existsSync(f.selectedEnvironment), true, 'a failed recovery does not discard its only redaction source');
  assert.equal(existsSync(f.lock), true, 'a failed recovery keeps its retry fence');
  assert.doesNotMatch(refusedRecovery.stdout + refusedRecovery.stderr, /inert-executor-(?:auth|api-key)-sentinel/);

  writeFileSync(rawReport, 'Repaired owned report with inert-executor-auth-sentinel and useful content.\n');
  const recovered = runOrdinaryRecovery(f);
  assert.equal(recovered.status, 0, recovered.stderr || recovered.stdout);
  const sanitized = readFileSync(rawReport, 'utf8');
  assert.doesNotMatch(sanitized, /inert-executor-(?:auth|api-key)-sentinel/);
  assert.match(sanitized, /Repaired owned report/);
  assert.equal(existsSync(f.selectedEnvironment), false, 'successful ordinary recovery removes the private selected file');
  assert.equal(existsSync(f.lock), false, 'successful ordinary recovery releases the fence');
  assert.deepEqual(readFileSync(join(f.folder, 'candidate.json')), candidateBefore, 'recovery does not rewrite candidate identity');
  assert.deepEqual(readFileSync(join(f.folder, 'checks.json')), checksBefore, 'recovery does not rewrite check identity');
});
