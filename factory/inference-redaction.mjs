import { randomBytes } from 'node:crypto';
import {
  closeSync, constants, fstatSync, lstatSync, openSync, readFileSync, renameSync, rmSync, writeFileSync,
} from 'node:fs';
import { join } from 'node:path';

const MAX_RETAINED_OUTPUT_BYTES = 1024 * 1024;
const REDACTION = '[REDACTED SELECTED INFERENCE CREDENTIAL]';
const WORKER_REPORTS = [
  ['agent-report.md', false],
  ['review.json', true],
  ['incident-report.json', true],
];

function variants(secret) {
  const jsonEscaped = JSON.stringify(secret).slice(1, -1);
  return [...new Set([secret, jsonEscaped].filter(Boolean))].sort((a, b) => b.length - a.length);
}

export function redactInferenceText(value, secrets) {
  let output = value;
  const ordered = [...new Set(secrets)].filter(Boolean).sort((a, b) => b.length - a.length);
  for (const secret of ordered) {
    for (const candidate of variants(secret)) output = output.split(candidate).join(REDACTION);
  }
  return output;
}

function redactJson(value, secrets) {
  if (typeof value === 'string') {
    const cleaned = redactInferenceText(value, secrets);
    return { value: cleaned, changed: cleaned !== value };
  }
  if (Array.isArray(value)) {
    let changed = false;
    const items = value.map(item => {
      const result = redactJson(item, secrets);
      changed ||= result.changed;
      return result.value;
    });
    return { value: items, changed };
  }
  if (!value || typeof value !== 'object') return { value, changed: false };
  let changed = false;
  const entries = [];
  for (const [key, item] of Object.entries(value)) {
    const safeKey = redactInferenceText(key, secrets), result = redactJson(item, secrets);
    changed ||= safeKey !== key || result.changed;
    entries.push([safeKey, result.value]);
  }
  if (new Set(entries.map(([key]) => key)).size !== entries.length)
    throw new Error('Worker report credential redaction would merge structured fields.');
  return { value: Object.fromEntries(entries), changed };
}

function readOwnedFile(path) {
  let descriptor;
  try {
    if (typeof constants.O_NOFOLLOW !== 'number') throw new Error();
    descriptor = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw new Error('Worker output is not a readable regular file; refusing to follow it.');
  }
  try {
    const stat = fstatSync(descriptor);
    if (!stat.isFile() || stat.size > MAX_RETAINED_OUTPUT_BYTES)
      throw new Error('Worker output is not a bounded regular file; refusing to retain it.');
    return readFileSync(descriptor, 'utf8');
  } finally { closeSync(descriptor); }
}

function writeOwnedReplacement(path, content) {
  const temporary = `${path}.redacted-${randomBytes(8).toString('hex')}`;
  let descriptor;
  try {
    if (typeof constants.O_NOFOLLOW !== 'number') throw new Error();
    descriptor = openSync(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    writeFileSync(descriptor, content, 'utf8');
    closeSync(descriptor);
    descriptor = undefined;
    renameSync(temporary, path);
  } catch {
    if (descriptor !== undefined) try { closeSync(descriptor); } catch {}
    try { rmSync(temporary, { force: true }); } catch {}
    throw new Error('Could not safely retain redacted worker output.');
  }
}

function redactFile(path, secrets, structured) {
  const source = readOwnedFile(path);
  if (source === null) return;
  let output = source;
  if (structured) {
    try {
      const result = redactJson(JSON.parse(source), secrets);
      if (result.changed) output = `${JSON.stringify(result.value, null, 2)}\n`;
    } catch (error) {
      if (error.message === 'Worker report credential redaction would merge structured fields.') throw error;
      output = redactInferenceText(source, secrets);
    }
  } else output = redactInferenceText(source, secrets);
  if (output !== source) writeOwnedReplacement(path, output);
}

// Called only after the phase container is absent. The report names are fixed
// controller-created outputs; arbitrary files and links are never traversed.
export function redactRetainedPhaseOutputs(runFolder, phase, secrets) {
  if (!secrets.length) return;
  const reportDirectory = join(runFolder, phase);
  try {
    const stat = lstatSync(reportDirectory);
    if (!stat.isDirectory() || stat.isSymbolicLink())
      throw new Error('Worker output directory is not a regular owned directory.');
    for (const [name, structured] of WORKER_REPORTS) redactFile(join(reportDirectory, name), secrets, structured);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  redactFile(join(runFolder, `${phase}.log`), secrets, false);
}
