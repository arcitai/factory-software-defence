import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseLocalBindings, localRegistry } from '../factory/local-inference.mjs';
import { configAt } from '../factory/lib.mjs';
import { inspectDefinition, previewDefinition, changeDefinition } from '../factory/definition-store.mjs';
import { parseRoleDefinition, resolveRoleProfiles } from '../factory/role-definition.mjs';
import { effectiveExecutionConfig, executionProfile, assertFrozenExecution, isSupportedExecutionProfile, phaseExecutionConfig } from '../factory/execution-profile.mjs';
import { writeSelectedModelEnvironment } from '../factory/model-environment.mjs';

const binding = { endpoint: 'http://inference.invalid:8080/v1', model: 'fixture/model:small', contextWindow: 65536, maxTokens: 4096 };
const definition = { version: 1, roles: { implement: { harness: 'pi', localBinding: 'workstation' }, review: { harness: 'codex', model: 'reviewer' } } };
const idle = () => ({ actions: new Set(), issueActions: new Map(), all: () => [] });
function setup(t) {
  const state = mkdtempSync(join(tmpdir(), 'factory-local-'));
  t.after(() => rmSync(state, { recursive: true, force: true }));
  const config = { version: 1, harness: 'codex', command: ['codex', 'exec', '-'], model: 'existing', repo: state,
    image: 'fixture:1', network: 'bridge', timeoutSeconds: 30, memoryMiB: 512, check: 'true', port: 7350,
    scope: { project: 'p', service: 's', owner: 'o', environment: 'e' } };
  writeFileSync(join(state, 'factory.json'), JSON.stringify(config));
  return { state, config };
}
test('explicit local bindings are separate from portable roles and fail closed', () => {
  const parsed = parseLocalBindings({ workstation: binding });
  assert.equal(parsed.workstation.contextWindow, 65536);
  assert.throws(() => resolveRoleProfiles({}, definition), /missing local binding/);
  assert.throws(() => resolveRoleProfiles({}, { version: 1, roles: { implement: { harness: 'pi', localBinding: 'constructor' } } }), /localBinding/);
  for (const extra of [{ model: 'openai/other' }, { harness: 'inherit' }, { reasoningEffort: 'high' }, { localBinding: '' }])
    assert.throws(() => parseRoleDefinition({ version: 1, roles: { implement: { ...definition.roles.implement, ...extra } } }));
  for (const extra of [ { headers: {} }, { apiKey: '!command' }, { samplingParams: { temperature: 0.5 } }, { compat: null },
    { compat: { thinkingFormat: 'qwen' } }, { compat: { supportsUsageInStreaming: 'yes' } }, { compat: { maxTokensField: 'other' } },
    ...['ftp://host', 'http:///host', 'http://user:pass@host/v1', 'http://@host/v1', 'http://host/v1?key=a', 'http://host/v1#x', 'http://host/%2f', 'http://host/../v1', 'http://host\\x', 'http://host/\nx'].map(endpoint => ({ endpoint })),
    ...['!command', '../bad', '--help', 'model name', 'a\nb', 'https://model'].map(model => ({ model })),
    { contextWindow: 0 }, { contextWindow: 12.2 }, { maxTokens: 0 }, { maxTokens: 65536 }, { contextWindow: 1048577 },
  ]) assert.throws(() => parseLocalBindings({ workstation: { ...binding, ...extra } }), JSON.stringify(extra));
  assert.throws(() => parseLocalBindings(JSON.parse('{"__proto__":{}}')));
});
test('endpoint normalization is idempotent and cannot introduce forbidden escapes', () => {
  for (const endpoint of ['http://inference.invalid/v1///', 'http://inference.invalid/', 'http://INFERENCE.invalid:80/v1', 'http://[::1]:8080/v1']) {
    const parsed = parseLocalBindings({ workstation: { ...binding, endpoint } });
    assert.deepEqual(parseLocalBindings(JSON.parse(JSON.stringify(parsed))), parsed);
  }
  for (const endpoint of ['http://inference.invalid/café/v1', 'http://inference.invalid/<path>', 'http://inference.invalid/"path"'])
    assert.throws(() => parseLocalBindings({ workstation: { ...binding, endpoint } }), /endpoint/);
});
test('atomic binding adoption, stale/busy rejection, restart, removals and rollback retain exact policy', t => {
  const { state, config } = setup(t), initial = inspectDefinition(state), queue = idle();
  const preview = previewDefinition(state, definition, { workstation: binding });
  assert.equal(preview.effective.implement.localBinding.allocation, null);
  assert.equal(preview.effective.implement.localBinding.quality, 'unqualified');
  assert.equal(preview.effective.implement.localBinding.endpoint, undefined);
  assert.deepEqual(preview.definition, parseRoleDefinition(definition));
  const applied = changeDefinition(state, queue, { definition, local_bindings: preview.local_bindings, expected_revision: preview.revision });
  assert.deepEqual(inspectDefinition(state), applied, 'fresh read after restart has same state');
  const bytes = readFileSync(join(state, 'role-definition.json'));
  for (const input of [ { expected_revision: initial.revision, definition },
    { expected_revision: applied.revision, definition, local_bindings: {} },
    { expected_revision: applied.revision, definition, local_bindings: { workstation: { ...binding, endpoint: 'invalid' } } } ]) {
    assert.throws(() => changeDefinition(state, queue, input));
    assert.deepEqual(readFileSync(join(state, 'role-definition.json')), bytes);
  }
  queue.active = { id: 'busy' };
  assert.throws(() => changeDefinition(state, queue, { expected_revision: applied.revision, definition, local_bindings: {} }), /busy/);
  assert.deepEqual(readFileSync(join(state, 'role-definition.json')), bytes);
  queue.active = null;
  // No inference request is made, including adoption of an unreachable endpoint.
  assert.equal(inspectDefinition(state).local_bindings.workstation.endpoint, binding.endpoint);
  const common = effectiveExecutionConfig(configAt(state));
  assert.equal(common.localBindings, undefined, 'catalog not frozen wholesale');
  assert.equal(common.resolvedRoleProfiles.implement.localBinding.endpoint, binding.endpoint);
  const changed = changeDefinition(state, queue, { expected_revision: applied.revision, definition,
    local_bindings: { workstation: { ...binding, contextWindow: 131072, endpoint: 'http://different.invalid/v1' } } });
  assert.notEqual(executionProfile(effectiveExecutionConfig(configAt(state)), 'build').policyHash, executionProfile(common, 'build').policyHash);
  assert.equal(common.resolvedRoleProfiles.implement.localBinding.contextWindow, 65536);
  const restored = changeDefinition(state, queue, { expected_revision: changed.revision }, true);
  assert.deepEqual(effectiveExecutionConfig(configAt(state)), common);
  changeDefinition(state, queue, { expected_revision: restored.revision }, true);
  assert.deepEqual(configAt(state), config);
});
test('all phases share v3 frozen policy; old writers cannot attest local bindings, unchanged 0.14 v2 remains honest', t => {
  const { config } = setup(t);
  const common = effectiveExecutionConfig({ ...config, roleDefinition: definition, localBindings: { workstation: binding } });
  const policy = executionProfile(common, 'build').policyHash;
  for (const phase of ['build', 'review', 'defence', 'verify', 'handoff']) {
    const profile = executionProfile(common, phase);
    assert.equal(profile.version, 3); assert.equal(profile.policyHash, policy);
    assertFrozenExecution(common, profile, phase);
    assert(isSupportedExecutionProfile(profile));
    assert.equal(profile.localBinding?.contextWindow ?? null, phase === 'build' ? 65536 : null);
    assert.equal(profile.localBinding?.endpoint, undefined);
    for (const version of [1, 2]) {
      const old = { ...profile, version, runtimeVersion: '0.14.0' };
      assert.equal(isSupportedExecutionProfile(old), false);
      assert.throws(() => assertFrozenExecution(common, old, phase));
    }
  }
  const changed = structuredClone(common); changed.resolvedRoleProfiles.implement.localBinding.endpoint = 'http://other.invalid/v1';
  assert.throws(() => assertFrozenExecution(changed, executionProfile(common, 'review'), 'review'));
  const cloud = effectiveExecutionConfig({ ...config, roleDefinition: { version: 1, roles: { review: { harness: 'pi', model: 'anthropic/review' } } } });
  const historical = { ...executionProfile(cloud, 'review'), runtimeVersion: '0.14.0' };
  assert(isSupportedExecutionProfile(historical)); assertFrozenExecution(cloud, historical, 'review');
});
test('minimal registry has no extensible credentials; local and deterministic roles get no model env', t => {
  const { state, config } = setup(t);
  const registry = localRegistry(binding), provider = registry.providers['factory-local'];
  assert.deepEqual(Object.keys(registry.providers), ['factory-local']);
  assert.equal(provider.models.length, 1); assert.equal(provider.models[0].id, binding.model);
  assert.equal(provider.models[0].contextWindow, 65536);
  assert.equal(provider.models[0].reasoning, false);
  assert.equal(provider.apiKey, 'factory-local-keyless');
  const source = join(state, 'model.env'), dest = join(state, 'selected.env');
  writeFileSync(source, 'OPENAI_API_KEY=inert-openai\nOPENAI_BASE_URL=https://cloud.invalid\nFACTORY_CODEX_AUTH_JSON={"token":"inert-account"}\n', { mode: 0o600 });
  assert.equal(writeSelectedModelEnvironment(source, dest, { phase: 'build', executor: 'pi', inferenceProvider: 'factory-local' }), false);
  assert.equal(writeSelectedModelEnvironment(source, dest, { phase: 'verify', executor: 'deterministic' }), false);
  const common = effectiveExecutionConfig({ ...config, roleDefinition: definition, localBindings: { workstation: binding } });
  const cloud = phaseExecutionConfig(common, 'review');
  assert.equal(cloud.localBinding, undefined); assert.equal(cloud.command.includes('factory-local'), false);
  assert.equal(writeSelectedModelEnvironment(source, dest, { phase: 'review', executor: 'codex', inferenceProvider: 'openai' }), true);
  assert.match(readFileSync(dest, 'utf8'), /inert-openai/);
});
test('0.14 private records migrate only on adoption and retain rollback; failed persistence leaves original state', t => {
  const { state } = setup(t);
  const legacy = { version: 1, sequence: 1, definition: { version: 1, roles: { review: { harness: 'pi', model: 'anthropic/review' } } }, history: [{ version: 1, roles: {} }] };
  const path = join(state, 'role-definition.json'); writeFileSync(path, JSON.stringify(legacy), { mode: 0o600 });
  const before = readFileSync(path), original = inspectDefinition(state);
  assert.deepEqual(readFileSync(path), before);
  const current = changeDefinition(state, idle(), { expected_revision: original.revision, definition, local_bindings: { workstation: binding } });
  const restored = changeDefinition(state, idle(), { expected_revision: current.revision }, true);
  assert.deepEqual(restored.definition, original.definition);
  changeDefinition(state, idle(), { expected_revision: restored.revision }, true);
  assert.equal(inspectDefinition(state).definition.roles.review.harness, 'inherit');
  // A directory at the destination cannot be replaced by rename; no temp record is adopted.
  rmSync(path); mkdirSync(path, { mode: 0o700 });
  assert.throws(() => changeDefinition(state, idle(), { expected_revision: original.revision, definition }), /regular private file/);
});

test('missing adopted reference refuses queue admission before source retention', async t => {
  const { JobQueue } = await import('../factory/queue.mjs');
  const { state } = setup(t);
  let admissions = 0;
  writeFileSync(join(state, 'role-definition.json'), JSON.stringify({ version: 2, sequence: 1, definition, localBindings: {}, history: [] }), { mode: 0o600 });
  const queue = new JobQueue(state, { sourceAdmission: { admit: () => { admissions++; } } }); t.after(() => queue.close());
  assert.throws(() => queue.submit({ repository: 'app', workflow: 'software', spec: 'Synthetic scope' }), /missing local binding/);
  assert.equal(admissions, 0); assert.equal(queue.all().length, 0);
});

test('typed local reasoning requests freeze without rewriting unchanged bindings or legacy policy', t => {
  const { config } = setup(t);
  const original = parseLocalBindings({ workstation: binding });
  assert.equal(Object.hasOwn(original.workstation, 'reasoningEffort'), false);
  for (const invalid of [null, '', 'off', 'xhigh', true, { off: 'none' }])
    assert.throws(() => parseLocalBindings({ workstation: { ...binding, reasoningEffort: invalid } }), /reasoningEffort/);
  for (const reasoningEffort of ['default', 'none', 'low', 'medium', 'high']) {
    const common = effectiveExecutionConfig({ ...config, roleDefinition: definition,
      localBindings: { workstation: { ...binding, reasoningEffort } } });
    const profile = executionProfile(common, 'build');
    assert.equal(profile.localBinding.reasoningEffort, reasoningEffort);
    assert.equal(profile.localBinding.quality, 'unqualified');
    assert.equal(profile.localBinding.endpoint, undefined);
    const changed = structuredClone(common);
    changed.resolvedRoleProfiles.implement.localBinding.reasoningEffort = reasoningEffort === 'none' ? 'low' : 'none';
    assert.throws(() => assertFrozenExecution(changed, profile, 'build'), /does not match/);
    assert.equal(executionProfile(common, 'review').localBinding, null, 'cloud review has no local override');
    assert.equal(executionProfile(common, 'verify').localBinding, null);
    assert.equal(executionProfile(common, 'handoff').policyHash, profile.policyHash);
  }
});

test('complete serialized record validation rejects sequence overflow before replacement', t => {
  const { state } = setup(t), path = join(state, 'role-definition.json');
  const initial = inspectDefinition(state);
  changeDefinition(state, idle(), { expected_revision: initial.revision, definition: { version: 1, roles: { review: { harness: 'codex', model: 'previous' } } } });
  const record = JSON.parse(readFileSync(path)); record.sequence = Number.MAX_SAFE_INTEGER;
  writeFileSync(path, JSON.stringify(record));
  const bytes = readFileSync(path), before = inspectDefinition(state);
  assert.throws(() => changeDefinition(state, idle(), { expected_revision: before.revision, definition,
    local_bindings: { workstation: binding } }), /Invalid private definition record/);
  assert.deepEqual(readFileSync(path), bytes); assert.deepEqual(inspectDefinition(state), before);
});
