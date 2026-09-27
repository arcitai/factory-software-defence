import { harnessOf } from './lib.mjs';
import { hostname } from 'node:os';
import { digest } from './lib.mjs';
import { VERSION } from './updates.mjs';
import { usageFields } from './usage.mjs';
import { effectiveInferenceProvider } from './model-environment.mjs';
import { expectedWebStories, webPolicyHash } from './web-verification.mjs';

// Audited v1 protected evidence writers: 0.8.0 (380f749), 0.9.0 (cdaadef),
// 0.9.1, 0.10.0 and 0.11.0 (unchanged protected evidence writers). Deliberately independent of VERSION: a release bump is not
// evidence compatibility. Re-audit this list for every trust-relevant writer,
// isolation or validation change; remove versions whose guarantees no longer
// satisfy current policy. See docs/npm.md. This predicate alone grants no trust.
const SUPPORTED_EXECUTION_RUNTIMES_V1 = new Set(['0.8.0', '0.9.0', '0.9.1', '0.10.0', '0.11.0']);

export function isSupportedExecutionProfile(profile) {
  return profile?.version === 1 && SUPPORTED_EXECUTION_RUNTIMES_V1.has(profile.runtimeVersion);
}

export function withRequestedModel(configuration, requestedModel) {
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
  const inferenceProvider = effectiveInferenceProvider(configuration, modelEnvironmentPath);
  const config = withRequestedModel(configuration, requestedModel);
  if (inferenceProvider) config.inferenceProvider = inferenceProvider;
  return config;
}

// Public facts only. The complete admitted configuration stays in private state.
export function executionProfile(config, phase) {
  const deterministic = ['verify', 'handoff'].includes(phase);
  const applicable = !deterministic && harnessOf(config) !== 'mock';
  const provider = applicable && ['codex', 'pi'].includes(harnessOf(config));
  const requestedModel = provider ? config.model || null : null;
  const profile = {
    version: 1, phase, executor: deterministic ? 'deterministic' : harnessOf(config),
    requestedModel,
    modelSelection: !applicable ? 'not_applicable' : !provider ? 'unknown' : requestedModel ? 'explicit' : 'provider_default',
    runtimeVersion: VERSION, image: phase === 'handoff' ? null : config.image,
    policyHash: digest(JSON.stringify(config)), hostName: hostname(),
  };
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
