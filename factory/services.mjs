import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync, cpSync, readdirSync, renameSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir, userInfo } from 'node:os';
import { spawnSync } from 'node:child_process';
import { createServer } from 'node:net';
import { ROOT, STATE_HOME, DATA_HOME, SOURCE_CHECKOUT } from './paths.mjs';
import { configAt, json, save, run, api, sleep, digest } from './lib.mjs';
import { assertInstalledJobImage } from './image-install.mjs';
import { VERSION, newer, latestVersion, installRelease, busyInstallations } from './updates.mjs';
import { serviceId, systemdUnit, launchAgent, tunnelArguments, groupArguments, runtimeLauncher } from './service-files.mjs';

const records = join(STATE_HOME, 'services');
const configHome = process.env.XDG_CONFIG_HOME || join(homedir(), '.config');
const userUnits = join(configHome, 'systemd/user');
const updater = 'software-defence-factory-update';
const recordPath = id => join(records, `${id}.json`);
const systemctl = (...args) => run('systemctl', ['--user', ...args]);
const uid = () => process.getuid();
function userOnly() { if (uid() === 0) throw new Error('Install and operate user services without sudo; never run the controller as root'); }
function alive(pid) { try { process.kill(pid, 0); return true; } catch (error) { if (error.code === 'ESRCH') return false; throw error; } }
export const controllerService = state => recordPath(serviceId('controller', state));
export function hasService(state) { return existsSync(controllerService(state)); }
export async function withServiceOperation(action, perform) {
  const lock = join(STATE_HOME, 'service-update.lock');
  mkdirSync(STATE_HOME, { recursive: true, mode: 0o700 });
  try { writeFileSync(lock, JSON.stringify({ pid: process.pid, action }), { flag: 'wx', mode: 0o600 }); }
  catch (error) { if (error.code === 'EEXIST') throw new Error(`Another service operation may own ${lock}; reconcile its PID before removing the lock`); throw error; }
  try { return await perform(); } finally { rmSync(lock); }
}
export function isManagedLaunch(state) {
  return hasService(state) && process.env.SDF_MANAGED_SERVICE === serviceId('controller', state);
}
function owned(record) {
  if (!existsSync(record.file) || digest(readFileSync(record.file, 'utf8')) !== record.definitionHash) throw new Error(`Service definition changed outside the CLI; reconcile ${record.file} before changing it`);
}
function loaded(record) {
  if (record.platform === 'linux') return systemctl('show', record.unit, '--property=LoadState', '--value') !== 'not-found';
  const result = spawnSync('/bin/launchctl', ['print', `gui/${uid()}/${record.id}`], { encoding: 'utf8' });
  if (result.error) throw result.error;
  if (result.status === 0) return true;
  if (/Could not find service|Could not find specified service/.test(result.stderr)) return false;
  throw new Error(result.stderr || 'Cannot inspect launchd service');
}
function active(record) {
  if (record.platform === 'linux') return ['active', 'activating', 'reloading'].includes(systemctl('show', record.unit, '--property=ActiveState', '--value'));
  return loaded(record);
}
function start(record) {
  owned(record);
  if (record.platform === 'linux') systemctl('start', record.unit);
  else if (!loaded(record)) run('/bin/launchctl', ['bootstrap', `gui/${uid()}`, record.file]);
}
function stop(record) {
  owned(record);
  if (record.platform === 'linux') { if (active(record)) systemctl('stop', record.unit); }
  else if (loaded(record)) run('/bin/launchctl', ['bootout', `gui/${uid()}/${record.id}`]);
  if (record.kind === 'controller') {
    const lock = join(record.state, 'supervisor.json');
    if (existsSync(lock) && alive(json(lock).pid)) throw new Error('A controller remains alive outside the stopped service; reconcile its supervisor PID before proceeding');
  }
}
export async function waitHealthy(record, expectedVersion) {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    try {
      if (record.kind === 'controller') {
        const status = await api(record.state, '/api/v1/status');
        if (status.workers?.some(worker => worker.connected) && (!expectedVersion || status.runtime_version === expectedVersion)) return status;
      } else {
        const response = await fetch(`http://127.0.0.1:${record.port}/api/v1/status`, { signal: AbortSignal.timeout(1000) });
        if (response.ok && (await response.json()).workers) return;
      }
    } catch { /* A service may be waiting for Docker or the SSH peer. */ }
    await sleep(500);
  }
  throw new Error(`Service is installed but dashboard is not ready; inspect ${record.file} and service logs. It will keep retrying.`);
}
async function portFree(port) {
  await new Promise((resolve, reject) => {
    const server = createServer(); server.once('error', reject);
    server.listen(port, '127.0.0.1', () => server.close(resolve));
  });
}
// Retain only installed package content. A source tree or npx cache is never
// the service's enduring runtime. Old snapshots remain available for recovery.
function retainRuntime() {
  if (SOURCE_CHECKOUT) throw new Error('Install the npm artifact before installing a service; source worktrees are not service runtimes');
  const destination = join(DATA_HOME, 'services/runtimes', VERSION);
  if (!existsSync(destination)) {
    mkdirSync(dirname(destination), { recursive: true, mode: 0o700 });
    const staging = `${destination}.${process.pid}.tmp`;
    try {
      mkdirSync(staging, { mode: 0o700 });
      for (const name of ['package.json', 'bin', 'factory', 'kit', '.agents', 'scripts']) if (existsSync(join(ROOT, name))) cpSync(join(ROOT, name), join(staging, name), { recursive: true });
      renameSync(staging, destination);
    } finally { rmSync(staging, { recursive: true, force: true }); }
  }
  if (json(join(destination, 'package.json')).version !== VERSION) throw new Error('Retained service runtime identity mismatch');
  return destination;
}
function launcher() {
  const runtime = retainRuntime(), file = join(DATA_HOME, 'services', `launch-${VERSION}-${digest(STATE_HOME).slice(0, 16)}.mjs`);
  const content = runtimeLauncher({ runtime, stateHome: STATE_HOME, dataHome: DATA_HOME });
  if (existsSync(file)) {
    if (readFileSync(file, 'utf8') !== content) throw new Error('Retained launcher content differs; preserve and reconcile it before installation');
  } else writeFileSync(file, content, { flag: 'wx', mode: 0o600 });
  return file;
}
function environment() {
  return { PATH: process.env.PATH || '/usr/local/bin:/usr/bin:/bin', HOME: homedir(), XDG_STATE_HOME: dirname(STATE_HOME), XDG_DATA_HOME: dirname(DATA_HOME), XDG_CONFIG_HOME: configHome, SDF_AUTO_UPDATE: '0' };
}
export function serviceDefinition(state) {
  configAt(state);
  return systemdUnit({ description: 'Factory', argv: [process.execPath, join(ROOT, 'bin/software-defence-factory.mjs'), 'serve', '--state', state], directory: homedir(), environment: environment() });
}
async function install(kind, state, flags) {
  userOnly();
  if (kind === 'controller' && process.platform !== 'linux') throw new Error('Controller services currently require Linux/systemd; use up on macOS. Tunnel services support macOS and Linux.');
  if (!['linux', 'darwin'].includes(process.platform)) throw new Error('Services require Linux/systemd or macOS/launchd');
  const port = kind === 'controller' ? configAt(state).port : Number(flags.port);
  const id = kind === 'controller' ? serviceId(kind, state) : serviceId(kind, `${flags.host}:${port}`);
  if (existsSync(recordPath(id))) {
    const previous = json(recordPath(id)); owned(previous);
    if (kind === 'controller' && previous.state !== state) throw new Error('Service identity mismatch');
    if (previous.port !== port || (flags.group && previous.group !== flags.group)) throw new Error('Service configuration changed; uninstall and reinstall the service while preserving its private state');
    if (previous.platform === 'linux') systemctl('enable', previous.unit);
    start(previous); await waitHealthy(previous);
    console.log(JSON.stringify(await serviceStatus(previous), null, 2)); return;
  }
  if (kind === 'controller') {
    assertInstalledJobImage(state, configAt(state));
    if (existsSync(join(state, 'supervisor.json')) && alive(json(join(state, 'supervisor.json')).pid)) throw new Error('Stop the manually started controller before adopting it as a service');
  }
  let argv = kind === 'controller' ? [process.execPath, launcher(), 'serve', '--state', state] : tunnelArguments(flags.host, port);
  if (flags.group) {
    if (kind !== 'controller') throw new Error('--group applies only to Linux controller services');
    if (!run('id', ['-nG', userInfo().username]).split(/\s+/).includes(flags.group)) throw new Error('The current user must already belong to the requested group');
    const executable = existsSync('/usr/bin/sg') ? '/usr/bin/sg' : '/usr/bin/newgrp';
    if (executable.endsWith('/newgrp') && !run(executable, ['--help']).includes('--command')) throw new Error('This newgrp does not support commands; use a system with sg or refresh the login session');
    argv = groupArguments(argv, flags.group, executable);
  }
  await portFree(port);
  const record = { id, kind, platform: process.platform, version: VERSION, port, state: kind === 'controller' ? state : undefined, host: flags.host, group: flags.group, argv, environment: environment() };
  if (kind === 'controller') record.environment.SDF_MANAGED_SERVICE = id;
  record.unit = `${id}.service`;
  record.file = process.platform === 'linux' ? join(userUnits, record.unit) : join(homedir(), 'Library/LaunchAgents', `${id}.plist`);
  record.log = join(records, `${id}.log`);
  const definition = process.platform === 'linux' ? systemdUnit({ description: `Factory ${kind}`, argv, directory: homedir(), environment: record.environment })
    : launchAgent({ id, argv, directory: homedir(), log: record.log, environment: record.environment });
  if (existsSync(record.file)) throw new Error(`Refusing to overwrite an unregistered service: ${record.file}`);
  mkdirSync(dirname(record.file), { recursive: true, mode: 0o700 }); mkdirSync(records, { recursive: true, mode: 0o700 });
  writeFileSync(record.file, definition, { mode: 0o600 }); record.definitionHash = digest(definition); save(recordPath(id), record);
  if (process.platform === 'linux') { run('systemd-analyze', ['--user', 'verify', record.file]); systemctl('daemon-reload'); systemctl('enable', record.unit); }
  start(record);
  await waitHealthy(record);
  console.log(JSON.stringify(await serviceStatus(record), null, 2));
}
async function serviceStatus(record) {
  owned(record);
  const result = { id: record.id, kind: record.kind, definition: record.file, dashboard: `http://127.0.0.1:${record.port}`, running: active(record) };
  if (record.platform === 'linux') {
    result.enabled = systemctl('show', record.unit, '--property=UnitFileState', '--value') === 'enabled';
    const linger = run('loginctl', ['show-user', userInfo().username, '-p', 'Linger', '--value']);
    result.linger = linger === 'yes'; result.startsAt = result.linger ? 'boot' : 'login';
    if (!result.linger) result.next = `For boot without login, an administrator can run: loginctl enable-linger ${userInfo().username}`;
    result.logs = `journalctl --user -u ${record.unit} -n 100 --no-pager`;
  } else { result.startsAt = 'login'; result.logs = record.log; }
  try {
    const response = await fetch(`http://127.0.0.1:${record.port}/api/v1/status`, { signal: AbortSignal.timeout(1500) });
    const snapshot = await response.json(); result.healthy = response.ok && !!snapshot.workers;
    result.runtimeVersion = snapshot.runtime_version; result.maintenance = snapshot.maintenance;
  }
  catch { result.healthy = false; }
  return result;
}
export async function manageService(kind, action, state, flags = {}) {
  userOnly();
  if (kind === 'tunnel') tunnelArguments(flags.host, Number(flags.port));
  if (kind === 'controller' && action === 'update') return updateServices();
  const readonly = ['status', 'logs'].includes(action) || (action === 'updates' && flags.auto === 'status');
  return readonly ? performService(kind, action, state, flags) : withServiceOperation(`${kind} ${action}`, () => performService(kind, action, state, flags));
}
async function performService(kind, action, state, flags) {
  if (kind === 'controller' && action === 'updates') return automaticUpdates(flags.auto);
  if (kind === 'controller' && action === 'resume') {
    console.log(JSON.stringify(await api(state, '/api/v1/maintenance', { enabled: false }))); return;
  }
  if (action === 'install') return install(kind, state, flags);
  const id = kind === 'controller' ? serviceId(kind, state) : serviceId(kind, `${flags.host}:${Number(flags.port)}`);
  if (!['start', 'stop', 'restart', 'status', 'uninstall', 'logs'].includes(action)) throw new Error('Use service/tunnel install|start|stop|restart|status|logs|uninstall; service update; service updates --auto on|off|status');
  if (!existsSync(recordPath(id))) {
    if (action === 'status') { console.log(JSON.stringify({ installed: false, id })); return; }
    if (action === 'uninstall') { console.log('Service is already uninstalled; private state was preserved.'); return; }
    throw new Error('Service is not installed');
  }
  const record = json(recordPath(id)); owned(record);
  if (action === 'status') { console.log(JSON.stringify(await serviceStatus(record), null, 2)); return; }
  if (action === 'logs') {
    console.log(record.platform === 'linux' ? run('journalctl', ['--user', '-u', record.unit, '-n', '100', '--no-pager']) : (existsSync(record.log) ? readFileSync(record.log, 'utf8').split('\n').slice(-100).join('\n') : 'No service log yet.')); return;
  }
  if (['stop', 'restart', 'uninstall'].includes(action)) stop(record);
  if (['start', 'restart'].includes(action)) { start(record); await waitHealthy(record); }
  if (action === 'uninstall') {
    if (record.platform === 'linux') systemctl('disable', record.unit);
    rmSync(record.file); rmSync(recordPath(id));
    if (record.platform === 'linux') systemctl('daemon-reload');
  }
  console.log(`${action}: ${id}. Private state and retained runtimes were preserved.`);
}

function controllers() {
  if (!existsSync(records)) return [];
  return readdirSync(records).filter(name => name.endsWith('.json')).map(name => json(join(records, name))).filter(record => record.kind === 'controller');
}
export async function updateServices({ latest = latestVersion, download = installRelease } = {}) {
  userOnly();
  return withServiceOperation('update', () => performUpdate(latest, download));
}
async function performUpdate(latest, download) {
  const held = [], stopped = [];
  const preferencesPath = join(STATE_HOME, 'updates.json'), selectionPath = join(STATE_HOME, 'service-release.json');
  const previousPreferences = existsSync(preferencesPath) ? json(preferencesPath) : { enabled: true, lastCheckedAt: 0 };
  const previous = existsSync(selectionPath) ? json(selectionPath) : {};
  let activated = false, releaseMaintenance = true;
  const priorVersions = new Map();
  try {
    const managed = controllers();
    for (const record of managed) owned(record);
    const live = managed.filter(active);
    const installed = managed.map(record => record.version || VERSION).reduce((minimum, version) => newer(minimum, version) ? version : minimum, VERSION);
    const current = previous.version || installed;
    const version = [await latest(), VERSION, current].reduce((selected, candidate) => newer(candidate, selected) ? candidate : selected);
    const runningVersions = await Promise.all(live.map(async record => {
      const value = (await api(record.state, '/api/v1/status')).runtime_version;
      priorVersions.set(record.id, value); return value;
    }));
    if (runningVersions.some(value => !/^\d+\.\d+\.\d+$/.test(value || ''))) throw new Error('Cannot verify the runtime version of a managed controller');
    if (!newer(version, current) && runningVersions.every(value => !newer(version, value))) { console.log(`Factory ${current} is up to date.`); return; }
    const unowned = busyInstallations().filter(state => !live.some(record => record.state === state));
    if (unowned.length) throw new Error('Unmanaged controllers or executor fences block the update: ' + unowned.join(', '));
    // Reserve idle controllers before downloads. All mutating API actions are
    // refused until restart or explicit release, eliminating submit/stop races.
    for (const record of live) { await api(record.state, '/api/v1/maintenance', { enabled: true }); held.push(record); }
    download(version);
    for (const record of live) { stop(record); stopped.push(record); }
    if (busyInstallations().length) throw new Error('An installation or executor still blocks activation');
    // Ordinary CLI downloads must never change what an existing service starts.
    // Only this reserved update transaction may advance the managed selection.
    activated = true;
    save(selectionPath, { version });
    save(preferencesPath, { ...previousPreferences, version, lastCheckedAt: Date.now() });
    for (const record of stopped) { start(record); await waitHealthy(record, version); }
    console.log(`Updated to ${version}; restarted ${stopped.length} previously active services. Jobs and history preserved.`);
  } catch (error) {
    releaseMaintenance = false;
    try {
      if (activated) {
        for (const record of stopped) stop(record);
        save(selectionPath, previous);
        save(preferencesPath, previousPreferences);
      }
      for (const record of stopped) { start(record); await waitHealthy(record, priorVersions.get(record.id)); }
      releaseMaintenance = true;
    } catch (recoveryError) {
      throw new Error(`Update failed: ${error.message}. Recovery unconfirmed: ${recoveryError.message}. Maintenance reservations were retained.`);
    }
    throw error;
  } finally {
    const failures = [];
    if (releaseMaintenance) for (const record of held) try { await api(record.state, '/api/v1/maintenance', { enabled: false }); } catch (error) { failures.push(`${record.id}: ${error.message}`); }
    if (failures.length) throw new Error('Maintenance release unconfirmed: ' + failures.join('; '));
  }
}
function automaticUpdates(mode) {
  if (process.platform !== 'linux') throw new Error('Scheduled service updates currently require Linux/systemd');
  if (!['on', 'off', 'status'].includes(mode)) throw new Error('Use service updates --auto on|off|status');
  const timer = join(userUnits, `${updater}.timer`), service = join(userUnits, `${updater}.service`), record = join(records, 'updates.json');
  if (mode === 'status') { console.log(JSON.stringify({ installed: existsSync(record), ...(existsSync(record) ? { timer: systemctl('show', `${updater}.timer`, '-p', 'ActiveState', '-p', 'NextElapseUSecRealtime') } : {}) })); return; }
  if (mode === 'off') {
    if (existsSync(record)) {
      if (systemctl('show', `${updater}.service`, '-p', 'ActiveState', '--value') === 'activating') throw new Error('An update is running; wait for it to finish before disabling the timer');
      const data = json(record);
      for (const [file, hash] of [[timer, data.timerHash], [service, data.serviceHash]]) if (!existsSync(file) || digest(readFileSync(file, 'utf8')) !== hash) throw new Error('Update service was edited; reconcile it before removal');
      systemctl('disable', '--now', `${updater}.timer`);
      systemctl('stop', `${updater}.service`);
      rmSync(timer); rmSync(service); rmSync(record); systemctl('daemon-reload');
    }
    console.log('Scheduled updates disabled.'); return;
  }
  if (existsSync(record)) { console.log('Scheduled updates are already installed.'); return; }
  if (existsSync(timer) || existsSync(service)) throw new Error('Refusing to overwrite an unregistered update unit');
  const serviceText = systemdUnit({ description: 'Factory idle update', argv: [process.execPath, launcher(), 'service', 'update'], directory: homedir(), environment: environment(), oneshot: true });
  const timerText = `[Unit]\nDescription=Check Factory updates daily when idle\n\n[Timer]\nOnCalendar=daily\nRandomizedDelaySec=1h\nPersistent=true\n\n[Install]\nWantedBy=timers.target\n`;
  mkdirSync(userUnits, { recursive: true, mode: 0o700 });
  writeFileSync(service, serviceText, { mode: 0o600 }); writeFileSync(timer, timerText, { mode: 0o600 });
  save(record, { serviceHash: digest(serviceText), timerHash: digest(timerText) });
  systemctl('daemon-reload'); systemctl('enable', '--now', `${updater}.timer`); console.log('Daily idle service updates enabled. Busy/unknown installations defer the update.');
}
