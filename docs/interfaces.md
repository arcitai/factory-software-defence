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
| Select optional private HTTPS ingress while stopped | `factory ingress setup --file PRIVATE_JSON_FILE --state PATH` |
| Compare selected config with owning listener | `factory ingress status --state PATH` |
| Remove ingress config while stopped, preserving prior config | `factory ingress remove --state PATH` |

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

List and Kanban show the same records and filters. A closed GitHub issue is a
repository decision, not proof of successful execution. Results show native
thread/turn identities and bounded final text; Codex retains full history.

## HTTP and private ingress boundary

The public surface is `/api/v1/` on the loopback listener. Status supplies a local
session nonce. Protected reads and mutations require `x-factory-session`, with
Host/Origin/cross-site checks. SSH is the default remote route. Optional private
HTTPS uses an existing authenticated proxy over a private Unix socket, with one
exact configured origin/Host and an explicitly allowlisted authenticated identity
header. No forwarded header can broaden the TCP boundary. Duplicate security
headers, malformed/unapproved identity, malicious authority/origin, cross-site and
missing/invalid sessions are refused. Navigation/status bootstrap still works
without a Factory nonce after the applicable route checks.
CLI discovery verifies the bridge's repository and immutable process instance.

Bootstrap and status expose only `operator_ingress` configuration/listener flags,
configuration digest and an explicit unqualified-transport statement. Origin and
allowed identities stay in the private `ingress.json` version-1 sidecar. CLI/service
status compare that selected configuration with the owning bridge's startup
projection; unavailable live state stays unknown. The socket path is fixed at
`STATE/inbox.sock`, private and Linux-only. Neither configured nor listening means
TLS, owner/device policy or remote UI is qualified. See the complete
[setup and verification contract](private-ingress.md).

Issue preview/start, native status/result/continue/interrupt/reconnect and issue
creation all share these handlers. Writes are explicit and size-bounded. Stale
expected-turn identities are rejected. An uncertain creation or admission is
recorded before upstream work and never silently repeated.

The bridge accepts the selected runtime through a narrow contract; only that
integration knows native protocol details. Capability flags describe what is
available. No CLI command may spin up a temporary agent server for a live action
and then close it while the work is running.
