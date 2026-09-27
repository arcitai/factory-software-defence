import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));

test('report redaction refuses a FIFO promptly without opening it as a blocking reader', t => {
  if (process.platform === 'win32') return t.skip('FIFO creation is not supported on Windows');
  const directory = mkdtempSync(join(tmpdir(), 'sdf-redaction-fifo-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const phaseDirectory = join(directory, 'review');
  mkdirSync(phaseDirectory, { mode: 0o700 });
  const fifo = join(phaseDirectory, 'agent-report.md');
  try { execFileSync('mkfifo', [fifo]); }
  catch (error) { return t.skip(`mkfifo is unavailable: ${error.message}`); }

  const moduleUrl = pathToFileURL(join(root, 'factory/inference-redaction.mjs')).href;
  const script = `import { redactRetainedPhaseOutputs } from ${JSON.stringify(moduleUrl)};
try { redactRetainedPhaseOutputs(${JSON.stringify(directory)}, 'review', ['inert-fifo-sentinel']); process.exitCode = 2; }
catch (error) { if (!/regular file/.test(error.message)) { process.stderr.write(error.message); process.exitCode = 3; } }
`;
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8', timeout: 3000 });
  assert.ifError(child.error, 'FIFO handling must finish before the bounded subprocess timeout');
  assert.equal(child.status, 0, child.stderr || child.stdout || `unexpected child status ${child.status}`);
});
