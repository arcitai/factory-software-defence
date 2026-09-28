// Request projection only. Never change raw tool events, files or session entries.
// UTF-8 bytes (not characters/4) conservatively cover text tokenization; explicit
// framing headroom also covers chat templates. This is a budget, not usage.
export const bytes = value => Buffer.byteLength(JSON.stringify(value), 'utf8');
export const projectedTokens = payload => bytes(payload) + 1024
  + 64 * ((payload.messages?.length || 0) + (payload.tools?.length || 0));

// Pi 0.87.1 clamps against native history BEFORE onPayload. Recover the caller's
// allowance, not that obsolete clamp. Explicit summary caps remain explicit.
// Only the selected adapter's OpenAI effort control is supported: numeric or
// nested thinking budgets could also have been clamped and must not be guessed.
export function restoreOutputBudget(payload, configured, requested, reasoning) {
  const field = configured.compat.maxTokensField;
  const fields = ['max_tokens', 'max_completion_tokens'].filter(key => Object.hasOwn(payload, key));
  if (!Number.isSafeInteger(requested) || requested < 1 || requested > configured.maxTokens
    || fields.length !== 1 || fields[0] !== field
    || !Number.isSafeInteger(payload[field]) || payload[field] < 1 || payload[field] > requested)
    throw new Error('Unsupported local output budget; refusing to override selected limits');
  if ((reasoning !== undefined && !['off', 'low', 'medium', 'high'].includes(reasoning))
    || ['reasoning', 'thinking', 'thinking_token_budget', 'reasoning_budget', 'chat_template_kwargs', 'chat_template_args', 'enable_thinking']
      .some(key => Object.hasOwn(payload, key)))
    throw new Error('Unsupported local reasoning budget; qualify the endpoint controls before use');
  const effort = configured.reasoning
    ? (!reasoning || reasoning === 'off' ? configured.thinkingLevelMap?.off : reasoning) : undefined;
  if (payload.reasoning_effort !== effort)
    throw new Error('Local reasoning effort does not match the selected request');
  payload[field] = requested;
}

function excerpt(text, limit) {
  if (text.length <= limit) return text;
  // Do not split a UTF-16 surrogate pair. JSON escaping is counted afterward.
  const prefix = text.slice(0, limit).replace(/[\uD800-\uDBFF]$/, '');
  const shortened = `${prefix}\n[Factory context projection: shortened tool result (${Buffer.byteLength(text, 'utf8')} original UTF-8 bytes). Raw tool event is unchanged; source files are unchanged by projection. Do not infer omitted contents. Re-read the original path with read offset/limit (start with limit: 40), or run a narrower query; keep subsequent batches small.]`;
  return Buffer.byteLength(shortened) < Buffer.byteLength(text) ? shortened : text;
}

// Uniform cap shares space among large results without penalizing small ones.
// Calls, arguments, identities, ordering and all non-tool text are immutable.
export function fitToolText(value, budget, measure = bytes, native = false) {
  const original = structuredClone(value);
  if (measure(original) <= budget) return original;
  const messages = Array.isArray(original) ? original : original.messages;
  const slots = [];
  for (const message of messages) {
    if (message.role !== (native ? 'toolResult' : 'tool')) continue;
    if (typeof message.content === 'string') slots.push([message, 'content', message.content]);
    else if (Array.isArray(message.content)) {
      for (const part of message.content) if (part.type === 'text') slots.push([part, 'text', part.text]);
    }
  }
  const cap = limit => { for (const [object, key, text] of slots) object[key] = excerpt(text, limit); };
  cap(0);
  if (measure(original) > budget) throw new Error('Local Pi context budget cannot fit required instructions, tool pairs and truncation guidance; use smaller task/input or qualify the configured allocation. No fallback.');
  let low = 0, high = Math.max(0, ...slots.map(([, , text]) => text.length));
  while (low < high) {
    const mid = Math.ceil((low + high) / 2); cap(mid);
    if (measure(original) <= budget) low = mid; else high = mid - 1;
  }
  cap(low);
  return original;
}

export function validatePairs(messages) {
  const pending = new Set(), seen = new Set();
  for (const message of messages) {
    if (message.role !== 'tool' && pending.size) throw new Error('Local Pi context has interrupted tool pairs');
    for (const call of message.tool_calls || []) {
      if (!call.id || seen.has(call.id)) throw new Error('Local Pi context has duplicate tool identity');
      pending.add(call.id); seen.add(call.id);
    }
    if (message.role === 'tool' && !pending.delete(message.tool_call_id)) throw new Error('Local Pi context has orphan tool result');
  }
  if (pending.size) throw new Error('Local Pi context has missing tool results');
}
