import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const cli = join(root, 'bin/software-defence-factory.mjs');
function run(args, cwd) {
  const result = spawnSync(process.execPath, [cli, ...args], { cwd, encoding: 'utf8', timeout: 15000 });
  if (result.error) throw result.error;
  return { ...result, data: result.stdout.trim() ? JSON.parse(result.stdout) : null };
}

test('same CLI validates all examples and coherent staged output without native state or credentials', t => {
  const temp = mkdtempSync(join(tmpdir(), 'factory-definition-cli-'));
  t.after(() => rmSync(temp, { recursive: true, force: true }));
  for (const name of ['software', 'content', 'design']) {
    const file = join(root, `adlc/examples/definitions/${name}/factory.yaml`);
    const validation = run(['definition', 'validate', '--file', file, '--repo', root], temp);
    assert.equal(validation.status, 0, validation.stderr);
    assert.equal(validation.data.valid, true);
    assert.equal(validation.data.execution.qualified, false);
    const output = join(temp, name);
    const staging = run(['kit', '--definition', file, '--repo', root, '--output', output], temp);
    assert.equal(staging.status, 0, staging.stderr);
    assert.equal(staging.data.definition.snapshotDigest, validation.data.snapshotDigest);
    const copied = run(['definition', 'validate', '--file', join(output, 'project/factory.yaml'), '--repo', join(output, 'project')], temp);
    assert.equal(copied.status, 0, copied.stderr);
    assert.deepEqual(copied.data, validation.data);
    const receipt = readFileSync(join(output, '.factory-kit/manifest.json'));
    const repeat = run(['kit', '--definition', file, '--repo', root, '--output', output], temp);
    assert.equal(repeat.status, 1);
    assert.equal(repeat.data.errors[0].code, 'DESTINATION_EXISTS');
    assert.deepEqual(readFileSync(join(output, '.factory-kit/manifest.json')), receipt);
  }
});

test('CLI emits located JSON and nonzero exit on invalid input; creates no destination', t => {
  const temp = mkdtempSync(join(tmpdir(), 'factory-definition-cli-fail-'));
  t.after(() => rmSync(temp, { recursive: true, force: true }));
  const file = join(temp, 'factory.yaml'), output = join(temp, 'output');
  writeFileSync(file, 'name: first\nname: second\n');
  for (const args of [
    ['definition', 'validate', '--file', file, '--repo', root],
    ['kit', '--definition', file, '--repo', root, '--output', output],
  ]) {
    const result = run(args, temp);
    assert.equal(result.status, 1);
    assert.equal(result.data.valid, false);
    assert.equal(result.data.errors[0].code, 'YAML_DUPLICATE_KEY');
    assert.equal(result.data.errors[0].line, 2);
    assert.equal(result.data.errors[0].column, 1);
    assert.match(result.stderr, /:2:1:/);
    assert.equal(existsSync(output), false);
  }
  for (const args of [
    ['definition', 'validate', '--file', file],
    ['definition', 'validate', '--file', file, '--file', file, '--repo', root],
    ['kit', '--definition', file, '--output', output],
  ]) {
    const result = run(args, temp);
    assert.equal(result.status, 1);
    assert.equal(result.data.valid, false);
    assert.equal(result.data.errors[0].code, 'DEFINITION_COMMAND');
    assert.equal(existsSync(output), false);
  }
});
