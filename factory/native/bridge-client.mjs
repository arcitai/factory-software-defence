import { randomUUID } from 'node:crypto';
import { readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const location = state => join(state, 'bridge.json');
const unavailable = () => new Error('Factory is not connected to its running bridge. Start its service or run factory serve; no native operation was retried.');

// Only the serving process owns native turn operations. A second app-server
// reads persisted history but cannot reliably observe that process's live turns.
export function registerBridge(state, repo, port, instance) {
  const path = location(state), temporary = `${path}.${randomUUID()}`;
  const record = { version: 1, repo, url: `http://127.0.0.1:${port}`, instance };
  writeFileSync(temporary, `${JSON.stringify(record)}\n`, { flag: 'wx', mode: 0o600 });
  renameSync(temporary, path);
  return () => {
    try {
      if (JSON.parse(readFileSync(path, 'utf8')).instance === instance) rmSync(path);
    } catch (error) {
      if (error.code !== 'ENOENT') process.stderr.write('Factory bridge reference could not be removed; verify it before reuse.\n');
    }
  };
}

export async function connectBridge(state, repo) {
  let record;
  try { record = JSON.parse(readFileSync(location(state), 'utf8')); }
  catch { throw unavailable(); }
  if (record.version !== 1 || record.repo !== repo || typeof record.instance !== 'string'
    || !/^http:\/\/127\.0\.0\.1:[1-9][0-9]{3,4}$/.test(record.url)
    || Number(new URL(record.url).port) > 65535) throw unavailable();
  let status;
  try {
    const response = await fetch(`${record.url}/api/v1/bridge/status`, { signal: AbortSignal.timeout(5000), redirect: 'error' });
    if (!response.ok) throw unavailable();
    status = await response.json();
  } catch { throw unavailable(); }
  if (status.native !== true || status.repo !== repo || status.native_instance !== record.instance
    || !/^[a-f0-9]{64}$/.test(status.csrf_token || '')) throw unavailable();
  const request = async (path, input) => {
    if (!path.startsWith('/api/v1/')) throw new Error('Unsupported Factory API path.');
    let response;
    try {
      response = await fetch(`${record.url}${path}`, {
        method: input === undefined ? 'GET' : 'POST',
        headers: { 'x-factory-session': status.csrf_token, ...(input === undefined ? {} : { 'content-type': 'application/json' }) },
        body: input === undefined ? undefined : JSON.stringify(input),
        signal: AbortSignal.timeout(90000), redirect: 'error',
      });
    } catch {
      throw new Error('Factory connection was lost; the operation outcome may be unknown. Inspect its native history or receipt before retrying.');
    }
    let result;
    try { result = await response.json(); }
    catch { throw new Error('Factory returned an unreadable response. Preserve the operation as unresolved; no retry was attempted.'); }
    if (!response.ok) throw new Error(result.error || `Factory operation failed (HTTP ${response.status}).`);
    return result;
  };
  const { csrf_token, ...publicStatus } = status;
  return { status: publicStatus, request, instance: record.instance, url: record.url };
}
