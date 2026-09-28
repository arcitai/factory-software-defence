# Capability and verification map

Factory binds each result to its exact revision and current policy. Source
checks, independent review, installed qualification, protected CI and publication
establish separate facts. Passing fixtures do not qualify model judgment,
security or production readiness.

## Delivered capabilities

| Capability | Release / delivery | Boundary |
| --- | --- | --- |
| Immutable source admission | 0.7.0 · [PR #65](https://github.com/arcitai/software-and-defence-factory/pull/65) | Retained source and explicit revisions; unknown provenance stays unknown. |
| Trusted PR handoff | 0.8.0 · [PR #80](https://github.com/arcitai/software-and-defence-factory/pull/80) | Protected evidence, workflow checks and durable receipts; no merge/deploy authority. |
| Optional browser verification | 0.9.0 · [PR #81](https://github.com/arcitai/software-and-defence-factory/pull/81) | Tool/story/revision-bound artifacts; explicit policy and actual browser readiness required. |
| Compatible protected evidence | 0.9.1 · [PR #85](https://github.com/arcitai/software-and-defence-factory/pull/85) | Exact supported writers and current provenance/policy guards; no rewritten acceptance or hashes. |
| Reviewed-candidate continuation | 0.10.0 · [PR #87](https://github.com/arcitai/software-and-defence-factory/pull/87) | Original source baseline preserved; aggregate checks/review repeated. Unfinished Build checkpoint recovery remains [#42](https://github.com/arcitai/software-and-defence-factory/issues/42). |
| Repository Inbox lifecycle | 0.11.0 · [PR #89](https://github.com/arcitai/software-and-defence-factory/pull/89) | Explicit admission, creation-only issues, canonical execution history and duplicate-active refusal. |

Delivered 0.11.0 verification covered protected Node 22/24 CI, 279 runtime/package
and 58 dashboard checks, 12 installed provider/native cases, six browser cases
at 1440/390/320px in both themes, and all 103 public package files. Installed
adoption preserved histories. Those results apply to 0.11.0, not later revisions.

## Current source verification

| Check route | Coverage | Limit |
| --- | --- | --- |
| `npm ci --ignore-scripts`; `npm run build:dashboard`; `npm run check` | Locked dependencies, built assets, syntax and runtime/package/dashboard regressions | Does not prove protected remote CI or registry publication. |
| [Tarball tests](../tests/npm.test.mjs) | Disposable global install; shared bin help/version/state; collision refusal; offline npm exec/npx; cached dispatch; source-checkout refusal; served HTML/assets | Controlled bootstrap fixture, not an exact published old-release upgrade or rendered browser inspection. |
| [Profile](../tests/execution-profile.test.mjs) and [delivery tests](../tests/delivery.test.mjs) | Exact writer versions, unchanged retained records, current provenance/policy/revision guards and unsupported writer rejection | Controlled records/providers do not prove live account writes. |
| [Service](../tests/services.test.mjs) and [source admission tests](../tests/source-admission.test.mjs) | Stable launch/update contracts and retained-source behavior | Does not prove a running installation's service/image/history preservation. |

### Pi project-trust startup (0.15.3, #103)

The 0.15.2 plain-directory actual-Pi adapter fixture passed, but adding only an
empty `.agents/skills` directory made the same fixture fail before inference at
`trust.json.lock`. Replaying the unchanged 0.15.2 launcher with installed official
Pi **0.87.1** reproduced `EACCES` with a non-root permission-protected binding;
a direct Pi invocation using an existing read-only mount reproduced `EROFS` at
the same lock operation. No baseline checkout or private installation was edited.
The candidate passes the identical representative fixture.

The installed upstream `core/trust-manager.js` explains the gap:
`hasTrustRequiringProjectResources` tests existence of `.agents/skills` in the
project/ancestors, or supported entries under project `.pi` (including settings,
extensions, skills, prompts, themes and system files). `ProjectTrustStore.get`
locks even when no trust file exists. `core/resource-loader.js` loads explicit
CLI extensions before the trust decision and preserves explicit CLI skills.
`core/package-manager.js` resolves project packages before extension filtering;
`--no-extensions` alone is therefore insufficient to exclude installation.
These are pinned upstream behavior, not claims about other Pi releases.

The candidate separates read-only binding/adapter inputs from a fresh private
Pi runtime directory in the existing sandbox tmpfs and explicitly denies project
trust with `--no-approve`. No trusted project/parent entry is created. Pi creates
empty `auth.json` and `models-store.json` files, not imported credentials;
`models.json` remains linked to the read-only binding. The context adapter reads
its original read-only model input directly. Existing selection, handshake,
context/output validation and no-cloud-fallback behavior remain in force.

[Actual-Pi trust regression](../tests/pi-trust.test.mjs) covers the old plain and
minimal-trigger cases, candidate startup, separate Build and permission-protected
Review tools/reports, all six mounted skills, task/project text, distinct runtime
directories and cleanup, ignored inherited trust/auth state, unchanged model
input, terminal provider/tool/report-write failures and an adversarial extension,
local package and dependency-install probe. Execution would leave a marker;
the marker is absent. [Executor regressions](../tests/executor-container-recovery.test.mjs)
check native mount construction, read-only rootfs/policy/skills/Review, omitted
credential environment and normal recovery. Those use a labeled synthetic Docker
shim, not a running Docker daemon. `npm run qualify:pi` includes this fixture and
the retained #100 context compaction, recovery, six-result batch and output-budget
checks. All inference responses in these fixtures are synthetic loopback HTTP.

Locked dependency installation and dashboard build passed. `npm run check`
passed **453 runtime/package tests and 63 dashboard tests**, with no failures or
skips; `npm run qualify:pi` passed **20 actual-Pi synthetic cases**, including the
trust fixture and retained #100 cases. These are source-worker results.

This worker has Node 22.23.3 and actual Pi 0.87.1, but no Docker CLI/daemon.
Full repository checks include disposable tarball installation; they do not prove
an installed native Factory Build/Review in the selected image. Exact installed
CLI/API/image qualification, independent Review of the delivered candidate and
one actual local-model run remain lead-owned gates. The failed local #51 attempt
is not retried, rewritten or accepted by this source repair.

### Pi context-boundary first slice (0.15.2, #100)

This candidate pins the standard worker to **`@earendil-works/pi-coding-agent@0.87.1`**
with engine enforcement (**Node >=22.19.0**), keeping **Codex 0.156.1** and the base
image digest unchanged. Registry metadata identified the maintained namespace and
repository; the old `@mariozechner/pi-coding-agent` remains at 0.73.1. The installed
0.87.1 package reports that version and includes an npm shrinkwrap. Its registry
integrity is
`sha512-m8ArJUtVcQMSe1lLE/Ei7vX/JV7O39sWmWBsXV2NOU70F0qCp8GubA24pT3LnwTmM6LL2xV80/h6sQg85n69ew==`.
The standard image tag advances to `software-defence-factory-job:0.4.0`; it is not
an instruction to change an active installation's frozen image.

Primary-source audit: the [pinned changelog](https://github.com/earendil-works/pi/blob/v0.87.1/packages/coding-agent/CHANGELOG.md)
records between-tool threshold compaction in 0.84.4, trailing-tool accounting in
0.86.0, and context projection/recovery changes in 0.87.0. The
[pinned session implementation](https://github.com/earendil-works/pi/blob/v0.87.1/packages/coding-agent/src/core/agent-session.ts)
and [compaction documentation](https://github.com/earendil-works/pi/blob/v0.87.1/packages/coding-agent/docs/compaction.md)
place the check after tools and before the next assistant request; installed
0.73.1 instead checks after `agent_end`/before another prompt. Both actual packages
emit `compaction_*` events; the new stream also exposes retry-aware `agent_end`
and `agent_settled`. This is an upstream compaction implementation, not a second
Factory agent loop. Ollama's [0.33.3 prompt construction](https://github.com/ollama/ollama/blob/v0.33.3/server/prompt.go)
can truncate earlier messages while retaining system/latest messages. That source
inspection **does not establish** the cause of #83's `no user query found in messages`.

The actual installed CLIs were exercised on Node 22.23.3/npm 10.9.9 with a disposable
loopback HTTP chat-completions server and isolated HOME, working directory and
read-only selected registry. No Ollama server or real model was used. The fixture
model `fixture-context`, character/4 token accounting and 65,536 allocation are
**synthetic transport budgets**, with 8,192 output, upstream default 16,384 reserve
and 20,000 recent-token retention. No private installation, usage database or
production analytics receives those counts.

| Controlled actual-CLI case | Observed result | Boundary |
| --- | --- | --- |
| 0.73.1 baseline, seven requested reads | Five reads; next request exceeded the fixture allocation (about 59,241 input + 8,192 output); `agent_end` preceded compaction; launcher failed, no report | Reproduces ordering, not the original provider's exact error |
| 0.87.1 same seven-read workload | Threshold compaction, resumed reads and report write; ten requests including one summary; exit 0 | All requests fit the fixture allocation; summary content is scripted |
| Long aggregate, 24 reads | Multiple compactions and report; final JSON record exceeds 1 MiB; exit 0 | Demonstrated why the old 1 MiB parser limit rejected otherwise recovered long runs |
| Transient HTTP 500 | Explicit bounded retry, later compaction/tool use/report; exit 0 | No error event discarded or model changed |
| Explicit context overflow after three reads | Overflow summary/retry, resumed work and later threshold compaction; exit 0 | Recovery depends on summarizable history |
| Overflow after only one read | Exit nonzero, no summary/report, input file retained | Insufficient history is not represented as successful recovery |
| Terminal summarization/provider errors | Exit nonzero; no report or fallback; input retained | Upstream may continue after a compaction failure; launcher keeps that failure fatal |
| Persistent HTTP 500 | Four provider requests (initial + three retries), then nonzero | Per-case process-group deadline 45 seconds, request bound 24 (40 for aggregate) |

The [wire fixture](../tests/pi-local-adapter.test.mjs) also passes against both
pins for independent role contexts, exact model/provider/output, all supported
reasoning requests, unsupported reasoning, unavailable model and registry mismatch.
Pi 0.87.1 initially failed against the read-only registry because credential refresh
tried to create/lock `auth.json`. Passing the existing fixed non-secret placeholder
via supported `--api-key` resolves that compatibility issue without creating a
credential store or making the registry writable. No local registry schema or
CLI/API/dashboard setting was added. Cloud credential selection is unchanged.

The [completion tests](../tests/pi-completion.test.mjs) require explicit recovery
and a successful terminal assistant/aggregate (plus settlement on the new stream).
They reject failed/aborted compaction even followed by success, retry exhaustion,
unfinished recovery, malformed/oversized/truncated JSONL, missing completion and
length/abort exits. Parsing permits at most 8 Mi characters per record, separately
from the existing bounded retained log. The [24-read native regression](../tests/pi-context.test.mjs)
failed with the old limit and passes with the bounded larger limit. Larger streams
still fail closed. Raw error events remain in the output stream; production Pi
usage is still unknown (#51).

Reproduce from the exact candidate source with its locked dependencies:

```sh
npm ci --ignore-scripts
# Isolated install; use an executable filesystem (some workers mount /tmp noexec).
npm install --prefix .tmp/pi-current --no-audit --no-fund @earendil-works/pi-coding-agent@0.87.1
PATH="$PWD/.tmp/pi-current/node_modules/.bin:$PATH" npm run qualify:pi
npm install --prefix .tmp/pi-baseline --no-audit --no-fund @mariozechner/pi-coding-agent@0.73.1
PATH="$PWD/.tmp/pi-baseline/node_modules/.bin:$PATH" FACTORY_PI_BASELINE=1 FACTORY_REQUIRE_PI=1 \
  node --test tests/pi-context.test.mjs
npm run build:dashboard
PATH="$PWD/.tmp/pi-current/node_modules/.bin:$PATH" npm run check
```

`qualify:pi` requires the exact pin and fails rather than silently skipping when
unavailable. Ordinary `check` reports native Pi tests skipped if the pin is absent.
It does not download Pi automatically. Baseline mode requires an explicit flag and
asserts the old long-run failure. Fixtures create/remove only their own temporary
data; production unfinished-checkout preservation remains the existing executor's
responsibility and is covered by container/recovery regressions.

For Lead's exact-image transport rerun, after building the reviewed worker image,
mount this candidate (including locked source dependencies) read-only. No published
ports, credentials or host inference are needed for loopback transport:

```sh
docker run --rm --read-only --network none --cap-drop=ALL \
  --security-opt=no-new-privileges --memory=2g --cpus=2 --pids-limit=128 \
  --tmpfs /tmp:rw,nosuid,size=512m \
  --mount "type=bind,source=$PWD,target=/candidate,readonly" --workdir /candidate \
  --env FACTORY_REQUIRE_PI=1 --entrypoint node REVIEWED_IMAGE_ID \
  --test tests/pi-local-adapter.test.mjs tests/pi-context.test.mjs
```

Final worker checks passed: `npm run build:dashboard`, then `npm run check` with
**436 runtime/package tests and 63 dashboard tests**, no failures or skips, including
the candidate tarball install/invocation. Dedicated `qualify:pi` passed nine native
0.87.1 cases; explicit 0.73.1 baseline/registry compatibility passed two cases.
The completion protocol suite passed 34 cases. These are Node 22.23.3 source and
controlled transport results; protected Node 22/24 CI remains Lead-owned. No Docker CLI,
local inference endpoint or live-model allocation was available to this worker.
Lead still owns exact installed CLI/API/Docker proof, one bounded actual local
inference Factory fixture, independent Review, protected CI/release and idle image
adoption. There is no 64k/larger-window quality, latency or memory comparison here;
actual inference quality/latency/peak memory and hardware cost remain null. No
claim is made for long real repository delivery, resolution of #83's provider
root cause, #51 usage, #42 unfinished-checkpoint reuse or broader #69/#100 tuning.
See [setup/migration/rollback](setup.md#local-context-budget-and-worker-image-0152-100).

### Pi retained batch revision (0.15.2, #100)

The reviewed first slice above was **not accepted or delivered**. Lead reported
that the exact installed image passed synthetic/installed checks but the actual
65,536 local allocation failed after six 44,629-byte reads in one assistant batch,
even after a successful summary. Those external results are operator-supplied;
this worker did not access that private job or host. The earlier sequential fixture
and its historical counts above remain evidence of that earlier slice only.

This revision bundles a local-only adapter using Pi 0.87.1's supported
`registerProvider` stream wrapper and `session_before_compact` hook. Pi still owns
cut selection, summaries, retry limits and the agent loop. Only tool-result text
in request copies is shortened. Calls/arguments, result IDs/order, system/tool
instructions and the exact original task survive; raw events and source files
are untouched. Shortened results carry original byte length and explicit bounded
re-read guidance. The unchanged bounded diagnostic retention still applies.
The summary preparation hook projects copies before upstream serialization;
the provider wrapper checks **every actual generation and summary payload**.

The conservative request bound is serialized UTF-8 bytes + 1,024 template
headroom + 64 per message/tool declaration + the **full configured output**.
It includes schemas, arguments and escaping, unlike the old characters/4 fixture.
This is an estimate for text tokenization, not measured usage or a guarantee for
arbitrary endpoint chat templates/tokenizers. Summary preparation additionally
reserves 8,192 bytes for pinned upstream templates and previous-summary text;
the exact final wire guard remains authoritative. When fixed content cannot fit,
the adapter exits before transport, retaining unfinished files. It neither drops
instructions nor changes models/allocations. It can be intentionally conservative;
useful recovery with an actual model still needs Lead's unchanged fixture.

`tests/pi-context-batch.test.mjs` uses the **actual pinned CLI**, six distinct
44,629-byte/551-line files in a single assistant response, scripted pre-burst
usage of 6,108 input tokens, and an independent byte-budget wire oracle. It checks:

| Case | Controlled result |
| --- | --- |
| Unprotected 0.87.1 | Summary succeeds, then retained six-result request projects to about 282,363 before 8,192 output; fixture rejects it. Pi itself exits 0 despite the provider error. No report. |
| Bundled adapter, 65,536 / 8,192 | Summary, six paired excerpts, bounded re-read of an omitted line, report and successful completion; all requests fit. |
| Bundled adapter, 16,384 / 1,024 | Same batch succeeds with two summaries and resumed useful tools. |
| 4,096 / 1,024 | Required fixed prompt/schema cannot fit; zero provider requests, nonzero exit. |
| Failed summary | Upstream continues tools and writes the scripted report; launcher still returns nonzero. |
| Terminal provider failure | Nonzero exit, no report/fallback; input files intact. |
| Oversized required tool arguments | Explicit budget failure; actual unfinished write is preserved, no fabricated report. |

This proves the retained-group boundary in the deterministic transport. It does
**not** prove Ollama removed the user message or reproduce its exact 500 error.
Raw tool events retain all six complete results; wire assertions verify original
task, system and every tool ID/order, with no automatic repository extension load.
Each case has a 45-second process-group deadline and 16-request bound. Synthetic
responses, summaries, usage and reports never enter production analytics.

`qualify:pi` now includes this seven-case batch regression alongside the nine
existing protocol/transport cases. The sequential suite uses separately scripted
threshold usage and independent byte-based request bounds; its old 0.73.1 baseline
retains the original characters/4 oracle. Reproduce the baseline with only
`FACTORY_PI_BASELINE=1 FACTORY_REQUIRE_PI=1 node --test tests/pi-context.test.mjs`
on a PATH selecting 0.73.1. It invokes the old CLI directly and applies the existing
completion parser; the new protected launcher explicitly requires 0.87.1.
The exact-image Docker command above should also include
`tests/pi-context-batch.test.mjs`.

The controller now mounts the two bundled adapter modules read-only beside the
selected registry. Automatic extension discovery remains disabled; only that
explicit bundled extension is loaded. Missing adapter files or unsupported Pi
versions fail closed. No new profile field or UI control was added, and the
admitted role command/config/image remains immutable. Historical 0.15.0/0.15.1
records stay readable; running the new local launcher on an old image requires
an explicit idle image migration, never an automatic image rewrite.

Worker validation on Node 22.23.3/npm 10.9.9 passed: `npm run build:dashboard`,
`npm run check` (**446 runtime/package + 63 dashboard tests**, no skips),
`npm run qualify:pi` (**16 actual-CLI synthetic cases**), and the explicit
0.73.1 baseline (**one expected-failure regression**). The full suite includes
Unicode/escaping budgets, malformed tool-pair rejection, read-only adapter mounts,
missing-adapter rejection, packaging and existing recovery/profile tests. Initial
full-check startup failed because root dependencies were absent; locked
`npm ci --ignore-scripts` restored them before the passing run.
No Docker CLI or local model endpoint is available here. Lead must rebuild the
exact image, rerun installed CLI/API/Docker proof and the unchanged real local
fixture, then obtain independent aggregate Review and fresh acceptance. Larger
windows, quality, latency, memory, hardware cost, #51 and broader #69/#100 remain
unqualified; no local product delivery is claimed.

### Pi output allowance revision (0.15.2, #100)

The retained-batch candidate above, reviewed checkpoint `d7cc323`, was also
**rejected, not delivered** after Lead's unchanged actual local fixture ended
with `stopReason: length` and one output token after successful compaction.
Those private-model observations are operator-supplied. The earlier synthetic
passes did not enforce output allowance and therefore missed this boundary.

This worker reproduced it with the actual installed official **Pi 0.87.1** on
Node **22.23.3**, isolated HOME/registry/workspace and loopback transport. Before
the adapter repair, the tightened six-read fixture failed: generation allowances
were **8192, 8192, 1**, with a bounded **8192** summary between the last two.
The final request's independent input budget was **57,339**; the endpoint returned
`length` instead of a complete scripted tool call. This proves output starvation
in the transport path, not the historical Ollama 500's cause.

Audited installed `pi-ai/dist/api/simple-options.js` and
`pi-ai/dist/api/openai-completions.js` agree with the pinned primary sources:
[`buildBaseOptions`](https://github.com/earendil-works/pi/blob/v0.87.1/packages/ai/src/api/simple-options.ts)
clamps against native history, including a 4,096 safety margin and minimum one
token; [`streamSimple`/`stream`](https://github.com/earendil-works/pi/blob/v0.87.1/packages/ai/src/api/openai-completions.ts)
construct the request before invoking `onPayload`. Factory's existing projection
therefore ran too late to affect that clamp. The repair captures the caller's
allowance before `streamSimple`, restores the selected output field in the
request copy, then measures/projects that final payload before transport.
Generation defaults to the admitted binding; explicit upstream summary limits
are preserved. Missing/ambiguous output fields, invalid or excessive allowances,
and unsupported reasoning-budget formats fail closed. Supported effort selection
is unchanged and shares the output ceiling. No history, allocation, model,
upstream compaction loop or completion/failure guard is changed.

The actual-CLI batch fixture now enforces a deterministic output allowance
(serialized response UTF-8 bytes/4, synthetic units only) as well as the existing
conservative input bound. An insufficient allowance produces `length`, never a
complete call. Every successful generation must request exactly the selected
output. Exact system/policy, original task, tool schemas and paired IDs/names/
arguments are asserted; raw six-file results remain intact with re-read guidance
in projections. Each process still has a 45-second deadline and 16-request bound.

| Controlled six-read configuration | Wire result after repair |
| --- | --- |
| 65,536 / 8,192, reasoning none | Post-summary input budget <=57,344, generation output 8,192; re-read/report succeeds |
| 65,536 / 16,384 | Generation output 16,384, summary still 8,192; re-read/report succeeds |
| 32,768 / 4,096, `max_completion_tokens`, reasoning high | Correct alternate field/effort, input <=28,672; re-read/report succeeds |
| 16,384 / 1,024 | Two summaries, bounded requests, re-read/report succeeds |
| Terminal length/provider/summary failures, 4k fixed-content overflow | Nonzero launcher exit; summary failure stays fatal even if Pi later writes a report |

The oversized-required-argument control uses 32,000 output so its scripted
70,000-character write itself fits the fixture response allowance; subsequent
input protection fails and preserves that unfinished file. Unit checks reject
ambiguous fields/unsafe reasoning limits and preserve both 8,192 turn-prefix and
13,107 history-summary caps under a larger generation limit.

Reproduction uses the existing isolated install and `npm run qualify:pi` commands
above (now **19 actual-CLI synthetic cases**, including ten grouped-batch cases).
Worker validation passed `npm run build:dashboard`, then `npm run check`
(**451 runtime/package + 63 dashboard tests**, no failures/skips), the dedicated
19-case qualification, 118 focused budget/completion/profile/recovery tests, and
the explicit Pi 0.73.1 expected-failure baseline. Package checks install and invoke
the candidate tarball. No dependency, dashboard source, CI or image-pin change was
needed for this output-allowance repair; the retained migration stays intact.
The exact-image Docker command must include `tests/pi-context-batch.test.mjs`.
Docker and a local model endpoint are unavailable in this worker; these are actual
package/CLI tests, **not an installed-image or actual-inference qualification**.
Lead must rebuild the exact image, rerun installed CLI/API/Docker proof and repeat
the unchanged real fixture. Factory owns fresh independent aggregate Review and
acceptance. No local quality/delivery claim, larger-window tuning or production
adoption is made; inference quality, latency, memory and hardware cost remain null.

### Bounded release-download freshness (#83)

The 0.15.1 source candidate requests fresh npm metadata for the already-selected
exact release. Only `ETARGET` receives up to three attempts with one-second waits,
all within the existing 120-second download budget. Identity validation precedes
immutable adoption; selection, activation, rollback and maintenance ownership
remain in the existing callers.

Controlled injected-runner tests exercise the actual `installRelease` path for
stale metadata, delayed visibility followed by success, three-attempt exhaustion,
shared deadline exhaustion, offline/authentication/spawn failures, wrong package
identity, and cleanup that preserves prior releases and unrelated staging/state.
The new freshness/retry cases failed before the change. No PATH or environment
mutation, registry write or model call is used by these fixtures.

The patch explicitly supports its unchanged v1/v2/v3 writers and retains 0.15.0
local/hybrid evidence. Protected-profile regressions cover both patch versions
across Build/Verify/Review/handoff, unchanged retained bytes, and rejection of
unknown writers, wrong phases, policy/selection/identity changes and frozen-config
tampering. Profile compatibility tests failed before the allowlist/readback fix.

Local Node 22.23.3/npm 10.9.9 checks passed: locked dependency installation,
dashboard build, `npm run check` (394 runtime/package and 63 dashboard tests),
including installation and invocation of the actual candidate tarball. This is
controlled source/package evidence, not a reproduction of npm propagation or
installed managed-service qualification. The lead must separately qualify a real
public package download from the exact installed candidate. The cache-versus-registry
cause of the observed incident remains unknown; independent Review, publication
and operator adoption are not claimed.

Factory 0.11.1's naming first slice was delivered via protected maintainer
[PR #92](https://github.com/arcitai/software-and-defence-factory/pull/92), per the
operator brief. Native publication refused its malformed retained patch before
provider writes ([#91](https://github.com/arcitai/software-and-defence-factory/issues/91)).
That maintainer delivery does not establish successful native publication.

The 0.11.2 candidate preserves exact Buffer output for Build and handoff patches.
The executor regression failed on the original writer and passes with the fix:
trailing blank context, missing final newline, binary and non-UTF-8 text survive
continued Build and handoff; retained bytes/digest match Git output and replay
against the exact retained base to the candidate tree in new bare storage.
SHA-1 and SHA-256 local handoff are covered; GitHub publication remains SHA-1.
Malformed and wrong-tree patches fail before acceptance; scratch cleanup
preserves unrelated prior evidence. A modeled 0.11.1 accepted malformed patch
with a matching digest still refuses publication with zero provider writes and
unchanged patch/approval records. Exact supported v1 writers now include 0.11.2;
all current provenance, source, browser, workflow and publication gates remain.

`npm ci --ignore-scripts`, `npm run build:dashboard` and `npm run check`
passed for this candidate: 297 runtime/package tests and 58 dashboard tests.
These are real local Git/executor/controller regressions using controlled
Docker/model/provider fixtures, not installed native or live provider proof.
Operator installed/native proof on Z13, independent native Review, guarded
publication and adoption remain pending. No UI source changed; #90 remains the
next restoration slice before #62/#63. See [recovery](recovery.md) for preserving
old malformed evidence and the separately reviewed maintainer/new-attempt routes.

## Qualified primary Inbox (#90 / #94)

The 0.12.0 candidate restores the compact primary list/Kanban, status rail,
shared checkbox filters and progressive detail with linked attempts. Canonical
`work_records` combine loaded repository issues, retained histories and local
requests in CLI/API and dashboard. Unknown assignments remain unknown;
readiness is distinct from execution state. Creation and Start work remain
separate, with the original #60 lifecycle and protected evidence/delivery guards.

Implementation and installed qualification are complete for candidate
`ed3292ccd079a182ee573d6baf01e2fe1d9c3223` (tree
`467b9375dca757a521bc523e86c6c565f5bc0fd6`). Native independent aggregate Review
`run_c2ba3c93edf433e60e364c4f` passed with no actionable defects against original
delivery base `a7095949a3c3aa632a419e5ad1752b53963a5480`. The lead's
[qualification evidence](https://github.com/arcitai/software-and-defence-factory/issues/90#issuecomment-5857634334)
records these boundaries:

- **Source/Verify:** locked install, dashboard build and full checks passed:
  302 runtime/package and 61 dashboard tests. #94 covers same-directory atomic
  JSON fixture publication in the generated Docker client and concurrent parent
  updates, deterministically observing complete old/new JSON without weakening
  cancellation/recovery assertions.
- **Actual installed read-only integration:** CLI/API `work_records` agreed for
  25 live source issues; zero jobs were admitted. All eight served assets were
  byte-identical to the installed tarball. The private controller is stopped.
- **Isolated Chromium:** all six interaction cases passed at 1440/390/320px in
  light/dark. Coverage includes mixed retained histories; combined label/type/model
  filters, Select all/reset; stable Repository overlay; search/no-match; keyboard
  board scrolling; previous/next/close/Escape and scroll restoration; operator
  brief retention after stale-start refusal; active-attempt refusal; source
  failure/recovery; and creation-only retry with a stable request key and no
  implicit jobs.
- **Visual acceptance:** the restored composition passed comparison with live
  Build by Warp. First-row tops were 263.5/424.5/466.5px at the respective widths,
  with no page overflow. UI writes and error replies used controlled replay,
  separate from actual read-only provider integration. Raw Markdown body
  rendering remains #37.

Private artifacts remain outside source/npm. Protected release and adoption
are pending. The documentation-only continuation requires refreshed aggregate
Review from the original base and lead verification that every final installed
package file except the edited proof document is byte-identical to the qualified
package before reusing UI/API proof and granting handoff. Qualification does not
claim publication, live provider mutations or customer application jobs.

## Skill ownership (#62)

Delivered in PR #96 / 0.13.0, as reported in the accepted operator brief.
The following records the earlier checkpoint/source evidence and its limits;
its historical pending gates do not describe the current delivery status.

The 0.13.0 candidate separates one canonical `kit/skills/` runtime catalog from
`.agents/skills/factory-foundation/` operator guidance and removes the obsolete
operator store. All six runtime SKILL.md files are byte-identical to the admitted
0.12.0 source. Foundation's relative documentation links follow its new location.
Before moving files, the trace covered the definition reader and CLI/API/Skills
consumers, Foundation lookup, executor mounts and harness presets, exporter
mapping, npm allowlist and package/catalog/export/executor regressions.

Jobs retain read-only `/factory-skills`; Codex agent phases also mount that same
catalog at `/etc/codex/skills`. Pi retains `--skill /factory-skills`; custom
harnesses retain the prompt contract. Operator instructions are outside these
mounts. Repository copies may still be read as untrusted project context and
cannot grant host authority. All six job skills remain available; this is not
per-role restriction, browser installation or model qualification.

Source regression coverage exercises actual tarball installation without a
source checkout, installed Foundation and relative links, exact CLI/API paths,
content and hashes, staged skill byte/hash parity, existing-destination refusal,
and the executor's Docker arguments for Codex/Pi/custom/mock and deterministic
checks. The Skills component renders the shared catalog with its actual
provenance. Controlled Docker clients and DOM tests are source regressions,
not installed Docker or rendered browser proof. The [writer compatibility
audit](npm.md#protected-evidence-compatibility) admits only the explicit 0.13.0
writer in addition to supported old writers, preserving immutable evidence and
all current validation guards.

`npm ci --ignore-scripts`, `npm run build:dashboard` and `npm run check`
passed again in this continuation: 310 runtime/package tests and 62 dashboard tests, with no
failures or skips. Runtime/package coverage includes the actual disposable npm
installation; it does not establish native discovery or host Docker enforcement.

The operator reports that reviewed checkpoint `7463a4c31012e80200ad2b12706ac300020c3d19`
passed installed CLI/API/export and Foundation checks, a real synthetic Docker
handoff in a separate installation, and credential-free native Codex/Pi discovery
of six skills each with Foundation absent. These were controlled commands without
inference; they do not prove model quality or live provider access.

This continuation preserves the checkpoint's runtime/catalog/executor behavior
and 0.13.0 version, shortens the Skills notes, and integrates #63 below. Native
Verify and independent Review must cover the complete combined candidate after
Build returns. Final installed runtime-byte comparison, desktop/narrow Skills
browser inspection, visual acceptance, protected release and adoption remain
operator gates. Custom harness discovery, inference/provider quality and browser
availability remain separately qualified capabilities.

## Ownership diagrams (#63)

Delivered in PR #96 / 0.13.0, as reported in the accepted operator brief.
The following is the retained pre-delivery evidence record.

Three operator-authored, visually inspected views now cover setup/deployment,
runtime layers/ownership and work lifecycle in [architecture](architecture.md),
with a compact README preview and editable sources. The six Excalidraw/SVG files
were imported unchanged from immutable source
`4ee0f50bc8a4f481fa9b7aec5169d4370c6415a6`; all six supplied SHA-256 hashes matched.
The overloaded active diagram copies were removed. Text alternatives distinguish
delivered Inbox behavior from planned profiles/providers/MCP and quality work,
inference-only job credentials from repository/CI/merge authority, and packaged
Foundation guidance from job execution. Independent Review must assess the actual
diagram semantics across #62/#63; final visual/installed acceptance is operator-owned.

## Delivered-commit check readback (#37, 0.13.1)

This bounded source slice starts at admitted main
`e813eec7716349df28d331b9fdfdbb4ddcde2cbe`. A controlled PR96-shaped fixture uses
reported delivered SHA `74d5c2d5563e44a89ab84434173a8014b4d4fe62`, three completed
runs, empty PR associations and success/success/skipped conclusions. Before the
fix it returns `unknown`; the same regression now returns `success`, with two
passing executions and one visible skipped result. This reproduces the supplied
observation locally; it is not an actual GitHub query.

The trace covered GitHub normalization, DeliveryService's immutable final SHA
and before/after PR identity guards, retained receipts, shared publish/status
CLI/API responses and task-detail rendering. The controller guards and actions
are unchanged. Exact matching run heads may be commit-scoped when the optional
association list is empty. Conflicting association numbers, supplied head/repo
identities, missing/mismatched SHA or combined-status repository/SHA, malformed
or unreadable data, missing/truncated pagination and unknown conclusions cannot
produce aggregate success. Skipped/neutral, pending, failed, cancelled and
unknown remain distinct. See [the shared fields and limits](interfaces.md#delivered-commit-checks-0131-bounded-37-slice).

Focused source regressions cover the positive and negative response matrix,
merged-PR CLI/authenticated API equivalence without additional provider writes,
and dashboard DOM rendering of provider-normalized results, legacy uncertainty
and recovery. Existing delivery tests retain PR-race/restart and protected
acceptance coverage. Fixtures carry realistic commit/repository identity; none
qualifies a real integration. The v1 writer audit found protected execution,
candidate/check/review/acceptance writers and policy/isolation guarantees
unchanged. The explicit 0.13.1 compatibility entry adds no automatic trust for
future versions; retained-evidence and refusal tests still pass.

The revision continues checkpoint `b5cb91d89431cae0eeb4a548fe3caa72ef21288b`
(review `run_3022982b651740367ce7aea4`) on the original admitted base above,
retaining 0.13.1. Controlled before probes reproduced Review's false successes
for malformed supplied PR head/base/repository containers and combined-status
repository URL disagreement. Those cases now return unknown. Regressions also
cover contradictory repository names/URLs/owner and commit URLs, malformed
SHAs, missing required combined identity and valid absent optional details.
PR96-shaped success/success/skipped, matching associations, pagination and
conclusion rules remain covered. No controller guard or protected writer changed.

`npm ci --ignore-scripts`, `npm run build:dashboard` and `npm run check` passed:
**324 runtime/package tests and 62 dashboard tests**, no failures or skips.
Package tests exercise a disposable installed tarball; this is source regression
coverage, not external installed acceptance. The worker report, before/after
logs, final build/check logs and source/writer hash comparisons are retained
privately under `/output/` in the job artifacts, outside source/npm.

The lead reports that b5cb's installed provider read actual PR96 as success
(two successful checks, one skipped), with 11 controlled provider cases and six
isolated browser cases passing. All 52 tracked dashboard files (including build
configuration and lockfile), CLI, server, queue and delivery projection code
match that checkpoint byte for byte; SHA-256 comparisons are retained. This
permits carrying forward the reported isolated browser presentation evidence
for unchanged normalized payloads only. The provider changed, so its prior
installed/live proof does not qualify this revision. The revised provider passed
the 11-test focused suite and an 11-case controlled probe again from a disposable
installed 0.13.1 tarball; all 104 installed files match source/build output.
These synthetic responses are not a rerun of the lead's live provider proof.
Final installed actual-GitHub and shared
CLI/API/dashboard readback acceptance remain with the lead. No new live-provider
or rendered-browser run is claimed inside this job.

Native Factory owns the next independent Review of the combined diff; this
worker has not started a reviewer or inferred acceptance. The accepted Inbox/
list/Kanban/filter/detail layout and all actions remain; #37 stays open for its
remaining parity work. No role profiles, workflow changes or new write operation
are included. External acceptance, deployment and model quality are not claimed.

### Row API self-identity revision (native Review R1)

This revision retains reviewed checkpoint
`b8e417906956679d1fe102a922f4a18ef66b6c41` (tree
`c2c940108102fa49033ed10538be9f519c8f1f21`, review
`run_b0af7122b2c279427e5e0dd3`) on the original `e813eec` admission/delivery
base and version 0.13.1. The earlier evidence above remains about its recorded
candidate. The lead additionally reports b8e417's installed actual PR96 readback
as success (two successful checks, one skipped), 14 controlled provider cases
and six browser viewport/theme cases passing. These are retained operator
observations, not this worker's fresh qualification or external acceptance.

Before probes against b8e417 reproduced false success for both check-run and
individual commit-status rows with another repository's API self URL. The same
regressions now require unknown status/scope, `passed: false` and
`non_blocking: false`. Coverage includes matching/absent self URLs, malformed
endpoints, conflicting row IDs, exact-SHA status URLs, external CI links and
mixed valid/invalid rows. The full normalized identity chain was inspected:
requested immutable target, run head and PR associations, combined repository/
commit envelope, row self identity and shared receipt projection. Existing
container, before/after PR, pagination and conclusion guards remain unchanged;
app/creator identities, context labels and external CI links are not treated
as the target repository. No new provider abstraction, request or write exists.

Endpoint interpretation follows GitHub's [check-run response contract](https://docs.github.com/en/rest/checks/runs#list-check-runs-for-a-git-reference)
and [commit-status response contract](https://docs.github.com/en/rest/commits/statuses#get-the-combined-status-for-a-specific-reference).
Check self URLs identify `check-runs/{id}`; statuses accept `statuses/{id}` or
the documented legacy `statuses/{sha}` form. Numeric resource IDs agree with
supplied row IDs; a SHA suffix agrees with the delivered commit instead.

`npm ci --ignore-scripts`, `npm run build:dashboard` and `npm run check` passed
with **328 runtime/package and 62 dashboard tests**, no failures or skips.
The final 15-test provider suite fails its two new negative tests against the
retained reviewed provider, then passes from a disposable installed 0.13.1
tarball. All 104 installed files match source/build output. These are controlled
responses, not live GitHub qualification. Before/after logs and hash manifests
are retained under `/output/r1-*` with the worker report, outside source/npm.

Exact SHA-256 comparisons against b8e417 confirm all 52 dashboard files and
CLI/server/queue/delivery projection sources unchanged. Prior browser evidence
can carry forward only for the unchanged presentation of normalized payloads;
no browser run was performed here. Protected writers, acceptance guarantees and
the existing explicit 0.13.1 compatibility entry are unchanged. The changed
provider requires fresh lead installed/live qualification and final acceptance;
native Factory owns independent Review of the combined diff. #37 remains open.

## Completed 0.13.1 delivery readback qualification

The earlier pending gates above are superseded by the lead's
[delivery record](https://github.com/arcitai/software-and-defence-factory/issues/37#issuecomment-5858449096)
and merged [PR #97](https://github.com/arcitai/software-and-defence-factory/pull/97):
independent native Review, 328 runtime/package and 62 dashboard tests, protected
Node 22/24 PR/main CI and npm publication; exact installed package, 16 controlled
provider cases, actual read-only PR96 check results and six browser cases.
The lead records 104 public files matching before Mac/Z13 adoption and preservation
of private config, services/tunnels and 22+18 stored jobs. This job reconciled those
records; it did not repeat those operator runs. #37 retains its other parity work.

## First role-profile slice (#53), 0.14.0 candidate

The [portable role contract](definition.md) now drives CLI/API/Agents/Definition,
including inherited private commands, explicit Codex/Pi models, bounded Codex
effort, preview, revision-guarded idle apply and bounded atomic rollback history.
Legacy all-inherit configurations keep their exact effective policy. Overrides
use v2 protected profiles and a single common policy across agent and deterministic
phases. Source tests exercise schema refusal, legacy/private inheritance, stale/
busy/concurrent/failed application, restart/rollback, historical evidence and
actual executor launch argv/provider-specific environment through a controlled
Docker executable. They do not run a Docker daemon or inference.

Mixed-profile continuation runs the native executor with controlled Docker outputs,
retains failed attempts through restart, rejects changed policy, resumes after
explicit rollback and completes deterministic handoff. Delivery tests exercise
both capability and publication validation and a controlled provider publication.
The DOM editor test uses the real local API/parser/store for invalid/busy refusal,
visible diff, explicit apply, immediate readback and rollback. Source boundary
checks keep Factory-owned output separate from ephemeral harness final capture;
legacy commands and historical reports are never rewritten.

`npm ci --ignore-scripts`, `npm run build:dashboard` and `npm run check` passed:
**341 runtime/package tests and 63 dashboard tests**, no failures or skips.
Detailed command results are recorded in `/output/agent-report.md`. No native browser executable or browser tool is available
in this worker. DOM tests and a successful dashboard build do not qualify layout:
lead desktop/390/320px inspection in both themes remains pending, along with
independent Review and exact installed-package CLI/API/mixed-Docker qualification.
Provider/model access, quality, native discovery and cross-platform readiness
remain unqualified here. No new credentials, model downloads, schedules, external provider writes,
commits, deployment or .github changes were performed by this job. #53 remains
open for broader definitions, skills/resources/access and readiness; #69 owns model
benchmarks, #51 measurement and #70 improvement.

### Native Review model-option repair

The operator reports that reviewed checkpoint `c5f2f7e` passed 13 isolated
installed-package Docker/CLI/API checks and six real-browser cases at
1440/390/320px in light/dark themes, with visual inspection. Those controlled
runners did not prove inference quality or cover the short-model-option defect;
they are retained evidence, not acceptance of this corrected candidate.

The repair preserves that checkpoint on the original `156ae65c` source/delivery
base and keeps version 0.14.0 and all dashboard source unchanged. Before-state
adoption regressions failed for explicit and null models, and installed
`codex-cli 0.156.1` reproduced the duplicate-option rejection without inference.
The shared resolver now normalizes supported short/long model and direct config
model options, preserves argument/prompt boundaries and rejects ambiguous commands
before adoption. All-inherit private commands and legacy policy remain unchanged.

Focused adoption/evidence and CLI/API regressions cover both model selections,
attached forms, config settings, unchanged inheritance and atomic refusal. The
controlled executor checks the exact corrected Review argv and protected profile
for explicit/default selections. Twenty native parser probes reach an intentional
missing-value error after normalization, without opening an inference session.
`npm ci --ignore-scripts`, `npm run build:dashboard` and `npm run check` passed;
the final suite has **347 runtime/package and 63 dashboard tests**, no failures
or skips. Logs are retained under `/output/`; independent native Review and the operator's
affected qualification rerun remain pending. No new browser or real Docker run
is claimed by this worker, and historical evidence is not rewritten.

### Native Review effort-option repair

The operator reports that independent Review of checkpoint `432a08f` passed
24 explicit/null model-option adoption/evidence/native-parser cases and found
one remaining effort-only prompt-boundary defect. That model repair, prior
evidence, version 0.14.0 and the original `156ae65c` source/delivery base remain
intact. This continuation changes no dashboard source.

Before repair, nine new adoption/evidence regressions failed. Offline probes
with installed `codex-cli 0.156.1` reproduced the invalid effort placement after
`--`. One bounded parser now transforms only selected model/effort options,
removes conflicting direct effort settings and inserts the selection before the
prompt boundary. Effort-only changes preserve inherited model argv; all-inherit
commands remain exact. Ambiguous commands fail CLI/API validation and application
without changing the private definition or installation.

All 24 corrected native probes match their expected argv and pass parsing to an
intentional missing-directory stop, with a private empty home and no inference
credentials. The 60 focused tests also cover frozen evidence, shared policy,
CLI/API adoption/refusal and the controlled executor launch boundary. This is
parser/control-flow evidence, not inference or real Docker qualification.
`npm ci --ignore-scripts`, `npm run build:dashboard` and `npm run check` passed:
**360 runtime/package tests and 63 dashboard tests**, no failures or skips.
Before/after logs and the reproducible native probe are retained in `/output/`
and indexed by `/output/agent-report.md`. Independent native Review and the
operator's affected installed-package qualification rerun remain pending;
no acceptance, publication or fresh browser qualification is claimed.

## Role-profile release reconciliation (operator report)

The supplied #69 operator brief reports that PR #98 and release **0.14.0** are
complete at main `35aae68403d3060a935dc7cce6bfe0d5f9533d17`: independent Review,
13 installed runtime cases, 15 native parser cases and six real-browser cases
passed; 107 npm files matched before Mac/Z13 adoption. Private configuration and
23+18 execution rows were preserved; inherited profiles and prior PR #96 check
readback remain valid. This supersedes the earlier #53 candidate/review pending
gates above. This worker verified the supplied source revision locally, not those
remote installations or the operator's measurement records.

## Isolated local inference bindings (#69), 0.15.0 candidate

The opt-in [binding contract](definition.md#opt-in-local-bindings-0150-69) separates
portable role references from private installation endpoint/model declarations.
CLI, authenticated API and the existing Agents/Definition editor share validation,
diff, current-revision idle apply and atomic role/binding rollback. No inference,
service change or work admission occurs during configuration. Local/hybrid attempts
freeze selected endpoint/model/context/output/compatibility and command under one
policy, requiring protected v3 evidence for agent and deterministic phases.
Unchanged profiles preserve v1/v2 behavior, including honest 0.14.0 writer readback.

Focused source regressions cover invalid/missing/stale/busy bindings, restart,
old-record migration, rollback, public endpoint omission, model/credential isolation,
frozen-policy tamper refusal and admission before source retention. Controlled
Docker runners inspect actual executor argv and the generated single-model registry
for Implement/Review/Investigate, deterministic exclusion, readonly mounts, failure
retention, confirmed cleanup and ordinary uncertain-shutdown recovery. These are
synthetic runners, not Docker-daemon or hardware qualification.

A **native installed Pi 0.73.1** protocol test uses only a controlled loopback
chat-completions server and a temporary home. The server observes the exact selected
model, output limit, tools, packaged skill catalog and a returned tool result; Pi's
write tool produces a fixture report. A filesystem-readonly registry directory also
works. Missing-model HTTP 404, mismatched selection and absent registry fail without
fallback/report creation. The deterministic launcher handles Pi JSON mode's zero
exit after provider error. This test proves bounded adapter/tool/report compatibility,
not inference, reasoning quality, token throughput or actual context allocation.
The native test explicitly skips on machines without the exact pinned adapter; the
worker's run exercised it without a skip.

`npm run build:dashboard`, final `npm run check` and `npm pack` passed: **375
runtime/package tests and 63 dashboard tests**, no failures or skips; the 0.15.0
tarball contains 109 files. The full suite includes a real temporary npm installation
and served-asset checks. Initial empty-map CLI/API parity failures and a DOM test
refresh race were corrected; their logs and the passing final run are retained in
`/output/agent-report.md`. No native browser or Docker executable is available in
this worker; DOM interaction tests do not qualify viewport rendering and controlled
Docker runners do not prove mount enforcement. Lead owns independent installed
0.15.0 package/Docker and desktop/390/320px light/dark browser qualification, followed
by actual local hardware/model testing. No models were downloaded or queried here.
64k/128k allocation, KV cache/Flash Attention tradeoffs, model digest/quantization,
memory/offload, prefill/decode, token/cost accounting, the matched two-software-fixture
comparison and subsequent real Factory issue remain unmeasured. #69 stays open.

## #69 reviewed-checkpoint revision: endpoint persistence and reasoning requests

This continuation retains checkpoint `238445110aadea25b7ecc739531d082c51e5c77c`
(tree `4a59e7da5b9fa15f364f6f970fc3fe3f9cb19703`) staged on original delivery
base `35aae68403d3060a935dc7cce6bfe0d5f9533d17`. The operator reports ten
installed CLI/API/real-Pi Docker transport cases passed after correcting an
external synthetic-server process-lifetime bug, plus six installed browser cases
at 1440/390/320 in both themes with visual inspection. Those results belong to
the rejected checkpoint and are **superseded proof**, not qualification of this
revision. They used controlled protocol/UI fixtures, not model inference.

R1 was reproduced before repair: all three unused-binding store/CLI/API cases
changed the private record before readback failed for a Unicode endpoint path.
Selected-binding cases already rejected it. All six paths now reject before
replacement and preserve the exact bytes, readable state and rollback history.
Additional checks cover canonical URL idempotence, normalized forbidden escapes
and validation of the entire serialized record, including sequence overflow.

Local bindings now optionally request `default`, `none`, `low`, `medium` or `high`
through `reasoningEffort`. Omission/default sends no request field. Native pinned
Pi 0.73.1 against a controlled loopback server verifies actual payloads for all
choices, rotating default/none/low through independent Implement/Review/Investigate
processes and contexts. The same fixture exercises tools/results/report creation,
missing models, rejected reasoning requests and selection mismatch without fallback.
CLI/API/UI regressions cover diff/apply/readback/rollback and retained invalid drafts;
controlled container runners cover selected registry/argv, frozen reasoning evidence,
credential isolation and deterministic exclusion. These are synthetic protocol and
runner tests, not live inference or Docker enforcement proof.

The operator's first real Qwen3.8 comparison reportedly exhausted 8192 output
tokens before editing with an explicit low request. This motivates the operator
choice; it does not qualify any model or justify a hardcoded tuning recommendation.
Real fixtures, effective allocation, memory/offload, throughput, tokens and total
cost remain unqualified/unmeasured here. #69 remains open.

`npm ci --ignore-scripts`, `npm run build:dashboard`, `npm run check` and
`npm pack` passed for this revision: **385 runtime/package tests and 63 dashboard
tests**, no failures or skips, including native Pi wire assertions. The 0.15.0
tarball contains 109 files. Before/after logs and remaining qualification are
recorded in `/output/agent-report.md`. This worker has native Pi 0.73.1 but no Docker or browser
executable/tool. The lead still owns independent Review and refreshed installed
package, Docker and desktop/narrow light/dark browser qualification. No live model
calls, downloads, publication or acceptance were performed.

## Remaining limits

- Namespace/account migration and automated GitHub Releases remain separate work
  under [#61](https://github.com/arcitai/software-and-defence-factory/issues/61); see [release prerequisites](npm.md#release-flow).
- Synthetic Docker qualification requires an explicit disposable installation;
  follow [setup](setup.md), [browser verification](web-verification.md) and
  [recovery](recovery.md). Never qualify against an application installation.
- Live provider, browser, model and security capabilities need scoped evidence
  on the actual installation. Skills alone supply neither tools nor authority.
- Unknown usage/cost stays unknown. Defence supports private scoped investigation,
  not production monitoring or autonomous recovery.
