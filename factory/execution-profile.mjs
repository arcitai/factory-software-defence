import { hostname } from 'node:os';
import { digest } from './lib.mjs';
import { VERSION } from './updates.mjs';
import { usageFields } from './usage.mjs';

export function withRequestedModel(configuration, requestedModel) {
  const config = structuredClone(configuration);
  if (requestedModel && requestedModel !== config.model) {
    if (!['codex', 'pi'].includes(config.agent)) throw new Error('Task model overrides require codex or pi');
    config.model = requestedModel;
    const index = config.command.indexOf('--model');
    if (index >= 0) config.command[index + 1] = requestedModel;
    else config.command.splice(config.agent === 'codex' ? config.command.length - 1 : config.command.length, 0, '--model', requestedModel);
  }
  return config;
}

// Public facts only. The complete admitted configuration stays in private state.
export function executionProfile(config, phase) {
  const deterministic = ['verify', 'handoff'].includes(phase);
  const applicable = !deterministic && config.agent !== 'mock';
  const provider = applicable && ['codex', 'pi'].includes(config.agent);
  const requestedModel = provider ? config.model || null : null;
  return {
    version: 1, phase, executor: deterministic ? 'deterministic' : config.agent,
    requestedModel,
    modelSelection: !applicable ? 'not_applicable' : !provider ? 'unknown' : requestedModel ? 'explicit' : 'provider_default',
    runtimeVersion: VERSION, image: phase === 'handoff' ? null : config.image,
    policyHash: digest(JSON.stringify(config)), workerName: hostname(),
  };
}

export function attemptPresentation(attempt, recoveredUsage) {
  const profile = attempt.execution;
  const recordedUsage = attempt.usage?.status === 'unknown' || attempt.usage === undefined
    ? recoveredUsage?.usage ?? attempt.usage : attempt.usage;
  const usage = usageFields(recordedUsage, profile, attempt.command);
  return {
    ...attempt, executor: profile?.executor ?? 'unknown',
    ...usage,
    model: profile?.requestedModel ?? null, worker_name: profile?.workerName ?? null,
    provenance_status: profile ? 'recorded' : attempt.started_at ? 'unknown' : 'not_started',
  };
}
