import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { accessSync, chmodSync, constants, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { digest } from '../factory/lib.mjs';
import { createController } from '../factory/server.mjs';
import { expectedWebStories, webPolicyHash } from '../factory/web-verification.mjs';
import { qualificationWebConfig } from '../factory/web/qualification-fixture.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const job = `job_${'c'.repeat(24)}`;
const attempt = `run_${'d'.repeat(24)}`;
const inertAuth = 'inert-executor-auth-sentinel';
const inertApiKey = 'inert-executor-api-key-sentinel';

function hostExecutable(name) {
  const extensions = process.platform === 'win32' ? (process.env.PATHEXT || '.EXE;.CMD;.BAT').split(';') : [''];
  for (const directory of (process.env.PATH || '').split(delimiter).filter(Boolean)) {
    for (const extension of extensions) {
      const candidate = join(directory, `${name}${extension}`);
      try {
        accessSync(candidate, constants.X_OK);
        return realpathSync(candidate);
      } catch { /* Continue through the host PATH until the actual tool is found. */ }
    }
  }
  throw new Error(`Could not resolve required host executable ${name}`);
}

function createFallback(rootDir) {
  const fallbackBin = join(rootDir, 'fallback-bin');
  const fallbackDockerLog = join(rootDir, 'fallback-docker.log');
  mkdirSync(fallbackBin, { mode: 0o700 });
  writeFileSync(fallbackDockerLog, '', { mode: 0o600 });
  writeFileSync(join(fallbackBin, 'docker'), '#!/bin/sh\nprintf \'%s\\n\' "$*" >> "$SDF_FALLBACK_DOCKER_LOG"\nexit 0\n', { mode: 0o700 });
  chmodSync(join(fallbackBin, 'docker'), 0o700);
  return { fallbackBin, fallbackDockerLog };
}

function fixture(t, mode, phase = 'review', harness = 'codex', hostFallback = null, webVerification = null) {
  const rootDir = mkdtempSync(join(tmpdir(), 'sdf-executor-container-recovery-'));
  t.after(() => rmSync(rootDir, { recursive: true, force: true }));
  const dockerRoot = mkdtempSync(join(root, '.sdf-controlled-docker-'));
  t.after(() => rmSync(dockerRoot, { recursive: true, force: true }));
  const state = join(rootDir, 'state'), bin = join(dockerRoot, 'bin');
  const fallback = hostFallback ?? createFallback(dockerRoot);
  const { fallbackBin, fallbackDockerLog } = fallback;
  const folder = join(state, 'jobs', job), attemptFolder = join(folder, attempt);
  const artifacts = join(folder, 'artifacts', attempt), workspace = join(folder, 'checkout');
  const output = artifacts, dockerState = join(rootDir, 'docker-state.json');
  mkdirSync(attemptFolder, { recursive: true, mode: 0o700 });
  mkdirSync(artifacts, { recursive: true, mode: 0o700 });
  mkdirSync(workspace, { recursive: true, mode: 0o700 });
  mkdirSync(bin, { mode: 0o700 });

  // Keep executor and recovery command lookup independent from the machine's
  // Docker installation. Spawn-error fixtures arrange this inert fallback in
  // the surrounding PATH before executorEnv is captured below.
  for (const [name, executable] of [['node', realpathSync(process.execPath)], ['git', hostExecutable('git')], ['ps', hostExecutable('ps')]])
    symlinkSync(executable, join(bin, name));

  execFileSync('git', ['-C', workspace, 'init', '--quiet', '-b', 'main']);
  writeFileSync(join(workspace, 'fixture.txt'), 'review fixture\n');
  execFileSync('git', ['-C', workspace, 'add', 'fixture.txt']);
  execFileSync('git', ['-C', workspace, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@localhost', 'commit', '--quiet', '-m', 'Fixture']);
  const head = execFileSync('git', ['-C', workspace, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  const tree = execFileSync('git', ['-C', workspace, 'rev-parse', 'HEAD^{tree}'], { encoding: 'utf8' }).trim();

  const config = {
    harness, command: harness === 'mock' ? ['fixture-mock'] : ['fixture-agent'], image: 'fixture/image:latest',
    memoryMiB: 512, cpus: 1, network: 'none', timeoutSeconds: 30, check: 'true',
    ...(webVerification ? { webVerification } : {}),
  };
  const policyHash = digest(JSON.stringify(config));
  const execution = { phase, executor: harness, runtimeVersion: 'fixture', policyHash,
    requestedModel: harness === 'mock' ? null : 'fixture-model',
    modelSelection: harness === 'mock' ? 'not_applicable' : 'explicit' };
  writeFileSync(join(attemptFolder, 'execution-config.json'), JSON.stringify(config));
  writeFileSync(join(artifacts, 'execution.json'), JSON.stringify(execution));
  writeFileSync(join(folder, 'candidate.json'), JSON.stringify({ base: head, head, tree,
    ...(webVerification ? { build_policy_hash: policyHash } : {}) }));
  writeFileSync(join(folder, 'checks.json'), JSON.stringify({ passed: true, head, policyHash }));
  const outsideReport = join(rootDir, 'outside-report.txt');
  writeFileSync(outsideReport, `outside sentinel ${inertAuth}\n`, { mode: 0o600 });
  writeFileSync(join(state, 'model.env'), `OPENAI_API_KEY=${inertApiKey}\nFACTORY_CODEX_AUTH_JSON={"auth_mode":"fixture","tokens":{"access_token":"${inertAuth}"}}\n`, { mode: 0o600 });
  writeFileSync(dockerState, JSON.stringify({
    mode, present: false, running: false, id: 'fixture-container-id', outsideReport,
    labels: {}, initialRemoveFailed: ['present', 'unknown', 'outer-cleanup', 'verify-present', 'verify-unknown', 'verify-outer-cleanup', 'redaction-uncertain', 'web-uncertain'].includes(mode),
    outerRemoveFailed: ['present', 'success-still-present', 'verify-present', 'redaction-uncertain', 'web-uncertain'].includes(mode),
    listingUnknown: ['unknown', 'verify-unknown'].includes(mode),
    recoveryAllowed: false, launchSawSelectedEnvironment: false, launchAttempted: false,
    firstRmScratchExists: null, firstRmMarkerExists: null, firstRmRunning: null,
    webImage: webVerification?.image || null, webImagePresent: mode !== 'web-unavailable', webInput: null, webReport: null,
    webContainerRuns: [], webContainers: {}, webPolicyPath: join(attemptFolder, 'web-policy.json'), webRmObservations: [],
  }));

  const docker = join(bin, 'docker');
const dockerProgram = `#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, statSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
const statePath = process.env.SDF_DOCKER_STATE;
const state = JSON.parse(readFileSync(statePath, 'utf8'));
const [command, ...args] = process.argv.slice(2);
let stdin = '';
for await (const chunk of process.stdin) stdin += chunk;
const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
const save = () => writeFileSync(statePath, JSON.stringify(state));
const fail = (message) => { process.stderr.write(message + '\\n'); process.exit(1); };
const output = value => process.stdout.write(value ? value + '\\n' : '');
const webByName = key => Object.values(state.webContainers || {}).find(item => item.name === key || item.id === key);
const labelPairs = argv => { const result = {}; for (let i = 0; i < argv.length - 1; i++) if (argv[i] === '--label') { const [key, ...rest] = argv[i + 1].split('='); result[key] = rest.join('='); } return result; };
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
  const roleLabel = args.find(value => value.startsWith('sdf.role='));
  const webRole = roleLabel?.slice('sdf.role='.length);
  if (['web-preview', 'web-browser'].includes(webRole)) {
    const labels = labelPairs(args), entrypoint = args.indexOf('--entrypoint'), image = args[entrypoint + 2];
    const id = webRole === 'web-preview' ? 'fixture-web-preview-id' : 'fixture-web-browser-id';
    const item = { name: state.name, id, role: webRole, image, labels, running: true, present: true };
    state.webContainers[state.name] = item;
    state.webContainerRuns.push({ role: webRole, args });
    if (webRole === 'web-preview') { save(); output(id); process.exit(0); }
    const outputMountIndex = args.findIndex((value, index) => value === '--mount' && args[index + 1]?.includes('target=/browser-output'));
    const outputSource = outputMountIndex >= 0
      ? args[outputMountIndex + 1].split(',').find(value => value.startsWith('source='))
      : null;
    state.webOutputPath = outputSource?.slice('source='.length) || null;
    if (!state.webOutputPath) fail('Missing private browser output mount ' + JSON.stringify(args));
    if (state.mode === 'web-cancel') { save(); await new Promise(() => {}); }
    const web = JSON.parse(stdin);
    state.webInput = web;
    const stories = web.stories.map(story => {
      const failAt = state.mode === 'web-broken' && story.id === 'busy-disabled'
        ? story.steps.findIndex(step => step.op === 'expect-disabled')
        : state.mode === 'web-result-broken' && story.id === 'result'
          ? story.steps.findIndex(step => step.op === 'expect-text') : -1;
      const trace = [];
      for (let index = 0; index < story.steps.length; index++) {
        const step = story.steps[index], status = index === failAt ? 'failed' : 'passed';
        trace.push({ index, op: step.op, ...(step.op === 'press' ? { key: step.key } : { role: step.role, name: step.name }),
          ...(step.op === 'expect-text' ? { expectedText: step.text } : {}), status, durationMs: 12,
          ...(status === 'failed' ? { message: story.id === 'result' ? 'Controlled broken result text' : 'Controlled broken busy state' } : {}) });
        if (status === 'failed') break;
      }
      const screenshot = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
      const file = 'web-story-' + story.id + '.png';
      writeFileSync(state.webOutputPath + '/' + file, screenshot, { mode: 0o600 });
      return { id: story.id, contentHash: story.contentHash, status: failAt >= 0 ? 'failed' : 'passed', durationMs: 12,
        trace, screenshot: { file, sha256: createHash('sha256').update(screenshot).digest('hex'), bytes: screenshot.length },
        ...(failAt >= 0 ? { message: story.id === 'result' ? 'Controlled broken result text' : 'Controlled broken busy state' } : {}) };
    });
    state.webReport = { version: 1, status: stories.some(story => story.status === 'failed') ? 'failed' : 'passed', job: web.job, attempt: web.attempt, head: web.head,
      tree: web.tree, policyHash: web.policyHash, webPolicyHash: web.webPolicyHash,
      tool: { adapter: web.adapter, version: web.version, browser: 'chromium', image: web.image,
        platform: 'linux-container', coverage: 'web', browserVersion: '153.0.8010.12' },
      stories };
    writeFileSync(state.webOutputPath + '/result.json', JSON.stringify(state.webReport));
    item.running = false; save(); process.exit(0);
  }
  const mountArgs = [];
  for (let i = 0; i < args.length - 1; i++) if (args[i] === '--mount') mountArgs.push(args[i + 1]);
  const scratchMount = mountArgs.find(value => /(?:^|,)target=\\/scratch(?:,|$)/.test(value));
  state.scratchPath = scratchMount?.match(/(?:^|,)source=([^,]+),target=\\/scratch(?:,|$)/)?.[1] ?? null;
  if (state.scratchPath) {
    const cache = state.scratchPath + '/fixture-cache';
    mkdirSync(cache, { recursive: true });
    state.scratchMarkerPath = cache + '/partial-check-output.txt';
    if (!existsSync(state.scratchMarkerPath)) {
      writeFileSync(state.scratchMarkerPath, 'controlled partial check output\\n');
      chmodSync(cache, 0o500);
    }
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
if (command === 'info') { output('linux'); process.exit(0); }
if (command === 'image' && args[0] === 'inspect') {
  if (!state.webImagePresent || !state.webImage || args.at(-1) !== state.webImage) fail('No such image');
  output(state.webImage); process.exit(0);
}
if (command === 'ps') {
  if (state.listingUnknown) fail('simulated Docker listing failure');
  const filter = args[args.indexOf('--filter') + 1] || '';
  const legacyMatch = state.present && (
    filter === 'label=sdf.factory=' + state.labels['sdf.factory'] ||
    filter === 'name=^/' + state.name + '$'
  );
  const webMatches = Object.values(state.webContainers || {}).filter(item => item.present && (
    filter === 'label=sdf.factory=' + item.labels['sdf.factory'] || filter === 'name=^/' + item.name + '$'
  ));
  output([...(legacyMatch ? [state.id] : []), ...webMatches.map(item => item.id)].join('\\n'));
  process.exit(0);
}
if (command === 'inspect') {
  const webItem = webByName(args[0]);
  if (webItem?.present) {
    output(JSON.stringify([{ Id: webItem.id, Name: '/' + webItem.name, Image: webItem.image,
      Config: { Labels: webItem.labels }, State: { Running: webItem.running } }]));
    process.exit(0);
  }
  if (args[0] === state.name) {
    output(JSON.stringify([{ Id: state.id, Name: '/' + state.name, Image: 'fixture/image:latest', Config: { Labels: state.labels }, State: { Running: state.running } }]));
    process.exit(0);
  }
  if (!state.present || args[0] !== state.id) fail('No such object');
  output(JSON.stringify([{ Id: state.id, Config: { Labels: state.labels }, State: { Running: state.running } }]));
  process.exit(0);
}
if (command === 'stop') {
  const webItem = webByName(args.at(-1));
  if (webItem?.present) { webItem.running = false; save(); output(webItem.id); process.exit(0); }
  if (!state.present) fail('No such container');
  state.running = false; save(); output(state.id); process.exit(0);
}
if (command === 'rm') {
  const force = args.includes('-f');
  const webItem = webByName(args.at(-1));
  if (webItem?.present) {
    state.webRmObservations.push({ role: webItem.role, force, policyExists: existsSync(state.webPolicyPath),
      scratchExists: Boolean(state.scratchPath && existsSync(state.scratchPath)),
      outputExists: existsSync(state.webOutputPath || '') });
    save();
    if (state.mode === 'web-uncertain' && webItem.role === 'web-browser' && !state.recoveryAllowed)
      fail('simulated browser container remove failure');
    webItem.present = false; webItem.running = false; save(); output(webItem.id); process.exit(0);
  }
  if (state.name?.endsWith('-web')) {
    state.webRmObservations.push({ force, policyExists: existsSync(state.webPolicyPath), scratchExists: Boolean(state.scratchPath && existsSync(state.scratchPath)) });
    save();
  }
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
  const failOnlyWebCleanup = state.mode === 'web-uncertain' && state.name?.endsWith('-web');
  if ((force && state.initialRemoveFailed && (state.mode !== 'web-uncertain' || failOnlyWebCleanup))
    || (!force && state.outerRemoveFailed && !state.recoveryAllowed && (state.mode !== 'web-uncertain' || failOnlyWebCleanup)))
    fail('simulated Docker remove failure');
  state.present = false; state.running = false; save(); output(state.id); process.exit(0);
}
fail('unsupported controlled Docker operation');
`;
  writeFileSync(docker, mode === 'spawn-error-absent' ? '#!/sdf-test-missing-interpreter\n' : dockerProgram, { mode: 0o700 });
  chmodSync(docker, 0o700);

  const parentPathAtCapture = process.env.PATH ?? '';
  const executorEnv = {
    ...process.env,
    PATH: bin,
    SDF_FALLBACK_DOCKER_LOG: fallbackDockerLog,
    SDF_DOCKER_STATE: dockerState,
    SDF_JOB_ID: job,
    SDF_RUN_ID: attempt,
    SDF_OUTPUT_DIR: output,
    SDF_STEP_RESULT_PATH: join(output, 'result.json'),
    SDF_SOURCE_ADMISSION: 'null',
  };

  return {
    rootDir, state, folder, attemptFolder, artifacts, output, dockerState, docker, dockerProgram, outsideReport, fallbackBin, fallbackDockerLog,
    selectedEnvironment: join(attemptFolder, '.model-review.env'),
    webPolicyPath: join(attemptFolder, 'web-policy.json'),
    verifyScratch: join(attemptFolder, 'check-workspace'),
    phase,
    lock: join(folder, 'active.json'),
    parentPathAtCapture,
    executorEnv,
  };
}

function withHostFallback(t, mode, action, phase = 'review') {
  const fallbackRoot = mkdtempSync(join(root, '.sdf-spawn-error-host-fallback-'));
  t.after(() => rmSync(fallbackRoot, { recursive: true, force: true }));
  const fallback = createFallback(fallbackRoot);
  const previousPath = process.env.PATH;
  process.env.PATH = [fallback.fallbackBin, previousPath].filter(Boolean).join(delimiter);
  try {
    const f = fixture(t, mode, phase, 'codex', fallback);
    assertHostFallbackIsolation(f);
    return action(f);
  } finally {
    if (previousPath === undefined) delete process.env.PATH;
    else process.env.PATH = previousPath;
  }
}

function runExecutor(f) {
  return spawnSync(process.execPath, [join(root, 'factory/executor.mjs'), f.state, f.phase], {
    input: 'bounded executor cleanup fixture', encoding: 'utf8', env: f.executorEnv, timeout: 30_000,
  });
}

function assertHostFallbackIsolation(f) {
  assert.equal(f.parentPathAtCapture.split(delimiter)[0], f.fallbackBin, 'the inert fallback was present in the surrounding PATH when executorEnv was captured');
  assert.equal(f.executorEnv.PATH.split(delimiter).includes(f.fallbackBin), false, 'executor lookup remains limited to fixture-owned tools');
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
  withHostFallback(t, 'spawn-error-absent', f => {
    const execution = runExecutor(f);
    assert.notEqual(execution.status, 0, 'a missing Docker client blocks the phase');
    assert.equal(stateOf(f).launchAttempted, false);
    assert.equal(existsSync(f.selectedEnvironment), true, 'the failed launch cannot establish that no environment-bearing container exists');
    assert.equal(existsSync(f.lock), true, 'the executor fence survives unknown Docker availability');
    assert.equal(readFileSync(f.fallbackDockerLog, 'utf8'), '', 'the inert Docker fallback in the surrounding PATH was not invoked');
    assert.doesNotMatch(execution.stdout + execution.stderr, new RegExp(inertAuth));

    restoreDockerClient(f);
    enableRecovery(f);
    const recovered = runOrdinaryRecovery(f);
    assert.equal(recovered.status, 0, recovered.stderr || recovered.stdout);
    assert.equal(existsSync(f.selectedEnvironment), false);
    assert.equal(existsSync(f.lock), false);
    assert.equal(readFileSync(f.fallbackDockerLog, 'utf8'), '', 'ordinary recovery used the restored controlled Docker client');
  });
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
  withHostFallback(t, 'spawn-error-absent', f => {
    const execution = runExecutor(f);
    assert.notEqual(execution.status, 0, 'a missing Docker client blocks verification');
    assert.equal(existsSync(f.verifyScratch), true, 'a spawn error cannot establish that the container is absent');
    assert.equal(existsSync(f.lock), true, 'the executor fence survives unknown Docker availability');
    assert.equal(readFileSync(f.fallbackDockerLog, 'utf8'), '', 'the inert Docker fallback in the surrounding PATH was not invoked');

    restoreDockerClient(f);
    enableRecovery(f);
    const recovered = runOrdinaryRecovery(f);
    assert.equal(recovered.status, 0, recovered.stderr || recovered.stdout);
    assert.equal(existsSync(f.verifyScratch), false, 'confirmed recovery removes scratch after a spawn failure');
    assert.equal(existsSync(f.lock), false);
    assert.equal(readFileSync(f.fallbackDockerLog, 'utf8'), '', 'ordinary recovery used the restored controlled Docker client');
  }, 'verify');
});

test('trusted web Verify records bound traces and screenshots after both containers stop, and blocks broken or unavailable capability', async t => {
  const browserImage = `sha256:${'a'.repeat(64)}`;
  const web = qualificationWebConfig(browserImage);
  const f = fixture(t, 'web-pass', 'verify', 'mock', null, web);
  const execution = runExecutor(f);
  assert.equal(execution.status, 0, JSON.stringify({ stderr: execution.stderr, stdout: execution.stdout,
    docker: stateOf(f), webLog: existsSync(join(f.attemptFolder, 'web.log')) ? readFileSync(join(f.attemptFolder, 'web.log'), 'utf8') : null,
    checks: existsSync(join(f.folder, 'checks.json')) ? JSON.parse(readFileSync(join(f.folder, 'checks.json'), 'utf8')) : null }));
  const docker = stateOf(f), checks = JSON.parse(readFileSync(join(f.folder, 'checks.json'), 'utf8'));
  assert.equal(checks.passed, true);
  assert.equal(checks.web_verification.status, 'passed');
  assert.deepEqual(checks.web_verification.stories.map(story => story.contentHash), expectedWebStories(web).map(story => story.contentHash));
  assert.equal(checks.web_verification.webPolicyHash, webPolicyHash(web));
  assert.deepEqual(docker.webRmObservations.slice(0, 2).map(item => item.role), ['web-browser', 'web-preview']);
  assert(docker.webRmObservations.slice(0, 2).every(item => item.policyExists && item.scratchExists),
    'policy and preview scratch survive each exact container removal');
  assert(docker.webRmObservations[0].outputExists, 'browser output remains mounted through browser-container removal');
  const preview = docker.webContainerRuns.find(item => item.role === 'web-preview').args;
  const browser = docker.webContainerRuns.find(item => item.role === 'web-browser').args;
  for (const args of [preview, browser]) {
    assert.equal(args.includes('--privileged'), false);
    assert.equal(args.includes('--cap-drop=ALL'), true);
    assert.equal(args.some(value => value.startsWith('--cap-add')), false);
    assert.equal(args[args.indexOf('--user') + 1], `${process.getuid()}:${process.getgid()}`);
    assert.equal(args.some(value => value.includes('docker.sock')), false);
    assert.equal(args.includes('--env-file'), false, 'neither container receives model credentials');
  }
  assert(preview.includes('--network=none'));
  assert(preview.some(value => value.includes('target=/workspace,readonly')));
  assert(preview.some(value => value.includes('target=/scratch')));
  assert.equal(preview.some(value => value.includes('target=/browser-output')), false);
  assert.equal(browser[browser.indexOf('--network') + 1], `container:${docker.webContainerRuns.find(item => item.role === 'web-preview').args[docker.webContainerRuns.find(item => item.role === 'web-preview').args.indexOf('--name') + 1]}`);
  assert.equal(browser.some(value => value.includes('target=/workspace') || value.includes('target=/scratch') || value.includes('target=/output')), false);
  assert(browser.some(value => value.includes('target=/browser-output')));
  assert.equal(typeof docker.webInput.deadlineAt, 'number');
  assert.equal(Object.hasOwn(docker.webInput, 'outputToken'), false);
  assert.equal(existsSync(f.verifyScratch), false, 'confirmed browser shutdown releases its writable scratch');
  assert.equal(existsSync(join(f.attemptFolder, 'web-output')), false, 'confirmed browser shutdown releases the separate result mount');
  assert.equal(existsSync(f.webPolicyPath), false, 'confirmed browser shutdown releases its private runner input');
  assert.equal(existsSync(f.lock), false, 'confirmed browser shutdown releases the recovery fence');
  const artifact = JSON.parse(readFileSync(join(f.output, 'web-verification.json'), 'utf8'));
  assert.equal(artifact.attempt, attempt);
  assert.equal(artifact.head, checks.head);
  assert.equal(artifact.policyHash, checks.policyHash);
  assert(artifact.stories.every(story => story.trace.length > 0 && story.screenshot?.file));
  assert(existsSync(join(f.output, artifact.stories[0].screenshot.file)), 'controller-promoted screenshot is retained as a private artifact');

  const broken = fixture(t, 'web-broken', 'verify', 'mock', null, web);
  const brokenRun = runExecutor(broken);
  assert.notEqual(brokenRun.status, 0, 'a failed frozen busy-state story blocks Verify');
  const brokenEvidence = JSON.parse(readFileSync(join(broken.folder, 'checks.json'), 'utf8')).web_verification;
  assert.equal(brokenEvidence.status, 'failed');
  assert.equal(brokenEvidence.stories.find(story => story.id === 'busy-disabled').status, 'failed');
  assert(brokenEvidence.stories.find(story => story.id === 'busy-disabled').screenshot?.file);
  assert.equal(existsSync(join(broken.folder, 'accepted.json')), false);

  const unavailable = fixture(t, 'web-unavailable', 'verify', 'mock', null, web);
  const unavailableRun = runExecutor(unavailable);
  assert.notEqual(unavailableRun.status, 0, 'missing browser image blocks required verification');
  const unavailableChecks = JSON.parse(readFileSync(join(unavailable.folder, 'checks.json'), 'utf8'));
  assert.equal(unavailableChecks.passed, false);
  assert.equal(unavailableChecks.web_verification.status, 'unavailable');
  assert(unavailableChecks.web_verification.stories.every(story => story.status === 'unavailable'));
  assert.equal(stateOf(unavailable).webContainerRuns.length, 0, 'missing capability is never replaced with another tool');
  assert.equal(existsSync(join(unavailable.folder, 'accepted.json')), false);

  const brokenResult = fixture(t, 'web-result-broken', 'verify', 'mock', null, web);
  const brokenResultRun = runExecutor(brokenResult);
  assert.notEqual(brokenResultRun.status, 0, 'a failed frozen result story blocks Verify');
  const resultEvidence = JSON.parse(readFileSync(join(brokenResult.folder, 'checks.json'), 'utf8')).web_verification;
  assert.equal(resultEvidence.stories.find(story => story.id === 'result').status, 'failed');
  assert(resultEvidence.stories.find(story => story.id === 'result').trace.some(event => event.status === 'failed'));
  assert(resultEvidence.stories.find(story => story.id === 'result').screenshot?.file);
  assert.equal(existsSync(join(brokenResult.folder, 'accepted.json')), false);
});

test('uncertain browser-container cleanup retains story input, scratch and the Verify fence for recovery', t => {
  const browserImage = `sha256:${'b'.repeat(64)}`;
  const web = qualificationWebConfig(browserImage);
  const f = fixture(t, 'web-uncertain', 'verify', 'mock', null, web);
  const execution = runExecutor(f);
  assert.notEqual(execution.status, 0, 'the Verify process cannot release state while Docker cleanup is uncertain');
  const docker = stateOf(f);
  const browserContainer = Object.values(docker.webContainers).find(item => item.role === 'web-browser');
  assert.equal(browserContainer.present, true, 'the controlled browser container remains for recovery');
  assert(docker.webRmObservations.some(item => item.role === 'web-browser' && item.force && item.policyExists && item.scratchExists),
    `initial exact-name cleanup sees the retained input and scratch: ${JSON.stringify({ observations: docker.webRmObservations, result: execution.stderr })}`);
  assert(docker.webRmObservations.some(item => item.role === 'web-preview' && item.force && item.policyExists && item.scratchExists),
    'the preview is also reconciled before scratch release');
  assert(docker.webRmObservations.some(item => item.role === 'web-browser' && !item.force && item.policyExists && item.scratchExists),
    'outer recovery also retains both mounts while browser removal is uncertain');
  assert.equal(existsSync(f.webPolicyPath), true, JSON.stringify({ path: f.webPolicyPath, observations: docker.webRmObservations, stderr: execution.stderr }));
  assert.equal(existsSync(f.verifyScratch), true);
  assert.equal(existsSync(join(f.attemptFolder, 'web-output')), true);
  assert.equal(existsSync(f.lock), true);

  enableRecovery(f);
  const recovered = runOrdinaryRecovery(f);
  assert.equal(recovered.status, 0, recovered.stderr || recovered.stdout);
  assert.equal(existsSync(f.webPolicyPath), false, 'normal reconciliation removes the protected input only after Docker confirms absence');
  assert.equal(existsSync(f.verifyScratch), false, 'normal reconciliation removes scratch only after Docker confirms absence');
  assert.equal(existsSync(join(f.attemptFolder, 'web-output')), false, 'normal recovery removes browser output after both containers stop');
  assert.equal(existsSync(f.lock), false, 'normal reconciliation releases the matching attempt fence');
});

test('cancelling a live browser run and restarting reconciles both exact containers before releasing state', async t => {
  const browserImage = `sha256:${'c'.repeat(64)}`;
  const web = qualificationWebConfig(browserImage);
  const f = fixture(t, 'web-cancel', 'verify', 'mock', null, web);
  const child = spawn(process.execPath, [join(root, 'factory/executor.mjs'), f.state, f.phase], {
    detached: true, stdio: ['pipe', 'ignore', 'ignore'], env: f.executorEnv,
  });
  child.stdin.end('bounded executor cancellation fixture');
  let settled = false;
  t.after(() => { if (!settled) { try { process.kill(-child.pid, 'SIGKILL'); } catch {} } });
  const closed = new Promise(resolve => child.once('close', (code, signal) => { settled = true; resolve({ code, signal }); }));
  const deadline = Date.now() + 10_000;
  let browserStarted = false;
  while (Date.now() < deadline) {
    const state = stateOf(f);
    if (Object.values(state.webContainers).some(item => item.role === 'web-browser' && item.present)) {
      browserStarted = true;
      break;
    }
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  assert.equal(browserStarted, true, 'both isolated containers start before cancellation');
  const beforeCancel = stateOf(f);
  assert.deepEqual(Object.values(beforeCancel.webContainers).map(item => item.role).sort(), ['web-browser', 'web-preview']);
  assert(Object.values(beforeCancel.webContainers).every(item => item.present && item.running));
  assert.equal(existsSync(f.webPolicyPath), true);
  assert.equal(existsSync(f.verifyScratch), true);
  assert.equal(existsSync(join(f.attemptFolder, 'web-output')), true);
  assert.equal(existsSync(f.lock), true);

  process.kill(-child.pid, 'SIGTERM');
  let closeTimer;
  const stopped = await Promise.race([closed, new Promise((_, reject) => {
    closeTimer = setTimeout(() => reject(new Error('cancelled executor did not stop')), 10_000);
  })]);
  clearTimeout(closeTimer);
  assert.equal(stopped.signal, 'SIGTERM');
  assert.equal(settled, true);
  assert.equal(existsSync(f.webPolicyPath), true, 'cancellation leaves private story input for restart reconciliation');
  assert.equal(existsSync(f.verifyScratch), true, 'cancellation does not release preview scratch early');
  assert.equal(existsSync(join(f.attemptFolder, 'web-output')), true, 'cancellation does not release browser output early');
  assert.equal(existsSync(f.lock), true, 'cancellation preserves the execution fence until restart reconciliation');

  const recovered = runOrdinaryRecovery(f);
  assert.equal(recovered.status, 0, recovered.stderr || recovered.stdout);
  const afterRecovery = stateOf(f);
  assert.deepEqual(afterRecovery.webRmObservations.map(item => item.role).sort(), ['web-browser', 'web-preview']);
  assert(afterRecovery.webRmObservations.every(item => item.policyExists && item.scratchExists && item.outputExists),
    'restart stops both exact browser and preview containers while their mounts and fence remain private');
  assert(Object.values(afterRecovery.webContainers).every(item => !item.present && !item.running));
  assert.equal(existsSync(f.webPolicyPath), false);
  assert.equal(existsSync(f.verifyScratch), false);
  assert.equal(existsSync(join(f.attemptFolder, 'web-output')), false);
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
