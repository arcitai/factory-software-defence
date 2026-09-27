import { lstatSync, readFileSync, writeFileSync } from 'node:fs';

// These names are the supported inference inputs for the bundled Codex and
// pinned Pi providers. Host, forge, deploy, cloud identity and arbitrary
// application settings are intentionally absent.
const providerVariables = Object.freeze({
  openai: ['OPENAI_API_KEY', 'OPENAI_BASE_URL'],
  anthropic: ['ANTHROPIC_API_KEY'],
  'azure-openai-responses': ['AZURE_OPENAI_API_KEY', 'AZURE_OPENAI_BASE_URL', 'AZURE_OPENAI_RESOURCE_NAME', 'AZURE_OPENAI_API_VERSION', 'AZURE_OPENAI_DEPLOYMENT_NAME_MAP'],
  deepseek: ['DEEPSEEK_API_KEY'],
  google: ['GEMINI_API_KEY'],
  mistral: ['MISTRAL_API_KEY'],
  groq: ['GROQ_API_KEY'],
  cerebras: ['CEREBRAS_API_KEY'],
  'cloudflare-ai-gateway': ['CLOUDFLARE_API_KEY', 'CLOUDFLARE_ACCOUNT_ID', 'CLOUDFLARE_GATEWAY_ID'],
  'cloudflare-workers-ai': ['CLOUDFLARE_API_KEY', 'CLOUDFLARE_ACCOUNT_ID'],
  xai: ['XAI_API_KEY'],
  openrouter: ['OPENROUTER_API_KEY'],
  'vercel-ai-gateway': ['AI_GATEWAY_API_KEY'],
  zai: ['ZAI_API_KEY'],
  opencode: ['OPENCODE_API_KEY'],
  'opencode-go': ['OPENCODE_API_KEY'],
  huggingface: ['HF_TOKEN'],
  'kimi-coding': ['KIMI_API_KEY'],
  minimax: ['MINIMAX_API_KEY'],
  'minimax-cn': ['MINIMAX_CN_API_KEY'],
  xiaomi: ['XIAOMI_API_KEY'],
  'xiaomi-token-plan-cn': ['XIAOMI_TOKEN_PLAN_CN_API_KEY'],
  'xiaomi-token-plan-ams': ['XIAOMI_TOKEN_PLAN_AMS_API_KEY'],
  'xiaomi-token-plan-sgp': ['XIAOMI_TOKEN_PLAN_SGP_API_KEY'],
});

const codexAuthVariable = 'FACTORY_CODEX_AUTH_JSON';
const credentialedWorkerPhases = new Set(['build', 'review', 'defence']);
const supportedVariables = new Set([...Object.values(providerVariables).flat(), codexAuthVariable]);
const validName = /^[A-Za-z_][A-Za-z0-9_]*$/;

function validateCodexAuthJson(value) {
  let parsed;
  try { parsed = JSON.parse(value); }
  catch { throw new Error(`${codexAuthVariable} must contain a single-line JSON object.`); }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
    throw new Error(`${codexAuthVariable} must contain a single-line JSON object.`);
}

export function isInferenceProvider(provider) {
  return typeof provider === 'string' && Object.hasOwn(providerVariables, provider);
}

function providerFromConfiguredModel(model) {
  if (typeof model !== 'string') return null;
  const separator = model.indexOf('/');
  if (separator < 1) return null;
  const provider = model.slice(0, separator);
  return isInferenceProvider(provider) ? provider : null;
}

export function inferenceProviderFromModel(model) {
  return providerFromConfiguredModel(model);
}

// Resolve the provider only from installation configuration. In particular,
// a job's requested model is not an input to this function.
export function configuredInferenceProvider(config) {
  const harness = config.harness ?? config.agent;
  if (harness === 'codex') return 'openai';
  if (harness !== 'pi') return null;
  return config.inferenceProvider || providerFromConfiguredModel(config.model);
}

function readModelEnvironment(path) {
  let text;
  try {
    const stat = lstatSync(path);
    if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0) throw new Error();
    text = readFileSync(path, 'utf8');
  } catch { throw new Error('Private model.env is missing, unsafe or unreadable.'); }

  const values = new Map();
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const separator = line.indexOf('=');
    if (separator < 1) throw new Error('model.env accepts supported inference settings only; remove unrelated configuration.');
    const name = line.slice(0, separator).trim(), value = line.slice(separator + 1).trim();
    if (!validName.test(name) || !supportedVariables.has(name) || /[\0\r\n]/.test(value) || values.has(name))
      throw new Error('model.env accepts supported inference settings only; remove unrelated configuration.');
    if (name === codexAuthVariable) validateCodexAuthJson(value);
    values.set(name, value);
  }
  return values;
}

export function validateModelEnvironment(path) {
  readModelEnvironment(path);
  return true;
}

function soleConfiguredProvider(values) {
  const providers = Object.entries(providerVariables)
    .filter(([, names]) => names.some(name => values.has(name)))
    .map(([provider]) => provider);
  if (providers.length > 1) throw new Error('Select inferenceProvider in private factory.json before using multiple Pi provider settings.');
  return providers[0] || null;
}

// Pi may select the only configured provider group when installation config
// omits one. Include that trusted choice in attempt policy without retaining
// credential values in the execution profile.
export function effectiveInferenceProvider(config, environmentPath) {
  const configured = configuredInferenceProvider(config);
  if (configured || (config.harness ?? config.agent) !== 'pi' || !environmentPath) return configured;
  return soleConfiguredProvider(readModelEnvironment(environmentPath));
}

// Writes a private, short-lived Docker env file containing only the selected
// provider's settings. The source file is never mounted into an agent job.
// Checks and non-agent phases validate installation settings but receive no
// credential env file. Provider selection is tied to the trusted executor.
export function writeSelectedModelEnvironment(sourcePath, destinationPath, { phase, executor, inferenceProvider }) {
  const values = readModelEnvironment(sourcePath);
  if (!credentialedWorkerPhases.has(phase) || !['codex', 'pi'].includes(executor)) return false;

  const provider = executor === 'codex' ? 'openai' : inferenceProvider || soleConfiguredProvider(values);
  if (provider && !isInferenceProvider(provider)) throw new Error('The configured inference provider is unsupported.');
  if (executor === 'codex' && inferenceProvider && inferenceProvider !== 'openai')
    throw new Error('Codex can use only the configured OpenAI inference settings.');

  const selectedNames = provider ? new Set(providerVariables[provider]) : new Set();
  if (executor === 'codex') selectedNames.add(codexAuthVariable);
  const lines = [...values].filter(([name]) => selectedNames.has(name)).map(([name, value]) => `${name}=${value}`);
  if (!lines.length) return false;
  writeFileSync(destinationPath, `${lines.join('\n')}\n`, { mode: 0o600, flag: 'wx' });
  return true;
}

const credentialEnvironmentName = /(?:^|_)(?:API_KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL)(?:_|$)/i;
const credentialJsonField = /api[_-]?key|token|secret|password|credential/i;

function collectCodexCredentialStrings(value, inheritedCredentialField, secrets) {
  if (typeof value === 'string') {
    if (inheritedCredentialField && value) secrets.add(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectCodexCredentialStrings(item, inheritedCredentialField, secrets);
    return;
  }
  if (!value || typeof value !== 'object') return;
  for (const [key, item] of Object.entries(value))
    collectCodexCredentialStrings(item, inheritedCredentialField || credentialJsonField.test(key), secrets);
}

// Read only the short-lived, already-selected phase file. These values are
// kept in memory for output redaction and are never included in profiles,
// logs, reports or action results.
export function selectedInferenceSecrets(path) {
  const values = readModelEnvironment(path);
  const secrets = new Set();
  for (const [name, value] of values) {
    if (name === codexAuthVariable) {
      collectCodexCredentialStrings(JSON.parse(value), false, secrets);
    } else if (credentialEnvironmentName.test(name) && value) secrets.add(value);
  }
  return [...secrets];
}
