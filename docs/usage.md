# Attempt token usage

The shared status API and CLI expose executor reported usage on each attempt.
`token_usage` is a decimal string equal to `input_tokens + output_tokens`;
cached input and reasoning output are subsets and are never added again. The
values are observations, not an invoice or a monetary estimate.

An observed `usage` value has this shape:

```json
{
  "input_tokens": "5954949",
  "output_tokens": "56198",
  "cached_input_tokens": "5778688",
  "source": "codex_jsonl",
  "coverage": "complete"
}
```

Counts are decimal strings so totals remain exact beyond JavaScript's safe
integer range. `coverage` is `partial` when observed evidence is incomplete.
For no evidence, `usage` is `{ "status": "unknown", "source": "codex_jsonl",
"coverage": "unknown" }` for Codex, and `token_usage` is `null`. Unsupported
executors also remain unknown. Deterministic phases and the synthetic mock
executor use `{ "status": "not_applicable", "source": "not_applicable",
"coverage": "not_applicable" }` with a `null` total.

The native runtime parses only top-level Codex `turn.completed` JSONL events
from stdout. It ignores event bodies and other usage-like fields, rejects
negative, malformed, unsafe numeric, and inconsistent counts, and bounds each
line to 64 KiB, each decimal count to 128 digits, and accepted events to 2,048.
Input/output and cached-input counts are retained; cache-write and reasoning
counts are validated as subsets when present but are not included in the total.
A failed attempt retains a completed event if one was observed.

For older attempts, status can read back a supported event from the exact
attempt's bounded private log only when its private execution profile identifies
Codex and the retained footer proves stderr was empty. This fallback is
read-only and does not rewrite SQLite history. Missing, malformed, oversized,
ambiguous-stream, and non-Codex evidence stays unknown. If the old bounded log
omitted bytes, a recovered count is explicitly partial and is not represented
as a complete total.
