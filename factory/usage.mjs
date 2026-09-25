// Codex emits JSONL, but only the top-level turn.completed usage record is
// evidence for token totals. Never retain the event body or any other event.
export const MAX_USAGE_LINE_BYTES = 64 * 1024;
export const MAX_USAGE_COUNT_DIGITS = 128;
export const MAX_USAGE_EVENTS = 2048;
const DECIMAL_COUNT = new RegExp(`^\\d{1,${MAX_USAGE_COUNT_DIGITS}}$`);

const own = (value, key) => Object.hasOwn(value, key);
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);

function count(value) {
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || value < 0 || Object.is(value, -0)) throw new Error('Invalid token count');
    return BigInt(value);
  }
  if (typeof value !== 'string' || !DECIMAL_COUNT.test(value)) throw new Error('Invalid token count');
  return BigInt(value);
}

function topLevelCompletedPrefix(text) {
  // Used only to recognize a malformed supported event. Track JSON nesting so
  // a forged type inside a message/tool body cannot affect usage provenance.
  let depth = 0;
  for (let i = 0; i < text.length;) {
    const ch = text[i];
    if (ch === '"') {
      const start = i++;
      let escaped = false;
      while (i < text.length) {
        const current = text[i++];
        if (escaped) escaped = false;
        else if (current === '\\') escaped = true;
        else if (current === '"') break;
      }
      if (depth === 1) {
        let next = i;
        while (/\s/.test(text[next] || '')) next++;
        if (text.slice(start, i) === '"type"' && text[next] === ':') {
          next++;
          while (/\s/.test(text[next] || '')) next++;
          if (text.slice(next, next + 16) === '"turn.completed"') return true;
        }
      }
      continue;
    }
    if (ch === '{' || ch === '[') depth++;
    else if (ch === '}' || ch === ']') depth--;
    i++;
  }
  return false;
}

function eventCounts(event) {
  if (!record(event) || event.type !== 'turn.completed') return null;
  if (!record(event.usage)) throw new Error('Missing token usage');
  const usage = event.usage;
  if (!own(usage, 'input_tokens') || !own(usage, 'output_tokens') || !own(usage, 'cached_input_tokens')) throw new Error('Incomplete token usage');
  const input = count(usage.input_tokens), output = count(usage.output_tokens), cached = count(usage.cached_input_tokens);
  if (cached > input) throw new Error('Cached input exceeds input tokens');
  // These known values are subsets. Validate their bounds, but never add them.
  if (own(usage, 'cache_write_input_tokens') && count(usage.cache_write_input_tokens) > input) throw new Error('Cache write input exceeds input tokens');
  if (own(usage, 'reasoning_output_tokens') && count(usage.reasoning_output_tokens) > output) throw new Error('Reasoning output exceeds output tokens');
  return { input, output, cached };
}

export class CodexUsageParser {
  constructor() {
    this.line = Buffer.alloc(MAX_USAGE_LINE_BYTES);
    this.length = 0;
    this.overflow = false;
    this.incomplete = false;
    this.events = 0;
    this.input = 0n;
    this.output = 0n;
    this.cached = 0n;
  }

  write(chunk) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    for (const byte of bytes) {
      if (byte === 0x0a) {
        this.lineComplete();
        continue;
      }
      if (this.length < this.line.length) this.line[this.length++] = byte;
      else this.overflow = true;
    }
  }

  lineComplete() {
    if (this.overflow) this.incomplete = true;
    else this.parseLine();
    this.length = 0;
    this.overflow = false;
  }

  parseLine() {
    let length = this.length;
    if (length && this.line[length - 1] === 0x0d) length--;
    if (!length) return;
    const text = this.line.toString('utf8', 0, length);
    let event;
    try { event = JSON.parse(text); }
    catch { if (topLevelCompletedPrefix(text)) this.incomplete = true; return; }
    if (!record(event) || event.type !== 'turn.completed') return;
    try {
      const counts = eventCounts(event);
      if (!counts) return;
      if (this.events >= MAX_USAGE_EVENTS) { this.incomplete = true; return; }
      this.events++;
      this.input += counts.input;
      this.output += counts.output;
      this.cached += counts.cached;
    } catch { this.incomplete = true; }
  }

  finish({ truncated = false } = {}) {
    if (this.length || this.overflow) this.lineComplete();
    if (!this.events) return null;
    return {
      input_tokens: this.input.toString(),
      output_tokens: this.output.toString(),
      cached_input_tokens: this.cached.toString(),
      source: 'codex_jsonl',
      coverage: truncated || this.incomplete ? 'partial' : 'complete',
    };
  }
}

export function parseCodexJsonl(chunks, options) {
  const parser = new CodexUsageParser();
  for (const chunk of chunks) parser.write(chunk);
  return parser.finish(options);
}

function normalizeUsage(value) {
  if (!record(value)) return null;
  if (value.status === 'unknown') {
    if (!['codex_jsonl', 'unsupported_executor'].includes(value.source) || value.coverage !== 'unknown') return null;
    return { status: 'unknown', source: value.source, coverage: 'unknown' };
  }
  if (value.status === 'not_applicable') {
    if (value.source !== 'not_applicable' || value.coverage !== 'not_applicable') return null;
    return { status: 'not_applicable', source: 'not_applicable', coverage: 'not_applicable' };
  }
  if (!['codex_jsonl', 'legacy_codex_log'].includes(value.source) || !['complete', 'partial'].includes(value.coverage)) return null;
  try {
    const input = count(value.input_tokens), output = count(value.output_tokens), cached = count(value.cached_input_tokens);
    if (cached > input) return null;
    return { input_tokens: input.toString(), output_tokens: output.toString(), cached_input_tokens: cached.toString(), source: value.source, coverage: value.coverage };
  } catch { return null; }
}

export function emptyUsage(execution, phase) {
  if (['verify', 'handoff'].includes(phase) || execution?.executor === 'mock')
    return { status: 'not_applicable', source: 'not_applicable', coverage: 'not_applicable' };
  return {
    status: 'unknown',
    source: execution?.executor === 'codex' ? 'codex_jsonl' : 'unsupported_executor',
    coverage: 'unknown',
  };
}

export function usageFields(value, execution, phase) {
  const usage = normalizeUsage(value) || emptyUsage(execution, phase);
  const token_usage = usage.status ? null : (BigInt(usage.input_tokens) + BigInt(usage.output_tokens)).toString();
  return { usage, token_usage };
}
