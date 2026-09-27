# One runtime, CLI and dashboard

Issue [#37](https://github.com/arcitai/software-and-defence-factory/issues/37)
owns complete bidirectional capability parity. This inventory records current
gaps; it is not a claim that parity is complete. Keep it current in each relevant
change. The queue/controller owns task state, policy and acceptance in both
interfaces. Host operations need a deliberate operator API, never an arbitrary
shell endpoint or a second scheduler.

| Capability | CLI | Shared API | Dashboard | Remaining work |
| --- | --- | --- | --- | --- |
| Project/queue/attempt state | `status`, `inbox --source factory` JSON | `GET /api/v1/status` | Project, tasks, details/history | Stable versioned agent result/error contract |
| Start local work | `issue start --file --title` or `--draft`, explicit `--workflow`, optional `--model` | `POST /api/v1/jobs` | Local execution only → review → Create & start locally | Persistent unstarted drafts and typed incident intake remain separate |
| Browse repository Inbox | `inbox [--page N] [--issue-state open/closed/all]` (also `issue list --source inbox`), `issue preview --url URL` via controller provider | Authenticated `GET /api/v1/issues`, `POST /api/v1/issues/preview` using shared readers | Primary list/Board with shared status/search/workflow/model/label filters, compact Repository tools/loaded scope, item count with secondary issue/execution totals and progressive linked detail; explicit Start work for either type | Issue → execution links retained; no implicit polling |
| Start repository work | `issue start --url URL --workflow software/defence [--brief-file operator.md]` | `POST /api/v1/issues/start` | Issue context → explicit Start work with operator brief | Rechecks current content and active admission |
| Create repository issue / recovery | `issue connection`, `create --key`, `submissions`, `recover --key` | Authenticated connection, `POST /issues`, receipts and recovery | Display destination/actor, create without execution, recover uncertain result | GitHub adapter first; assignees/projects and other providers unimplemented |
| Repository issue templates | `issue templates`, `issue draft --template --sha --file` | Authenticated template list and draft compilation | Chooser, fields/defaults/validation, review | Supports Markdown and YAML markdown/input/textarea/dropdown/checkboxes; unsupported templates link to GitHub |
| Suggest task type | `issue recommend --file` or `--url` | Authenticated `POST /api/v1/intake/recommend`; issue preview includes suggestion | Editable recommendation after source selection | Deterministic label/brief rules; no model judgment or execution authority |
| Cancel/retry/approve | Commands | Job action endpoints with current run ID | Task controls | JSON action results and consistent needs-attention outcomes |
| Request changes | `revise --file`, optional `--from admitted-source\|reviewed-candidate` or `--source-ref REF` | `request_changes` with `revision_mode`; continuation binds current run/head/tree from shared status | Explicit starting point, baseline and reviewed checkpoint; inline errors | JSON action result; unfinished Build checkpoints remain #42 |
| Remove a stopped task | No command | `DELETE /api/v1/jobs/:id` | Remove action | Add CLI; keep existing recoverability/history semantics |
| Evidence list/read/download | No command | Authenticated artifact routes | Files/preview/download | Add CLI with matching access and size/path rules |
| Roles, workflows and packaged skills | `definition`, `agents`, `skills` JSON (also while stopped) | `GET /api/v1/definitions` | Agents, Skills and Definition | Shared catalog plus bounded role harness/model editing; deterministic checks, gates, skills and resources stay shared |
| Portable role definitions | `definition export/validate/diff/apply/rollback` | Authenticated `/api/v1/definition` and typed operations | Agents/Definition role editor, diff, explicit idle Apply and rollback | One schema/capability matrix; revision CAS and bounded atomic history; [request shapes](definition.md) |
| Project repository links | Validated links in `status` | `project_links` from configured Git origin | View repo / optional GitHub issue link | Provider creates/issues reads are separate from Git source links |
| Recorded token usage | Per-attempt `usage` and `token_usage` in `status` | Same status records | Analytics, task rows, metadata/history | No billing estimate; partial/unknown coverage stays explicit |
| Analytics/filtering | Raw status available | Source queue records | Derived views | Expose equivalent queries/summaries without inventing usage data |
| Scoped incident admission | `incident --file` validates/deduplicates private evidence | No equivalent typed intake endpoint | Generic Defence form is not equivalent admission | Common typed intake, gaps and deduplication before execution |
| Initialize/configure | `init` | No operator setup endpoint | None | Preserve app files, explicit state and private secrets |
| Select/install job image | `install [--image LOCAL_REF]` (#30) | No operator image endpoint | None | Shared supported controls after host-operation boundary; runtime checks alone do not qualify a toolchain/model |
| Diagnostics | `doctor` | Limited status/definitions only | Runtime status only | Equivalent checks/results and truthful qualification status |
| Controller lifecycle | `up`, `stop`, `serve`, `service` | Operator-only maintenance reservation | No lifecycle controls | Define safe behavior while stopped/restarting; GUI must not bypass maintenance |
| Runtime updates | `update`, `service update`, auto-update settings | No update endpoint | None | Idle-only activation, rollback and common progress/errors |
| SSH tunnels | `tunnel` | No tunnel endpoint | None | Client-host ownership; distinguish operator machine from worker |
| Method export | `kit --output` | No export endpoint | None | Equivalent download/export preserving staging-only adoption |
| Synthetic qualification | `demo`, `qualify` | No qualification endpoint | Synthetic disclosure only | Explicit separate state; never target an application accidentally |
| Immutable source admission | `init --source-ref`, `run --source-ref`, `issue start --source-ref`; status and build evidence carry the resolved SHA | `POST /api/v1/jobs` resolves/retains before acknowledgement; shared source metadata in status | Issue Start work, local request and revision forms accept a ref; task detail shows requested ref, resolved SHA and prior source commits | Build/retry use retained objects; revisions start fresh by default; explicit continuation keeps the reviewed tree and recorded source; a new ref replaces the base; legacy source remains unknown |
| Trusted PR handoff | `publish JOB_ID` publishes/reconciles; `abandon-delivery JOB_ID --branch-sha SHA` records a checked local resolution for a pre-write branch collision | Authenticated `POST /api/v1/jobs/:id/publish` and `/abandon-delivery`; shared receipt, conflict identity and removal policy | Publish/reconcile and explicit “Abandon local delivery; keep remote branch” actions share controller state; errors/results and inspected branch identity are visible | New writes require matching protected Codex/Pi build/review provenance, deterministic verify/handoff provenance, non-synthetic bound artifacts and a qualified GitHub Actions tree. Shared delivery status exposes `workflow_qualification` and the same reason blocks CLI/API/dashboard capability and publication/retry. Candidate workflow changes, unsupported triggers/syntax, or active generated-push, selected-ref-dispatch and PR jobs with write/secrets/environment/OIDC/deploy access, self-hosted runners or ambiguous privileged guards refuse trusted writes. Supported ASCII guard comparisons follow GitHub's case-insensitive string semantics; unknown PR refs, non-ASCII mismatches, and glob/escaped branch filters cannot prove a privileged job inactive. The shared summary's `action_mode` distinguishes new/resumable publication from read-only reconciliation and drives idle and pending task button wording. Branch-only collisions and unknown/abandoned states offer neither; known PR receipts and pending PR-creation checkpoints retain read-only reconciliation. Abandonment checks the current run, saved intent, exact branch head and absence of an associated PR; it writes no provider data, preserves the remote branch/evidence, disables republishing and permits local removal. Uncertain effects and incompatible evidence stay blocked. Destination remains private operator config; patch-only remains default |
| Delivered-commit check readback | `publish JOB_ID` reconciles, `status` returns saved checks | Existing publish/status routes return the same `delivery_status.checks` | Delivered-commit checks, per-row conclusions/scope, uncertainty and refresh | 0.13.1 delivered in PR #97 with installed/live/browser qualification recorded; no required-check or mergeability claim |
| Optional trusted web verification | `web probe` performs a real local Chromium interaction; `doctor` reports readiness | Verify stores a shared story summary and protected JSON artifact in the run | Task history shows passed/failed/unavailable/inconclusive plus tool, candidate, policy and story hashes | Disabled by default. Required operator stories and Playwright/Chromium image ID are frozen in attempt policy. Linux Chromium proof cannot qualify native/mobile OS behavior; see [the browser contract](web-verification.md) |

The current generic task form can name the Defence workflow; that is not a
substitute for the CLI's validated incident admission. Treat the typed intake
gap as unfinished functionality, not a qualified human workflow.

Implement the smaller task/evidence/JSON gaps first. Setup/lifecycle controls
need an operator boundary that remains usable when a project controller is
stopped, preserves least privilege and cannot expose host commands to task text.
Do not equate the browser's current project session with host administrator
authority. Headless use and GUI use must ultimately reach the same outcomes;
intermediate releases must explicitly retain their unimplemented rows here.

Infrastructure exposes detected host capacity and the local worker through
`infrastructure` and the same status API. `automations` returns the harness
ownership contract; the UI explains that external schedules are not discovered.
Factory has no cron module. The v1 `automations: []` field remains a compatibility
view; `automation_control` owns the current semantics.
`foundation` prints the packaged operator skill without configuring anything;
the Skills page reads that same file. Full safe setup controls remain #37.
The roadmap is split into Defence #50, quality measurement #51, GitHub intake
#52, editable definitions #53 and scoped MCP #54. Existing REST endpoints are
local single-operator interfaces, not a public multi-user API.


## Issue lifecycle API in 0.11.0

`GET /api/v1/issues?page=1&state=open` retains repository/issues/next_page and adds
provider, page, state, loaded_count, total (null when unknown), and history.
Each issue adds canonical identity, provider state, readiness, executions,
latest_execution, active_execution(s), and start_block_reason. History groups
local jobs and canonical sources outside the page; not_loaded does not claim
that an issue is missing or closed. `status.issue_history` refreshes these local
associations without polling the provider. No issue content database was added.

`POST /api/v1/issues/preview` retains content/labels/recommendation and adds the
same identity/readiness/history contract. `POST /api/v1/issues/start` accepts
url, expected_spec (the preview's spec), workflow, optional brief, source_ref
and model. It re-reads current provider context, rejects changed scope, closed
sources, blocked/conflicting readiness and active/unresolved work, then uses
existing source admission. HTTP 409 describes stale or duplicate admission.
`POST /api/v1/jobs` remains compatible for local/direct callers; its queue-level
canonical reservation also rejects concurrent duplicate active work and retries.
Terminal succeeded/failed/cancelled executions release the reservation unless
provider delivery is unresolved. Other/unknown states retain it conservatively.

`inbox` now defaults to the same repository page object as the dashboard (open,
page 1), an intentional 0.11.0 JSON change from its former jobs array. Use
`inbox --source factory` for the explicit legacy execution-only array.
`issue list` still defaults to the original local jobs array (`--source factory`).
`--source inbox`, `remote` and compatibility `github` return the shared enriched
page. `issues` now uses this same authenticated controller endpoint and enriched
JSON, rather than bypassing the controller; scripts need a running controller.
Use `--issue-state` for provider state; `--state` continues to mean installation
path. Repository paging/state options are rejected in execution-only mode rather
than ignored. Unsupported providers return their capability state and local/history
records; provider/auth failures exit nonzero, never an empty-success backlog.
`issue start --url URL --brief-file operator.md` reads a UTF-8 operator brief of at
most 16000 characters (the API's string-length limit), forwarded unchanged to the
shared preview/start contract. The API appends nonblank, trimmed text under
`Operator brief:` in the admitted spec, while preserving provider identity and
rechecking current content. `--brief-file` is optional, only valid with remote
`issue start --url` (or its `--github` alias); it cannot accompany local `--file`
or `--draft`, creation, browsing or other commands. Missing/unreadable files and
oversize text fail without admission. Local file/draft execution is unchanged. `run` retains
its compatible direct-job path and the controller's duplicate identity guard.

Definition exposes `configuration.issueReadinessLabels`. The optional private
config field has exactly triage/spec/ready/blocked keys with four distinct label
names; defaults are factory:triage/spec/ready/blocked. Configuration is validated,
not inferred from issue content. No browsing path changes labels or comments.

The additive `work_records` read model is returned by `GET /api/v1/issues`
(and CLI `inbox` / `issue list --source inbox`) alongside the existing `issues`
and `history` fields. `status` returns the same model for retained history without
fetching a provider page. Each record includes a canonical `key`, source `identity`,
`source_status` (`loaded`, `not_loaded`, `local`), optional source `issue`, all
`executions`, representative `execution_id`, actual `state`, `workflow` and `phase`.
Active/unresolved execution takes precedence over the latest terminal execution.
Without an execution, state is `not_started`, workflow/phase and execution ID are
null. Readiness lives on the source issue, separate from execution state. Dashboard
projection uses this same pure read-model function with its bounded page snapshot
and latest status; grouping/filtering does not admit execution. Individual
`#/runs/JOB_ID` links remain valid; `#/issues/KEY` opens canonical source detail.

The dashboard's Repository disclosure beside the item count holds source-state
selection, refresh, available previous/next page actions and Local execution
request. It also explains read time, remote total, the loaded search boundary
and separate issue/local request/execution counts. Loading and source errors
remain visible when it is closed. Rows and cards share compact metadata; source
readiness remains distinct from the runtime badge, and full assignments and
linked attempts remain in detail. These presentation controls do not change
headless records or admission semantics.

## Delivered-commit checks (0.13.1, bounded #37 slice)

The controller keeps its before/after PR repository, branch, target and immutable
head guards. The GitHub adapter reads that delivered head, not a moving ref or
merge commit. CLI/API/dashboard share the saved normalized `checks` object:

- `target`: requested `repository` URL, immutable `sha`, validated
  `pull_request_number`; null for an invalid request. This names the read target,
  not proof that every returned row belongs to it.
- Each check run retains `head_sha`, raw `conclusion`, `status`, `passed` and
  `non_blocking`; `scope` is `commit`, `pull_request` or `unknown`. An exact
  `head_sha` with `pull_requests: []` is commit-scoped. Missing/malformed or
  conflicting associations do not qualify. Commit statuses use the combined
  response's exact SHA and repository identity and carry the same scope/flags.
  Supplied PR `head`/`base`, repository and owner containers must be objects,
  never null, scalars or arrays. Supplied repository names, owner login and
  API/HTML URLs must agree, including on combined statuses; supplied combined
  commit/status URLs must identify the exact target. Optional association details
  may be absent. A supplied head SHA must match; a supplied base SHA must be
  well formed but may differ from the delivered head. Combined statuses still
  require a repository `full_name` and exact commit SHA.
- Optional row API self `url` fields must name the requested repository and
  `check-runs/{id}` or `statuses/{id}` resource, agreeing with a supplied numeric
  row ID. The documented legacy `statuses/{sha}` form must name the exact delivered
  SHA; its suffix is a commit identity, not a row ID. Missing self URLs remain
  supported. Malformed or contradictory self URLs make that row's status/scope
  unknown and both flags false. CI details/HTML/target links are presentation
  links, not repository identity; external CI destinations remain usable.
- `pagination_complete` requires both arrays and exact nonnegative totals
  within the existing 100-row bound. No extra pages or polling are introduced.
  Empty, partial, unreadable or unknown data never establishes aggregate success;
  `reason` explains unknown results. Verified failures remain visible with partial
  data. Otherwise incomplete/unverified data takes precedence over cancellation,
  pending and positive results.
- `success` requires at least one executed success and all observed rows to be
  non-blocking. Skipped/neutral-only results are `non_blocking`, not passing
  execution. `pending`, `failure`, `cancelled` and `unknown` remain distinct;
  raw conclusions retain timeout/action-required and unrecognized outcomes.

Old receipts are not rewritten. Without matching target/scope metadata the
human view marks recorded results unverified and offers the existing refresh;
headless consumers must likewise treat absent provenance as unknown. These are
observations of delivered-commit checks, not proof of required-check completion,
branch protection, mergeability, deployment or model quality. Protected Verify,
independent Review and explicit acceptance remain unchanged. #37 remains open
for the other parity gaps above; no role/profile or workflow redesign is included.
