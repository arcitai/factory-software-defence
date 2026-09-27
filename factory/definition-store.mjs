import { isDeepStrictEqual } from 'node:util';
import { parseLocalBindings } from './local-inference.mjs';
import { closeSync, existsSync, fsyncSync, openSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { configAt, digest, harnessOf } from './lib.mjs';
import { DefinitionError, installedRoleRecord, parseRoleRecord, parseRoleDefinition, publicRoleProfiles, resolveRoleProfiles, ROLE_CAPABILITIES } from './role-definition.mjs';

const revisionOf = (config, record) => digest(JSON.stringify({ config, sequence: record.sequence, definition: record.definition, localBindings: record.localBindings }));
function context(state) {
  const config = configAt(state), record = installedRoleRecord(state);
  delete config.roleDefinition; delete config.localBindings;
  record.localBindings ||= {};
  return { config, record, revision: revisionOf(config, record) };
}
function view({ config, record, revision }) {
  return { revision, inherited_harness: harnessOf(config), definition: record.definition, local_bindings: record.localBindings, rollback_available: record.history.length > 0,
    effective: publicRoleProfiles(resolveRoleProfiles({ ...config, localBindings: record.localBindings }, record.definition)), capabilities: ROLE_CAPABILITIES };
}
export function inspectDefinition(state) { return view(context(state)); }
export function previewDefinition(state, value, bindings) {
  const current = context(state), definition = parseRoleDefinition(value);
  const before = view(current);
  const localBindings = parseLocalBindings(bindings === undefined ? current.record.localBindings : bindings);
  const effective = publicRoleProfiles(resolveRoleProfiles({ ...current.config, localBindings }, definition));
  const changes = [];
  for (const role of ROLE_CAPABILITIES.roles) {
    if (JSON.stringify(before.definition.roles[role]) !== JSON.stringify(definition.roles[role])
      || JSON.stringify(before.effective[role]) !== JSON.stringify(effective[role]))
      changes.push({ role, before: before.effective[role], after: effective[role], selection: definition.roles[role] });
  }
  return { revision: current.revision, definition, local_bindings: localBindings, effective, changes,
    binding_changes: Object.keys({ ...current.record.localBindings, ...localBindings }).filter(name => JSON.stringify(current.record.localBindings[name]) !== JSON.stringify(localBindings[name]))
      .map(name => ({ reference: name, before: current.record.localBindings[name] || null, after: localBindings[name] || null })), valid: true,
    qualification: 'Configuration only; harness, model availability and quality are not qualified' };
}
export function previewRollback(state) {
  const previous = context(state).record.history.at(-1);
  if (!previous) throw new DefinitionError('No previous definition is available', 409);
  return { ...previewDefinition(state, previous.definition, previous.localBindings), rollback: true };
}
function assertIdle(queue, state) {
  if (queue.closing || queue.maintenance || queue.active || queue.actions.size || queue.issueActions.size
    || queue.all().some(job => !['succeeded', 'failed', 'cancelled', 'blocked', 'interrupted'].includes(job.state)))
    throw new DefinitionError('Controller is busy; finish or cancel active and awaiting-approval work before applying a definition', 409);
  const jobs = join(state, 'jobs');
  if (existsSync(jobs) && readdirSync(jobs).some(id => /^job_[a-z0-9]+$/.test(id) && existsSync(join(jobs, id, 'active.json'))))
    throw new DefinitionError('Executor recovery is required before applying a definition', 409);
}
function persist(state, serialized) {
  const destination = join(state, 'role-definition.json'), temp = `${destination}.${randomUUID()}.tmp`;
  let fd;
  try {
    fd = openSync(temp, 'wx', 0o600);
    writeFileSync(fd, serialized); fsyncSync(fd); closeSync(fd); fd = undefined;
    // Definition and rollback history share one atomic replacement. A crash before
    // rename retains the old record; after rename it retains the complete new one.
    renameSync(temp, destination);
  } finally { if (fd !== undefined) closeSync(fd); rmSync(temp, { force: true }); }
}
// Called synchronously only by the single controller, after request body parsing.
// No await between CAS, idle check and atomic replacement; admission cannot interleave.
export function changeDefinition(state, queue, input, rollback = false) {
  const allowed = rollback ? ['expected_revision'] : ['expected_revision', 'definition', 'local_bindings'];
  if (!input || Object.keys(input).some(key => !allowed.includes(key)) || typeof input.expected_revision !== 'string')
    throw new DefinitionError('Expected definition and expected_revision (rollback accepts expected_revision only)');
  const current = context(state);
  if (input.expected_revision !== current.revision) throw new DefinitionError('Definition revision changed; refresh and preview again', 409);
  assertIdle(queue, state);
  const value = rollback ? current.record.history.at(-1) : { definition: input.definition, localBindings: input.local_bindings };
  if (!value) throw new DefinitionError('No previous definition is available', 409);
  const preview = previewDefinition(state, value.definition, value.localBindings);
  if (!rollback && JSON.stringify(preview.definition) === JSON.stringify(current.record.definition)
    && JSON.stringify(preview.local_bindings) === JSON.stringify(current.record.localBindings)) return view(current);
  const history = rollback ? current.record.history.slice(0, -1) : [...current.record.history, { definition: current.record.definition, localBindings: current.record.localBindings }].slice(-10);
  const record = { version: 2, sequence: current.record.sequence + 1, definition: preview.definition, localBindings: preview.local_bindings, history };
  const serialized = JSON.stringify(record, null, 2) + '\n';
  if (Buffer.byteLength(serialized) > 256000) throw new DefinitionError('Private definition history exceeds 256 KB; shorten binding endpoints before applying');
  const roundtrip = parseRoleRecord(JSON.parse(serialized));
  if (!isDeepStrictEqual(record, roundtrip)) throw new DefinitionError('Private definition record must round-trip without normalization');
  const next = view({ config: current.config, record: roundtrip, revision: revisionOf(current.config, roundtrip) });
  persist(state, serialized);
  return next;
}
