import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { configAt, harnessOf, run, save, sleep, containers } from '../factory/lib.mjs';
import { createController } from '../factory/server.mjs';
import { probeWebBrowser } from '../factory/web-readiness.mjs';
import { initializeWebQualificationRepository, qualificationWebConfig } from '../factory/web/qualification-fixture.mjs';

const state = resolve(process.argv[2] || '');
const image = process.argv[3] || '';
assert(state && image, 'Use qualify-web --state SYNTHETIC_STATE --image sha256:...');
assert.match(image, /^sha256:[a-f0-9]{64}$/, 'The browser image must be supplied by immutable local image ID');
const marker = JSON.parse(readFileSync(join(state, 'synthetic-demo.json'), 'utf8'));
assert.equal(marker.version, 1, 'This qualification accepts only a state created by the synthetic demo command');
const original = configAt(state);
assert.equal(harnessOf(original), 'mock', 'Web qualification is restricted to the synthetic mock harness');
assert.equal(readFileSync(join(original.repo, 'value.txt'), 'utf8'), 'broken\n', 'The configured demo repository is the expected untouched synthetic fixture');
const jobImage = run('docker', ['image', 'inspect', '--format', '{{.Id}}', original.image]);
assert.match(jobImage, /^sha256:[a-f0-9]{64}$/, 'The configured synthetic job image must already exist');
assert.equal(run('docker', ['image', 'inspect', '--format', '{{.Id}}', image]), image, 'The explicitly selected browser image must already exist locally');

const webVerification = qualificationWebConfig(image);
const readiness = probeWebBrowser({ ...original, webVerification }, state);
assert.equal(readiness.ready, true, `Actual browser readiness probe failed: ${readiness.reason || 'unknown reason'}`);

const proofRoot = join(state, `web-qualification-${Date.now()}-${randomBytes(3).toString('hex')}`);
const repo = join(proofRoot, 'fixture-app'), runtime = join(proofRoot, 'runtime');
mkdirSync(proofRoot, { recursive: true, mode: 0o700 });
mkdirSync(runtime, { recursive: true, mode: 0o700 });
initializeWebQualificationRepository(repo);
const { delivery, ...base } = original;
const config = {
  ...base, repo, sourceRef: 'main', harness: 'mock', agent: undefined,
  command: ['node', '/opt/factory/mock.mjs'], model: null, image: jobImage, network: 'none',
  timeoutSeconds: Math.max(original.timeoutSeconds, 180), memoryMiB: Math.max(original.memoryMiB, 1024),
  cpus: Math.max(original.cpus || 2, 2), check: 'test "$(cat value.txt)" = fixed',
  webVerification,
};
delete config.agent;
save(join(runtime, 'factory.json'), config);
writeFileSync(join(runtime, 'worker.token'), `${randomBytes(32).toString('hex')}\n`, { mode: 0o600 });
writeFileSync(join(runtime, 'model.env'), '# Synthetic browser qualification. No inference settings.\n', { mode: 0o600 });

let controller;
const result = { synthetic: true, readiness, image: { job: jobImage, browser: image }, results: [] };
async function waitFor(jobId, wanted, timeoutMs = 180_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const job = controller.queue.get(jobId);
    if (job.state === wanted && !controller.queue.active) return job;
    if (['failed', 'blocked', 'cancelled', 'interrupted'].includes(job.state) && job.state !== wanted)
      throw new Error(`${jobId}: expected ${wanted}, got ${job.state}: ${job.runs.at(-1)?.error || job.runs.at(-1)?.summary}`);
    await sleep(250);
  }
  throw new Error(`${jobId}: timed out waiting for ${wanted}`);
}

try {
  controller = createController(runtime);
  await new Promise((resolveListen, reject) => {
    controller.server.once('error', reject);
    controller.server.listen(0, '127.0.0.1', resolveListen);
  });
  const submit = source_ref => controller.queue.submit({ workflow: 'software', repository: 'app', source_ref,
    title: `Disposable browser fixture (${source_ref})`, spec: 'Synthetic qualification only; do not use an application or model.' });
  const passing = submit('main');
  const passJob = await waitFor(passing.id, 'awaiting_approval');
  const passChecks = JSON.parse(readFileSync(join(runtime, 'jobs', passing.id, 'checks.json'), 'utf8'));
  assert.equal(passChecks.passed, true);
  assert.equal(passChecks.web_verification.status, 'passed');
  assert.equal(passChecks.web_verification.stories.length, webVerification.stories.length);
  assert(passChecks.web_verification.stories.every(story => story.status === 'passed'));
  const status = await (await fetch(`http://127.0.0.1:${controller.server.address().port}/api/v1/status`)).json();
  const sharedPass = status.jobs.find(job => job.id === passing.id).runs.find(run => run.command === 'verify').web_verification;
  assert.equal(sharedPass.status, 'passed', 'API status exposes the same browser summary and story hashes');
  assert.equal(sharedPass.candidate, passChecks.head);
  assert.equal(sharedPass.policyHash, passChecks.policyHash);
  result.results.push({ case: 'delayed save, disabled/busy state, result, failure/retry, keyboard focus and light/dark desktop/narrow stories', job: passing.id, state: passJob.state, evidence: sharedPass });

  const broken = submit('broken');
  const brokenJob = await waitFor(broken.id, 'failed');
  const brokenChecks = JSON.parse(readFileSync(join(runtime, 'jobs', broken.id, 'checks.json'), 'utf8'));
  assert.equal(brokenJob.runs.at(-1).command, 'verify');
  assert.equal(brokenChecks.passed, false);
  assert.equal(brokenChecks.web_verification.status, 'failed');
  assert(brokenChecks.web_verification.stories.some(story => story.status === 'failed'));
  assert.equal(JSON.parse(readFileSync(join(runtime, 'jobs', broken.id, 'artifacts', brokenJob.runs.at(-1).id, 'result.json'), 'utf8')).outcome, 'blocked');
  result.results.push({ case: 'deliberately broken busy-state/result variant blocks Verify and acceptance', job: broken.id, state: brokenJob.state, evidence: brokenJob.runs.at(-1).web_verification });

  for (const id of [passing.id, broken.id]) {
    assert(!containers(runtime).some(item => item.Config.Labels['sdf.job'] === id), `Browser/check containers remain for ${id}`);
    const verify = controller.queue.get(id).runs.find(run => run.command === 'verify');
    assert(!readFileSync(join(runtime, 'jobs', id, verify.id, 'execution-config.json'), 'utf8').includes('DOCKER_HOST'));
    assert(!existsSync(join(runtime, 'jobs', id, verify.id, 'check-workspace')));
    assert(!existsSync(join(runtime, 'jobs', id, verify.id, 'web-policy.json')));
  }
  assert(!existsSync(join(runtime, 'jobs', broken.id, 'accepted.json')));
  result.limits = ['Synthetic fixture and mock build/review only; no application, model, provider write or native/mobile OS coverage.'];
  save(join(proofRoot, 'qualification.json'), result);
  console.log(JSON.stringify({ proof: join(proofRoot, 'qualification.json'), results: result.results }, null, 2));
} finally {
  if (controller) await controller.close();
}
