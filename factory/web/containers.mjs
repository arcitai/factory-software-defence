import { spawn } from 'node:child_process';
import { chmodSync, lstatSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { BoundedLog } from '../bounded-log.mjs';
import { instanceLabel, run } from '../lib.mjs';

const PATH = '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin';
const CLEANUP_TIMEOUT_MS = 5000;

function remaining(deadlineAt) {
  const milliseconds = deadlineAt - Date.now();
  if (milliseconds <= 0) throw new Error('Browser verification wall-clock deadline expired');
  return milliseconds;
}

function privateDirectory(path, { create = false } = {}) {
  if (create) mkdirSync(path, { mode: 0o700 });
  const stat = lstatSync(path);
  if (!stat.isDirectory() || stat.isSymbolicLink() || stat.uid !== process.getuid() || (stat.mode & 0o077) !== 0)
    throw new Error(`Browser execution directory is not a private owned directory: ${path}`);
  return stat;
}

function makeScratchWritable(path) {
  const stat = lstatSync(path);
  if (stat.isSymbolicLink()) return;
  if (stat.isDirectory()) {
    chmodSync(path, 0o700);
    for (const name of readdirSync(path)) makeScratchWritable(join(path, name));
  } else if (stat.isFile()) {
    chmodSync(path, (stat.mode & 0o111) | 0o600);
  }
}

function labelArgs({ state, job, attempt, role, deadlineAt }) {
  return ['--label', `sdf.factory=${instanceLabel(state)}`, '--label', `sdf.job=${job}`,
    '--label', `sdf.run=${attempt}`, '--label', `sdf.role=${role}`, '--label', `sdf.deadline=${deadlineAt}`];
}

function commonArgs({ name, state, job, attempt, role, deadlineAt, uid, gid, memoryMiB, cpus, pidsLimit }) {
  return ['run', '--name', name, '--init', '--read-only', '--cap-drop=ALL', '--security-opt=no-new-privileges',
    '--pids-limit', String(pidsLimit), '--memory', `${memoryMiB}m`, '--cpus', String(cpus), '--user', `${uid}:${gid}`,
    ...labelArgs({ state, job, attempt, role, deadlineAt }), '--tmpfs', '/tmp:rw,nosuid,nodev,noexec,size=512m'];
}

export function webContainerNames(state, attempt) {
  const prefix = `sdf-${instanceLabel(state)}-${attempt}`;
  return { preview: `${prefix}-web-preview`, browser: `${prefix}-web-browser` };
}

export function webPreviewDockerArgs({ name, state, job, attempt, deadlineAt, uid, gid, config, web, workspace, scratch }) {
  return [
    ...commonArgs({ name, state, job, attempt, role: 'web-preview', deadlineAt, uid, gid,
      memoryMiB: config.memoryMiB, cpus: config.cpus ?? 2, pidsLimit: config.pidsLimit ?? 256 }),
    '--detach', '--network=none', '--mount', `type=bind,source=${workspace},target=/workspace,readonly`,
    '--mount', `type=bind,source=${scratch},target=/scratch`, '--workdir', '/scratch/check',
    '--entrypoint', '/usr/bin/env', config.image, '-i', `PATH=${PATH}`, 'HOME=/tmp', 'NODE_ENV=test',
    'HOST=127.0.0.1', `PORT=${web.port}`, ...web.previewCommand,
  ];
}

export function webBrowserDockerArgs({ name, previewName, state, job, attempt, deadlineAt, uid, gid, config, web, outputDir }) {
  return [
    ...commonArgs({ name, state, job, attempt, role: 'web-browser', deadlineAt, uid, gid,
      memoryMiB: config.memoryMiB, cpus: config.cpus ?? 2, pidsLimit: config.pidsLimit ?? 256 }),
    '-i', '--network', `container:${previewName}`, '--mount', `type=bind,source=${outputDir},target=/browser-output`,
    '--entrypoint', '/usr/bin/env', web.image, '-i', `PATH=${PATH}`, 'HOME=/tmp/browser-home',
    'XDG_CACHE_HOME=/tmp/browser-home/cache', 'PLAYWRIGHT_BROWSERS_PATH=/ms-playwright',
    'FACTORY_PHASE=web', 'node', '/opt/factory-web/runner.mjs',
  ];
}

function invokeDocker(args, deadlineAt) {
  return run('docker', args, { timeout: Math.max(1, Math.min(remaining(deadlineAt), 10_000)), killSignal: 'SIGKILL' });
}

function exactContainer(name) {
  return run('docker', ['ps', '-aq', '--filter', `name=^/${name}$`], {
    timeout: CLEANUP_TIMEOUT_MS, killSignal: 'SIGKILL',
  }).split('\n').filter(Boolean);
}

function ownedContainer(name, expected) {
  const records = JSON.parse(run('docker', ['inspect', name], { timeout: CLEANUP_TIMEOUT_MS, killSignal: 'SIGKILL' }));
  const record = Array.isArray(records) ? records[0] : null;
  const labels = record?.Config?.Labels || {};
  if (!record || record.Name !== `/${name}` || record.Image !== expected.image
    || labels['sdf.factory'] !== instanceLabel(expected.state) || labels['sdf.job'] !== expected.job
    || labels['sdf.run'] !== expected.attempt || labels['sdf.role'] !== expected.role
    || labels['sdf.deadline'] !== String(expected.deadlineAt))
    throw new Error(`Refusing to stop a web container whose identity is not the exact ${expected.role} for this attempt`);
  return record;
}

function removeExact(name, expected) {
  const matches = exactContainer(name);
  if (!matches.length) return;
  if (matches.length !== 1) throw new Error(`More than one container matches exact web name ${name}`);
  ownedContainer(name, expected);
  try { run('docker', ['rm', '-f', name], { timeout: CLEANUP_TIMEOUT_MS, killSignal: 'SIGKILL' }); }
  catch { /* The exact-name absence check decides whether cleanup succeeded. */ }
  if (exactContainer(name).length) throw new Error(`Web container ${expected.role} remains after cleanup`);
}

function runAttached(args, input, deadlineAt, log) {
  return new Promise((resolve, reject) => {
    let settled = false, timedOut = false, killTimer;
    const child = spawn('docker', args, { stdio: ['pipe', 'pipe', 'pipe'] });
    const finish = value => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearTimeout(killTimer);
      resolve(value);
    };
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
      killTimer = setTimeout(() => child.kill('SIGKILL'), 500);
    }, Math.max(1, deadlineAt - Date.now()));
    child.stdout.on('data', bytes => log.write('stdout', bytes));
    child.stderr.on('data', bytes => log.write('stderr', bytes));
    child.stdin.on('error', error => { if (error.code !== 'EPIPE' && !settled) { settled = true; clearTimeout(timer); reject(error); } });
    child.on('error', error => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearTimeout(killTimer);
      reject(error);
    });
    child.on('close', (code, signal) => finish({ code, signal, timedOut }));
    child.stdin.end(input);
  });
}

export async function runWebContainers({ state, job, attempt, config, web, workspace, scratch, attemptDir, input, deadlineAt }) {
  const names = webContainerNames(state, attempt);
  const uid = process.getuid(), gid = process.getgid();
  const browserOutput = join(attemptDir, 'web-output');
  const logPath = join(attemptDir, 'web.log');
  const log = new BoundedLog();
  const expected = {
    preview: { state, job, attempt, role: 'web-preview', deadlineAt, image: config.image },
    browser: { state, job, attempt, role: 'web-browser', deadlineAt, image: web.image },
  };
  const result = { names, outputDir: browserOutput, logPath, code: null, signal: null, timedOut: false };
  let primaryError;
  try {
    makeScratchWritable(scratch);
    privateDirectory(scratch);
    privateDirectory(attemptDir);
    privateDirectory(browserOutput, { create: true });
    if (!Number.isSafeInteger(uid) || uid <= 0 || !Number.isSafeInteger(gid) || gid <= 0)
      throw new Error('Web verification requires the non-root controller UID and GID');
    for (const [role, name] of Object.entries(names)) {
      if (exactContainer(name).length) throw new Error(`An exact ${role} container already exists; reconcile the prior attempt before retrying`);
    }

    invokeDocker(webPreviewDockerArgs({ name: names.preview, state, job, attempt, deadlineAt, uid, gid,
      config, web, workspace, scratch }), deadlineAt);
    const browserArgs = webBrowserDockerArgs({ name: names.browser, previewName: names.preview, state, job, attempt,
      deadlineAt, uid, gid, config, web, outputDir: browserOutput });
    const browserResult = await runAttached(['run', ...browserArgs.slice(1)], input, deadlineAt, log);
    result.code = browserResult.code;
    result.signal = browserResult.signal;
    result.timedOut = browserResult.timedOut;
    if (browserResult.timedOut) {
      result.error = 'Browser verification wall-clock deadline expired';
      log.append(`\n${result.error}.\n`);
    } else if (browserResult.code !== 0) {
      result.error = `Browser runner exited ${browserResult.code ?? browserResult.signal ?? 'without a status'}`;
    }
  } catch (error) {
    primaryError = error;
    log.write('stderr', Buffer.from(`${error.message}\n`));
  } finally {
    const failures = [];
    // Remove the browser first so it cannot continue using the preview network
    // namespace or writing its private output while controller cleanup begins.
    for (const role of ['browser', 'preview']) {
      try { removeExact(names[role], expected[role]); }
      catch (error) { failures.push(`${role}: ${error.message}`); }
    }
    writeFileSync(logPath, log.finish({ code: result.timedOut ? 'deadline' : result.code, signal: result.signal }), { mode: 0o600 });
    if (failures.length) throw new Error(`Could not reconcile both exact web containers; ${failures.join('; ')}. Retain scratch and the Verify fence for recovery.`);
  }
  if (primaryError) result.error = primaryError.message;
  return result;
}
