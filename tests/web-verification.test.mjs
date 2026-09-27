import test from 'node:test';
import assert from 'node:assert/strict';
import { validateWebVerification, expectedWebStories, makeUnavailableWebEvidence, webEvidenceSummary,
  assertCurrentWebEvidence, webPolicyHash } from '../factory/web-verification.mjs';
import { executionProfile } from '../factory/execution-profile.mjs';
import { assertCurrentHandoffEvidence } from '../factory/execution-evidence.mjs';
import { readinessDockerArgs, probeWebBrowser } from '../factory/web-readiness.mjs';
import { qualificationWebConfig } from '../factory/web/qualification-fixture.mjs';
import { digest, instanceLabel } from '../factory/lib.mjs';

const image = `sha256:${'a'.repeat(64)}`;
const job = `job_${'b'.repeat(24)}`;
const attempt = `run_${'c'.repeat(24)}`;
const head = 'd'.repeat(40), tree = 'e'.repeat(40), policyHash = 'f'.repeat(64);
const meta = { head, tree, build_policy_hash: policyHash };
const web = qualificationWebConfig(image);
const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

function passedEvidence(configuration = web) {
  return {
    version: 1, status: 'passed', job, attempt, head, tree, policyHash,
    webPolicyHash: webPolicyHash(configuration),
    tool: { adapter: configuration.adapter, version: configuration.version, browser: 'chromium',
      browserVersion: '153.0.8010.12', image: configuration.image, platform: 'linux-container', coverage: 'web' },
    stories: expectedWebStories(configuration).map((story, index) => {
      const spec = configuration.stories[index];
      return { ...story, status: 'passed', durationMs: 10,
        trace: spec.steps.map((step, stepIndex) => ({ index: stepIndex, op: step.op,
          ...(step.op === 'press' ? { key: step.key } : { role: step.role, name: step.name }),
          ...(step.op === 'expect-text' ? { expectedText: step.text } : {}), status: 'passed', durationMs: 1 })),
        screenshot: { file: `web-story-${story.id}.png`, sha256: digest(png), bytes: png.length } };
    }),
  };
}

test('trusted browser policy requires the named desktop/narrow themes and interaction stories', () => {
  assert.deepEqual(validateWebVerification(undefined), { enabled: false });
  assert.deepEqual(validateWebVerification({ enabled: false }), { enabled: false });
  assert.equal(validateWebVerification(web).enabled, true);
  const missing = structuredClone(web);
  missing.stories = missing.stories.filter(story => story.id !== 'failure-retry');
  assert.throws(() => validateWebVerification(missing), /required named stories|failure-retry/);
  const staleResult = structuredClone(web);
  staleResult.stories.find(story => story.id === 'busy-disabled').steps.reverse();
  assert.throws(() => validateWebVerification(staleResult), /busy-disabled story/);
  const shell = structuredClone(web);
  shell.stories[0].steps[0] = { op: 'evaluate', script: 'return true' };
  assert.throws(() => validateWebVerification(shell), /unsupported story operation/);
  assert.throws(() => validateWebVerification({ ...web, image: 'playwright:latest' }), /immutable local Docker image ID/);
});

test('execution profile freezes the browser image, tool and story-content hashes into attempt policy', () => {
  const config = { harness: 'mock', command: ['mock'], image, webVerification: web };
  const profile = executionProfile(config, 'verify');
  assert.equal(profile.webVerification.adapter, 'playwright');
  assert.equal(profile.webVerification.version, '1.63.0');
  assert.equal(profile.webVerification.image, image);
  assert.deepEqual(profile.webVerification.requiredStories, expectedWebStories(web));
  const changed = structuredClone(web);
  changed.stories[0].steps[0].name = 'Other action';
  assert.notEqual(executionProfile({ ...config, webVerification: changed }, 'verify').policyHash, profile.policyHash);
  assert.notEqual(executionProfile({ ...config, webVerification: changed }, 'verify').webVerification.policyHash,
    profile.webVerification.policyHash);
});

test('only exact passed story evidence can reach Review, handoff and current policy acceptance', () => {
  const evidence = passedEvidence();
  assert.equal(assertCurrentWebEvidence(web, evidence, { job, attempt, meta, policyHash }), undefined);
  for (const mutate of [
    copy => { copy.head = '0'.repeat(40); },
    copy => { copy.attempt = `run_${'9'.repeat(24)}`; },
    copy => { copy.policyHash = '0'.repeat(64); },
    copy => { copy.stories[0].contentHash = '0'.repeat(64); },
    copy => { copy.stories[0].status = 'unavailable'; },
    copy => { copy.tool.browserVersion = ''; },
  ]) {
    const changed = structuredClone(evidence); mutate(changed);
    assert.throws(() => assertCurrentWebEvidence(web, changed, { job, attempt, meta, policyHash }));
  }
  const checks = { passed: true, run_id: attempt, head, tree, policyHash, web_verification: evidence };
  const review = { verdict: 'pass', head, tree, policyHash };
  assert.equal(assertCurrentHandoffEvidence(meta, checks, review, policyHash, { webVerification: web }, job), undefined);
  assert.throws(() => assertCurrentHandoffEvidence(meta, { ...checks, web_verification: undefined }, review,
    policyHash, { webVerification: web }, job), /browser evidence/);
  const changedPolicy = structuredClone(web); changedPolicy.stories[0].steps[0].name = 'Changed trusted story';
  assert.throws(() => assertCurrentWebEvidence(changedPolicy, evidence, { job, attempt, meta, policyHash }));
  assert.equal(assertCurrentWebEvidence(undefined, undefined, { job, attempt, meta, policyHash }), undefined,
    'an installation with the optional capability disabled keeps its existing gate');
});

test('missing browser capability is explicitly unavailable and never passes', () => {
  const unavailable = makeUnavailableWebEvidence({ job, attempt, meta, policyHash, webVerification: web,
    reason: 'Pinned image missing' });
  assert.equal(unavailable.status, 'unavailable');
  assert.equal(unavailable.head, head);
  assert.equal(unavailable.attempt, attempt);
  assert.equal(unavailable.webPolicyHash, webPolicyHash(web));
  assert(unavailable.stories.every(story => story.status === 'unavailable' && story.contentHash));
  assert.equal(webEvidenceSummary(unavailable).status, 'unavailable');
  assert.throws(() => assertCurrentWebEvidence(web, unavailable, { job, attempt, meta, policyHash }));
});

test('readiness runs the pinned image with network none and reconciles exact probe cleanup', () => {
  const configuration = { webVerification: web };
  const probeState = '/private/state/test';
  const args = readinessDockerArgs(configuration, probeState, 'sdf-fixture-web-probe');
  assert.equal(args.name, 'sdf-fixture-web-probe');
  assert(args.args.includes('--network=none'));
  assert(args.args.includes('--read-only'));
  assert(args.args.includes('--cap-drop=ALL'));
  assert(args.args.includes('30s'));
  assert(args.args.includes(image));
  assert(!args.args.some(value => value.includes('docker.sock')));
  let present = false, calls = [], launchedName, labels = {};
  const dockerRun = (command, argv) => {
    calls.push([command, argv]);
    if (argv[0] === 'image') return image;
    if (argv[0] === 'run') {
      present = true;
      launchedName = argv[argv.indexOf('--name') + 1];
      labels = Object.fromEntries(argv.flatMap((value, index) => value === '--label' ? [argv[index + 1].split('=')] : []));
      return JSON.stringify({ adapter: 'playwright', version: '1.63.0', browser: 'chromium', browserVersion: '153.0.8010.12', platform: 'linux-container', interaction: 'passed' });
    }
    if (argv[0] === 'inspect') return JSON.stringify([{ Name: `/${launchedName}`, Image: image, State: { Running: false }, Config: { Labels: labels } }]);
    if (argv[0] === 'rm') { present = false; return ''; }
    if (argv[0] === 'ps') return present ? 'unexpected-probe-id' : '';
    throw new Error(`Unexpected Docker operation ${argv[0]}`);
  };
  const ready = probeWebBrowser(configuration, probeState, { dockerRun });
  assert.equal(ready.ready, true);
  assert.equal(ready.interaction, 'passed');
  assert.equal(present, false, 'readiness probe container was confirmed absent');
  assert.equal(calls.some(([, argv]) => ['pull', 'build'].includes(argv[0])), false, 'readiness never installs a missing image');
  const runArgs = calls.find(([, argv]) => argv[0] === 'run')[1];
  assert(runArgs.includes('--label'));
  const deadline = runArgs.find((value, index) => value === '--label' && runArgs[index + 1]?.startsWith('sdf.deadline='));
  assert(deadline);
  assert(Number(labels['sdf.deadline']) > Date.now(), 'readiness has an active wall-clock deadline');
  assert.equal(runArgs[runArgs.indexOf('--user') + 1], `${process.getuid()}:${process.getgid()}`);
  assert.equal(runArgs.includes('--user=0:0'), false);
  assert.equal(runArgs.some(value => value.startsWith('--cap-add')), false);
});

test('failed actual browser probe is unavailable and still removes the exact probe container', () => {
  let present = false, launchedName, labels = {};
  const dockerRun = (_command, argv) => {
    if (argv[0] === 'image') return image;
    if (argv[0] === 'run') {
      present = true; launchedName = argv[argv.indexOf('--name') + 1];
      labels = Object.fromEntries(argv.flatMap((value, index) => value === '--label' ? [argv[index + 1].split('=')] : []));
      return JSON.stringify({ interaction: 'failed' });
    }
    if (argv[0] === 'inspect') return JSON.stringify([{ Name: `/${launchedName}`, Image: image, State: { Running: false }, Config: { Labels: labels } }]);
    if (argv[0] === 'rm') { present = false; return ''; }
    if (argv[0] === 'ps') return present ? 'left-running' : '';
    throw new Error(`Unexpected Docker operation ${argv[0]}`);
  };
  const readiness = probeWebBrowser({ webVerification: web }, '/private/state/test', { dockerRun });
  assert.equal(readiness.status, 'unavailable');
  assert.equal(readiness.ready, false);
  assert.equal(present, false);
});

test('readiness deadline is enforced by the host and timed-out probe is reconciled before returning', () => {
  let present = false, launchedName, labels = {}, runOptions;
  const dockerRun = (_command, argv, options = {}) => {
    if (argv[0] === 'image') return image;
    if (argv[0] === 'run') {
      runOptions = options;
      present = true; launchedName = argv[argv.indexOf('--name') + 1];
      labels = Object.fromEntries(argv.flatMap((value, index) => value === '--label' ? [argv[index + 1].split('=')] : []));
      throw new Error('controlled host wall-clock timeout');
    }
    if (argv[0] === 'inspect') return JSON.stringify([{ Name: `/${launchedName}`, Image: image, State: { Running: true }, Config: { Labels: labels } }]);
    if (argv[0] === 'rm') { present = false; return ''; }
    if (argv[0] === 'ps') return present ? 'timed-out-probe-id' : '';
    throw new Error(`Unexpected Docker operation ${argv[0]}`);
  };
  const readiness = probeWebBrowser({ webVerification: web }, '/private/state/test', { dockerRun });
  assert.equal(readiness.ready, false);
  assert.match(readiness.reason, /wall-clock timeout/);
  assert.equal(runOptions.killSignal, 'SIGKILL');
  assert(runOptions.timeout > 0 && runOptions.timeout <= 30_000, 'the host spawn has a real bounded deadline');
  assert.equal(present, false, 'the timed-out exact probe is removed and absence is confirmed before returning');
});
