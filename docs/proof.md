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
