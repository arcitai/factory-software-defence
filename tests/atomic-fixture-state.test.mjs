import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { publishFixtureState } from './helpers/atomic-fixture-state.mjs';

test('fixture publication exposes complete old JSON until same-directory rename, then complete new JSON', t => {
  const folder = mkdtempSync(join(tmpdir(), 'atomic-fixture-'));
  t.after(() => rmSync(folder, { recursive: true, force: true }));
  const path = join(folder, 'state.json');
  const old = { present: false, observations: [] };
  const next = { present: true, observations: Array(10000).fill('complete observation') };
  publishFixtureState(path, old);
  let observed = false;
  publishFixtureState(path, next, temporary => {
    observed = true;
    assert.equal(dirname(temporary), dirname(path));
    assert.deepEqual(JSON.parse(readFileSync(path, 'utf8')), old);
    assert.deepEqual(JSON.parse(readFileSync(temporary, 'utf8')), next);
  });
  assert.equal(observed, true);
  assert.deepEqual(JSON.parse(readFileSync(path, 'utf8')), next);
});
