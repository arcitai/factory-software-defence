import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, chmodSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { configAt, ROOT, digest, save } from '../factory/lib.mjs';
import { parseRoleDefinition, resolveRoleProfiles, inheritedDefinition } from '../factory/role-definition.mjs';
import { inspectDefinition, previewDefinition, changeDefinition } from '../factory/definition-store.mjs';
import { effectiveExecutionConfig, executionProfile, phaseExecutionConfig, assertFrozenExecution, isSupportedExecutionProfile } from '../factory/execution-profile.mjs';
import { assertCurrentHandoffEvidence, trustedExecutionProfile } from '../factory/execution-evidence.mjs';
import { createController } from '../factory/server.mjs';

const definition = { version: 1, roles: { implement: { harness: 'codex', model: 'build-model', reasoningEffort: 'high' },
  review: { harness: 'pi', model: 'anthropic/review-model' } } };
function installation(t) {
  const state = mkdtempSync(join(tmpdir(), 'factory-roles-')); t.after(() => rmSync(state, { recursive: true, force: true }));
  const config = { version: 1, repo: state, harness: 'codex', command: ['private-wrapper', 'exec', '--private-setting', 'PRIVATE_SENTINEL', '-'],
    model: 'installed-model', image: 'sha256:' + 'a'.repeat(64), port: 7349, timeoutSeconds: 10, memoryMiB: 256,
    network: 'none', check: 'true', scope: { project: 'p', service: 's', owner: 'o', environment: 'e' } };
  writeFileSync(join(state, 'factory.json'), JSON.stringify(config));
  writeFileSync(join(state, 'worker.token'), 'fixture-token');
  writeFileSync(join(state, 'model.env'), 'OPENAI_API_KEY=inert-openai\nANTHROPIC_API_KEY=inert-anthropic\n', { mode: 0o600 });
  return { state, config };
}
const idle = () => ({ closing: false, maintenance: false, active: null, actions: new Set(), issueActions: new Map(), all: () => [] });

const codexModelOptions = [
  ['-m', 'old-model'], ['-mold-model'], ['-m=old-model'],
  ['--model', 'old-model'], ['--model=old-model'],
  ['-c', 'model="old-model"'], ['-cmodel="old-model"'], ['-c=model="old-model"'],
  ['--config', 'model = "old-model"'], ['--config=model="old-model"'],
  ['-c', '"model" = "old-model"'], ['-c', "'model'='old-model'"],
];
const codexEffortOptions = [
  ['-c', 'model_reasoning_effort="low"'], ['-cmodel_reasoning_effort="low"'],
  ['-c=model_reasoning_effort="low"'], ['--config', 'model_reasoning_effort = "low"'],
  ['--config=model_reasoning_effort="low"'], ['-c', '"model_reasoning_effort"="low"'],
  ['-c', "'model_reasoning_effort'='low'"],
];
for (const tail of [['--', 'PROMPT'], ['--', '-'], ['-'], ['PROMPT'], [],
  ['--', '-m prompt-model --config model_reasoning_effort="prompt text"']]) {
  test(`Codex effort-only adoption preserves inherited model and prompt tail ${JSON.stringify(tail)}`, t => {
    const { state, config } = installation(t);
    const proposal = { version: 1, roles: { review: { reasoningEffort: 'high' } } };
    for (const options of [[], ...codexEffortOptions, codexEffortOptions.flat()]) {
      config.model = 'old-model';
      config.command = ['codex', '-c', 'model_reasoning_effort="medium"', 'exec', '-mold-model',
        '--color=never', '-c', 'instructions="keep model_reasoning_effort and --model"', ...options, ...tail];
      writeFileSync(join(state, 'factory.json'), JSON.stringify(config));
      const legacy = effectiveExecutionConfig(configAt(state));
      const preview = previewDefinition(state, proposal);
      const applied = changeDefinition(state, idle(), { expected_revision: preview.revision, definition: proposal });
      const common = effectiveExecutionConfig(configAt(state));
      assert.deepEqual(phaseExecutionConfig(common, 'review').command, ['codex', 'exec', '-mold-model',
        '--color=never', '-c', 'instructions="keep model_reasoning_effort and --model"',
        '-c', 'model_reasoning_effort="high"', ...tail]);
      assert.deepEqual(phaseExecutionConfig(common, 'build').command, config.command);
      const evidence = executionProfile(common, 'review');
      assert.equal(evidence.reasoningEffort, 'high');
      assert.equal(evidence.requestedModel, 'old-model');
      assert.equal(applied.effective.review.modelSource, 'installed');
      assert.equal(evidence.policyHash, executionProfile(common, 'verify').policyHash);
      assert.equal(executionProfile(common, 'verify').reasoningEffort, null);
      assertFrozenExecution(common, evidence, 'review');
      changeDefinition(state, idle(), { expected_revision: applied.revision }, true);
      assert.deepEqual(effectiveExecutionConfig(configAt(state)), legacy, 'all-inherit restores exact argv and policy');
    }
  });
}

test('combined Codex model/effort adoption removes only selected settings before the prompt', t => {
  const { state, config } = installation(t);
  const tail = ['--', '--model prompt-model -c model_reasoning_effort="prompt text"'];
  for (const model of ['selected-model', null]) {
    config.command = ['codex', '-c', 'model_reasoning_effort="low"', 'exec', '-mold-model',
      '--config=model="old-model"', '--config=model_reasoning_effort="medium"', '--json', ...tail];
    writeFileSync(join(state, 'factory.json'), JSON.stringify(config));
    const proposal = { version: 1, roles: { review: { model, reasoningEffort: 'high' } } };
    const applied = changeDefinition(state, idle(), { expected_revision: inspectDefinition(state).revision, definition: proposal });
    const common = effectiveExecutionConfig(configAt(state));
    assert.deepEqual(phaseExecutionConfig(common, 'review').command, ['codex', 'exec', '--json',
      ...(model === null ? [] : ['--model', model]), '-c', 'model_reasoning_effort="high"', ...tail]);
    const evidence = executionProfile(common, 'review');
    assert.equal(evidence.reasoningEffort, 'high');
    assert.equal(evidence.requestedModel, model);
    assert.equal(evidence.modelSelection, model === null ? 'provider_default' : 'explicit');
    assertFrozenExecution(common, evidence, 'review');
    changeDefinition(state, idle(), { expected_revision: applied.revision }, true);
  }
});

test('effort-only selection never substitutes installed model metadata for private model argv', () => {
  for (const options of codexModelOptions) {
    const config = { harness: 'codex', model: 'different-installed-metadata', command: ['codex', 'exec', ...options, '--', '-'] };
    const profiles = resolveRoleProfiles(config, { version: 1, roles: { review: { reasoningEffort: 'high' } } });
    assert.deepEqual(profiles.review.command, ['codex', 'exec', ...options, '-c', 'model_reasoning_effort="high"', '--', '-']);
    assert.deepEqual(profiles.implement.command, config.command);
  }
});

for (const model of ['selected-model', null]) {
  test(`adopted Codex model ${model} replaces inherited options in command and frozen evidence`, t => {
    const { state, config } = installation(t);
    for (const inheritedOptions of [...codexModelOptions, codexModelOptions.flat()]) {
      config.command = ['codex', 'exec', '--json', ...inheritedOptions, '-c', 'model_reasoning_effort="low"', '-'];
      config.model = 'old-model';
      writeFileSync(join(state, 'factory.json'), JSON.stringify(config));
      const before = inspectDefinition(state);
      const proposal = { version: 1, roles: { review: { model } } };
      const preview = previewDefinition(state, proposal);
      const applied = changeDefinition(state, idle(), { expected_revision: before.revision, definition: proposal });
      assert.equal(preview.effective.review.model, model);
      assert.equal(applied.effective.review.model, model);
      const common = effectiveExecutionConfig(configAt(state), null, join(state, 'model.env'));
      const command = phaseExecutionConfig(common, 'review').command;
      assert.deepEqual(command, ['codex', 'exec', '--json', '-c', 'model_reasoning_effort="low"',
        ...(model === null ? [] : ['--model', model]), '-'], JSON.stringify(inheritedOptions));
      const evidence = executionProfile(common, 'review');
      assert.equal(evidence.requestedModel, model);
      assert.equal(evidence.modelSelection, model === null ? 'provider_default' : 'explicit');
      assert.equal(evidence.version, 2);
      assertFrozenExecution(common, evidence, 'review');
      assert.equal(evidence.policyHash, executionProfile(common, 'verify').policyHash);
      changeDefinition(state, idle(), { expected_revision: applied.revision }, true);
      assert.deepEqual(effectiveExecutionConfig(configAt(state)).command, config.command);
    }
  });
}

test('Codex normalization preserves argument values, prompt boundaries and all-inherit legacy bytes', t => {
  const { state, config } = installation(t);
  const cases = [
    { before: ['codex', '-c', 'model="old-model"', 'exec', '-mold-model', '--color=never', '-'],
      after: ['codex', 'exec', '--color=never', '--model', 'selected-model', '-'] },
    { before: ['codex', 'exec', '-mold-model', '--output-schema=--model', '--', '-mold-model'],
      after: ['codex', 'exec', '--output-schema=--model', '--model', 'selected-model', '--', '-mold-model'] },
    { before: ['codex', 'exec', '--model=old-model', 'Explain --model old-model and -c model="old-model"'],
      after: ['codex', 'exec', '--model', 'selected-model', 'Explain --model old-model and -c model="old-model"'] },
    { before: ['codex', 'exec', '-c', 'instructions="keep --model and model=old-model"', '-mold-model'],
      after: ['codex', 'exec', '-c', 'instructions="keep --model and model=old-model"', '--model', 'selected-model'] },
  ];
  for (const { before, after } of cases) {
    config.command = before;
    writeFileSync(join(state, 'factory.json'), JSON.stringify(config));
    const original = effectiveExecutionConfig(configAt(state));
    const unchanged = changeDefinition(state, idle(), { expected_revision: inspectDefinition(state).revision, definition: inheritedDefinition() });
    assert.deepEqual(effectiveExecutionConfig(configAt(state)), original);
    assert.deepEqual(original.command, before);
    const applied = changeDefinition(state, idle(), { expected_revision: unchanged.revision,
      definition: { version: 1, roles: { review: { model: 'selected-model' } } } });
    const common = effectiveExecutionConfig(configAt(state));
    assert.deepEqual(phaseExecutionConfig(common, 'review').command, after);
    assert.deepEqual(phaseExecutionConfig(common, 'build').command, before);
    const withEffort = resolveRoleProfiles(config, { version: 1, roles: { review: { model: 'selected-model', reasoningEffort: 'high' } } });
    const expectedWithEffort = after.slice();
    expectedWithEffort.splice(after.indexOf('selected-model') + 1, 0, '-c', 'model_reasoning_effort="high"');
    assert.deepEqual(withEffort.review.command, expectedWithEffort, 'combined controls stay before the prompt boundary');
    changeDefinition(state, idle(), { expected_revision: applied.revision }, true);
  }
});

test('strict portable schema rejects unsupported capabilities and invalid combinations', () => {
  for (const value of [null, [], {}, { version: 2, roles: {} }, { version: 1, roles: { foreman: {} } },
    { version: 1, roles: { implement: null } }, { version: 1, roles: { implement: { harness: null } } },
    { version: 1, roles: { review: { harness: 'custom' } } }, { version: 1, roles: {}, secrets: {} },
    ...['command', 'skills', 'cpus', 'network', 'provider', 'access', 'secret', 'image'].map(field => ({ version: 1, roles: { implement: { [field]: 'denied' } } })),
    ...['/secret/path', 'C:/secret/path', '../secret', '--help', 'model name', 'a\nb', 'https://provider.invalid'].map(model => ({ version: 1, roles: { implement: { model } } })),
    { version: 1, roles: { review: { harness: 'pi', model: 'unqualified' } } },
    { version: 1, roles: { review: { harness: 'pi', model: 'anthropic/model', reasoningEffort: 'high' } } },
    { version: 1, roles: { implement: { reasoningEffort: 'invented' } } },
  ]) assert.throws(() => parseRoleDefinition(value));
  assert.equal(parseRoleDefinition(definition).roles.investigate.harness, 'inherit');
  assert.throws(() => resolveRoleProfiles({ harness: 'custom', command: ['wrapper'] }, { version: 1, roles: { implement: { model: 'x' } } }), /does not support/);
  assert.throws(() => resolveRoleProfiles({ harness: 'pi', command: ['pi'], inferenceProvider: 'openai' }, { version: 1, roles: { review: { model: 'anthropic/model' } } }), /conflicts/);
});

test('adoption freezes role selections under one policy; inheritance and rollback preserve exact legacy policy', t => {
  const { state, config } = installation(t), queue = idle();
  const legacy = effectiveExecutionConfig(config, null, join(state, 'model.env'));
  assert.deepEqual(configAt(state), config);
  const initial = inspectDefinition(state), preview = previewDefinition(state, definition);
  assert.equal(preview.changes.length, 2); assert.equal(preview.revision, initial.revision);
  assert.doesNotMatch(JSON.stringify(preview), /PRIVATE_SENTINEL|private-wrapper|inert-openai/);
  const applied = changeDefinition(state, queue, { expected_revision: initial.revision, definition });
  assert.equal(applied.effective.review.harness, 'pi');
  assert.deepEqual(readFileSync(join(state, 'factory.json'), 'utf8'), JSON.stringify(config));
  const common = effectiveExecutionConfig(configAt(state), null, join(state, 'model.env'));
  const profiles = ['build', 'verify', 'review', 'handoff', 'defence'].map(phase => executionProfile(common, phase));
  assert.equal(new Set(profiles.map(p => p.policyHash)).size, 1);
  assert(profiles.every(p => p.version === 2 && isSupportedExecutionProfile(p)));
  assert.deepEqual(profiles.map(p => p.executor), ['codex', 'deterministic', 'pi', 'deterministic', 'codex']);
  assert.deepEqual(profiles.map(p => p.requestedModel), ['build-model', null, 'anthropic/review-model', null, 'installed-model']);
  assert.deepEqual(phaseExecutionConfig(common, 'defence').command, config.command, 'private inherited command is exact');
  assert(phaseExecutionConfig(common, 'build').command.includes('model_reasoning_effort="high"'));
  assert(!phaseExecutionConfig(common, 'review').command.includes('PRIVATE_SENTINEL'));
  assert.throws(() => effectiveExecutionConfig(configAt(state), 'task-model'), /Task model overrides/);
  assert.throws(() => assertFrozenExecution(common, { ...profiles[2], executor: 'codex' }, 'review'), /does not match/);
  assert.throws(() => assertFrozenExecution(common, { ...profiles[2], version: 1 }, 'review'), /does not match/);
  const meta = { head: 'head', tree: 'tree', build_policy_hash: profiles[0].policyHash };
  const checks = { ...meta, passed: true, policyHash: profiles[1].policyHash };
  const review = { ...meta, verdict: 'pass', policyHash: profiles[2].policyHash };
  assert.doesNotThrow(() => assertCurrentHandoffEvidence(meta, checks, review, profiles[3].policyHash));
  assert.throws(() => assertCurrentHandoffEvidence(meta, checks, review, digest(JSON.stringify(legacy))), /current policy/);
  const rollback = changeDefinition(state, queue, { expected_revision: applied.revision }, true);
  assert.notEqual(rollback.revision, initial.revision, 'revision prevents ABA after rollback');
  assert.deepEqual(effectiveExecutionConfig(configAt(state), null, join(state, 'model.env')), legacy);
  assert.equal(executionProfile(legacy, 'build').version, 1);
  assert.deepEqual(common.resolvedRoleProfiles.review.model, 'anthropic/review-model', 'prior frozen config stays unchanged');
});

test('stale, busy, invalid and failed writes preserve previous definition; history survives restart and stays bounded', t => {
  const { state } = installation(t), queue = idle(), start = inspectDefinition(state);
  for (const busy of ['queued', 'running', 'cancelling', 'awaiting_approval', 'unknown']) {
    queue.all = () => [{ state: busy }];
    assert.throws(() => changeDefinition(state, queue, { expected_revision: start.revision, definition }), /busy/);
    assert.deepEqual(inspectDefinition(state), start);
  }
  queue.all = () => [];
  const applied = changeDefinition(state, queue, { expected_revision: start.revision, definition });
  assert.throws(() => changeDefinition(state, queue, { expected_revision: start.revision, definition: inheritedDefinition() }), /revision changed/);
  assert.throws(() => changeDefinition(state, queue, { expected_revision: applied.revision, definition: { ...definition, version: 9 } }), /version/);
  assert.deepEqual(inspectDefinition(state), applied);
  const path = join(state, 'role-definition.json'), bytes = readFileSync(path);
  chmodSync(state, 0o500);
  try { assert.throws(() => changeDefinition(state, queue, { expected_revision: applied.revision, definition: inheritedDefinition() }), /EACCES/); }
  finally { chmodSync(state, 0o700); }
  assert.deepEqual(readFileSync(path), bytes);
  writeFileSync(`${path}.interrupted.tmp`, 'incomplete');
  assert.deepEqual(inspectDefinition(state), applied, 'orphaned uncommitted file is ignored on restart');
  for (let i = 0; i < 12; i++) changeDefinition(state, queue, { expected_revision: inspectDefinition(state).revision,
    definition: { version: 1, roles: { implement: { harness: 'codex', model: `model-${i}` } } } });
  assert.equal(JSON.parse(readFileSync(path)).history.length, 10);
});

async function cli(state, args) {
  return new Promise(resolve => {
    const child = spawn(process.execPath, [join(ROOT, 'bin/software-defence-factory.mjs'), 'definition', ...args, '--state', state], { env: { ...process.env, SDF_AUTO_UPDATE: '0' } });
    let stdout = '', stderr = ''; child.stdout.on('data', v => stdout += v); child.stderr.on('data', v => stderr += v);
    child.on('close', code => resolve({ code, stdout, stderr }));
  });
}
test('CLI and authenticated API share preview, concurrent CAS application, fresh catalog and rollback/restart', async t => {
  const { state, config } = installation(t);
  const adapter = { execute: async () => ({ outcome: 'blocked' }), stop: async () => {}, reconcile: async () => {} };
  let controller;
  const start = async () => {
    controller = createController(state, adapter); await new Promise(r => controller.server.listen(0, '127.0.0.1', r));
    config.port = controller.server.address().port; writeFileSync(join(state, 'factory.json'), JSON.stringify(config));
    return `http://127.0.0.1:${config.port}`;
  };
  let origin = await start(); t.after(() => controller.close());
  const get = async path => (await fetch(origin + path)).json();
  const post = (path, data, headers = { Authorization: 'Bearer fixture-token' }) => fetch(origin + path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(data) });
  const file = join(state, 'proposed.json'); writeFileSync(file, JSON.stringify(definition));
  const current = (await get('/api/v1/definitions')).role_definition;
  assert.equal((await post('/api/v1/definition/apply', { definition, expected_revision: current.revision }, {})).status, 403);
  const preview = await (await post('/api/v1/definition/diff', { definition })).json();
  const cliPreview = await cli(state, ['diff', '--file', file]); assert.equal(cliPreview.code, 0, cliPreview.stderr);
  assert.deepEqual(JSON.parse(cliPreview.stdout), preview);
  const results = await Promise.all([post('/api/v1/definition/apply', { definition, expected_revision: preview.revision }), post('/api/v1/definition/apply', { definition, expected_revision: preview.revision })]);
  assert.deepEqual(results.map(r => r.status).sort(), [200, 409]);
  const catalog = await get('/api/v1/definitions');
  assert.equal(catalog.agents.find(a => a.id === 'review').model, 'anthropic/review-model');
  assert.equal(controller.queue.all().length, 0, 'adoption does not admit work');
  const refused = await post('/api/v1/jobs', { workflow: 'software', repository: 'app', spec: 'fixture', model: 'override' });
  assert.equal(refused.status, 400); assert.match((await refused.json()).error, /Task model overrides/);
  const before = readFileSync(join(state, 'role-definition.json'));
  await controller.close(); origin = await start();
  assert.deepEqual(readFileSync(join(state, 'role-definition.json')), before);
  const revision = (await get('/api/v1/definitions')).role_definition.revision;
  const rolled = await cli(state, ['rollback', '--expected-revision', revision]);
  assert.equal(rolled.code, 0, rolled.stderr);
  assert.equal(JSON.parse(rolled.stdout).effective.review.harness, 'codex');
  assert.equal((await get('/api/v1/definitions')).agents[1].model, 'installed-model');
  assert.deepEqual(JSON.parse((await cli(state, ['export'])).stdout), inheritedDefinition());
});

test('CLI/API validation and application share Codex normalization and atomic ambiguous-command refusal', async t => {
  const { state, config } = installation(t);
  const controller = createController(state, { execute: async () => ({ outcome: 'blocked' }), stop: async () => {}, reconcile: async () => {} });
  await new Promise(resolve => controller.server.listen(0, '127.0.0.1', resolve));
  t.after(() => controller.close());
  config.port = controller.server.address().port;
  const post = (action, data) => fetch(`http://127.0.0.1:${config.port}/api/v1/definition/${action}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer fixture-token' }, body: JSON.stringify(data),
  });
  const file = join(state, 'proposed.json');
  for (const model of ['selected-model', null]) {
    const proposal = { version: 1, roles: { review: { model } } };
    writeFileSync(file, JSON.stringify(proposal));
    for (const options of [['-m', 'old-model'], ['-m=old-model'], ['--config=model="old-model"']]) {
      config.command = ['codex', 'exec', ...options, '-']; config.model = 'old-model';
      writeFileSync(join(state, 'factory.json'), JSON.stringify(config));
      const apiValidation = await post('validate', { definition: proposal });
      assert.equal(apiValidation.status, 200);
      const preview = await apiValidation.json();
      const cliValidation = await cli(state, ['validate', '--file', file]);
      assert.equal(cliValidation.code, 0, cliValidation.stderr);
      assert.deepEqual(JSON.parse(cliValidation.stdout), preview);
      // Exercise both writers against the same effective command/evidence boundary.
      for (const transport of ['cli', 'api']) {
        const revision = inspectDefinition(state).revision;
        if (transport === 'cli') {
          const applied = await cli(state, ['apply', '--file', file, '--expected-revision', revision]);
          assert.equal(applied.code, 0, applied.stderr);
        } else assert.equal((await post('apply', { definition: proposal, expected_revision: revision })).status, 200);
        const common = effectiveExecutionConfig(configAt(state));
        assert.deepEqual(phaseExecutionConfig(common, 'review').command,
          ['codex', 'exec', ...(model === null ? [] : ['--model', model]), '-']);
        assert.equal(executionProfile(common, 'review').requestedModel, model);
        assert.equal((await post('rollback', { expected_revision: inspectDefinition(state).revision })).status, 200);
      }
    }
    for (const command of [
      ['wrapper', 'exec', '-mold-model', '-'],
      ['codex', 'exec', '--profile', 'private-model-profile', '-'],
      ['codex', 'exec', '-pprivate-model-profile', '-'],
      ['codex', 'exec', '--config', 'profiles.private.model="old-model"', '-'],
      ['codex', 'exec', '-c', 'profile="private"', '-'],
      ['codex', 'exec', '-c', '"m\\u006fdel"="old-model"', '-'],
      ['codex', 'exec', '--unknown-private-option', '-mold-model', '-'],
      ['codex', 'exec', '-m'], ['codex', 'exec', '--model='],
      ['codex', 'exec', 'prompt', '-mold-model'], ['codex', 'exec', 'resume', '-'],
    ]) {
      config.command = command;
      writeFileSync(join(state, 'factory.json'), JSON.stringify(config));
      const before = inspectDefinition(state), bytes = readFileSync(join(state, 'role-definition.json'));
      assert.deepEqual(effectiveExecutionConfig(configAt(state)).command, command, 'all-inherit still preserves opaque commands');
      const validation = await post('validate', { definition: proposal });
      assert.equal(validation.status, 400, JSON.stringify(command));
      assert.match((await validation.json()).error, /cannot safely override/);
      assert.notEqual((await cli(state, ['validate', '--file', file])).code, 0);
      assert.equal((await post('apply', { definition: proposal, expected_revision: before.revision })).status, 400);
      const cliApply = await cli(state, ['apply', '--file', file, '--expected-revision', before.revision]);
      assert.notEqual(cliApply.code, 0); assert.match(cliApply.stderr, /cannot safely override/);
      assert.deepEqual(inspectDefinition(state), before);
      assert.deepEqual(readFileSync(join(state, 'role-definition.json')), bytes);
    }
  }
});


test('CLI/API share effort-only and combined adoption, and refuse ambiguous effort commands without writes', async t => {
  const { state, config } = installation(t);
  const controller = createController(state, { execute: async () => ({ outcome: 'blocked' }), stop: async () => {}, reconcile: async () => {} });
  await new Promise(resolve => controller.server.listen(0, '127.0.0.1', resolve));
  t.after(() => controller.close());
  config.port = controller.server.address().port;
  const post = (action, data) => fetch(`http://127.0.0.1:${config.port}/api/v1/definition/${action}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer fixture-token' }, body: JSON.stringify(data),
  });
  const file = join(state, 'proposed.json');
  for (const selection of [{ reasoningEffort: 'high' }, { reasoningEffort: 'high', model: 'selected-model' }]) {
    const proposal = { version: 1, roles: { review: selection } };
    writeFileSync(file, JSON.stringify(proposal));
    for (const tail of [['--', 'PROMPT'], ['--', '-'], ['-']]) {
      config.model = 'old-model';
      config.command = ['codex', 'exec', '-mold-model', '--config=model_reasoning_effort="low"', ...tail];
      writeFileSync(join(state, 'factory.json'), JSON.stringify(config));
      const validation = await post('validate', { definition: proposal });
      assert.equal(validation.status, 200);
      const preview = await validation.json();
      const cliValidation = await cli(state, ['validate', '--file', file]);
      assert.equal(cliValidation.code, 0, cliValidation.stderr);
      assert.deepEqual(JSON.parse(cliValidation.stdout), preview);
      for (const transport of ['cli', 'api']) {
        const revision = inspectDefinition(state).revision;
        if (transport === 'cli') {
          const applied = await cli(state, ['apply', '--file', file, '--expected-revision', revision]);
          assert.equal(applied.code, 0, applied.stderr);
        } else assert.equal((await post('apply', { definition: proposal, expected_revision: revision })).status, 200);
        const common = effectiveExecutionConfig(configAt(state));
        assert.deepEqual(phaseExecutionConfig(common, 'review').command, ['codex', 'exec',
          ...(selection.model ? ['--model', selection.model] : ['-mold-model']), '-c', 'model_reasoning_effort="high"', ...tail]);
        assert.equal(executionProfile(common, 'review').reasoningEffort, 'high');
        assert.equal(executionProfile(common, 'review').requestedModel, selection.model || 'old-model');
        assert.equal((await post('rollback', { expected_revision: inspectDefinition(state).revision })).status, 200);
      }
    }
    for (const command of [
      ['wrapper', 'exec', '--', 'PROMPT'], ['codex', 'exec', '--profile', 'private-profile', '-'],
      ['codex', 'exec', '--unknown-option', '-'], ['codex', 'exec', 'PROMPT', '--json'],
      ['codex', 'exec', '--', 'PROMPT', 'EXTRA'],
      ...(!Object.hasOwn(selection, 'model') ? [['codex', 'exec', '-mold-model', '--model=another-model', '-']] : []),
      ['codex', 'exec', '-c', 'profiles.private.model_reasoning_effort="low"', '-'],
      ['codex', 'exec', '-c', 'model_reasoning_effort.nested="low"', '-'],
      ['codex', 'exec', '-c', '"model_reasoning_\\u0065ffort"="low"', '-'],
    ]) {
      config.command = command;
      writeFileSync(join(state, 'factory.json'), JSON.stringify(config));
      const before = inspectDefinition(state), bytes = readFileSync(join(state, 'role-definition.json'));
      const privateBytes = readFileSync(join(state, 'factory.json'));
      assert.deepEqual(effectiveExecutionConfig(configAt(state)).command, command);
      for (const action of ['validate', 'apply']) {
        const response = await post(action, { definition: proposal, ...(action === 'apply' ? { expected_revision: before.revision } : {}) });
        assert.equal(response.status, 400, JSON.stringify(command));
        assert.match((await response.json()).error, /cannot safely override/);
        const responseCli = await cli(state, [action, '--file', file, ...(action === 'apply' ? ['--expected-revision', before.revision] : [])]);
        assert.notEqual(responseCli.code, 0); assert.match(responseCli.stderr, /cannot safely override/);
        assert.deepEqual(readFileSync(join(state, 'role-definition.json')), bytes);
        assert.deepEqual(readFileSync(join(state, 'factory.json')), privateBytes);
        assert.deepEqual(inspectDefinition(state), before);
      }
    }
  }
});

test('protected role evidence requires v2, exact frozen selection and current policy; historical v1 stays unchanged', t => {
  const { state, config } = installation(t), queue = idle(), job = { id: 'job_evidence' }, run = { id: 'run_evidence' };
  const folder = join(state, 'jobs', job.id), artifact = join(folder, 'artifacts', run.id, 'execution.json');
  const legacyConfig = effectiveExecutionConfig(config), legacy = { ...executionProfile(legacyConfig, 'build'), runtimeVersion: '0.13.1' };
  run.execution = legacy; save(artifact, legacy);
  assert.equal(trustedExecutionProfile(state, job, run, 'build', legacy.policyHash), true);
  const historicalBytes = readFileSync(artifact);
  const applied = changeDefinition(state, queue, { definition, expected_revision: inspectDefinition(state).revision });
  assert.equal(trustedExecutionProfile(state, job, run, 'build', legacy.policyHash), false, 'old writer cannot attest role overrides');
  assert.deepEqual(readFileSync(artifact), historicalBytes);
  const common = effectiveExecutionConfig(configAt(state), null, join(state, 'model.env')), profile = executionProfile(common, 'review');
  const roleRun = { id: 'run_roles', execution: profile }, roleArtifact = join(folder, 'artifacts', roleRun.id, 'execution.json');
  save(roleArtifact, profile); save(join(folder, roleRun.id, 'execution-config.json'), common);
  assert.equal(trustedExecutionProfile(state, job, roleRun, 'review', profile.policyHash), true);
  assert.equal(trustedExecutionProfile(state, job, roleRun, 'review', legacy.policyHash), false);
  const altered = { ...profile, requestedModel: 'other-model' };
  save(roleArtifact, altered); roleRun.execution = altered;
  assert.equal(trustedExecutionProfile(state, job, roleRun, 'review', profile.policyHash), false);
  const pretendV1 = { ...legacy, policyHash: profile.policyHash }; save(roleArtifact, pretendV1); roleRun.execution = pretendV1;
  assert.equal(trustedExecutionProfile(state, job, roleRun, 'build', profile.policyHash), false);
  changeDefinition(state, queue, { expected_revision: applied.revision }, true);
  assert.equal(trustedExecutionProfile(state, job, run, 'build', legacy.policyHash), true);
  assert.deepEqual(readFileSync(artifact), historicalBytes);
});

test('inherited custom argv stays private and known Codex report collisions refuse role adoption', t => {
  const { config } = installation(t);
  const custom = { ...config, harness: 'custom', command: ['private-launcher', 'private-argument'] };
  assert.deepEqual(resolveRoleProfiles(custom, definition).investigate.command, custom.command);
  const unsafe = { ...config, command: ['codex', 'exec', '--output-last-message', '/output/agent-report.md', '-'] };
  assert.deepEqual(resolveRoleProfiles(unsafe).implement.command, unsafe.command, 'unchanged legacy profile is not rewritten');
  assert.throws(() => resolveRoleProfiles(unsafe, definition), /final-message capture/);
  const safe = { ...unsafe, command: ['codex', 'exec', '--output-last-message', '/tmp/factory-final-message.md', '-'] };
  assert.deepEqual(resolveRoleProfiles(safe, definition).investigate.command, safe.command);
});


test('repository definitions are never auto-adopted and a symlink cannot turn private state into candidate-owned configuration', t => {
  const { state } = installation(t), current = inspectDefinition(state);
  const proposed = join(state, 'factory-roles.json'); writeFileSync(proposed, JSON.stringify(definition));
  assert.deepEqual(inspectDefinition(state), current, 'a source-style portable file has no adoption effect');
  const privatePath = join(state, 'role-definition.json');
  symlinkSync(proposed, privatePath);
  assert.throws(() => inspectDefinition(state), /regular private file/);
  rmSync(proposed);
  assert.throws(() => inspectDefinition(state), /regular private file/, 'a dangling symlink cannot silently restore inherited policy');
  rmSync(privatePath);
  const applied = changeDefinition(state, idle(), { expected_revision: current.revision, definition });
  chmodSync(privatePath, 0o644);
  assert.throws(() => inspectDefinition(state), /regular private file/);
  chmodSync(privatePath, 0o600);
  assert.deepEqual(inspectDefinition(state), applied);
});

test('local binding CLI/API adoption uses one private CAS record and excludes endpoints from public catalog/export', async t => {
  const { state, config } = installation(t);
  const controller = createController(state, { execute: async () => ({ outcome: 'blocked' }), stop: async () => {}, reconcile: async () => {} });
  await new Promise(resolve => controller.server.listen(0, '127.0.0.1', resolve)); t.after(() => controller.close());
  config.port = controller.server.address().port; writeFileSync(join(state, 'factory.json'), JSON.stringify(config));
  const origin = `http://127.0.0.1:${config.port}`;
  const post = (action, body, auth = true) => fetch(`${origin}/api/v1/definition/${action}`, { method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(auth ? { Authorization: 'Bearer fixture-token' } : {}) }, body: JSON.stringify(body) });
  const proposal = { version: 1, roles: { implement: { harness: 'pi', localBinding: 'local-box' } } };
  const bindings = { 'local-box': { endpoint: 'http://private-inference.invalid:8999/v1', model: 'fixture:small', contextWindow: 65536, maxTokens: 4096 } };
  const file = join(state, 'roles.json'), bindingsFile = join(state, 'bindings.json');
  writeFileSync(file, JSON.stringify(proposal)); writeFileSync(bindingsFile, JSON.stringify(bindings));
  const preview = await (await post('diff', { definition: proposal, local_bindings: bindings })).json();
  const cliPreview = await cli(state, ['diff', '--file', file, '--bindings-file', bindingsFile]);
  assert.equal(cliPreview.code, 0, cliPreview.stderr); assert.deepEqual(JSON.parse(cliPreview.stdout), preview);
  assert.equal((await post('apply', { definition: proposal, local_bindings: bindings, expected_revision: preview.revision }, false)).status, 403);
  const applied = await cli(state, ['apply', '--file', file, '--bindings-file', bindingsFile, '--expected-revision', preview.revision]);
  assert.equal(applied.code, 0, applied.stderr);
  assert.equal(controller.queue.all().length, 0);
  const publicCatalog = await (await fetch(origin + '/api/v1/definitions')).json();
  assert.doesNotMatch(JSON.stringify(publicCatalog), /private-inference/);
  const privateCatalog = await (await fetch(origin + '/api/v1/definitions', { headers: { Authorization: 'Bearer fixture-token' } })).json();
  assert.equal(privateCatalog.role_definition.local_bindings['local-box'].endpoint, bindings['local-box'].endpoint);
  assert.equal((await fetch(origin + '/api/v1/definition')).status, 403);
  const exported = await cli(state, ['export']); assert.equal(exported.code, 0);
  assert.equal(JSON.parse(exported.stdout).roles.implement.localBinding, 'local-box'); assert.doesNotMatch(exported.stdout, /endpoint|private-inference/);
  const before = readFileSync(join(state, 'role-definition.json'));
  assert.equal((await post('apply', { definition: proposal, expected_revision: preview.revision, local_bindings: bindings })).status, 409);
  assert.equal((await post('apply', { definition: proposal, expected_revision: inspectDefinition(state).revision, local_bindings: {} })).status, 400);
  assert.deepEqual(readFileSync(join(state, 'role-definition.json')), before);
  assert.equal((await post('rollback', { expected_revision: inspectDefinition(state).revision })).status, 200);
  assert.deepEqual(inspectDefinition(state).local_bindings, {});
});

test('local v3 protected evidence requires exact frozen bindings and cannot be downgraded to a legacy writer', t => {
  const { state } = installation(t);
  const local = { version: 1, roles: { review: { harness: 'pi', localBinding: 'worker' } } };
  changeDefinition(state, idle(), { expected_revision: inspectDefinition(state).revision, definition: local,
    local_bindings: { worker: { endpoint: 'http://fixture.invalid/v1', model: 'fixture:small', contextWindow: 65536, maxTokens: 4096 } } });
  const common = effectiveExecutionConfig(configAt(state)), profile = executionProfile(common, 'review');
  const job = { id: 'job_local' }, run = { id: 'run_local', execution: profile }, folder = join(state, 'jobs', job.id);
  const artifact = join(folder, 'artifacts', run.id, 'execution.json'), frozen = join(folder, run.id, 'execution-config.json');
  save(artifact, profile); save(frozen, common);
  assert.equal(trustedExecutionProfile(state, job, run, 'review', profile.policyHash), true);
  const forged = { ...profile, version: 2, runtimeVersion: '0.14.0' }; delete forged.localBinding;
  save(artifact, forged); run.execution = forged;
  assert.equal(trustedExecutionProfile(state, job, run, 'review', profile.policyHash), false);
  save(artifact, profile); run.execution = profile;
  const changed = structuredClone(common); changed.resolvedRoleProfiles.review.localBinding.contextWindow = 131072;
  save(frozen, changed);
  assert.equal(trustedExecutionProfile(state, job, run, 'review', profile.policyHash), false);
  save(frozen, common);
  assert.equal(trustedExecutionProfile(state, job, run, 'review', profile.policyHash), true);
});

for (const route of ['store', 'CLI', 'API']) for (const selected of [false, true]) {
  test(`${route} rejects ${selected ? 'selected' : 'unused'} non-roundtrippable endpoint without changing state/history`, async t => {
    const { state, config } = installation(t);
    const controller = createController(state, { execute: async () => ({ outcome: 'blocked' }), stop: async () => {}, reconcile: async () => {} });
    await new Promise(resolve => controller.server.listen(0, '127.0.0.1', resolve)); t.after(() => controller.close());
    config.port = controller.server.address().port; writeFileSync(join(state, 'factory.json'), JSON.stringify(config));
    const initial = inspectDefinition(state);
    const previous = changeDefinition(state, idle(), { expected_revision: initial.revision, definition });
    const path = join(state, 'role-definition.json'), bytes = readFileSync(path);
    const proposal = selected ? { version: 1, roles: { implement: { harness: 'pi', localBinding: 'candidate' } } } : definition;
    const bindings = { candidate: { endpoint: 'http://inference.invalid/café/v1', model: 'fixture:model', contextWindow: 32768, maxTokens: 1024 } };
    const input = { expected_revision: previous.revision, definition: proposal, local_bindings: bindings };
    if (route === 'store') assert.throws(() => changeDefinition(state, idle(), input), /endpoint/);
    else if (route === 'CLI') {
      const file = join(state, 'roles.json'), bindingsFile = join(state, 'bindings.json');
      writeFileSync(file, JSON.stringify(proposal)); writeFileSync(bindingsFile, JSON.stringify(bindings));
      const result = await cli(state, ['apply', '--file', file, '--bindings-file', bindingsFile, '--expected-revision', previous.revision]);
      assert.notEqual(result.code, 0); assert.match(result.stderr, /endpoint/);
    } else {
      const response = await fetch(`http://127.0.0.1:${config.port}/api/v1/definition/apply`, { method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer fixture-token' }, body: JSON.stringify(input) });
      assert.equal(response.status, 400); assert.match(await response.text(), /endpoint/);
    }
    assert.deepEqual(readFileSync(path), bytes);
    assert.deepEqual(inspectDefinition(state), previous);
    const restored = changeDefinition(state, idle(), { expected_revision: previous.revision }, true);
    assert.deepEqual(restored.definition, initial.definition);
    assert.deepEqual(restored.local_bindings, initial.local_bindings);
  });
}

test('local reasoning choice shares CLI/API inspect, diff, apply and rollback without changing portable roles', async t => {
  const { state, config } = installation(t);
  const controller = createController(state, { execute: async () => ({ outcome: 'blocked' }), stop: async () => {}, reconcile: async () => {} });
  await new Promise(resolve => controller.server.listen(0, '127.0.0.1', resolve)); t.after(() => controller.close());
  config.port = controller.server.address().port; writeFileSync(join(state, 'factory.json'), JSON.stringify(config));
  const origin = `http://127.0.0.1:${config.port}`, headers = { 'Content-Type': 'application/json', Authorization: 'Bearer fixture-token' };
  const post = (action, body) => fetch(`${origin}/api/v1/definition/${action}`, { method: 'POST', headers, body: JSON.stringify(body) });
  const proposal = { version: 1, roles: { review: { harness: 'pi', localBinding: 'reviewer' } } };
  const binding = { endpoint: 'http://inference.invalid/v1', model: 'fixture:model', contextWindow: 65536, maxTokens: 8192 };
  const file = join(state, 'roles.json'), bindingsFile = join(state, 'bindings.json');
  writeFileSync(file, JSON.stringify(proposal));
  const base = changeDefinition(state, idle(), { definition: proposal, local_bindings: { reviewer: binding }, expected_revision: inspectDefinition(state).revision });
  for (const reasoningEffort of ['default', 'none', 'low', 'medium', 'high']) {
    const bindings = { reviewer: { ...binding, reasoningEffort } };
    writeFileSync(bindingsFile, JSON.stringify(bindings));
    const preview = await (await post('diff', { definition: proposal, local_bindings: bindings })).json();
    const cliPreview = await cli(state, ['diff', '--file', file, '--bindings-file', bindingsFile]);
    assert.equal(cliPreview.code, 0, cliPreview.stderr); assert.deepEqual(JSON.parse(cliPreview.stdout), preview);
    assert.equal(preview.binding_changes[0].after.reasoningEffort, reasoningEffort);
    const applied = await cli(state, ['apply', '--file', file, '--bindings-file', bindingsFile, '--expected-revision', preview.revision]);
    assert.equal(applied.code, 0, applied.stderr);
    const readback = await (await fetch(origin + '/api/v1/definition', { headers })).json();
    assert.deepEqual(readback, JSON.parse(applied.stdout));
    assert.equal(readback.effective.review.localBinding.reasoningEffort, reasoningEffort);
    const cliReadback = await cli(state, []); assert.equal(cliReadback.code, 0, cliReadback.stderr);
    assert.deepEqual(JSON.parse(cliReadback.stdout).role_definition, readback);
    const bytes = readFileSync(join(state, 'role-definition.json'));
    const invalid = await post('apply', { definition: proposal, expected_revision: readback.revision,
      local_bindings: { reviewer: { ...binding, reasoningEffort: { off: 'none' } } } });
    assert.equal(invalid.status, 400); assert.deepEqual(readFileSync(join(state, 'role-definition.json')), bytes);
    const restored = await cli(state, ['rollback', '--expected-revision', readback.revision]);
    assert.equal(restored.code, 0, restored.stderr);
    assert.deepEqual(JSON.parse(restored.stdout).local_bindings, base.local_bindings);
    assert.deepEqual(inspectDefinition(state).definition, base.definition);
  }
  assert.equal(controller.queue.all().length, 0);
});
