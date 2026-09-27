import { randomBytes } from 'node:crypto';
import { instanceLabel, run } from './lib.mjs';
import { PLAYWRIGHT_VERSION } from './web-verification.mjs';

const DEADLINE_MS = 30_000;
const CLEANUP_TIMEOUT_MS = 5_000;

export function readinessDockerArgs(config, state,
  name = `sdf-${instanceLabel(state)}-web-probe-${process.pid}-${randomBytes(3).toString('hex')}`,
  deadlineAt = Date.now() + DEADLINE_MS) {
  const web = config.webVerification;
  const uid = process.getuid(), gid = process.getgid();
  return {
    name,
    args: ['run', '--name', name, '--init', '--read-only', '--cap-drop=ALL', '--security-opt=no-new-privileges',
      '--network=none', '--memory=1024m', '--cpus=2', '--pids-limit=128', '--tmpfs',
      '/tmp:rw,nosuid,nodev,noexec,size=256m', '--user', `${uid}:${gid}`,
      '--label', `sdf.factory=${instanceLabel(state)}`, '--label', 'sdf.probe=web',
      '--label', `sdf.deadline=${deadlineAt}`, '--entrypoint', '/usr/bin/timeout', web.image,
      '--signal=KILL', '30s', '/usr/bin/env', '-i',
      'PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',
      'HOME=/tmp/browser-home', 'XDG_CACHE_HOME=/tmp/browser-home/cache',
      'PLAYWRIGHT_BROWSERS_PATH=/ms-playwright', 'node', '/opt/factory-web/readiness.mjs'],
  };
}

function exactNames(name, dockerRun) {
  return dockerRun('docker', ['ps', '-aq', '--filter', `name=^/${name}$`], {
    timeout: CLEANUP_TIMEOUT_MS, killSignal: 'SIGKILL',
  }).split('\n').filter(Boolean);
}

function assertIdentity(name, state, web, deadlineAt, dockerRun) {
  const records = JSON.parse(dockerRun('docker', ['inspect', name], {
    timeout: CLEANUP_TIMEOUT_MS, killSignal: 'SIGKILL',
  }));
  const record = Array.isArray(records) ? records[0] : null;
  const labels = record?.Config?.Labels || {};
  if (!record || record.Name !== `/${name}` || record.Image !== web.image
    || labels['sdf.factory'] !== instanceLabel(state) || labels['sdf.probe'] !== 'web'
    || labels['sdf.deadline'] !== String(deadlineAt))
    throw new Error('Browser readiness container identity could not be confirmed');
  return record;
}

function removeAndConfirm(name, state, web, deadlineAt, dockerRun) {
  const matches = exactNames(name, dockerRun);
  if (matches.length > 1) throw new Error('Multiple browser readiness containers match the exact probe name');
  if (matches.length === 1) {
    assertIdentity(name, state, web, deadlineAt, dockerRun);
    try { dockerRun('docker', ['rm', '-f', name], { timeout: CLEANUP_TIMEOUT_MS, killSignal: 'SIGKILL' }); }
    catch { /* The exact-name absence check decides whether cleanup completed. */ }
  }
  if (exactNames(name, dockerRun).length)
    throw new Error('Browser readiness probe container remains after cleanup');
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

  const deadlineAt = Date.now() + DEADLINE_MS;
  const { args, name } = readinessDockerArgs(config, state, undefined, deadlineAt);
  let response, failure;
  try {
    const output = dockerRun('docker', args, {
      timeout: Math.max(1, deadlineAt - Date.now()), killSignal: 'SIGKILL',
    });
    try { response = JSON.parse(output.trim().split('\n').at(-1)); }
    catch { throw new Error('The browser image did not return a valid execution readiness record'); }
    if (response.adapter !== 'playwright' || response.version !== web.version || response.browser !== 'chromium'
      || response.platform !== 'linux-container' || response.interaction !== 'passed' || typeof response.browserVersion !== 'string')
      throw new Error('The configured browser image failed the actual Chromium interaction probe');
    const record = assertIdentity(name, state, web, deadlineAt, dockerRun);
    if (record.State?.Running !== false) throw new Error('Browser readiness container did not stop before the readiness deadline');
  } catch (error) { failure = error; }
  removeAndConfirm(name, state, web, deadlineAt, dockerRun);
  if (failure) return { enabled: true, ready: false, status: 'unavailable', adapter: web.adapter,
    version: web.version, image: web.image, reason: failure.message.slice(0, 1000) };
  return { enabled: true, ready: true, status: 'ready', adapter: web.adapter, version: web.version,
    browser: response.browser, browser_version: response.browserVersion, image: web.image,
    platform: response.platform, interaction: response.interaction, coverage: 'web' };
}
