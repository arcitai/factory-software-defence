import test from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { validateModelEnvironment } from '../factory/model-environment.mjs';

test('agent model environment accepts private inference values and rejects host forge credentials', t => {
  const root = mkdtempSync(join(tmpdir(), 'sdf-model-env-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const path = join(root, 'model.env');
  writeFileSync(path, '# inference only\nOPENAI_API_KEY=fixture\nANTHROPIC_API_KEY=fixture\n', { mode: 0o600 });
  assert.equal(validateModelEnvironment(path), true);
  for (const line of ['GH_TOKEN=secret', 'GITHUB_TOKEN=secret', 'GIT_ASKPASS=/tmp/helper', 'ACTIONS_RUNTIME_TOKEN=secret', 'GH_TOKEN']) {
    writeFileSync(path, `${line}\n`, { mode: 0o600 });
    assert.throws(() => validateModelEnvironment(path), /inference settings only/);
  }
  chmodSync(path, 0o644);
  assert.throws(() => validateModelEnvironment(path), /missing, unsafe or unreadable/);
  const target = join(root, 'target'); writeFileSync(target, 'OPENAI_API_KEY=fixture\n', { mode: 0o600 });
  rmSync(path); symlinkSync(target, path);
  assert.throws(() => validateModelEnvironment(path), /missing, unsafe or unreadable/);
});
