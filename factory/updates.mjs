import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { ROOT, STATE_HOME, DATA_HOME, SOURCE_CHECKOUT } from './paths.mjs';

const PACKAGE = 'software-defence-factory';
const REGISTRY = 'https://registry.npmjs.org';
const DAY = 24 * 60 * 60 * 1000;
export const VERSION = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version;
const read = path => JSON.parse(readFileSync(path, 'utf8'));
function save(path, value) {
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 });
  renameSync(temporary, path);
}
function privateDir(path) { mkdirSync(path, { recursive: true, mode: 0o700 }); }
export function newer(candidate, current) {
  if (!/^\d+\.\d+\.\d+$/.test(candidate) || !/^\d+\.\d+\.\d+$/.test(current)) return false;
  const a = candidate.split('.').map(Number), b = current.split('.').map(Number);
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i];
  return false;
}
export function registerInstallation(state, home = STATE_HOME) {
  const directory = join(home, 'installations');
  privateDir(directory);
  const absolute = resolve(state);
  save(join(directory, createHash('sha256').update(absolute).digest('hex') + '.json'), { state: absolute });
}
function alive(pid) {
  if (!Number.isSafeInteger(pid) || pid < 1) return true;
  try { process.kill(pid, 0); return true; } catch (error) { return error.code !== 'ESRCH'; }
}
export function busyInstallations(home = STATE_HOME) {
  const directory = join(home, 'installations');
  if (!existsSync(directory)) return [];
  const busy = [];
  for (const file of readdirSync(directory).filter(name => name.endsWith('.json'))) {
    try {
      const { state } = read(join(directory, file));
      const lock = join(state, 'supervisor.json');
      if (existsSync(lock) && alive(read(lock).pid)) { busy.push(state); continue; }
      const jobs = join(state, 'jobs');
      if (existsSync(jobs)) for (const job of readdirSync(jobs)) {
        // An executor fence requires reconciliation even after its PID exits.
        if (existsSync(join(jobs, job, 'active.json'))) { busy.push(state); break; }
      }
    } catch { busy.push(`Unverified installation: ${file}`); }
  }
  return busy;
}
export async function latestVersion(fetcher = fetch) {
  const response = await fetcher(`${REGISTRY}/${PACKAGE}/latest`, { signal: AbortSignal.timeout(4000) });
  if (!response.ok) throw new Error(`npm registry returned HTTP ${response.status}`);
  const release = await response.json();
  if (release.name !== PACKAGE || !/^\d+\.\d+\.\d+$/.test(release.version)) throw new Error('Unexpected npm release identity');
  return release.version;
}
function installedEntry(dataHome, version) {
  if (!/^\d+\.\d+\.\d+$/.test(version || '')) return null;
  const root = join(dataHome, 'releases', version, 'node_modules', PACKAGE);
  try {
    const pkg = read(join(root, 'package.json'));
    const entry = join(root, 'bin/software-defence-factory.mjs');
    return pkg.name === PACKAGE && pkg.version === version && existsSync(entry) ? entry : null;
  } catch { return null; }
}
export function installRelease(version, dataHome = DATA_HOME, runner = spawnSync) {
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error('Invalid release version');
  const existing = installedEntry(dataHome, version);
  if (existing) return existing;
  const releases = join(dataHome, 'releases'); privateDir(releases);
  const staging = mkdtempSync(join(releases, '.download-'));
  try {
    const result = runner('npm', ['install', '--prefix', staging, '--no-save', '--package-lock=false',
      '--ignore-scripts', '--omit=dev', '--no-audit', '--no-fund', '--registry', REGISTRY, `${PACKAGE}@${version}`],
      { encoding: 'utf8', timeout: 120000, maxBuffer: 1024 * 1024 });
    if (result.error || result.status !== 0) throw new Error(`npm update download failed: ${result.error?.message || result.stderr || result.status}`);
    const pkg = read(join(staging, 'node_modules', PACKAGE, 'package.json'));
    if (pkg.name !== PACKAGE || pkg.version !== version || !existsSync(join(staging, 'node_modules', PACKAGE, 'bin/software-defence-factory.mjs')))
      throw new Error('Downloaded package identity does not match the requested release');
    try { renameSync(staging, join(releases, version)); }
    catch (error) { if (!installedEntry(dataHome, version)) throw error; }
    return installedEntry(dataHome, version);
  } finally { rmSync(staging, { recursive: true, force: true }); }
}

export async function bootstrap(args) {
  if (process.env.SDF_BOOTSTRAPPED === '1') return;
  const command = args[0] || 'help', explicit = command === 'update';
  if (SOURCE_CHECKOUT) {
    if (explicit) throw new Error('This is a source checkout. Install the npm CLI to use update; source changes stay under Git.');
    return;
  }
  privateDir(STATE_HOME);
  const preferencePath = join(STATE_HOME, 'updates.json');
  const preferences = existsSync(preferencePath) ? read(preferencePath) : { enabled: true, lastCheckedAt: 0 };
  if (explicit && args[1] === '--auto') {
    if (args.length !== 3 || !['on', 'off'].includes(args[2])) throw new Error('Use update --auto on|off');
    preferences.enabled = args[2] === 'on'; save(preferencePath, preferences);
    console.log(`Automatic CLI updates ${preferences.enabled ? 'enabled' : 'disabled'}.`); return 0;
  }
  if (explicit && args.length > 1 && !(args.length === 2 && args[1] === '--check')) throw new Error('Use update, update --check, or update --auto on|off');
  const busy = busyInstallations();
  const cachedVersion = installedEntry(DATA_HOME, preferences.version) ? preferences.version : VERSION;
  let selectedVersion = newer(cachedVersion, VERSION) ? cachedVersion : VERSION;
  const automatic = !['stop', 'cancel', 'status', 'definition', 'workflows', 'agents', 'skills', 'foundation', 'inbox', 'issues', 'issue', 'recommend', 'infrastructure', 'automations', 'serve', 'service', 'tunnel', 'web', 'qualify-web', 'help', '--help', '-h', 'version', '--version', '-v'].includes(command)
    && preferences.enabled && process.env.SDF_AUTO_UPDATE !== '0'
    && Date.now() - preferences.lastCheckedAt >= DAY && busy.length === 0;
  if (explicit || automatic) {
    try {
      if (busy.length && args[1] !== '--check') throw new Error('Stop/reconcile running installations before updating: ' + busy.join(', '));
      preferences.lastCheckedAt = Date.now(); save(preferencePath, preferences);
      const latest = await latestVersion();
      if (explicit && args[1] === '--check') { console.log(JSON.stringify({ current: selectedVersion, latest, available: newer(latest, selectedVersion), automatic: preferences.enabled })); return 0; }
      if (newer(latest, selectedVersion)) {
        console.error(`Updating Factory (${PACKAGE}) ${selectedVersion} → ${latest}…`);
        installRelease(latest);
        // Downloads are immutable. A newly started controller keeps its version;
        // do not switch the next CLI process to a new release while it is active.
        if (busyInstallations().length) throw new Error('Update downloaded; activation deferred while an installation is running.');
        preferences.version = latest; save(preferencePath, preferences); selectedVersion = latest;
      }
      if (explicit) { console.log(`Factory ${selectedVersion} is up to date. Runtime, credentials and jobs were preserved.`); return 0; }
    } catch (error) {
      if (explicit) throw error;
      // An offline registry must never prevent a local command from working.
      console.error(`Automatic CLI update deferred: ${error.message}`);
    }
  }
  if (newer(selectedVersion, VERSION)) {
    const entry = installedEntry(DATA_HOME, selectedVersion);
    const result = spawnSync(process.execPath, [entry, ...args], { stdio: 'inherit', env: { ...process.env, SDF_BOOTSTRAPPED: '1' } });
    if (result.error) throw result.error;
    return result.status ?? 1;
  }
}
