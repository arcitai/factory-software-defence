# Interfaces and state

The Inbox and operational CLI commands use one running loopback bridge. Setup,
login, diagnostics, method export, release checking and OS-service management
are operator commands.
There is no second CLI execution engine.

| Intent | CLI |
| --- | --- |
| List repository issues | `factory issues list --status open --state PATH` |
| Inspect templates and connection | `factory issues templates` / `factory issues connection` |
| Prepare or create an issue | `factory issues draft` / `factory issues create --file JSON_FILE --state PATH` |
| Reconcile uncertain creation | `factory issues submissions` / `factory issues recover REQUEST_ID` |
| Inspect an issue | `factory issue URL --state PATH` |
| List work or inspect one item | `factory status [ID] --state PATH` |
| Read a bounded native result | `factory result ID --state PATH` |
| Start an accepted issue | `factory start URL --brief TEXT --state PATH` |
| Continue the same native history | `factory continue ID --turn TURN_ID --feedback TEXT --state PATH` |
| Interrupt the identified active turn | `factory interrupt ID --turn TURN_ID --state PATH` |
| Reconnect without starting work | `factory reconnect ID --state PATH` |
| Export the portable method | `factory kit --output NEW_DIRECTORY` |
| Adopt a reviewed installed patch into the owned user service | `factory service adopt --state PATH` |

`factory help` owns exact supported options. Software and scoped defensive work
share the same issue surface. Work type selects guidance, not another executor.
Sensitive security findings belong in the project's private reporting channel.

New issue loads repository templates, then creates through the repository
provider. Creation is separate from Start. Existing repository issues enter the
Inbox automatically when loaded; there is no redundant import-as-new-issue flow.
GitHub browser login and the execution host's authenticated GitHub CLI are separate.
For the browser creation, receipt recovery and delivery walkthrough, see
[setup](setup.md#create-and-deliver-an-issue).

The issue CLI uses the same JSON bodies as the dashboard's HTTP requests.
`issues draft --file` takes `template` (the selected template ID), `sha`, `title` and `answers`; inspect
`issues templates` first. `issues create --file` takes `request_id`, `repository`,
`actor`, `title`, `spec` and `labels`; `issues connection` supplies the exact
repository and authenticated actor. Keep one stable creation request ID (16–100
letters, digits, underscores or hyphens) when reconciling an uncertain response.
Never generate a fresh ID merely to retry. Inspect `issues submissions` and use
`issues recover` to look for the existing upstream issue; recovery does not repeat
creation or start an agent.

Release checking is an operator read: `factory updates check --channel next`
compares public `factory-software-defence` metadata with the executing CLI package.
It does not activate
the pinned service or invoke the harness. See [packages and releases](npm.md).
`service adopt` is a separate explicit activation from the selected installed
target CLI. It pins bytes, requires idle ownership and native readiness, and
retains private rollback evidence. It does not download or choose a release.
Same-version unchanged adoption is a no-op; an unresolved result is not a
fallback success. See [service adoption recovery](recovery.md#service-adoption).

## State is observable, not invented

- **Repository phase** comes from the shared [lifecycle catalog](../adlc/lifecycle.json):
  actual GitHub phase labels, open/closed state and closure reason. The existing
  triage/spec/ready/blocked readiness mapping remains supported. A ready label
  allows small accepted work to skip specification.
- **Unresolved source** covers missing or off-page provider data, stale reads,
  unlabeled issues and conflicting phase labels. A missing issue is not closed.
- **Done** requires a closed issue with GitHub's `completed` reason. Declined or
  reasonless closure stays **Closed**; the provider must supply the reason.
- **Native state** is separate: Running, native turn completed and needs review,
  Failed, Interrupted, Unknown or Not started. A completed turn needs checks and
  independent review. Running or unknown native state remains visible when its
  repository issue is closed.

`GET /api/v1/issues` and `factory issues list` return this same phase projection
alongside the native execution state and loaded-page scope. List, Kanban, phase
filters and native-state filters use the same projection. Changing views,
filters, page or source state does not start or replay native work.

The list's native category cards derive groups/substates from that catalog. A
category name toggles its actual substates; its separate count only folds detail
rows. Native-state checkboxes select substates, avoiding overlapping group values
that could defeat individual deselection. Repository phase remains a separate
facet and board grouping. Counts describe the loaded scope and retained native
associations; result counts reflect the selected filters. Models require actual
normalized native evidence and are currently absent. See the approved composition
and browser qualification checks in [DESIGN.md](../DESIGN.md).

List and Kanban show the same records and filters. A closed GitHub issue is a
repository decision, not proof of successful execution. Results show native
thread/turn identities and bounded final text; Codex retains full history.

## Local HTTP boundary

The public surface is `/api/v1/` on the loopback listener. Status supplies a local
session nonce. Protected reads and mutations require `x-factory-session`, with
Host/Origin/cross-site checks. It is not remote account authentication; use SSH.
CLI discovery verifies the bridge's repository and immutable process instance.

Issue preview/start, native status/result/continue/interrupt/reconnect and issue
creation all share these handlers. Writes are explicit and size-bounded. Stale
expected-turn identities are rejected. An uncertain creation or admission is
recorded before upstream work and never silently repeated.

The bridge accepts the selected runtime through a narrow contract; only that
integration knows native protocol details. Capability flags describe what is
available. No CLI command may spin up a temporary agent server for a live action
and then close it while the work is running.
