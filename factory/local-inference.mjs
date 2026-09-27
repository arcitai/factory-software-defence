// Deliberately smaller than Pi's models.json: no commands, headers, credentials,
// provider overrides or arbitrary request fields can enter this contract.
export class LocalBindingError extends Error {
  constructor(message) { super(message); this.status = 400; }
}
const fail = message => { throw new LocalBindingError(message); };
const object = (value, keys, label) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).some(key => !keys.includes(key))) fail(`${label}: expected an object with supported fields only`);
};
export const LOCAL_REASONING_EFFORTS = Object.freeze(['default', 'none', 'low', 'medium', 'high']);
export const LOCAL_PROVIDER = 'factory-local';
export const LOCAL_AGENT_DIR = '/factory-local';
export function validBindingReference(value) {
  return typeof value === 'string' && !['constructor', 'prototype'].includes(value) && /^[a-z][a-z0-9-]{0,47}$/.test(value);
}
export function parseLocalBindings(value = {}) {
  object(value, Object.keys(value || {}), 'local_bindings');
  if (Object.keys(value).length > 16) fail('At most 16 local bindings are supported');
  const entries = [];
  for (const [name, binding] of Object.entries(value).sort(([a], [b]) => a.localeCompare(b))) {
    if (!validBindingReference(name)) fail('Invalid local binding reference');
    object(binding, ['endpoint', 'model', 'contextWindow', 'maxTokens', 'compat', 'reasoningEffort'], `Local binding ${name}`);
    let url;
    try { url = new URL(binding.endpoint); } catch { fail(`${name}: invalid endpoint URL`); }
    if (typeof binding.endpoint !== 'string' || binding.endpoint.length > 2048
      || !/^https?:\/\/[^/]+/.test(binding.endpoint) || /[\s\\?#%@]/.test(binding.endpoint)
      || !['http:', 'https:'].includes(url.protocol) || url.username || url.password || !url.hostname
      || url.search || url.hash || /[\s\\?#%@]/.test(url.href) || /\/\.{1,2}(?:\/|$)/.test(binding.endpoint))
      fail(`${name}: endpoint must be an HTTP(S) base URL without credentials, query, fragment or escapes`);
    if (typeof binding.model !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_.:/+-]{0,127}$/.test(binding.model)
      || binding.model.includes('..') || binding.model.includes('://') || binding.model.includes('//'))
      fail(`${name}: invalid exact model ID`);
    if (!Number.isSafeInteger(binding.contextWindow) || binding.contextWindow < 1024 || binding.contextWindow > 1048576
      || !Number.isSafeInteger(binding.maxTokens) || binding.maxTokens < 1 || binding.maxTokens > 32000 || binding.maxTokens >= binding.contextWindow)
      fail(`${name}: contextWindow must be 1024–1048576 and maxTokens 1–32000 and smaller than contextWindow`);
    if (Object.hasOwn(binding, 'reasoningEffort') && !LOCAL_REASONING_EFFORTS.includes(binding.reasoningEffort))
      fail(`${name}: reasoningEffort must be default, none, low, medium or high`);
    const compat = binding.compat === undefined ? {} : binding.compat;
    object(compat, ['maxTokensField', 'supportsUsageInStreaming', 'requiresToolResultName'], `${name} compat`);
    if (compat.maxTokensField !== undefined && !['max_tokens', 'max_completion_tokens'].includes(compat.maxTokensField)) fail(`${name}: invalid maxTokensField`);
    for (const key of ['supportsUsageInStreaming', 'requiresToolResultName'])
      if (compat[key] !== undefined && typeof compat[key] !== 'boolean') fail(`${name}: ${key} must be boolean`);
    entries.push([name, { endpoint: url.href.replace(/\/+$/, ''), model: binding.model,
      contextWindow: binding.contextWindow, maxTokens: binding.maxTokens,
      ...(binding.reasoningEffort === undefined ? {} : { reasoningEffort: binding.reasoningEffort }),
      compat: { maxTokensField: compat.maxTokensField ?? 'max_tokens',
        supportsUsageInStreaming: compat.supportsUsageInStreaming ?? true, requiresToolResultName: compat.requiresToolResultName ?? false } }]);
  }
  return Object.fromEntries(entries);
}
export function localRegistry(binding) {
  const b = parseLocalBindings({ selected: binding }).selected;
  const reasoning = b.reasoningEffort !== undefined && b.reasoningEffort !== 'default';
  return { providers: { [LOCAL_PROVIDER]: { api: 'openai-completions', baseUrl: b.endpoint,
    // Pi requires a key. This fixed, non-secret placeholder never selects host auth.
    apiKey: 'factory-local-keyless', models: [{ id: b.model, name: b.model,
      reasoning, ...(b.reasoningEffort === 'none' ? { thinkingLevelMap: { off: 'none' } } : {}), input: ['text'], contextWindow: b.contextWindow, maxTokens: b.maxTokens,
      compat: { ...b.compat, supportsStore: false, supportsDeveloperRole: false,
        supportsReasoningEffort: reasoning, supportsStrictMode: false } }] } } };
}
export function publicLocalBinding(binding) {
  if (!binding) return null;
  const { endpoint, ...configured } = binding;
  return { ...configured, allocation: null, quality: 'unqualified' };
}
export function localRoleCommand(binding) {
  return ['node', `${LOCAL_AGENT_DIR}/launch.mjs`, '--mode', 'json', '--print', '--no-session', '--no-extensions', '--no-skills',
    '--skill', '/factory-skills', '--no-prompt-templates', '--provider', LOCAL_PROVIDER,
    '--model', binding.model, '--thinking', ['low', 'medium', 'high'].includes(binding.reasoningEffort) ? binding.reasoningEffort : 'off'];
}
