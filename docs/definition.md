# Role definitions (0.15.0)

The portable definition selects harness/model profiles for **Implement**, **Review**
and **Investigate**. CLI, local API and the existing Agents/Definition pages use
one parser, resolver, capability matrix and application path. This first #53 slice
does not make skills, resources, access, workflow gates or schedules editable.

```json
{
  "version": 1,
  "roles": {
    "implement": { "harness": "inherit" },
    "review": { "harness": "pi", "model": "anthropic/operator-selected-model" },
    "investigate": { "harness": "codex", "model": "operator-selected-model", "reasoningEffort": "high" }
  }
}
```

The root accepts exactly `version` and `roles`. Version must be numeric `1`;
role names are exactly `implement`, `review`, `investigate`. Missing roles and
missing `harness` mean `inherit`. Each role accepts only `harness`, `model`, `reasoningEffort` and
`localBinding`; unknown fields, roles, versions and incompatible combinations
fail explicitly. The authoritative implementation and capability matrix are in
[role-definition.mjs](../factory/role-definition.mjs), not a second schema copy.

- `inherit` preserves the installed private command, including a custom wrapper.
  An omitted model inherits the installed model. Model/reasoning overrides require
  an inherited Codex/Pi adapter; custom and mock commands have no such controls.
  For an inherited Codex model or effort override, one bounded option parser
  supports direct `codex exec` argv (also `e`). Model selection replaces
  separate/attached `-m` and `--model` forms and direct
  `-c`/`--config model=...` settings. An explicit model emits one `--model VALUE`;
  `null` removes those inherited selections. Unrelated supported options, their
  values and the prompt remain intact; new options precede the prompt or `--`.
  Effort selection replaces direct `model_reasoning_effort` settings in supported
  separate/attached `-c`/`--config` forms with one setting. Effort-only changes
  preserve inherited model arguments exactly, without substituting installed
  model metadata. Model-only changes preserve inherited effort settings.
  Opaque wrappers, unknown switches/arity, profile selectors (`-p`/`--profile` or
  config profile layers), nested commands, multiple prompts, options after a
  positional prompt and duplicate model flags left by an effort-only selection
  are refused before adoption. Use the Codex preset or correct the private
  command while stopped. All-inherit commands remain byte-for-byte unchanged.
- Explicit `codex` or hosted `pi` uses the same maintained preset as `init`, even when
  the installed harness has the same name. No command, path, privilege, network,
  credential or provider-authorization argument can enter the portable payload.
- `model` is a user-selected identifier (1–128 identifier characters, no paths,
  URLs, whitespace or command switches). Omit it for the explicit harness default;
  `null` also requests that default. Explicit hosted Pi requires a supported
  `provider/model` prefix so credential selection is unambiguous. For inherited Pi,
  a model must agree with any installed private `inferenceProvider`.
- `localBinding` selects an explicitly adopted private keyless Pi binding instead
  of a hosted model; see the opt-in contract below.
- This slice exposes Codex `reasoningEffort` values `low`, `medium`, `high`, passed
  as `-c model_reasoning_effort="VALUE"`. Omission preserves private/default
  behavior; it does not attest a detected effort. Pi effort control is unavailable.
  The [Codex configuration reference](https://learn.chatgpt.com/docs/config-file/config-reference)
  documents the setting; actual supported levels depend on the selected model.
  Validation does not call a model or prove availability, quality or readiness.

## Inspect, review and adopt

```sh
factory definition --state PATH
factory agents --state PATH
factory skills --state PATH
factory definition export --state PATH > factory-roles.json
factory definition validate --state PATH --file factory-roles.json
factory definition diff --state PATH --file factory-roles.json
factory definition apply --state PATH --file factory-roles.json --expected-revision REVISION
factory definition rollback --state PATH
factory definition rollback --state PATH --expected-revision REVISION
```

`definition`, `agents`, `skills`, and compatibility `workflows` remain readable
while stopped. Export prints only portable JSON. Validate and diff resolve against
the installation and return the normalized definition, effective selections,
changes and **current** revision. With no installation, validate performs portable
syntax/explicit-combination validation and reports that inheritance still needs
an installation. No account or provider connection is needed for validation.
Rollback without `--expected-revision` previews the previous definition. Supply
that revision to perform rollback; it restores the previous selection, not the
old revision number. Keep `factory-roles.json` in a repository for ordinary code
review or in a private local file. No filename is automatically discovered or
adopted from source, issues, labels or a candidate checkout.

Apply and rollback require the running single controller. The browser uses the
same endpoints, with labelled role inputs and a diff before explicit Apply.
A matching revision and an idle controller are required: queued, running,
cancelling, awaiting-approval work, pending actions, maintenance and unreconciled
executor fences block application. Stale or invalid requests fail without
changing installed settings. Reload and preview again after a conflict.
Configuration adoption never admits work or installs/discovers a schedule.

Authenticated API requests (bearer operator token or local session):

| Request | JSON body / result |
| --- | --- |
| `GET /api/v1/definition` | Current `revision`, portable `definition`, `effective`, `inherited_harness`, `capabilities`, `rollback_available` |
| `POST /api/v1/definition/validate` | `{"definition": {...}}` → validation and effective diff |
| `POST /api/v1/definition/diff` | `{"definition": {...}}`, or `{"rollback": true}` → current revision, proposed definition, effective changes |
| `POST /api/v1/definition/apply` | `{"definition": {...}, "expected_revision": "HASH"}` → installed readback |
| `POST /api/v1/definition/rollback` | `{"expected_revision": "HASH"}` → installed readback |

`GET /api/v1/definitions` remains the safe catalog and includes `role_definition`.
HTTP 400 means invalid schema/combination; 403 means missing session or rejected
Host/Origin; 409 means stale/busy/recovery-required or no rollback available.
Storage errors return 500 with details in private controller logs. CLI errors
exit nonzero. Neither catalog nor role responses expose private command argv,
credential values or machine bindings. Unresolved provider defaults remain null;
execution resolves them from the private installation before launch.

## Private state, policy and evidence

Existing `factory.json` is not rewritten or migrated. With no overrides, the
legacy effective configuration and policy hash are byte-compatible, including
private custom commands and legacy `agent` naming. All-inherit adoption is a
no-op. Shared resources, image, checks, repository identity and credentials stay
private and are changed while stopped through their existing operator workflow.
Foundation supplies setup guidance, not another configuration source.

The controller stores the adopted definition and up to ten prior definitions in
one private `role-definition.json`, using a flushed temporary file and atomic
rename. Process interruption before rename leaves the old record; after rename,
the complete new record and history are present. Incomplete temporary files are
not loaded. The adopted record must be a regular private file; repository symlinks
are refused. Revisions include a monotonic sequence and the private base settings,
so an old revision is stale even after rollback. Back up the entire private state
while stopped; rollback restores roles and adopted local bindings, not separately edited base
settings, credentials or historical attempts. New reads do not use a startup cache.

Before each attempt, trusted configuration resolves and freezes **all roles** in
private `execution-config.json`. The executor selects its phase from that frozen
configuration. One policy hash covers the common configuration across Build,
deterministic Verify, Review and Handoff; it is not a hash of separately merged
phase settings. Protected v2 execution evidence records role, requested model,
provider, explicit effort and a digest binding the exact private command selection.
The executor checks that binding before launching. Role overrides require v2;
old v1 evidence cannot attest them. Unchanged legacy configurations still emit
v1 with the actual installed runtime version. See [compatibility](npm.md#protected-evidence-compatibility).

Changing a role invalidates prior acceptance/checkpoint evidence under that
policy. Rollback can restore the exact prior policy; it never edits evidence or
automatically retries work. Recovery, reviewed-candidate continuation and new
publication use the same current-policy guards. Existing published receipt
reconciliation retains its read-only semantics. With any role override, task-wide
`--model`/API `model` is refused, including a value equal to the old shared model.
Clear it and use the role definition; unchanged legacy installations keep their
existing task-model behavior.

Only the selected provider's inference settings reach each agent phase. Codex
account-auth data never reaches Pi, including Pi using OpenAI. Check and Handoff
receive no inference credentials. Git/issue-provider identity remains on the
controller. Portable roles create no credentials or model downloads. The opt-in local binding
contract below explicitly adopts private endpoint details separately.

## Role and output boundaries

Build implements, runs appropriate checks, writes its report and returns. Factory
owns separate Review; this slice grants no nested reviewer capability or budget.
Review receives the original source baseline and protected exact-candidate,
current-policy checks. Its candidate mount is read-only, without installed
project dependencies; `/tmp` is bounded/noexec. Reuse passing protected checks.
Additional reproduction requires suitable available capabilities; do not repeat
impossible installs or treat an unavailable rerun as a code finding or a pass.

Factory owns `/output/agent-report.md`, `/output/review.json` and
`/output/incident-report.json` as appropriate to the phase. Harness-only final
output belongs in ephemeral `/tmp/factory-final-message.md`, never those reports.
The maintained presets do not capture a final-message file over a Factory report.
Role adoption rejects recognized inherited Codex final-message flags targeting
non-ephemeral destinations; it never rewrites the private command. Opaque custom
wrappers remain operator-owned. Redaction covers owned reports/logs, not every
arbitrary file a custom harness might write. A missing required report remains
a failure, never a final-message substitution.

All six installed runtime skills remain available read-only, with content/source
hashes in the catalog. Per-role recommendations are guidance, not access controls.
Triage/spec are pre-admission method skills, not executable roles. Check remains
deterministic; acceptance is human-owned. No foreman, scheduler, application
publishing or production recovery authority is added.

Host, image/toolchain and provider readiness require actual probes on each target
platform. `doctor` and existing image/browser probes keep their bounded meanings;
configuration alone is not readiness attestation. Lead qualification of the exact
package, isolated mixed-role Docker execution and desktop/390/320px browser
inspection in both themes remain separate gates. #53 stays open for per-role
skills/resources/access, broader project/flow/automation definitions and readiness
attestation. #69 owns local/hybrid model benchmarks, #51 measurement and #70
improvement proposals.

## Opt-in local bindings (0.15.0, #69)

A portable role can select `{"harness":"pi","localBinding":"local-worker"}`
instead of a hosted `model`. The same reference can serve Implement, Review and
Investigate, or any role can retain Codex/a hosted Pi model for a hybrid setup.
Binding references cannot be combined with a role model or reasoning effort.
They require the maintained Pi preset; private wrappers are not binding adapters.

Connection details belong to explicitly adopted **private installation state**,
not the portable definition. No repository filename, issue or model response is
an active configuration source. Save a private JSON binding map, for example:

```json
{
  "local-worker": {
    "endpoint": "http://operator-selected-host:8080/v1",
    "model": "exact-installed-model-id",
    "contextWindow": 32768,
    "maxTokens": 4096,
    "reasoningEffort": "default",
    "compat": {
      "maxTokensField": "max_tokens",
      "supportsUsageInStreaming": true,
      "requiresToolResultName": false
    }
  }
}
```

These illustrative values are not defaults or measured recommendations. Select
the endpoint, exact model and limits for your installation. `endpoint` is a base
URL for OpenAI **chat completions**, not a full `/chat/completions` URL. The job's
isolated network must reach it; its loopback address is not the host's loopback.
Factory neither opens ports nor adjusts networking or inference services.

```sh
factory definition diff --state PRIVATE_STATE --file roles.json --bindings-file PRIVATE_BINDINGS.json
factory definition apply --state PRIVATE_STATE --file roles.json --bindings-file PRIVATE_BINDINGS.json --expected-revision HASH_FROM_DIFF
factory definition rollback --state PRIVATE_STATE --expected-revision CURRENT_HASH
```

`validate`, `diff` and `apply` accept `--bindings-file`. Without it they retain the
installed binding map. Providing a map replaces it in full, so removing a referenced
binding fails until its roles are changed in the same request. `export` includes
only portable roles/references. CLI `definition` inspects private bindings locally.
The authenticated API adds optional `local_bindings` beside `definition` to
validate/diff/apply; `GET /api/v1/definition` returns both. Diff returns
`binding_changes`. Unauthenticated `/api/v1/definitions` omits endpoint maps;
authenticated readback includes them. The existing Agents/Definition editor uses
this same contract and shows a binding diff before Apply, including connection-only
changes. Configuration makes no inference/model-list requests and never starts work.

Bindings and roles share one revision, idle check, atomic record and at most ten
rollback snapshots. Rollback restores both together; stale/busy/invalid writes
preserve the prior state. Endpoint normalization is idempotent; URLs whose normalized
form contains forbidden escapes (including Unicode path characters) are rejected.
The complete serialized record and history are validated before replacement.
The version-2 private record reads old version-1 role
records without rewriting them. An old runtime cannot read a newly adopted v2
record: roll back profiles first and restore a stopped pre-upgrade private-state
backup before downgrading binaries. Do not hand-edit histories or frozen attempts.

The binding contract supports at most 16 named, keyless HTTP(S) endpoints. URLs
with user information, queries, fragments, escapes or malformed syntax are refused.
Model identifiers cannot contain shell syntax, whitespace or traversal. Context
must be 1,024–1,048,576 tokens; output must be 1–32,000 and smaller than context.
The output ceiling remains 32,000 with the pinned Pi 0.87.1 chat adapter. Range acceptance
is **not** evidence of server allocation or useful task capacity. Only the three
shown compatibility fields are supported. Authentication, custom headers, shell
credential commands, arbitrary request fields, sampling overrides, custom thinking
maps and provider plugins are unsupported. Factory does not spoof local inference
as the hosted OpenAI provider.

The optional binding `reasoningEffort` accepts only these OpenAI-style requests:

| Binding choice | Chat-completions request |
| --- | --- |
| Omitted or `default` | No `reasoning_effort` override; server default applies |
| `none` | `reasoning_effort: "none"` |
| `low`, `medium`, `high` | `reasoning_effort` set to that exact value |

This is a request choice, not a measured thinking budget or quality claim. The
pinned Pi 0.87.1 adapter uses a fixed internal `thinkingLevelMap.off="none"` for
`none`; `--thinking off` alone does **not** disable a server's default thinking.
Low/medium/high use the corresponding explicit Pi thinking level. Existing
bindings with no choice retain their omitted request and private policy shape;
no default is inserted into their saved configuration. The binding editor,
CLI/API diff, private readback, frozen selection and rollback share this choice.
Separate role bindings can request different efforts. Endpoint support and actual
behavior remain unqualified until tested on that installation. A server rejection
fails the job without fallback or retrying with a different choice; a server that
silently ignores the field cannot be detected from successful transport alone.

Before admission, all selected references must resolve. Each attempt freezes the
chosen endpoint, exact model, declared limits, reasoning request, compatibility settings and maintained
command along with the common resource/timeout/skill policy. Unselected bindings
are not included. Local/hybrid attempts emit protected **v3** evidence across all
phases, binding the selection digest and common policy. Public facts show configured
context/output, unknown actual allocation and unqualified quality. Old v1/v2 writers
cannot attest local bindings; unchanged legacy profiles keep their policy bytes and
compatible evidence. See [the compatibility audit](npm.md#protected-evidence-compatibility).

For the selected local role only, the executor creates a private single-model
`models.json` and deterministic launcher, mounted read-only at `/factory-local`.
`PI_CODING_AGENT_DIR` selects that directory; HOME is still ephemeral. The launcher
checks explicit provider/model argv, removes inherited credential/override inputs
and requires a completed JSON turn even if Pi exits zero. Explicit successful
retry/overflow recovery can clear an assistant error; failed/aborted compaction,
exhausted retries, malformed/truncated JSONL and missing completion remain failures.
The original event stream is retained in the bounded private log. The launcher also
passes the fixed placeholder as Pi's supported runtime `--api-key`, avoiding a
credential-store refresh against the read-only registry. No credentials are added. The registry uses
Pi's required fixed non-secret key placeholder (`factory-local-keyless`), which may
be sent as a bearer value; this is not endpoint authentication. No host home, provider
catalog or credential store is mounted. Repository files cannot replace this mount.
Files are removed after confirmed container shutdown; uncertain shutdown retains
them behind the existing recovery fence until normal recovery confirms absence.

Local roles receive no cloud model environment; cloud roles receive no local
registry/override. Verify and Handoff receive neither. The local preset disables
automatic skills/extensions/templates but explicitly adds `--skill /factory-skills`,
preserving the six packaged skills. Recommendations remain guidance, not per-role
access controls. Build still returns to Factory's independent Review and operator
handoff; no duplicate review workflow is launched.


For long tool-use runs, use the [context-boundary qualification and image migration
recipe](setup.md#local-context-budget-and-worker-image-0152-100). Declared context
and output budgets are the same shared binding fields in CLI, API and dashboard;
there are no Factory compaction knobs or automatic larger-window/model choices.
