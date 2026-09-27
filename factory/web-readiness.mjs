import { randomBytes } from 'node:crypto';
import { instanceLabel, run } from './lib.mjs';
import { PLAYWRIGHT_VERSION } from './web-verification.mjs';

export function readinessDockerArgs(config, state, name = `sdf-${instanceLabel(state)}-web-probe-${process.pid}-${randomBytes(3).toString('hex')}`) {
  const web = config.webVerification;
  return {
    name,
    args: ['run', '--name', name, '--init', '--read-only', '--cap-drop=ALL', '--security-opt=no-new-privileges',
      '--network=none', '--memory=1024m', '--cpus=2', '--pids-limit=128', '--tmpfs', '/tmp:rw,nosuid,nodev,noexec,size=256m',
      '--user=0:0', '--label', `sdf.factory=${instanceLabel(state)}`, '--label', 'sdf.probe=web',
      '--label', `sdf.deadline=${Date.now() + 30_000}`, '--entrypoint', '/usr/bin/timeout', web.image,
      '--signal=KILL', '30s', '/usr/bin/env', '-i', 'PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',
      'HOME=/tmp/runner-home', 'node', '/opt/factory-web/readiness.mjs'],
  };
}

function removeAndConfirm(name, dockerRun) {
  const bounded = { timeout: 5_000, killSignal: 'SIGKILL' };
  try { dockerRun('docker', ['rm', '-f', name], bounded); } catch { /* The exact-name listing decides whether cleanup completed. */ }
  let remaining;
  try { remaining = dockerRun('docker', ['ps', '-aq', '--filter', `name=^/${name}$`], bounded); }
  catch { throw new Error('Browser readiness probe cleanup is unconfirmed; inspect the labelled probe container before retrying'); }
  if (remaining) throw new Error('Browser readiness probe container remains after cleanup');
}

function assertStopped(name, state, dockerRun) {
  const record = JSON.parse(dockerRun('docker', ['inspect', name], { timeout: 5_000, killSignal: 'SIGKILL' }))[0];
  const labels = record?.Config?.Labels || {};
  if (!record || record.Name !== `/${name}` || record.State?.Running !== false
    || labels['sdf.factory'] !== instanceLabel(state) || labels['sdf.probe'] !== 'web')
    throw new Error('Browser readiness container identity or stopped state could not be confirmed');
}

export function probeWebBrowser(config, state, { dockerRun = run } = {}) {
  const web = config.webVerification;
  if (!web?.enabled) return { enabled: false, ready: false, reason: 'Optional browser verification is disabled.' };
  if (web.adapter !== 'playwright' || web.version !== PLAYWRIGHT_VERSION)
    return { enabled: true, ready: false, status: 'unavailable', adapter: web.adapter, version: web.version,
      reason: 'The configured browser adapter or version is not supported by this Factory runtime.' };
  let image;
  try { image = dockerRun('docker', ['image', 'inspect', '--format', '{{.Id}}', web.image], { timeout: 5_000, killSignal: 'SIGKILL' }); }
  catch {
    return { enabled: true, ready: false, status: 'unavailable', adapter: web.adapter, version: web.version,
      image: web.image, reason: 'The configured browser image is not present in the local Docker daemon.' };
  }
  if (image !== web.image) return { enabled: true, ready: false, status: 'unavailable', adapter: web.adapter,
    version: web.version, image: web.image, reason: 'The configured browser image did not resolve to its pinned image ID.' };
  const { args, name } = readinessDockerArgs(config, state);
  let response, failure;
  try {
    const output = dockerRun('docker', args, { timeout: 35_000, killSignal: 'SIGKILL' });
    try { response = JSON.parse(output.trim().split('\n').at(-1)); }
    catch { throw new Error('The browser image did not return a valid execution readiness record'); }
    if (response.adapter !== 'playwright' || response.version !== web.version || response.browser !== 'chromium'
      || response.platform !== 'linux-container' || response.interaction !== 'passed' || typeof response.browserVersion !== 'string')
      throw new Error('The configured browser image failed the actual Chromium interaction probe');
    assertStopped(name, state, dockerRun);
  } catch (error) { failure = error; }
  try { removeAndConfirm(name, dockerRun); }
  catch (error) { throw error; }
  if (failure) return { enabled: true, ready: false, status: 'unavailable', adapter: web.adapter,
    version: web.version, image: web.image, reason: failure.message.slice(0, 1000) };
  return { enabled: true, ready: true, status: 'ready', adapter: web.adapter, version: web.version,
    browser: response.browser, browser_version: response.browserVersion, image: web.image,
    platform: response.platform, interaction: response.interaction, coverage: 'web' };
}
