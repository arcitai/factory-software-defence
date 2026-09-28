import { UsageLineParser, tokenCount, MAX_USAGE_EVENTS, MAX_USAGE_COUNT_DIGITS } from './usage.mjs';

// Pi's final aggregate includes message content and can be much larger than a
// Codex usage line. Discard content after parsing; retain only bounded counters.
export const MAX_PI_USAGE_LINE_BYTES = 8 * 1024 * 1024;
export const MAX_PI_USAGE_METADATA_BYTES = 1024 * 1024;
export const MAX_PI_USAGE_EVENTS = 262144;
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);

function counts(message) {
  if (!object(message.usage) || !['stop', 'toolUse', 'length', 'error', 'aborted'].includes(message.stopReason)) return null;
  try {
    const { input, output, cacheRead, cacheWrite, totalTokens } = message.usage;
    const uncached = tokenCount(input), out = tokenCount(output), read = tokenCount(cacheRead), write = tokenCount(cacheWrite);
    const inclusive = uncached + read + write;
    if (inclusive + out !== tokenCount(totalTokens)) return null;
    if (Object.hasOwn(message.usage, 'reasoning') && tokenCount(message.usage.reasoning) > out) return null;
    // The provider initializes missing/failed-request usage to zero. Even a
    // successful stop with all zeros does not establish a measured zero call.
    if (inclusive + out === 0n) return null;
    return [inclusive, out, read, write].map(value => value.toString());
  } catch { return null; }
}

export class PiUsageParser extends UsageLineParser {
  constructor() {
    super(MAX_PI_USAGE_LINE_BYTES);
    this.totals = [0n, 0n, 0n, 0n];
    this.observed = 0;
    this.events = 0;
    this.metadataBytes = 0;
    this.messages = [];
    this.ended = false;
    this.ambiguous = false;
    this.exhausted = false;
  }

  lineComplete() {
    if (!this.exhausted && ++this.events > MAX_PI_USAGE_EVENTS) this.exhausted = true;
    super.lineComplete();
  }

  parseLine() {
    if (!this.length || this.exhausted) return;
    let event;
    try { event = JSON.parse(this.line.toString('utf8', 0, this.length)); }
    catch { this.ambiguous = true; return; }
    if (!object(event)) return;
    // The pinned agent loop's newMessages starts afresh at each agent_start.
    // Positions within that turn, not timestamps or equal token counts, match
    // message_end to the repeated agent_end snapshot. New turns may be identical.
    if (event.type === 'agent_start') {
      this.messages = []; this.metadataBytes = 0;
      this.ended = false; this.ambiguous = false;
    } else if (event.type === 'message_end') {
      if (!object(event.message)) { this.ambiguous = true; return; }
      if (event.message.role !== 'assistant') return;
      if (this.ended) { this.ambiguous = true; return; }
      this.append(counts(event.message));
    } else if (event.type === 'agent_end') {
      if (!Array.isArray(event.messages) || event.messages.length > MAX_USAGE_EVENTS) { this.ambiguous = true; return; }
      let index = 0;
      for (const message of event.messages) {
        if (!object(message)) { this.ambiguous = true; break; }
        if (message.role !== 'assistant') continue;
        const value = counts(message), signature = JSON.stringify(value);
        if (index < this.messages.length) {
          if (signature !== this.messages[index]) this.ambiguous = true;
        } else if (!this.ended && !this.ambiguous && !this.incomplete) this.append(value);
        else this.ambiguous = true;
        index++;
      }
      if (index !== this.messages.length) this.ambiguous = true;
      this.ended = true;
    }
  }

  append(value) {
    if (this.exhausted) return;
    const signature = JSON.stringify(value);
    if (this.observed >= MAX_USAGE_EVENTS || this.messages.length >= MAX_USAGE_EVENTS || this.metadataBytes + signature.length > MAX_PI_USAGE_METADATA_BYTES) {
      this.exhausted = true; return;
    }
    this.messages.push(signature); this.metadataBytes += signature.length;
    if (!value) return;
    const next = this.totals.map((total, index) => total + BigInt(value[index]));
    // Keep aggregate counts and their shared total representable on readback.
    if ([...next, next[0] + next[1]].some(total => total.toString().length > MAX_USAGE_COUNT_DIGITS)) {
      this.exhausted = true; return;
    }
    this.totals = next; this.observed++;
  }

  snapshot() {
    if (!this.observed) return null;
    const [input, output, cached, writes] = this.totals.map(String);
    return { input_tokens: input, output_tokens: output, cached_input_tokens: cached,
      cache_write_input_tokens: writes, source: 'pi_jsonl', coverage: 'partial' };
  }

  finish() {
    // JSONL requires a newline. A trailing fragment is not a completed event.
    if (this.length || this.overflow) this.incomplete = true;
    return this.snapshot();
  }
}
