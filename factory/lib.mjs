import { readFileSync, writeFileSync, mkdirSync, renameSync } from 'node:fs';
import { resolve, dirname, join, isAbsolute } from 'node:path';
import { spawnSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';

import { ROOT, DEFAULT_STATE } from './paths.mjs';
import { isInferenceProvider, inferenceProviderFromModel } from './model-environment.mjs';
export { ROOT, DEFAULT_STATE };
export const PINS = JSON.parse(readFileSync(join(ROOT, 'factory/pins.json')));
export const json = path => JSON.parse(readFileSync(path, 'utf8'));
export function save(path, value) {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const temp = `${path}.${process.pid}.tmp`;
  writeFileSync(temp, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 }); renameSync(temp, path);
}
export function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, ...options });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} failed (${result.status}): ${result.stderr || result.stdout || ''}`);
  return result.stdout?.trim() ?? '';
}
export function stream(command, args, options = {}) {
  return new Promise((ok, fail) => {
    const child = spawn(command, args, { stdio: 'inherit', ...options });
    child.on('error', fail); child.on('exit', code => code === 0 ? ok() : fail(new Error(`${command} exited ${code}`)));
  });
}
export const digest = value => createHash('sha256').update(value).digest('hex');
export const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
export const API_TIMEOUT_MS = 5000;
export const PUBLICATION_API_TIMEOUT_MS = 10 * 60 * 1000;
const MAX_API_TIMEOUT_MS = 10 * 60 * 1000;
export function harnessOf(config) {
  if (config.harness !== undefined && config.agent !== undefined && config.harness !== config.agent)
    throw new Error('harness conflicts with legacy agent; keep one harness setting');
  const harness = config.harness ?? config.agent;
  if (!['mock', 'codex', 'pi', 'custom'].includes(harness)) throw new Error('Unsupported harness');
  return harness;
}
export function configAt(state) {
  const config = json(join(state, 'factory.json'));
  if (config.version !== 1) throw new Error('Unsupported configuration');
  const harness = harnessOf(config);
  if (config.inferenceProvider !== undefined) {
    if (!isInferenceProvider(config.inferenceProvider) || !['codex', 'pi'].includes(harness)
      || (harness === 'codex' && config.inferenceProvider !== 'openai'))
      throw new Error('inferenceProvider must select a supported Codex/Pi inference provider.');
    const modelProvider = inferenceProviderFromModel(config.model);
    if (harness === 'pi' && modelProvider && modelProvider !== config.inferenceProvider)
      throw new Error('inferenceProvider must match the provider in the configured model.');
  }
  if (!Array.isArray(config.command) || !config.command.length || !config.command.every(v => typeof v === 'string' && v && !v.includes('\0'))) throw new Error('command must be an argument array');
  if (!Number.isInteger(config.port) || config.port < 1024 || config.port > 65535) throw new Error('Invalid port');
  if (!Number.isInteger(config.timeoutSeconds) || config.timeoutSeconds < 1 || config.timeoutSeconds > 7200) throw new Error('timeoutSeconds must be 1–7200');
  if (!Number.isInteger(config.memoryMiB) || config.memoryMiB < 256) throw new Error('Invalid memory limit');
  if (config.cpus !== undefined && (!Number.isInteger(config.cpus) || config.cpus < 1 || config.cpus > 32)) throw new Error('cpus must be 1–32');
  if (config.pidsLimit !== undefined && (!Number.isInteger(config.pidsLimit) || config.pidsLimit < 64 || config.pidsLimit > 16384)) throw new Error('pidsLimit must be 64–16384');
  if (!['none','bridge'].includes(config.network)) throw new Error('network must be none or bridge; host networking is not supported');
  if (typeof config.image !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_./:@-]*$/.test(config.image)) throw new Error('Invalid container image');
  if (typeof config.repo !== 'string' || !isAbsolute(config.repo) || [config.repo,state,ROOT].some(p=>/[,\n\r]/.test(p))) throw new Error('Expected absolute paths without commas or line breaks');
  if (config.sourceRef !== undefined && (typeof config.sourceRef !== 'string' || !config.sourceRef || Buffer.byteLength(config.sourceRef) > 256 || /[\u0000-\u001f\u007f]/.test(config.sourceRef))) throw new Error('sourceRef must be a Git ref under 256 bytes');
  if (config.delivery !== undefined) {
    const delivery = config.delivery;
    if (!delivery || typeof delivery !== 'object' || Array.isArray(delivery)
      || typeof delivery.provider !== 'string' || !/^[a-z][a-z0-9-]{0,31}$/.test(delivery.provider))
      throw new Error('delivery must name a supported provider');
    // Unknown provider names are retained as patch-only configuration. They do
    // not select an adapter or enable an external write.
    if (delivery.provider === 'github') {
      if (typeof delivery.repository !== 'string'
        || !/^https:\/\/github\.com\/[A-Za-z0-9-]+\/[A-Za-z0-9_.-]+$/.test(delivery.repository)
        || delivery.repository.endsWith('.git')
        || !['main', 'dev'].includes(delivery.target))
        throw new Error('GitHub delivery requires a canonical repository URL and target main or dev');
    }
  }
  if (typeof config.check !== 'string' || !config.scope || !['project','service','environment','owner'].every(k=>typeof config.scope[k]==='string'&&config.scope[k].trim())) throw new Error('Missing check or installation scope');
  return config;
}
export async function api(state, path, body, method, { timeoutMs = API_TIMEOUT_MS } = {}) {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > MAX_API_TIMEOUT_MS)
    throw new Error(`API timeout must be between 1 and ${MAX_API_TIMEOUT_MS} milliseconds`);
  const config = configAt(state);
  const response = await fetch(`http://127.0.0.1:${config.port}${path}`, {
    method: method || (body === undefined ? 'GET' : 'POST'),
    headers: { Authorization: `Bearer ${readFileSync(join(state, 'worker.token'), 'utf8').trim()}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`Controller ${response.status}: ${text}`);
  return text ? JSON.parse(text) : null;
}
export function instanceLabel(state) { return digest(resolve(state)).slice(0, 16); }
export function containers(state) {
  const ids = run('docker', ['ps', '-aq', '--filter', `label=sdf.factory=${instanceLabel(state)}`]).split('\n').filter(Boolean);
  return ids.flatMap(id=>{
    const result=spawnSync('docker',['inspect',id],{encoding:'utf8'});
    if(result.error)throw result.error;
    // Normal completion can remove a container between list and inspect.
    if(result.status!==0) {
      if(/no such (object|container)/i.test(result.stderr))return [];
      throw new Error(`Cannot inspect job container: ${result.stderr}`);
    }
    return JSON.parse(result.stdout);
  });
}
export function stopContainers(state, jobId) {
  for (const item of containers(state)) {
    if (jobId && item.Config.Labels['sdf.job'] !== jobId) continue;
    if (item.State.Running) {
      try {run('docker', ['stop', '--time', '2', item.Id]);}
      catch(error) {if(containers(state).some(c=>c.Id===item.Id&&c.State.Running))throw error;}
    }
    try { run('docker', ['rm', item.Id]); } catch (error) {
      if (containers(state).some(c => c.Id === item.Id)) throw error;
    }
  }
}
