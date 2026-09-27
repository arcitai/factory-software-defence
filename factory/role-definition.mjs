import { lstatSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { harnessOf } from './lib.mjs';
import { effectiveInferenceProvider, inferenceProviderFromModel } from './model-environment.mjs';

export const ROLE_PHASES = Object.freeze({ implement: 'build', review: 'review', investigate: 'defence' });
export const ROLE_CAPABILITIES = Object.freeze({
  version: 1, roles: Object.keys(ROLE_PHASES), harnesses: ['inherit', 'codex', 'pi'],
  reasoningEffort: { codex: ['low', 'medium', 'high'], pi: [] },
  model: 'user-selected; availability and quality unqualified',
  skills: 'all six packaged runtime skills are shared read-only; recommendations are not access controls',
  resources: 'shared private installation', triage_spec: 'pre-admission instructions; no executable roles',
  automation: 'harness-owned; discovery unavailable; application never starts work',
});
export class DefinitionError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}
function object(value, keys, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new DefinitionError(`${label} must be an object`);
  if (Object.keys(value).some(key => !keys.includes(key))) throw new DefinitionError(`${label} contains an unsupported field`);
}
export function parseRoleDefinition(value) {
  object(value, ['version', 'roles'], 'Definition');
  if (value.version !== 1) throw new DefinitionError('Unsupported role definition version; expected 1');
  object(value.roles, Object.keys(ROLE_PHASES), 'roles');
  const roles = {};
  for (const role of Object.keys(ROLE_PHASES)) {
    const profile = value.roles[role] ?? {};
    if (Object.hasOwn(value.roles, role) && value.roles[role] === null) throw new DefinitionError(`${role} must be an object`);
    object(profile, ['harness', 'model', 'reasoningEffort'], role);
    const harness = profile.harness ?? 'inherit';
    if (Object.hasOwn(profile, 'harness') && !ROLE_CAPABILITIES.harnesses.includes(profile.harness)) throw new DefinitionError(`${role}: unsupported harness`);
    if (Object.hasOwn(profile, 'model') && profile.model !== null
      && (typeof profile.model !== 'string' || !/^[\w][\w.:/+-]{0,127}$/.test(profile.model) || (profile.model.includes('..') || profile.model.includes('://') || /^[A-Za-z]:/.test(profile.model))))
      throw new DefinitionError(`${role}: invalid model identifier`);
    if (Object.hasOwn(profile, 'reasoningEffort') && !ROLE_CAPABILITIES.reasoningEffort.codex.includes(profile.reasoningEffort))
      throw new DefinitionError(`${role}: unsupported reasoning effort`);
    if (harness === 'pi' && profile.reasoningEffort !== undefined) throw new DefinitionError(`${role}: Pi reasoning effort is unavailable in this adapter`);
    if (harness === 'pi' && !inferenceProviderFromModel(profile.model)) throw new DefinitionError(`${role}: explicit Pi requires provider/model (a supported provider prefix)`);
    roles[role] = { harness, ...(Object.hasOwn(profile, 'model') ? { model: profile.model } : {}),
      ...(profile.reasoningEffort === undefined ? {} : { reasoningEffort: profile.reasoningEffort }) };
  }
  return { version: 1, roles };
}
export const inheritedDefinition = () => parseRoleDefinition({ version: 1, roles: {} });
export function hasRoleOverrides(definition) {
  return Object.values(parseRoleDefinition(definition).roles).some(p => p.harness !== 'inherit' || Object.hasOwn(p, 'model') || p.reasoningEffort !== undefined);
}
export function harnessPreset(harness) {
  const commands = {
    codex: ['codex', 'exec', '--json', '--ephemeral', '--sandbox', 'danger-full-access', '-'],
    pi: ['pi', '--mode', 'json', '--print', '--no-session', '--no-extensions', '--skill', '/factory-skills'],
    mock: ['node', '/opt/factory/mock.mjs'],
  };
  return commands[harness]?.slice();
}
function option(command, name, value, harness) {
  // Only supported switches are edited; an inherited private wrapper is retained.
  for (let i = command.length - 1; i >= 0; i--) {
    if (command[i] === name) command.splice(i, 2);
    else if (command[i].startsWith(`${name}=`)) command.splice(i, 1);
  }
  if (value !== null) command.splice(harness === 'codex' && command.at(-1) === '-' ? command.length - 1 : command.length, 0, name, value);
}
function codexRoleCommand(command, selection, role) {
  const selectModel = Object.hasOwn(selection, 'model'), selectEffort = Object.hasOwn(selection, 'reasoningEffort');
  const refuse = () => { throw new DefinitionError(`${role}: cannot safely override the inherited Codex model/reasoning options; use a supported codex exec command or select the Codex preset`); };
  // Parse a bounded argv grammar, never shell text. Unknown switches/wrappers,
  // profiles and subcommands can hide selected settings or a prompt boundary.
  if (!command?.length || !/(^|[/\\])codex(?:\.exe)?$/.test(command[0])) refuse();
  const values = new Set(['--model', '-m', '--config', '-c', '--sandbox', '-s', '--cd', '-C',
    '--output-last-message', '-o', '--output-schema', '--color', '--add-dir', '--enable', '--disable',
    '--thread-source', '--ask-for-approval', '-a']);
  const switches = new Set(['--json', '--ephemeral', '--skip-git-repo-check', '--strict-config',
    '--ignore-user-config', '--ignore-rules', '--worktree', '--approve-for-me',
    '--dangerously-bypass-approvals-and-sandbox', '--dangerously-bypass-hook-trust',
    '--search', '--no-alt-screen', '--no-daemon']);
  const normalized = [command[0]];
  let exec = false, boundary = command.length, inheritedModelOptions = 0;
  for (let i = 1; i < command.length; i++) {
    const argument = command[i];
    if (!exec && ['exec', 'e'].includes(argument)) { exec = true; normalized.push(argument); continue; }
    if (argument === '--' || argument === '-' || !argument.startsWith('-')) {
      if (!exec) refuse();
      // Only one positional prompt is supported. Nested exec commands and
      // options following a positional prompt require explicit operator repair.
      if (argument !== '--' && (i !== command.length - 1 || ['resume', 'fork', 'review', 'help'].includes(argument))) refuse();
      if (argument === '--' && i + 2 < command.length) refuse();
      boundary = i; break;
    }
    if (switches.has(argument)) { normalized.push(argument); continue; }
    const name = argument.startsWith('--') ? argument.split('=', 1)[0] : argument.slice(0, 2);
    if (!values.has(name)) refuse();
    const attached = argument !== name;
    const value = attached ? argument.slice(name.length).replace(/^=/, '') : command[++i];
    if (!value || (!attached && value.startsWith('-'))) refuse();
    if (name === '--model' || name === '-m') {
      if (selectModel) continue;
      // An effort-only change must not repair or choose between model flags.
      if (++inheritedModelOptions > 1) refuse();
    }
    if (name === '--config' || name === '-c') {
      const separator = value.indexOf('=');
      if (separator < 1) refuse();
      const key = value.slice(0, separator).trim();
      // Accept documented bare/dotted keys and simple quoted equivalents.
      // Escaped/complex keys and profile layers are ambiguous without loading
      // machine-local configuration, which portable adoption must not do.
      if (!/^(?:[\w-]+|"[\w-]+"|'[\w-]+')(?:\s*\.\s*(?:[\w-]+|"[\w-]+"|'[\w-]+'))*$/.test(key)) refuse();
      const parts = key.split('.').map(part => part.trim().replace(/^["']|["']$/g, ''));
      if (['profile', 'profiles'].includes(parts[0])) refuse();
      if ((selectModel && parts[0] === 'model') || (selectEffort && parts[0] === 'model_reasoning_effort')) {
        if (parts.length !== 1) refuse();
        continue;
      }
    }
    normalized.push(argument, ...(attached ? [] : [value]));
  }
  if (!exec) refuse();
  if (selectModel && selection.model !== null) normalized.push('--model', selection.model);
  if (selectEffort) normalized.push('-c', `model_reasoning_effort="${selection.reasoningEffort}"`);
  return [...normalized, ...command.slice(boundary)];
}
export function resolveRoleProfiles(config, definition = config.roleDefinition || inheritedDefinition(), environmentPath) {
  const parsed = parseRoleDefinition(definition), result = {}, overrides = hasRoleOverrides(parsed);
  for (const [role, selection] of Object.entries(parsed.roles)) {
    const inherited = selection.harness === 'inherit', harness = inherited ? harnessOf(config) : selection.harness;
    if (overrides && inherited && harness === 'codex') {
      const argv = config.command || [];
      for (let i = 0; i < argv.length; i++) {
        const argument = argv[i];
        const destination = ['-o', '--output-last-message'].includes(argument) ? argv[i + 1]
          : argument.startsWith('--output-last-message=') ? argument.slice('--output-last-message='.length)
          : argument.startsWith('-o') && argument.length > 2 ? argument.slice(2).replace(/^=/, '') : undefined;
        if (destination !== undefined && (!destination.startsWith('/tmp/') || destination.includes('..')))
          throw new DefinitionError(`${role}: inherited Codex final-message capture must use ephemeral /tmp; correct the private command while stopped`);
      }
    }
    const model = Object.hasOwn(selection, 'model') ? selection.model : inherited ? config.model || null : null;
    let command = inherited ? config.command?.slice() : harnessPreset(harness);
    if ((Object.hasOwn(selection, 'model') || selection.reasoningEffort) && !['codex', 'pi'].includes(harness))
      throw new DefinitionError(`${role}: inherited ${harness} does not support model or reasoning overrides`);
    if (selection.reasoningEffort && harness !== 'codex') throw new DefinitionError(`${role}: reasoning effort requires Codex`);
    if (command && (Object.hasOwn(selection, 'model') || selection.reasoningEffort || !inherited)) {
      if (harness === 'codex') command = codexRoleCommand(command, {
        ...(!inherited || Object.hasOwn(selection, 'model') ? { model } : {}),
        ...(selection.reasoningEffort ? { reasoningEffort: selection.reasoningEffort } : {}),
      }, role);
      else option(command, '--model', model, harness);
    }
    const providerConfig = { harness, model, ...(inherited && config.inferenceProvider ? { inferenceProvider: config.inferenceProvider } : {}) };
    const modelProvider = inferenceProviderFromModel(model);
    if (harness === 'pi' && providerConfig.inferenceProvider && modelProvider && providerConfig.inferenceProvider !== modelProvider)
      throw new DefinitionError(`${role}: model conflicts with installed inference provider`);
    // Explicit Pi must identify a provider; never guess between credential groups.
    if (harness === 'pi' && !inherited && !modelProvider) throw new DefinitionError(`${role}: explicit Pi requires provider/model (a supported provider prefix)`);
    const inferenceProvider = effectiveInferenceProvider(providerConfig, environmentPath);
    result[role] = { harness, model, command, inferenceProvider: inferenceProvider || null,
      reasoningEffort: selection.reasoningEffort || null, source: inherited ? 'installed' : 'preset',
      modelSource: Object.hasOwn(selection, 'model') ? 'role' : inherited ? 'installed' : 'harness_default' };
  }
  return result;
}
export function publicRoleProfiles(profiles) {
  return Object.fromEntries(Object.entries(profiles).map(([role, { command, ...profile }]) => [role, profile]));
}
export function installedRoleRecord(state) {
  const path = join(state, 'role-definition.json');
  let stat;
  try { stat = lstatSync(path); }
  catch (error) {
    if (error.code === 'ENOENT') return { version: 1, sequence: 0, definition: inheritedDefinition(), history: [] };
    throw error;
  }
  if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0 || stat.size > 256000)
    throw new DefinitionError('Private definition record must be a regular private file, never a repository symlink');
  const record = JSON.parse(readFileSync(path, 'utf8'));
  if (record.version !== 1 || !Number.isSafeInteger(record.sequence) || record.sequence < 1 || !Array.isArray(record.history) || record.history.length > 10)
    throw new DefinitionError('Invalid private definition record; restore the last valid private backup');
  return { ...record, definition: parseRoleDefinition(record.definition), history: record.history.map(parseRoleDefinition) };
}
