import { isDeepStrictEqual } from 'node:util';
import { resolveRoleProfiles, ROLE_PHASES } from './role-definition.mjs';
import { harnessOf } from './lib.mjs';
import { hostname } from 'node:os';
import { digest } from './lib.mjs';
import { VERSION } from './updates.mjs';
import { usageFields } from './usage.mjs';
import { effectiveInferenceProvider } from './model-environment.mjs';
import { expectedWebStories, webPolicyHash } from './web-verification.mjs';

// Audited v1 protected evidence writers: 0.8.0 (380f749), 0.9.0 (cdaadef),
// 0.9.1, 0.10.0, 0.11.0 and 0.11.1 (unchanged protected evidence writers),
// 0.11.2 (exact patch bytes and pre-acceptance reconstruction; same v1 schema).
// 0.12.0 restores the Inbox read model/presentation; protected writers and guards are unchanged.
// 0.13.0 relocates identical job skills and adds a read-only Codex discovery alias.
// 0.13.1 corrects read-only delivered-commit checks; protected v1 writers are unchanged.
// 0.14.0 emits v1 only for unchanged inherited profiles: common policy bytes,
// deterministic phases, protected checks, isolation and acceptance remain compatible.
// Role overrides require v2, with role/provider/reasoning and a private-command
// selection digest. V1 can never attest an adopted role override.
// Older writers still require exact patch/tree reconstruction before publication.
// Deliberately independent of VERSION: a release bump is not
// evidence compatibility. Re-audit this list for every trust-relevant writer,
// isolation or validation change; remove versions whose guarantees no longer
// satisfy current policy. See docs/npm.md. This predicate alone grants no trust.
const SUPPORTED_EXECUTION_RUNTIMES_V1 = new Set(['0.8.0', '0.9.0', '0.9.1', '0.10.0', '0.11.0', '0.11.1', '0.11.2', '0.12.0', '0.13.0', '0.13.1', '0.14.0']);

export function isSupportedExecutionProfile(profile) {
  if (profile?.version === 2) return profile.runtimeVersion === '0.14.0'
    && profile.role === (Object.keys(ROLE_PHASES).find(role => ROLE_PHASES[role] === profile.phase) || null)
    && (profile.reasoningEffort === null || ['low', 'medium', 'high'].includes(profile.reasoningEffort))
    && /^[a-f0-9]{64}$/.test(profile.selectionHash || '');
  return profile?.version === 1 && !Object.hasOwn(profile, 'role') && !Object.hasOwn(profile, 'selectionHash')
    && SUPPORTED_EXECUTION_RUNTIMES_V1.has(profile.runtimeVersion);
}

export function withRequestedModel(configuration, requestedModel) {
  if (configuration.roleDefinition && requestedModel) throw new Error('Task model overrides are unavailable with role profiles; edit the role definition instead');
  const config = structuredClone(configuration);
  if (requestedModel && requestedModel !== config.model) {
    if (!['codex', 'pi'].includes(harnessOf(config))) throw new Error('Task model overrides require codex or pi');
    config.model = requestedModel;
    const index = config.command.indexOf('--model');
    if (index >= 0) config.command[index + 1] = requestedModel;
    else config.command.splice(harnessOf(config) === 'codex' ? config.command.length - 1 : config.command.length, 0, '--model', requestedModel);
  }
  return config;
}

// Derive the same trusted provider selection for attempt policy/evidence and
// container setup. Provider choice comes from installation config before a
// task-level model override is applied.
export function effectiveExecutionConfig(configuration, requestedModel, modelEnvironmentPath) {
  if (configuration.roleDefinition) {
    const config = withRequestedModel(configuration, requestedModel);
    config.resolvedRoleProfiles = resolveRoleProfiles(config, config.roleDefinition, modelEnvironmentPath);
    return config;
  }
  const inferenceProvider = effectiveInferenceProvider(configuration, modelEnvironmentPath);
  const config = withRequestedModel(configuration, requestedModel);
  if (inferenceProvider) config.inferenceProvider = inferenceProvider;
  return config;
}

// Public facts only. The complete admitted configuration stays in private state.
export function executionProfile(commonConfig, phase) {
  const config = phaseExecutionConfig(commonConfig, phase);
  const deterministic = ['verify', 'handoff'].includes(phase);
  const applicable = !deterministic && harnessOf(config) !== 'mock';
  const provider = applicable && ['codex', 'pi'].includes(harnessOf(config));
  const requestedModel = provider ? config.model || null : null;
  const profile = {
    version: 1, phase, executor: deterministic ? 'deterministic' : harnessOf(config),
    requestedModel,
    modelSelection: !applicable ? 'not_applicable' : !provider ? 'unknown' : requestedModel ? 'explicit' : 'provider_default',
    runtimeVersion: VERSION, image: phase === 'handoff' ? null : config.image,
    policyHash: digest(JSON.stringify(commonConfig)), hostName: hostname(),
  };
  if (commonConfig.resolvedRoleProfiles) {
    profile.version = 2;
    profile.role = Object.keys(ROLE_PHASES).find(role => ROLE_PHASES[role] === phase) || null;
    profile.reasoningEffort = deterministic ? null : config.reasoningEffort || null;
    profile.inferenceProvider = deterministic ? null : config.inferenceProvider || null;
    profile.selectionHash = digest(JSON.stringify(deterministic ? { phase, executor: 'deterministic' } : commonConfig.resolvedRoleProfiles[profile.role]));
  }
  if (config.webVerification?.enabled) profile.webVerification = {
    enabled: true, adapter: config.webVerification.adapter, version: config.webVerification.version,
    browser: 'chromium', image: config.webVerification.image, policyHash: webPolicyHash(config.webVerification),
    requiredStories: expectedWebStories(config.webVerification), platform: 'linux-container',
  };
  return profile;
}

export function attemptPresentation(attempt, recoveredUsage) {
  const profile = attempt.execution;
  const recordedUsage = attempt.usage?.status === 'unknown' || attempt.usage === undefined
    ? recoveredUsage?.usage ?? attempt.usage : attempt.usage;
  const usage = usageFields(recordedUsage, profile, attempt.command);
  return {
    ...attempt, executor: profile?.executor ?? 'unknown',
    ...usage,
    model: profile?.requestedModel ?? null, host_name: profile?.hostName ?? profile?.workerName ?? null,
    worker_name: profile?.hostName ?? profile?.workerName ?? null, // v1 presentation alias
    provenance_status: profile ? 'recorded' : attempt.started_at ? 'unknown' : 'not_started',
  };
}

// Resolve from the frozen common configuration, never from candidate files.
export function phaseExecutionConfig(config, phase) {
  if (!config.resolvedRoleProfiles) return config;
  const role = Object.keys(ROLE_PHASES).find(role => ROLE_PHASES[role] === phase);
  if (!role) {
    if (!['verify', 'handoff'].includes(phase)) throw new Error('Unsupported execution phase');
    return config;
  }
  const selected = config.resolvedRoleProfiles[role];
  if (!selected?.command?.length) throw new Error(`Unresolved execution profile for ${role}`);
  const effective = { ...config, ...selected };
  delete effective.agent;
  return effective;
}
export function assertFrozenExecution(config, execution, phase) {
  const expected = executionProfile(config, phase);
  // Host identity is presentation; all execution and policy selections must match.
  delete expected.hostName;
  const actual = { ...execution }; delete actual.hostName; delete actual.workerName;
  if (!isDeepStrictEqual(expected, actual)) throw new Error('Admitted execution profile does not match this attempt');
}
