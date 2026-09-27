# Role definitions (0.14.0)

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
missing `harness` mean `inherit`. Each role accepts only `harness`, `model` and
`reasoningEffort`; unknown fields, roles, versions and incompatible combinations
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
- Explicit `codex` or `pi` uses the same maintained preset as `init`, even when
  the installed harness has the same name. No command, path, privilege, network,
  credential or provider-authorization argument can enter the portable payload.
- `model` is a user-selected identifier (1–128 identifier characters, no paths,
  URLs, whitespace or command switches). Omit it for the explicit harness default;
  `null` also requests that default. Explicit Pi requires a supported
  `provider/model` prefix so credential selection is unambiguous. For inherited Pi,
  a model must agree with any installed private `inferenceProvider`.
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
while stopped; rollback restores portable roles only, not separately edited base
settings, credentials or historical attempts. New reads do not use a startup cache.

Before each attempt, trusted configuration resolves and freezes **all roles** in
private `execution-config.json`. The executor selects its phase from that frozen
configuration. One policy hash covers the common configuration across Build,
deterministic Verify, Review and Handoff; it is not a hash of separately merged
phase settings. Protected v2 execution evidence records role, requested model,
provider, explicit effort and a digest binding the exact private command selection.
The executor checks that binding before launching. Role overrides require v2;
old v1 evidence cannot attest them. Unchanged legacy configurations still emit
v1 with the actual 0.14.0 runtime version. See [compatibility](npm.md#protected-evidence-compatibility).

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
controller. No new credentials, endpoint binding, model download or provider is
created by a definition.

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
