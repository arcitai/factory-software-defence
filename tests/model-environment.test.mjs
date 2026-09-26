import test from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { configuredInferenceProvider, validateModelEnvironment, writeSelectedModelEnvironment } from '../factory/model-environment.mjs';
import { withRequestedModel } from '../factory/execution-profile.mjs';

test('model.env accepts supported inference settings and rejects unrelated credentials without echoing values', t => {
  const root = mkdtempSync(join(tmpdir(), 'sdf-model-env-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const path = join(root, 'model.env');
  writeFileSync(path, '# inference only\nOPENAI_API_KEY=fixture\nANTHROPIC_API_KEY=fixture\n', { mode: 0o600 });
  assert.equal(validateModelEnvironment(path), true);
  for (const line of [
    'DEPLOY_TOKEN=private-deploy-sentinel', 'GH_TOKEN=private-forge-sentinel',
    'GITHUB_TOKEN=private-forge-sentinel', 'GIT_ASKPASS=/private/helper',
    'ACTIONS_RUNTIME_TOKEN=private-actions-sentinel', 'AWS_ACCESS_KEY_ID=private-cloud-sentinel',
    'SYNTHETIC_TEST_VALUE=private', 'GH_TOKEN',
  ]) {
    writeFileSync(path, `${line}\n`, { mode: 0o600 });
    assert.throws(() => validateModelEnvironment(path), error => {
      assert.match(error.message, /supported inference settings only/);
      assert.doesNotMatch(error.message, /private-(?:deploy|forge|actions|cloud)-sentinel/);
      return true;
    });
  }
  chmodSync(path, 0o644);
  assert.throws(() => validateModelEnvironment(path), /missing, unsafe or unreadable/);
  const target = join(root, 'target'); writeFileSync(target, 'OPENAI_API_KEY=fixture\n', { mode: 0o600 });
  rmSync(path); symlinkSync(target, path);
  assert.throws(() => validateModelEnvironment(path), /missing, unsafe or unreadable/);
});

test('container env file contains only the installation-selected Pi provider and retains local OpenAI endpoint settings', t => {
  const root = mkdtempSync(join(tmpdir(), 'sdf-model-scope-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const source = join(root, 'model.env'), selected = join(root, 'selected.env'), codexSelected = join(root, 'codex.env');
  writeFileSync(source, [
    'OPENAI_API_KEY=openai-private-sentinel',
    'OPENAI_BASE_URL=http://model-bridge.internal:8000/v1',
    'ANTHROPIC_API_KEY=anthropic-private-sentinel',
    '',
  ].join('\n'), { mode: 0o600 });

  const operatorConfig = { harness: 'pi', command: ['pi'], inferenceProvider: 'openai', model: 'openai/default-model' };
  const trustedProvider = configuredInferenceProvider(operatorConfig);
  const effectiveConfig = withRequestedModel(operatorConfig, 'anthropic/requested-by-task');
  assert.equal(effectiveConfig.model, 'anthropic/requested-by-task');
  assert.equal(trustedProvider, 'openai', 'a task model override does not choose the credential provider');
  assert.equal(writeSelectedModelEnvironment(source, selected, {
    executor: effectiveConfig.harness, inferenceProvider: trustedProvider,
  }), true);

  const delivered = readFileSync(selected, 'utf8');
  assert.equal(delivered, 'OPENAI_API_KEY=openai-private-sentinel\nOPENAI_BASE_URL=http://model-bridge.internal:8000/v1\n');
  assert(!delivered.includes('ANTHROPIC_API_KEY'));
  assert(!delivered.includes('anthropic-private-sentinel'));
  assert.equal(statSync(selected).mode & 0o777, 0o600);
  assert.equal(writeSelectedModelEnvironment(source, codexSelected, { executor: 'codex' }), true);
  assert.equal(readFileSync(codexSelected, 'utf8'), delivered,
    'Codex receives the selected OpenAI key and local-compatible endpoint, never the other provider key');
});

test('Pi provider selection is required when trusted model.env contains credentials for multiple providers', t => {
  const root = mkdtempSync(join(tmpdir(), 'sdf-model-select-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const source = join(root, 'model.env'), selected = join(root, 'selected.env');
  writeFileSync(source, 'OPENAI_API_KEY=openai-sentinel\nANTHROPIC_API_KEY=anthropic-sentinel\n', { mode: 0o600 });
  assert.throws(() => writeSelectedModelEnvironment(source, selected, { executor: 'pi' }), /Select inferenceProvider/);
  assert.throws(() => readFileSync(selected), { code: 'ENOENT' });
  assert.equal(writeSelectedModelEnvironment(source, selected, { executor: 'pi', inferenceProvider: 'anthropic' }), true);
  assert.equal(readFileSync(selected, 'utf8'), 'ANTHROPIC_API_KEY=anthropic-sentinel\n');
});
