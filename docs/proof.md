# Qualification evidence

## Native runtime and npm installation — 24 September 2026

The 0.3 candidate was packed as an npm tarball, installed outside a source checkout on Linux x64, and exercised on the Z13. No application repository or paid model was used for runtime qualification.

Eight real Docker/control-flow paths passed:

1. Isolated implementation, candidate commit, application check, independent synthetic review, operator approval and handoff.
2. Changing the candidate after review prevents acceptance.
3. Changing the check policy after review prevents acceptance.
4. A failing application check blocks review/delivery; controlled retry reruns it.
5. Cancellation confirms container stop. The running container was non-root, read-only, network-disabled for the fixture, without added capabilities or Docker socket; Git metadata was read-only.
6. A bounded deadline stops the attempt and records failure.
7. Incident intake deduplicates its event and produces a private draft without a recovery claim.
8. Stop/restart retains interrupted state; retry establishes the previous writer stopped and starts a distinct attempt.

The source application remained unchanged. These fixtures demonstrate runtime behavior, not independent model judgment or a real application's correctness.

The restored dashboard displays the native queue, task stages, history and actual artifact content. The tested build preserves the selected upstream layout and interaction model. The interface was inspected at desktop and a narrow viewport. Creating a synthetic task, requesting revisions, obtaining fresh checks/review, previewing the actual patch and approving handoff were exercised in the browser.

## Unit and packaging coverage

20 runtime/method/package tests and 39 dashboard tests passed locally. The maintained tests cover queue transitions, stale approval, cancellation, restart, incident scope/deduplication, session/Host/Origin protection, artifact bounds, npm installation/export, external state paths, update identity checks and failed-update preservation. Dashboard tests cover board routing, analytics with missing measurements, status races, task presentation and interaction/accessibility behavior.

## Limits

Real Codex/Pi inference inside the factory, local-model network access, application-specific browser/toolchain capability, cost, token reporting, production connectors and autonomous deployment have not been qualified by these synthetic tests. A separately successful host-local model request is not proof that an isolated factory job can use it. Application installations require a real bounded pilot after scope, credentials, toolchain and checks are selected.

## 0.3.2 — application build workspace

Verification now uses an isolated disk-backed checkout so native builds can exceed
1 GiB without exhausting the temporary RAM filesystem. CPU/process limits are
configurable and validated; defaults preserve the earlier limits. The source
candidate remains read-only and scratch is removed only after container stop.

Linux Docker qualification passed all nine paths, including a real 1,100 MiB
write, read-only candidate mounts, configured CPU/process limits and scratch
cleanup after both success and failed checks. Existing candidate/policy guards,
retry, cancellation, timeout and incident/restart checks passed. The 20 package/
runtime tests and 39 dashboard tests passed. No application development agent
was launched by this fixture qualification.

## 0.3.3 — read-only cache cleanup

A real application build exposed read-only cache directories left after an
unsuccessful copy. Verification now removes owned scratch directories after
container stop without following symlinks, and preserves the check exit code
if cleanup itself still requires recovery. Linux Docker qualification passed
all 11 paths, including success and exit-17 checks that create mode-000 cache
directories with symlinks to the read-only candidate. Both leave no scratch and
preserve the candidate; the failed check remains failed with its original exit.
The 20 package/runtime tests and 39 dashboard tests also passed.

## 0.3.4 — retained image pins and comparison bases

The npm-packed candidate passed all 12 Linux Docker qualification paths. A second
installation rebuilt the shared job-image tag; the first installation's original
image ID still inspected and executed successfully, and its controller restarted
with the same pin. Retention tags preserve exact images rather than silently
changing another installation's configuration.

The native-build fixture verified that `FACTORY_BASE_REVISION` matches protected
candidate metadata and differs from the changed candidate head. This enables
application diff checks without restoring a writable remote or substituting HEAD.
The read-only candidate, scratch cleanup, failure, timeout, retry and stale-review
guards also passed. All 20 runtime/package and 39 dashboard tests passed.
This is deterministic runtime proof; application and model qualification remain
separate.

## 0.3.5 — repeatable qualification

Repeating 0.3.4 qualification on the same synthetic state exposed a collision
with the first run's fixed secondary-installation directory. Version 0.3.5 uses
a fresh private fixture for each invocation. The installed npm candidate passed
all 12 Docker paths twice against one state, retaining both histories and the
cross-install image assertions. All 20 runtime/package and 39 dashboard tests
passed; application execution code is unchanged from 0.3.4.

## 0.4.0 — managed services and remote access

The installed npm candidate was exercised on Linux with a real systemd user
manager and Docker. Service installation, native unit validation, repeated
installation, ordinary `up`/`stop` routing, removal with retained state, and
automatic recovery after a real SIGKILL passed. An existing account group could
be applied through util-linux newgrp without a root controller or restarting
the user's desktop session.

A real synthetic executor blocked an attempted update before download. Injected
registry versions then exercised the actual service stop/start and durable
maintenance path: a working candidate preserved exact job history, and a broken
entrypoint restored the prior healthy release and released maintenance. Those
versions existed only in an isolated private test installation; they are not
claims of npm publication. The daily timer was installed, enabled and removed
using the CLI.

On macOS, the installed package created a native LaunchAgent SSH tunnel. Plist
validation, repeated installation, stop/start, and reconnect after SIGKILL passed.
The remote dashboard's 18 historical synthetic records remained unchanged.
This proves process recovery and login configuration, not a whole-machine reboot
or a physical two-network test. Disk unlock and sleep remain host prerequisites.

All 25 runtime/package tests and 39 dashboard tests passed. Added regressions
cover argument escaping, existing-group launch arguments, durable maintenance,
queued-work refusal, operator-only reservation, conventional help flags and
separate ordinary CLI/managed service release selection. The installed artifact
also proved that a foreground server releases its startup lock, allowing an
independent stop process. All eleven service scenarios and twelve synthetic
Docker qualification paths passed.
No application development agent or production connector was started.

## 0.4.1 — repeatable setup and host acceptance

The setup plan now connects host access, application/CI foundations, model
connectivity, managed services, updates and explicit reboot acceptance. The npm
consumer test verifies that both setup/service guides ship and that CLI help
points to the installed setup guide. Runtime behavior is unchanged from 0.4.0.

A subsequent Linux worker reboot with operator unlock/login exercised the 0.4.0
installation: SSH, Docker, controller, update timer and the client's existing
SSH tunnel recovered without manually starting Factory. All 18 historical
synthetic jobs/attempts were preserved; product controllers stayed stopped. The
local-model bridge retried once while Docker's bridge address appeared and then
served the model API from the selected job image. This is observed recovery
after human unlock/login, not proof of unattended disk unlock or a separate
physical-network test. A cached sudo success was found insufficient as evidence
of a permanent administrator policy; setup now requires inspecting the effective
policy and an uncached/fresh-boot check when that capability is selected.

## 0.4.2 — configured project identity and first real development pilot

Issue #25 uses the status response's configured path to show a persistent
project name and a keyboard-accessible path disclosure across dashboard routes.
The task form uses the readable name while preserving the internal `app` key.
Initial loading/failure, missing identity and stale retained status are explicit.
The synthetic-installation disclosure remains present. Optional DESIGN.md
branding is still future scope (#27), not an implemented theme loader.

The final UI build passed 25 runtime/package tests and 43 dashboard tests.
Vite/JSDOM coverage checks loading, errors/recovery, missing identity, routes,
label and submission behavior; those responses are fixtures. Separate Chromium
inspection used the built assets against the released controller in isolated
synthetic state. Desktop 1440×1000 and narrow 390×844 passed in both themes,
including long-path layout, keyboard disclosure and Tasks/detail/Workers/Workflows
identity. A real browser submission sent `repository: "app"`, created/opened a
task and completed the synthetic checks/review/handoff. Injected status failures
showed stale retained identity and initial unavailability, then recovered.
No application job or production integration was used for this UI acceptance.

The first worker candidate hid its desktop path inside closed `details`; the
lead browser check caught this despite passing DOM tests. The final disclosure
is available at every width. Inspected UI asset SHA-256 values:

- JavaScript: `d2801623d75004d4d241068f0701ca7bd45a8bc83f2f162f59d805860f51d2d2`
- CSS: `42b269f62ca91b7cde1a31652d476df5bd322b2f56a3ca6ac6e7bbd3b9cc3e4f`

The real development pilot held source `6dd9c43816090092281ca23cb2e5cf4bba30a18f`.
Two Pi/Qwen 35B A3B attempts failed without the required report; neither was
accepted. A fresh Codex GPT-6 Luna/max attempt produced candidate
`c0c019cba6155c5b5901d96c2c33264abd639356`, passed configured checks, and received
an independent `blocked` review for outstanding external browser proof.
This is observed fail-closed behavior, not a completed Factory acceptance.
The source patch was carried onto main's documentation update, corrected by the
lead and given final browser acceptance and a fresh independent delivery review.
No failed report was rewritten and no controller acceptance record was fabricated.

The pilot exposed missing terminal diagnostics (#33), incorrect historical
executor/model display (#34) and the missing failed-review-to-revision action
(#35). The contributor recipe documents the current manual boundary. Required
Node 22/24 PR checks now protect main. This exercise does not qualify the local
model, long-term headless auth refresh, broader security profile (#6), live
Defence (#7) or fully unattended delivery. Private logs and host paths remain
outside the public package.

## 0.4.3 — revision recovery, bounded logs and attempt provenance

The final package passed 35 runtime/package and 44 dashboard tests. All twelve
existing Docker qualification paths also passed, including cancellation, timeout,
immutable candidate/policy guards, recovery and retained image installation.

An isolated synthetic Docker installation exercised both `changes` and `blocked`
review outcomes through CLI revision, fresh build/check/review and a new approval.
It retained the original failed review, unchanged report and previous candidate;
stale approval and duplicate feedback were rejected. A separate browser journey
exercised the same feedback and approval controls at desktop 1440×1000 and narrow
390×844 in both themes. Previous failed reviews and execution facts remained in
History. An initial browser assertion expected the wrong completion heading;
readback confirmed the actual **Task complete** state and retained evidence.

A deterministic Docker process emitted more than 3 MiB and then a terminal error
on stderr, exiting 17 without an agent report. The retained log was below 1 MiB,
contained startup and terminal diagnostics plus exit/truncation metadata, and the
attempt failed without acceptance. Retrying with a different profile and
restarting the real controller preserved both attempts' original profiles and
exported measurements. UTF-8 boundaries, stream interleaving, legacy unknowns,
private-field exclusion and stale/rejected actions also have regressions.

Only after that deterministic proof, a bounded real Codex GPT-6 Luna/max profile
changed one line in an isolated fixture. Its build, configured check and separate
review passed. Each agent phase had a 300-second limit. Logs recorded terminal
exits and the exact requested model/image/configuration profile; inference
credentials were not exported. The review incorrectly compared the configuration
policy hash to the mounted Markdown file hash; operator inspection reconciled
the effective-configuration digest before approval. This is a tiny real-model
control-flow qualification, not proof of local-model adequacy, application
quality, persistent credential refresh or the broader security profile (#6).

To repeat the additional synthetic probes, use a dedicated mock installation
with a committed `value.txt` containing `broken` and a check requiring `fixed`,
as in the platform probe. Finish active fixture jobs first; the probes modify
only that fixture's private configuration and restore it afterwards:

```sh
node scripts/probe-review.mjs /private/state/synthetic-fixture
node scripts/probe-diagnostics.mjs /private/state/synthetic-fixture
```

Both probes require a running controller, installed Node-capable Docker image
and the `mock` profile; they make no model calls. Never use an application state
for qualification. When exercising a source candidate, set `SDF_BOOTSTRAPPED=1`
so its child CLI commands use that same candidate rather than a managed release.
See [recovery](recovery.md) for diagnostic limits, safe revision and legacy facts.

## Issue #30 — supported custom job-image selection — 25 September 2026

The CLI now accepts `install --image LOCAL_IMAGE_REF`. Its deterministic
regressions use temporary state and a fake Docker executable: they cover exact
ID pinning/retention, repeat selection, shared-tag movement, custom-to-custom
selection, invalid selection preservation, failed metadata-write rollback,
active/unreconciled execution refusal, sibling installation preservation,
ordinary standard-image installation, and `doctor` image/metadata checks.
`npm run build:dashboard` and `npm run check` passed; the final check included
44 runtime/package tests and 44 dashboard tests. These fake-Docker tests do not
prove a real daemon, image or container lifecycle.

The implementation container had no Docker socket and did not attempt one.
Disposable real-image checks remain assigned to the operator before acceptance:
exercise selecting twice, move a tag shared by two states and confirm each
selected ID remains pinned, change between two custom images, reject a missing
image without changing the working state, reject selection with active or
unreconciled work, then verify `doctor` and `up` against the selected image.
No model or toolchain qualification is claimed by image installation or by
these source tests.

### Operator proof and real self-development delivery

The real Factory development job `job_622021808e2f7e09d4a9b0b2` used the released
0.4.3 runtime and Codex `gpt-6-luna` with `max` reasoning. Its source was held at
`0ea5a204f6454e0e6264060529a1f788c1874a5f`; the recorded base matched. Factory
produced candidate `567c3665cdb42f353877f8a7f4f83196a2f2d576`, ran the configured
full checks, obtained a separate passing review, and completed explicitly
approved handoff for that same candidate/policy. This was a real repository
change, not the arithmetic demo. The local-model profile remains unqualified.

The operator separately exercised 11 real-Docker cases on that candidate:
custom selection/doctor, repeat selection, shared-tag movement across two
installations, missing-image preservation, live-controller refusal, unresolved
attempt refusal, retained-container refusal, mismatched metadata/failed startup,
custom-to-custom selection, ordinary standard installation, and preservation of
the real profile and application source. All passed. Those fixtures made no
model calls. Failed metadata-write rollback is covered by deterministic fault
injection; power-loss recovery is not claimed.

The 0.4.4 delivery adds the generic repository-readiness guide, staged issue form,
capability inventory and accepted future dashboard design to the Factory-owned
implementation. The integrated package passed 46 runtime/package tests and
44 dashboard tests. Final review also found and closed a managed-startup/image
selection race: a shared installation fence now covers selection through metadata
commit and startup through its supervisor PID claim. Deterministic regressions
cover both orderings, including managed launch during a pending image build. The existing UI source is unchanged. Publication and
published/installed-artifact readback remain pending at this source revision;
the delivery PR for #30/#40 will record that external evidence. This proves supervised self-development,
not autonomous issue intake, source snapshots (#28), PR publication (#29), full
interface parity (#37), security qualification or the future dashboard redesign.


## Warp-style dashboard — 0.4.5

The #1 frontend began as a real Factory build from source
`ebefe163506558236acfe26d31eb124fe7ff2f8e`, job
`job_2de982c6e7c8d98096de88d1`. It reached the configured 1,800-second phase
budget before runtime candidate/check/review/handoff completion. Its original
failed attempt and private source are preserved; it is not recorded as an
accepted Factory job. The operator recovered the source into an isolated branch,
finished bounded presentation corrections and validated the full recovered diff.
Supported checkpoint continuation is tracked in #42; live activity is #32.

The release uses a list-first project overview, a compact status rail, searchable
real task data, Geist and monochrome defaults. The operator corrected mobile
heading layout, legacy CLI issue-title presentation, recent-activity ordering,
and claims about generic task completion/initial approval. Unknown mobile counts
remain unknown while status is unavailable. Independent review also corrected
retry guidance/actions to match controller policy and removed the empty unknown-state
board lane; regressions cover blocked/timed-out actions and explicit cancelled retry.
No backend, credentials, workflow
policy or Docker execution path changes in this release.

The complete build/check passes 46 runtime/package and 48 dashboard tests.
Browser inspection covers desktop and 320/390px CSS widths, light/dark themes,
search combined with status filters, reset/empty results, list/board navigation,
keyboard focus, the task composer, project identity, result/history/files and
failed-review feedback controls. Real project data is read through a loopback
candidate preview. Long-name and offline/error states use explicitly synthetic
preview responses. No product job is submitted by these browser checks; action
request/current-run semantics remain covered by the existing component/API tests.

Independent final source review and public npm/installed asset readback are
external delivery gates; their exact revision and results belong to the delivery
PR. Optional reviewed project colors (#27), complete interface parity (#37),
GitHub sign-in and Coolify hosting (#39) are not delivered by this visual slice.


## Task navigation, Defence visibility and usage — 0.4.6

Issues #45 and #44 refine the project work view and retain structured token
usage. The plain wordmark replaces the geometric mark; real workflow/model/
state filters combine with search. Task details preserve context with close,
copy-link feedback and filtered previous/next navigation. Repository links use
only a validated origin. Software and Defence share Tasks and can be separated
in Analytics; Defence investigation does not grant production recovery authority.

The integrated candidate passes 60 runtime/package and 50 dashboard tests.
Browser inspection at normal zoom covers desktop and 320/390px, both themes,
combined filters/reset/no-results, list/board, close/copy, task metadata,
Software/Defence selection, Analytics, Workers, Workflows and Triggers. A
loopback read-only preview uses real queue data. Explicit synthetic offline
responses exercise initial errors, stale data and recovery. No product job is
submitted by these UI checks. Component/API tests retain revision, retry and
approval checks.

Token implementation was produced by real Factory job
`job_24d2916a51fdff5ecd152d27`, from held source
`3604275d25eba96976d6cfbc43055ed20e40da35`, candidate
`5d8ad7310a7c72ee362d1653fac1602f1242dbe1`. Its native build and configured
verification succeeded. Its separate review requested changes for a thrashing
legacy-read cache and missing UI partial-coverage labels. Both are resolved in
the integrated operator candidate, including bounded legacy read budgets and
regressions. The original failed review stays failed and unaccepted; delivery
uses independent review of the integrated candidate, recorded in the PR.

A separate disposable Docker installation exercised stdout-only capture despite
forged stderr events, an oversized line with partial observations, an absent
completion event, persistence and controller restart. These three cases used
synthetic events and no provider calls. A separate live Codex build-only telemetry
probe, with `gpt-6-luna` and `max` effort, captured 61,670 input and 854 output
tokens, including 51,200 cached input tokens: 62,524 total, without double counting
the cache. It changed no application source and is not a software delivery or
model-quality qualification. The probe ran the integrated runtime at
`55982257d6798a513987265e179138b153f6e796`; the subsequent historical-read budget change does not alter new stdout
capture. That change has a separate cache/budget regression.

Historical readback of existing real attempts remained unknown where the strict
private-log/profile/stream evidence was insufficient. No old history was rewritten.
The runtime exposes the same usage through CLI and API. Partial observations,
missing AI runs and deterministic phases remain distinct; no billing amounts are
estimated. Public npm, installed assets and idle-only activation are final delivery
gates recorded in the PR, not claims made by these source checks.

Independent integrated review also closed incomplete-turn coverage and hidden
compact-header context: a later unfinished/failed Codex turn makes counts
partial, and task detail retains the project path and explicit status freshness.
Regression tests cover these paths; the compact header is rechecked visually.

## Workflow workbench and task intake — 0.4.7 (#47)

Automated checks cover one workflow/skill catalog shared by CLI, controller and queue; non-Codex configuration, generic host metadata, authenticated and origin-bounded issue reads, modal import/preview/submission, filter intersection/navigation and unchanged telemetry/recovery contracts. UI interaction tests use jsdom and do not establish rendered layout, native dialog focus containment or scrollbar behavior.

Independent scoped code review passed at `1fda11a680704295db73b1170fcdc9544cd0cece` with no actionable findings. The full check passed 63 runtime/package and 51 dashboard tests; protected Node 22/24 CI also passed. The candidate issue reader fetched public issue #47 on the actual worker host through GitHub CLI, and OS discovery returned that host’s real model, architecture and resources. This read-only probe submitted no job.

Rendered acceptance was completed on the same source through native Zen browser control after the initial connector failure. Inspection covers 1440px desktop and 320/390px narrow viewports, both themes, stable filtered counts, select-all/reset and combined model/status/search, the horizontal board and keyboard scrolling, project tooltip, Software/Defence execution, all six skills and expanded instructions, configuration and detected worker capacity. The native modal hides the underlying document from interaction, focuses its close control on opening and restores the start button on Escape. The configured browser can still move keyboard focus to its own chrome; this is not a document focus escape.

The loopback preview served the candidate's compiled assets and read the existing real project queue. Importing public issue #47 exercised the actual issue reader. A preview-only rejected start exercised the visible submission error without creating a job. Explicit synthetic HTTP 503 responses exercised stale status, initial failure and recovery. No application work was started. Preview status used the prior controller's repository links; the new issue-chooser URL is covered by the API regression and must be read back from the released controller.

Code review and rendered acceptance now pass. Protected CI, public npm artifact matching and idle managed activation remain delivery checks recorded in PR #48; these UI checks do not claim live execution qualification or complete CLI/dashboard parity.

## 0.5.0 — shared definition and project foundations

The candidate passes 64 runtime/package tests and 44 dashboard tests. New checks
cover canonical harness settings with unchanged legacy config/policy identity,
CLI/API catalog parity, packaged operator guidance, shared status groups and
whole-row filters whose Reset and window focus changes keep the menu usable.
The former trigger renderer and obsolete source-text assertions were removed.

The built candidate was inspected in Safari at 1440px, 390px and 320px, with
light/dark coverage: roles and deterministic gates, actual skills, definition,
host/worker separation, horizontal Kanban scrolling, default brief modal and
textarea focus. Filter row selection and non-closing Reset were exercised in
the browser. A read-only preview used the existing installation's status; it did
not submit application work. The editable architecture scene was visually
checked after correcting text alignment, then exported with its SVG companion.

Project guidance now separates task correctness from standards, uses a maintained
feature map and dependency-aware specifications, and routes recurring failures
to checks or concise guidance. Those instruction changes are not a measured
claim of better autonomous outcomes. The research disposition is in issue #22.
An isolated npm installation on Linux x64 passed all 12 Docker qualification
paths, including candidate/policy guards, scratch isolation/cleanup, cancellation,
deadline, incident deduplication and restart recovery. The initial fixture used
the canonical harness setting; existing installations retained legacy agent
settings. No inference or application work was used for this qualification.
Independent review, protected CI and installed-package adoption are recorded
in the release PR.

## 0.5.1 — repository forms and local issues (#56 / PR #57)

Initial candidate `f6cc24744bc1c5bcad63d36489fc27de5d749525` passed 70
runtime/package and 47 dashboard tests. Independent review found an overridden
work-type choice on suggestion refresh, missing code fences for render fields,
missing native group-required checkbox feedback and editable title/spec drift.
The follow-up preserves explicit choices, safely fences code, validates groups
in the form and locks the reviewed title; corrections add regressions. The final
checks pass 71 runtime/package and 48 dashboard tests. Review results and exact
final revisions are recorded in PR #57.

Safari inspection exercised the actual built candidate at desktop, 390px and
320px, with light/dark coverage: repository template chooser, required-field
feedback, real Bug report answers and draft compilation, explicit review,
Software/Defence override, repository issue labels/search, security-labelled
issue preview, bounded scrolling, and Definition in desktop/mobile settings.
The controlled preview rejected creation visibly without submitting a job. An
explicit simulated GitHub error exercised Retry and recovery. The temporary
Safari developer-menu setting was restored. These are rendering/interaction
checks, not an actual application execution or GitHub-write qualification.

Live read-only GitHub probes returned this repository's three templates and
open issues, preserved its private security contact link and compiled a selected
form at its actual blob SHA. Unit/integration checks separately cover pagination,
pull-request exclusion, stale template SHA, Markdown/YAML semantics, unsupported
fields, origin/session boundaries, late responses and shared CLI/controller
records. Template code is data; raw HTML is not rendered. YAML uses the pinned
parser with alias and input limits. Uploaded attachments, persistent unstarted
drafts, GitHub creation/identity setup and automatic intake remain unsupported.
CLI `issue create` requires an explicit work type; legacy `run` remains compatible.

No executor/isolation code changed. The 0.5.0 Docker qualification remains the
existing execution proof; this slice does not claim new live-model qualification.
Release CI, npm byte comparison and idle managed installation readback remain
delivery checks recorded in the PR.

## 0.6.0 — repository issue providers (#58)

The shared publication API is tested independently of GitHub with a second,
synthetic provider. Coverage includes context drift, validation, maintenance
locking, rejected writes, ambiguous responses, durable restart recovery,
no-match recovery without another POST, session/Origin protection and CLI/API
receipt identity. Unsupported remote hosts expose only a sanitized host and
retain local execution. The final suite passes 76 runtime/package and 51 UI tests.

A real browser created issue #58 on this repository with the existing controller
GitHub identity and template label. GitHub readback and a same-key CLI replay
returned the same issue; the isolated preview queue stayed empty. Browser
inspection caught a provider-to-reader argument mismatch when selecting that
issue. The correction adds adapter coverage and the real CLI/browser preview
then succeeded. The preview blocked execution deliberately; no application jobs
were started.

Safari inspection covers desktop (including 1440px), 320px and 390px, with light
and dark coverage: destination/account, templates, published result and separate
Start, issue selection, scrolling, simulated provider failure and explicit start
failure. The architecture canvas was inspected and exported with editable source.
Independent review found a lost browser response could lose its request key on
composer reopen. The follow-up uses a stable content/identity key, recovers saved
created receipts and adds two browser regressions. Final code revision `ed7c5e3778a9872b1aea9c0a27cd19279caf82f8` passed
independent follow-up review with no findings. Later commits only record proof
and todo status. Release/adoption revisions are recorded in PR #59.

This release does not qualify another live issue provider, external schedule
discovery, hosted authentication or live model execution. Executor/isolation code
is unchanged; the existing 0.5.0 Docker qualification remains the execution proof.
SQLite receipts are not a mirrored backlog or persistent unsent drafts.

## 0.7.0 — immutable source admission (#28)

Admission resolves the configured or explicit ref from the configured local Git
repository, verifies a private per-job bare object store, and records the
repository identity, requested ref and resolved SHA in protected job metadata
before acknowledging the job. Build and retry restore that SHA. Revision actions
preserve it unless the operator supplies a deliberate new ref; the previous
source record and evidence remain in history. Legacy jobs stay labeled
**Not recorded (legacy/unknown)** and cannot retry or request implementation
changes without a replacement admission.

`node --test tests/source-admission.test.mjs` passed seven focused local-Git/queue
regressions, including admission at A before the execution pump, B movement,
source-ref deletion and garbage collection, SQLite restart/build retry, missing
objects, repository isolation, revision with a new base, same-revision repair of
a missing retained copy, and unchanged operator checkout. The R1 hostile-Git
regression runs the production admission, checkout and candidate Git helpers
with repository, worktree, index, object and config overrides aimed at a second
disposable checkout. It verifies the second checkout's tracked/untracked files,
HEAD, index and status remain unchanged through candidate staging, commit, diff
and cleanup. A second hostile-Git regression runs the exact retained-source
qualification fixture setup with real Git: it admits A, moves and prunes A from
that source repository, restores A from the retained store, and verifies a
separate operator checkout's branch, HEAD, index, tracked/untracked files, refs
and object IDs remain unchanged. `node --test tests/git-environment.test.mjs`
passed both regressions. `npm ci --ignore-scripts`, `npm run build:dashboard`
and `npm run check` passed after this repair; the full check reported 85
runtime/package tests and 51 dashboard tests. The npm artifact test also checks
that the factored qualification fixture ships with the CLI package.

The host Git boundary follow-up starts at repair base
`f5513763b42de65c3c82241d983c74fc76f29647`. CLI `init`, the demo fixture's
init/add/commit, project link/provider origin lookup, and the review probe's
local checkout assertion now use the shared bounded Git environment. Two new
real-Git regressions run init and provider/demo operations with repository,
worktree, index, object and config overrides aimed at a second disposable
checkout. They verify explicit-root selection, invalid-root rejection, and
unchanged tracked/untracked files, HEAD/branch, index, refs and object IDs.
`npm ci --ignore-scripts`, `npm run build:dashboard`, and `npm run check` passed
on this working tree: 87 runtime/package tests and 51 dashboard tests passed.
These are worker checks, not the separate full-range review or host qualification.

The real Docker qualification recipe is included in
`scripts/probe-platform.mjs`, reached through `software-defence-factory qualify
--state PATH`. It adds an isolated synthetic source repository, intentionally
fails the first build, moves and removes the original ref, prunes its original
objects, restarts the controller, then retries from the retained commit. It
checks the candidate base, status/evidence SHA, approval handoff and untouched
operator checkout. Existing candidate-change, policy-change, approval, retry,
cancellation and isolation paths remain in that probe.

The packed and separately installed candidate
`873ab5d31f33f38d79b86a24d1c6e616ca96dc42` passed all 13 real Docker qualification
paths on Linux x64. Qualification ran with inherited Git overrides aimed only at
a separate disposable sentinel checkout; its files, HEAD, index, refs and objects
remained unchanged. The retained-source scenario passed after source-ref
deletion, garbage collection, controller restart and build retry. Candidate and
policy guards, disk scratch, read-only cache cleanup, cancellation, timeout,
incident deduplication and the second installation also passed.

Independent Factory verification passed all 138 tests against that exact head.
Independent review passed with no actionable findings and reproduced 11 focused
Git/source regressions. The operator then approved the real development job;
native handoff completed and recorded the same accepted head. Previous failed
attempts remain intact. This is candidate acceptance, not automatic publication.

Safari inspection exercised invalid and valid source admission, preserved forms
and revision feedback, resolved source identity, a fresh revision and approval
through handoff. Genuine accepted and failed 0.6.0 histories opened unchanged in
0.7.0, with legacy provenance marked unknown and unsafe retry/revision disabled.
Desktop, 390px and 320px were inspected with light and dark coverage. All eight
UI files in the final package match the inspected build. Two follow-ups remain
under #37: a narrow revision error can be above the current viewport, and a
320px legacy detail can overflow horizontally. No application job was started
by these browser fixtures.

To repeat qualification, use a dedicated synthetic Docker installation only;
never use an application state:

```sh
SDF_BOOTSTRAPPED=1 node bin/software-defence-factory.mjs demo --state /private/state/sdf-0.7.0-proof
# Complete and approve the initial synthetic sample task in the dashboard.
SDF_BOOTSTRAPPED=1 node bin/software-defence-factory.mjs qualify --state /private/state/sdf-0.7.0-proof
```

For the hosted qualification, repeat the `qualify` command with inherited Git
repository, worktree, index, object-directory and configuration overrides aimed
at a separate disposable checkout. Record that checkout's branch, HEAD, index,
tracked/untracked files, refs and object IDs before and after; all must match.
The fixture must also show that source A is absent from its intended source repo
after pruning while the admitted job still builds from A.

Retain `qualification.json` and the nested `source-admission-*` fixture evidence.
Repeat browser inspection when UI assets change. The implementation and review
containers do not have Docker or browser access; the operator proof above was
performed outside those containers against the packed candidate.

## 0.8.0 — trusted PR handoff (#29)

The implementation candidate starts at the admitted `main` source revision
`b2643a8b67b748e9f0bf99a66e7cdd091bda3a71`. Package and root lockfile versions
are `0.8.0`. `npm run build:dashboard` completed successfully against the
dashboard lockfile. `npm run check` exited successfully, including all runtime,
package and 51 dashboard tests. The focused delivery and model-environment
regressions passed 10/10.

The bounded delivery tests use disposable real local Git repositories and an
injected fake GitHub provider. They cover default patch-only mode, trusted
destination selection separate from source ref, stale policy/check/review/
approval/patch rejection, changed source origin and target base, collision
preservation, concurrent requests, repeated publication, lost branch/PR
responses across controller restart, exact PR head/tree readback, and pending,
unknown or unrelated PR checks. They also exercise the authenticated API and
CLI against the same receipt. They do not establish live GitHub API behavior,
provider permissions, credential validity or successful external publication.

The dashboard regression is rendered with JSDOM. No browser tool or browser
executable is available in this implementation environment, so desktop and
narrow-width visual inspection of the final built assets was not performed.
The release lead owns that browser inspection and the authorized disposable
GitHub fixture: use the existing Factory repository, normal admission/check/
review/approval, a uniquely named draft proof PR, repeated publication and
restart recovery, exact readback, and close without merge. No GitHub write or
live fixture was attempted by this implementation worker. These checks are
required before lead acceptance; delivery itself still does not merge,
integrate or deploy.

## #29 recovery repairs on the admitted 0.8.0 checkpoint — 26 September 2026

This repair starts from admitted candidate
`0f0012a13ff67a021fc51191042e77cdc9cd7631`; the repository main baseline for
the combined review is `b2643a8b67b748e9f0bf99a66e7cdd091bda3a71`. Package and
lockfile versions remain `0.8.0`.

The controller now refuses to remove a stopped job while a saved delivery is
not confirmed `published`. Status exposes the same removal decision and reason
to the dashboard. The detail view disables Delete issue and explains how to
reconcile or inspect the delivery. Saved `intent`, `publishing`, `uncertain`
and retryable `blocked` checkpoints retain a guarded publish/reconcile action;
legacy acceptance without candidate-bound phase evidence is labelled
`legacy_unverified` and cannot be published.

The shared CLI API keeps its five-second default and bounds trusted publication
requests at ten minutes. A delayed local provider test holds one GitHub-shaped
request for 5.2 seconds and verifies that CLI publication receives the final
receipt. A controller API regression starts from a durable `intent`, rejects
delete, simulates a lost branch/PR response, rejects delete again, then
reconciles the same single branch and PR. These are local fake-provider and
HTTP-controller checks, not live GitHub qualification.

The provider retains each raw check-run conclusion. `success`, `skipped` and
`neutral` are non-blocking in the aggregate; only `success` is an executed
passing check. Known failure, action-required, timed-out and cancelled outcomes
remain failures. Unknown conclusions, absent/incomplete pagination and
unassociated PR checks remain unknown. The dashboard displays raw conclusions
beside readable labels. The aggregate does not infer branch-protection
completeness or merge authority.

`npm run build:dashboard` passed. `npm run check` passed syntax/JSON checks,
100 runtime/package tests and 52 dashboard tests. Focused regressions exercised
legacy acceptance, intent and lost-response removal guards, the >5-second CLI
request, conclusion aggregation, action-associated accessible failure
feedback, and wrapping of the delivery button. The dashboard tests use JSDOM
and source style assertions; this worker had no browser executable/tool and
performed no rendered Safari inspection at 320/390px.

No GitHub credential, live repository write or external fixture was used here.
The implementer inspected the combined source diff from the original main
baseline through this working tree; this is not a separate reviewer result. A
protected exact-head/policy attestation was not supplied in this worker
context. The lead owns the independent exact-final-diff review, protected
verification, installed CLI/dashboard publication repeat/restart/readback, and
desktop/narrow light/dark browser inspection before acceptance.

## CRED-1 and policy-retry repairs on admitted checkpoint faca645 — 26 September 2026

This uncommitted repair preserves package version `0.8.0` and starts from
admitted checkpoint `faca6458ada153454ae9b690287ef78abea14f16`. The combined
review baseline remains original main `b2643a8b67b748e9f0bf99a66e7cdd091bda3a71`.

`model.env` now accepts a typed set of provider inference settings and rejects
unrelated variables, including deployment, forge, Git, Actions and cloud
identity credentials. Before container start, the executor writes a mode-0600
temporary env file containing only the trusted Codex or Pi provider selection;
it never mounts the original model.env. Codex is fixed to OpenAI settings. Pi
uses its private `inferenceProvider`, an operator-configured `provider/model`,
or a sole provider group in the private model.env. Multiple provider groups
require explicit operator selection. A task-level model override is applied
after that selection and cannot choose a credential group. `OPENAI_BASE_URL`
remains available for the Codex OpenAI-compatible endpoint path used with local
models.

Regression coverage rejects a synthetic `DEPLOY_TOKEN` without including its
value in the error, checks that selected Pi/OpenAI settings alone are written
to the worker env file, rejects ambiguous multi-provider selection, and checks
failed-check, stale-build-policy and fresh-build evidence at the handoff guard.
The Docker qualification recipe now retains a failed-check job, verifies an
unchanged-policy retry fails the same check, verifies changing the policy
cannot hand off the earlier build, then admits a fresh build under the current
policy and completes its handoff.

`npm ci --ignore-scripts` and the dashboard lockfile install succeeded. The
focused credential/evidence/configuration regressions passed. The dashboard
suite passed 52/52. `npm run check` validated JavaScript/JSON and ran the full
runtime/package suite, with 101 tests passing and two artifact-dependent tests
failing because this checkout has no ignored `factory/ui/index.html`; the
locked dashboard was not rebuilt because its sources did not change. The
failures were the controller asset-route and npm-tarball asset-presence checks.
No Docker qualification or live provider/browser qualification ran here.

The requested preserved `review.json` was not available under `/workspace`,
`/output` or `/tmp`, so its findings could not be reread in this worker context.
This source diff inspection and test run are not an independent exact-head
review or protected-policy verification. The lead owns those, plus the new
isolated Docker qualification and any live-provider/browser proof before
acceptance.

## Codex account-auth compatibility on admitted checkpoint 64f4173 — 26 September 2026

This uncommitted compatibility repair starts from admitted checkpoint
`64f41737fa3735988a77926379a8ecae8263ea23`, preserves package version `0.8.0`,
and retains original main `b2643a8b67b748e9f0bf99a66e7cdd091bda3a71` as the
combined review baseline.

The typed private `model.env` accepts `FACTORY_CODEX_AUTH_JSON` only when it is a
single-line JSON object. The shared worker environment selector passes it only
to the trusted Codex executor during build, review or defence. It remains
excluded from Pi, including Pi with the OpenAI provider, deterministic checks
and unrelated executors. Codex API-key and OpenAI-compatible endpoint settings
remain available; the original `model.env` is not mounted into worker output.
The selected temporary env file remains private and is removed only after a
Docker listing confirms container absence. The R1 repair below also preserves
it and the active fence when removal or the absence probe is uncertain.

Inert-sentinel regressions cover account-auth validation and roundtrip, an
auth-only Codex profile, Pi/OpenAI provider isolation, verification and custom
executor exclusion, unrelated deployment-key rejection without value echo,
and existing API-key/local-endpoint selection. A full combined-diff review
also found that delivery's policy hash omitted the trusted inferred provider
for ordinary Codex and provider/model-configured Pi jobs. Execution and
delivery now use the same effective installation configuration, with Codex/Pi
handoff regressions. Published readback is read-only after a confirmed
receipt: a failed refresh preserves published state and does not recreate a
missing commit, branch or PR. The delivery panel exposes the saved branch and
admitted source ref at unresolved checkpoints; its regression asserts these
fields remain rendered.

After these repairs, `npm ci --ignore-scripts`,
`npm run build:dashboard` and `npm run check` passed. The complete check
reported 106 passing root tests and 52 passing dashboard tests. The focused
`node --test tests/model-environment.test.mjs tests/execution-profile.test.mjs tests/delivery.test.mjs`
reported 20/20 passing tests. The locked dashboard build completed after its
delivery panel source change.

The task context reports that the installed `64f417` package passed its 15
Docker qualification paths. This worker did not rerun that installed
qualification, inspect the actual private Codex profile, pack/install this
modified worktree, call a real inference provider, or perform browser
inspection. The preserved native `review.json` was not present in the worker's
filesystem search; the supplied CRED-1 compatibility finding was addressed,
but that missing artifact remains a review-input limitation. Independent
review of the full original-main to final-worktree diff is in progress. The
lead still owns private installed-profile/qualification checks and the final
browser inspection before acceptance.

## Final #29 PR lifecycle readback repair — 26 September 2026

This is the final uncommitted Build worktree based on preserved checkpoint
`f9780b28e5ba214336e853e2a3dd91b7711566c5`, retaining package version `0.8.0`
and the complete delivery implementation accumulated from original baseline
`b2643a8b67b748e9f0bf99a66e7cdd091bda3a71`. The checkpoint test counts above
describe earlier trees; they are not evidence for this final worktree.

Confirmed PR readback now records ready, closed and merged lifecycle state while
checking the exact saved PR identity, repository, target and branch names, head,
and accepted delivery commit tree and parent. Closed PR refresh permits a
deleted source branch and an older PR base. The original accepted base remains
separate and unchanged. Changed remote identity or candidate data remains a
visible conflict. A provider outage retains the known publication receipt.
This path makes read requests only. First publication still requires current
accepted evidence, the current target base and an open draft PR. The task view
shows the actual PR state, merged status, immutable accepted base and current PR
base separately.

`npm ci --ignore-scripts` completed successfully. `npm run build:dashboard`
completed with the locked dashboard dependencies. The final-tree
`npm run check` completed successfully: 113 root/runtime/package tests and 52
dashboard tests passed. The focused `node --test tests/delivery.test.mjs`
completed 19/19 tests. The regressions use disposable local Git repositories
and a fake provider; they include ready, closed, merged, deleted-branch-after-
close, target movement, changed head/tree/parent/repository/target, immutable
acceptance and provider-outage cases. They perform no live provider writes.

The R1 recovery regressions use a controlled Docker client at the executor
boundary. Existing selected inert Codex auth cases cover present/unknown
containers, client and spawn failures, successful removal, and ordinary
reconciliation of the private file and fence. The verify-specific regression
records scratch existence and running state at the first Docker remove attempt:
the pre-fix test failed because scratch was already absent while the container
was still running. After the repair, present and unknown probes retain scratch
and the fence until reconciliation confirms shutdown; confirmed absence after
success/client failure, outer `stopContainers` cleanup, and recovery after a
spawn error remove scratch. These controlled-client checks do not constitute
live Docker qualification. On this worktree, `npm ci --ignore-scripts`,
`npm run build:dashboard` and `npm run check` passed; the full check reported
129 root test cases and 52 dashboard tests.

The task context reports that the previously installed candidate passed 15
Docker paths, actual account-profile compatibility, cancellation, and disposable
PR #68 lifecycle checks including repeat, restart, provider outage, ready and
closed states. Those results belong to the previous candidate and do not prove
this executor repair. No real provider credentials, Docker daemon qualification
of the changed executor, or browser inspection was performed by this Build.
Browser qualification remains external pending. Factory Verify and independent
Review must consume the exact final worktree after Build returns.

## #29 branch-only collision resolution — 26 September 2026

This follow-up repairs unaccepted checkpoint `b3632bb039e32e95fd63a2905918d9436266a95f` while retaining `0.8.0` and the full review baseline `b2643a8b67b748e9f0bf99a66e7cdd091bda3a71`. Before the change, the new controlled collision regression failed because status had no explicit resolution action. It now covers a pre-write foreign branch, exact readback, local removal, restart persistence, rejected stale/changed identities, PRs on any base target, later-stage collisions and uncertain effects. Provider write counters stay unchanged. Authenticated API, CLI and visible dashboard action/result/error behavior use the same controller state.

The focused delivery suite passed 22/22 and dashboard suite passed 52/52. These use disposable local repositories and a fake provider; they do not qualify live GitHub behavior. The previous installed candidate's Docker/account/PR qualification remains prior-candidate evidence. No browser inspection was performed because the Mac browser is locked; lead-owned installed, provider and browser qualification, plus Native Factory Verify and independent Review, remain pending.

## #29 synthetic-evidence publication guard — 26 September 2026

The before-fix regression showed the mock acceptance could publish: the fake
provider recorded one blob, tree, commit, branch and PR write. The shared
delivery service now binds protected per-run execution profiles to the exact
build, verify, review and handoff runs and requires candidate/check/review
artifacts to explicitly state `synthetic: false`. Missing or inconsistent
evidence blocks new writes in status, CLI, API and dashboard. Saved write-stage
intents are revalidated; known PR receipts and PR-create checkpoints keep their
read-only reconciliation path. Executor tests confirm the mock review artifact
is marked synthetic.

The passing contract fixtures model native Codex/Pi provenance but make no
model calls; the provider remains fake. This repair did not refresh prior
installed/provider qualification. Browser inspection remains external and
pending, and the lead owns fresh candidate qualification after Native Verify
and independent Review.

For this worktree, `npm ci --ignore-scripts`, `npm run build:dashboard` and
`npm run check` passed. The complete check reported 137 root/runtime/package
test cases and 52 dashboard tests.

A follow-up on checkpoint `6d2f3ba120153bb900b23605bfbd360e49185eab` fixes the
shared publication capability after a branch-only collision. Before the
change, the strengthened collision regression failed because `can_publish` was
`true` while `publish` refused the saved conflict. The shared summary now
offers new/resumable writes only for ready evidence in eligible known states;
branch-only conflicts expose abandonment only, while known PR receipts and
pending PR creation retain read-only reconciliation. Unknown states refuse
both advertisement and action. The delivery regressions also exercise CLI/API
refusal and the dashboard's existing shared action controls. Final
`npm ci --ignore-scripts`, `npm run build:dashboard` and `npm run check` passed;
the complete check reported 138 root/runtime/package cases and 52 dashboard
tests. These are local fixtures with a fake GitHub provider. No fresh installed,
live-provider, Docker or browser qualification was performed; those remain
lead-owned, and this result awaits Native Factory Verify and independent Review
of the full baseline-to-candidate diff.

## #29 read-only PR reconciliation label — 26 September 2026

The D2 regression reproduced at both boundaries before the fix: the shared
summary had no mode for a conflicted record with a saved PR receipt, and task
details labeled that available readback action “Publish accepted candidate as
draft PR.” Delivery status now returns `action_mode` as `publish`, `reconcile`
or `null`; task details use the shared value for its button and explanatory
text. The service fixture confirms a saved PR conflict is read-only, while
ready publication, pending PR-create readback, published receipts and branch-
only collisions retain their prior modes and guards.

Final `npm ci --ignore-scripts`, `npm run build:dashboard` and `npm run check`
passed; the full check reported 138 root/runtime/package cases and 52 dashboard
tests. The contract tests use disposable local repositories and a fake provider;
they do not prove live GitHub behavior. No fresh installed/provider qualification
was performed. Browser inspection remains pending because the Mac browser is
locked and there is no usable browser provider; no visual pass is claimed.
Native Factory Verify and independent Review still own the full
baseline-to-candidate assessment.

## #29 GitHub Actions qualification — 26 September 2026

The before-fix candidate-workflow regression published through the controlled
fake provider: 2 blobs, 1 tree, 1 commit, 1 branch and 1 PR write. The shared
delivery summary and publisher now reconstruct the admitted base and
digest-bound accepted candidate tree, reject candidate workflow-definition
changes, and qualify every base workflow that can run on the generated branch
push, a branch-selected manual dispatch or a PR event. A workflow refusal has
the same reason in status, CLI, API and the dashboard action contract; saved
intents are rechecked. Existing exact target readback still verifies the remote
base before writes, while known receipts remain read-only.

Controlled regressions cover added/changed/deleted/symlinked workflow files,
malformed and unsupported YAML/triggers, missing/dynamic/write/OIDC/deployment
permissions, secrets and token contexts, environments, self-hosted/reusable
jobs, ambiguous guards, non-main branch filters, PR lifecycle events,
branch-selected `workflow_dispatch`, the unchanged current `ci.yml`, stale
saved evidence and refusal with zero fake-provider writes. These local fixtures
do not execute GitHub Actions, use a live provider, or inspect
repository/organization rules, webhooks, external CI or action code. No browser
or malicious live workflow was run. Existing installed/provider receipts remain
bound to their prior candidates and do not qualify this change.

Final `npm ci --ignore-scripts` completed with zero reported vulnerabilities;
`npm run build:dashboard` passed; `npm run check` passed with 167 root/runtime/
package tests and 52 dashboard tests. Factory Verify and independent Review
still own subsequent verification and full-baseline review.

## #29 GitHub Actions guard-semantics correction — 26 September 2026

On checkpoint `1a9eed933c988dcd53bf2c3a47ac4f3cef826cd7`, the new pre-fix
regressions failed: the shared status incorrectly allowed case-variant PR and
push guards, a guessed `REFS/PULL/123/MERGE` guard, and a `main+` branch filter;
the direct qualifier also mishandled case-variant `!=` controls. The saved-intent
tests now recheck those cases at summary and publish. After the repair, known
ASCII guard comparisons follow GitHub's case-insensitive semantics, differing
non-ASCII comparisons and `pull_request` refs remain unknown, and only simple
ASCII branch literals can prove a filter excludes a candidate. Glob and escape
patterns stay possible matches. The regressions check the known event/ref,
head/base values and assert blocked status, matching publish refusal and zero
fake-provider writes. The unchanged current CI workflow and ordinary delivery
tests remain positive controls.

This is controlled parser/service evidence only: no GitHub workflow ran, no
live provider was contacted, no live hostile workflow was used, and
repository/org automation and external hooks remain outside qualification. The
repair did not change UI assets or refresh installed, provider, Docker or
browser qualification.

Final `npm ci --ignore-scripts` and the locked dashboard dependency install
reported zero vulnerabilities. `npm run build:dashboard` passed, and
`npm run check` passed with 177 root/runtime/package tests and 52 dashboard
tests. These checks cover the final code and the new regressions; Native Factory
Verify and independent full-baseline Review remain pending.

## #29 mixed push filters and inference-output redaction — 26 September 2026

The pre-fix controlled saved-intent regression reproduced the mixed-filter
workflow error: publication wrote one blob, tree, commit, branch and PR despite
`tags` plus `branches-ignore`. Qualification now evaluates either branch filter
category alongside either tag filter category, while a tag-only workflow remains
excluded from generated branch pushes. Both mixed forms, tag-only behavior and
the unchanged current CI have shared status/publication coverage.

Before output redaction, the controlled executor retained selected API-key and
Codex auth token sentinels in split Docker output and raw reports. After the fix,
executor-boundary tests confirm exact selected values are absent from retained
logs, reports sanitized after confirmed shutdown, promoted review artifacts and
the authenticated artifact API; ordinary report text and parsed Codex usage
remain. Tests also cover nonzero Docker exit, uncertain shutdown followed by
ordinary recovery, and a report symlink whose outside target is unchanged.
Final `npm ci --ignore-scripts`,
`npm run build:dashboard` and `npm run check` passed: 184 root/runtime/package
tests and 52 dashboard tests. These use controlled Docker behavior and fake
provider fixtures; no model or real provider was called. This filter does not
detect encoded/derived values or rewrite candidate content/patches. No new
installed qualification was performed; Native Factory Verify and independent
full-baseline Review remain pending.
