import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { digest } from '../factory/lib.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const job = `job_${'c'.repeat(24)}`;
const attempt = `run_${'d'.repeat(24)}`;
const inertAuth = 'inert-executor-auth-sentinel';

function fixture(t, mode) {
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
    harness: 'codex', command: ['fixture-agent'], image: 'fixture/image:latest',
    memoryMiB: 512, cpus: 1, network: 'none', timeoutSeconds: 30,
  };
  const policyHash = digest(JSON.stringify(config));
  const execution = { phase: 'review', executor: 'codex', runtimeVersion: 'fixture', policyHash, requestedModel: 'fixture-model' };
  writeFileSync(join(attemptFolder, 'execution-config.json'), JSON.stringify(config));
  writeFileSync(join(artifacts, 'execution.json'), JSON.stringify(execution));
  writeFileSync(join(folder, 'candidate.json'), JSON.stringify({ base: head, head, tree }));
  writeFileSync(join(folder, 'checks.json'), JSON.stringify({ passed: true, head, policyHash }));
  writeFileSync(join(state, 'model.env'), `FACTORY_CODEX_AUTH_JSON={"auth_mode":"fixture","tokens":{"access_token":"${inertAuth}"}}\n`, { mode: 0o600 });
  writeFileSync(dockerState, JSON.stringify({
    mode, present: false, running: false, id: 'fixture-container-id',
    labels: {}, initialRemoveFailed: mode === 'present' || mode === 'unknown' || mode === 'outer-cleanup',
    outerRemoveFailed: mode === 'present' || mode === 'success-still-present', listingUnknown: mode === 'unknown',
    recoveryAllowed: false, launchSawSelectedEnvironment: false, launchAttempted: false,
  }));

  const docker = join(bin, 'docker');
  const dockerProgram = `#!/usr/bin/env node
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
const statePath = process.env.SDF_DOCKER_STATE;
const state = JSON.parse(readFileSync(statePath, 'utf8'));
const [command, ...args] = process.argv.slice(2);
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
    && (statSync(envPath).mode & 0o777) === 0o600);
  const nameIndex = args.indexOf('--name');
  state.name = nameIndex >= 0 ? args[nameIndex + 1] : null;
  state.labels = Object.fromEntries(args.filter(value => value.startsWith('sdf.')).map(value => value.split('=')));
  const mountArgs = [];
  for (let i = 0; i < args.length - 1; i++) if (args[i] === '--mount') mountArgs.push(args[i + 1]);
  const outputMount = mountArgs.find(value => /(?:^|,)target=\\/output(?:,|$)/.test(value));
  const outputDir = outputMount?.match(/(?:^|,)source=([^,]+),target=\\/output(?:,|$)/)?.[1];
  if (outputDir) {
    writeFileSync(outputDir + '/review.json', JSON.stringify({ verdict: 'pass', summary: 'Controlled executor fixture', findings: [] }));
    writeFileSync(outputDir + '/agent-report.md', 'Controlled executor fixture.\\n');
  }
  if (state.mode === 'client-failure-absent') {
    save(); process.stderr.write('simulated Docker client failure\\n'); process.exit(42);
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
  if (!state.present) fail('No such container');
  if (!force) state.outerRemovalSawSelectedEnvironment = Boolean(state.selectedEnvironmentPath && existsSync(state.selectedEnvironmentPath));
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
    rootDir, state, folder, attemptFolder, artifacts, output, dockerState, docker, dockerProgram,
    selectedEnvironment: join(attemptFolder, '.model-review.env'),
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
  return spawnSync(process.execPath, [join(root, 'factory/executor.mjs'), f.state, 'review'], {
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
  writeFileSync(script, `import { executors } from ${JSON.stringify(module)};\nawait executors(process.argv[2], { alive: () => false, run: () => '' }).reconcile(process.argv[3], 'review');\n`);
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
