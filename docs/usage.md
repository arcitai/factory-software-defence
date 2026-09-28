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
A failed attempt retains a completed event if one was observed. A later started
turn without completion, or a failed turn, makes those observations partial.

For older attempts, status can read back a supported event from the exact
attempt's bounded private log only when its private execution profile identifies
Codex and the retained footer proves stderr was empty. This fallback is
read-only and does not rewrite SQLite history. Missing, malformed, oversized,
ambiguous-stream, and non-Codex evidence stays unknown. If the old bounded log
omitted bytes, a recovered count is explicitly partial and is not represented
as a complete total.

Historical recovery is optional and budgeted to eight lookups per second and
512 cached terminal attempts per controller lifetime. Further attempts remain
unknown; new persisted measurements bypass these legacy read limits. This
prevents large old queues from rereading all logs on every status poll.

## Pi stdout measurements (0.15.4)

New Pi attempts use `source: "pi_jsonl"`. Factory collects stdout before bounded
log truncation; stderr, tool results and streaming updates cannot supply usage.
The audited official `@earendil-works/pi-coding-agent` **0.87.1** OpenAI
completions adapter reports uncached `input`, `cacheRead`, `cacheWrite`, `output`
and their sum in `totalTokens`. Factory maps them to the existing contract:

- `input_tokens = input + cacheRead + cacheWrite` (inclusive input).
- `cached_input_tokens = cacheRead`, and `cache_write_input_tokens = cacheWrite`.
- `token_usage = input_tokens + output_tokens`; neither cache subset is added again.

Cache-write attribution is optional for historical/Codex records, not assumed
zero when absent. Pi requires all five counters, validates their sum, and
preserves exact decimal strings. Unsafe numeric values are rejected. An all-zero
Pi usage object remains unknown: the installed provider also emits this initial
placeholder when no usage arrived, including failed requests. Provider cost
fields and configured zero prices do not establish monetary consumption; local
hardware/electricity and unpriced provider cost remain unknown.

The pinned agent loop emits completed `message_end` assistant messages and
repeats them, in order, in that agent turn's `agent_end.messages`. Factory
reconciles positions within each `agent_start`/`agent_end` interval. Equal token
counts and equal timestamps are not unique IDs: distinct positions and explicit
new agent turns count separately. Repeated snapshots do not add tokens; a final
aggregate alone can supply counts. Contradictory or ambiguous snapshots never
add unmatched counts. Missing, malformed and oversized evidence cannot turn an
observation into complete coverage or a measured zero.

All Pi observations currently have **partial** coverage, even after a successful
run. Pi 0.87.1 performs compaction summary calls outside the visible assistant
aggregate and can retry provider requests without independent failed-request
usage accounting. A recovered job can succeed while these totals remain
incomplete. Absence of a retry/compaction event is not proof of full coverage.
No scorer, cost estimate, quality claim or acceptance authority follows from
these measurements.

Parsing is bounded to an 8 MiB line buffer, 262,144 framed lines, 2,048 observed
assistant messages and at most 1 MiB of retained counter signatures per turn.
Message content is discarded after each line. Counts and aggregate totals are
bounded to 128 decimal digits. Beyond a limit, already observed totals remain
partial; with no usable evidence the result is unknown.

A private, atomic `jobs/JOB/RUN/usage.json` checkpoint contains only usage and
job/run/phase/frozen execution identity. It is controller-owned, outside the
worker output mount, and preserves observations when cancellation kills the
executor before its final result. Normal completion stores the same normalized
usage in SQLite and measurement artifacts. CLI `status`, the status API and
existing Analytics/issue detail consume that shared contract after restart.
Model/provider/role attribution still comes from the frozen execution profile,
never from usage event fields. Failed/cancelled runs keep their outcome.

There is **no Pi historical log backfill**. Existing records and mixed or
truncated legacy logs are not rewritten. This bounded measurement slice leaves
#51's scoring/benchmark engine, #69's model qualification and #70's improvement
proposal workflow open.
