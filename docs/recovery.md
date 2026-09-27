# Recovery and retained evidence

Use `status --state PATH` and the private supervisor.log to identify the active installation. Stop it before replacing its package or container image.

- A normal `stop` signals the controller, waits for the executor process group, removes its labelled containers and retains the database and artifacts.
- An unconfirmed running attempt becomes `interrupted` on controller restart. It is never silently considered successful.
- Admission resolves the configured source ref or an explicit `--source-ref` in the configured repository, records its identity/ref/SHA in private job metadata and retains its Git objects under that job. Build and retry restore from this retained revision; moving or deleting the source ref does not select a new commit.
- `retry JOB_ID` verifies retained objects and reconciles the previous process group and containers. A missing/corrupt retained source, live writer or unknown process blocks retry. For a new build/defence attempt, the prior checkout is retained as previous-checkout-*.
- A forced host/controller stop can leave the selected inference env file in the private attempt directory. Normal executor cleanup removes it only after a Docker listing confirms the named container is absent. Retry/reconciliation removes a leftover copy only after the prior process group is confirmed stopped and a Docker listing confirms the labelled containers are absent; a `docker rm` or `docker stop` exit alone does not prove shutdown. If identity, a Docker probe or shutdown is uncertain, the recovery fence and file remain; do not clean it manually while a worker may still be active. After shutdown is confirmed, recovery also redacts the fixed phase reports and log using the selected environment values before removing the env file.
- Retry repeats the stopped phase. A failed verification may retry the same candidate when its policy is unchanged and the check can now pass. If the check or execution policy changed after build, retrying verify/review cannot reuse the earlier build for handoff; handoff remains blocked. Preserve that failed attempt, then use an eligible requested revision or submit a replacement task to build under the current policy. Do not edit SQLite or acceptance evidence to bypass the guard.
- A requested revision keeps the recorded source by default, retains previous evidence and starts a new build with accumulated feedback. Supplying a deliberate new `--source-ref` resolves and retains that base before the action; prior source metadata stays in history, and the new build gets fresh checks and review.
- Removing a stopped task from the dashboard hides its queue record. Private artifacts and its deleted_at record remain on disk; this is not secure erasure.

Do not remove active.json merely to unblock a job. Establish that its PID, process group and labelled containers are stopped. PID reuse or missing process identity requires operator investigation. Preserve logs and work before cleanup.

For backup, stop the installation and copy the complete private state directory, including SQLite files, factory.json and credentials, to an authorized private destination. Restore only while stopped. Update the repository path if it moved, verify ownership/permissions and the pinned image, then inspect state before any retry. Keep previous backups; no automatic destructive schema migration is provided.

Earlier experimental engines use a different journal. Start a new state directory for the native 0.3 runtime; preserve old journals separately. There is no automatic import of their jobs or approval state.

Verification cleanup makes owned scratch directories traversable before removing
them and never follows their symlinks. The executor and recovery paths remove
`check-workspace` only after Docker confirms the named container is absent; a
client exit, failed remove or failed/unknown probe does not establish shutdown.
While shutdown is uncertain, the scratch directory and active recovery fence
remain. Ordinary reconciliation removes scratch after the process and labelled
containers are confirmed stopped. If a filesystem error still prevents cleanup,
the attempt fails and retains the original check exit and private log path
alongside the cleanup error.
Inspect that retained attempt before manual removal; never substitute the source
candidate path for the scratch path.

## Review feedback or phase retry

Use **Request changes** on a failed software review only when its validated
verdict is `changes` or `blocked`, or at the normal approval gate. The CLI
provides the same action:

```sh
software-defence-factory revise JOB_ID --file /private/revision.md --state /private/state/project
```

Feedback must be nonempty and at most 4,000 characters. It is accumulated in the
bounded job prompt. The controller checks the latest attempt and reconciles its
processes before starting a new build from the retained source commit with that
feedback. The old checkout moves to `previous-checkout-*`; the old failed review
and reports remain intact. Verification, review and operator approval are all
required again. A stale or duplicate request cannot approve or restart a newer
attempt. To deliberately change the base, pass `--source-ref REF`; the controller
resolves and retains it from the same configured repository before changing the
job record. If the request cannot reconcile, its unlinked source copy is removed.
**Retry** only repeats the stopped phase and is suitable for a repaired
execution environment; retrying review cannot change the candidate.

A crashed review without a validated verdict cannot request implementation
changes. Inspect the private log and restore the missing runtime capability
before retrying. For pre-0.4.3 jobs, the controller can recognize a failed review
only from that attempt's retained `review.json`, matching the candidate and
successful check policy. Missing or mismatched evidence grants no revision action.
Do not edit SQLite, rewrite verdicts or create acceptance records to bypass this.

## Bounded diagnostics

Each attempt's private `<phase>.log` retains the first 128 KiB and last 768 KiB
of observed Docker stdout/stderr. A truncation marker identifies omitted bytes;
the footer records process exit code, signal and stream byte counts. UTF-8 is
decoded separately per pipe; interleaving reflects observed arrival order, not a
guarantee of ordering between pipes. Inspect `artifacts/<run>/executor.log` and
`result.json` for controller/adapter failures as well. Raw model logs remain
private: do not paste them into public issues without sanitizing them.

A terminal log line is diagnostic evidence, not a replacement for required
agent reports, passing checks or review. Nonzero exits and missing/malformed
reports still fail closed. Process termination during a host crash can leave
incomplete logs and an interrupted attempt; apply process reconciliation above.

Before retention, Docker stdout/stderr logs have exact selected inference
credential values replaced. Mounted reports (`agent-report.md`, `review.json`,
`incident-report.json`) are sanitized after the phase container is confirmed
absent; if shutdown is uncertain, they remain in the private attempt directory
and ordinary recovery sanitizes them after confirming the stop. Filtering
includes selected API-key, token, secret, password and credential settings plus
credential fields inside selected Codex auth JSON. Reports are opened without
following symlinks and with nonblocking access before descriptor type checks, so
special files such as FIFOs are refused promptly. An unsafe or oversized report
cannot be promoted. If filtering cannot complete, recovery retains the selected
inference file and active fence; a repeated recovery remains blocked until the
fixed owned report can be safely filtered. Once process and container shutdown
are confirmed, repair or replace that report and retry ordinary recovery so it
can sanitize the output before removing the selected file and fence. This
bounded filter does not detect encoded or transformed values and does not
rewrite candidate files or patches; it is not a general data loss prevention
control.

## Recorded execution profiles

Before each attempt executes, the controller freezes its effective configuration
and resolves the Docker image tag to an immutable image ID. The private
`<run>/execution-config.json` is mode 0600 and is not a dashboard artifact. Its
command can contain private operator configuration; preserve it only in private
backups. The inference environment remains private and is never exported.

The allowlisted `artifacts/<run>/execution.json`, measurement and dashboard
agree on executor, requested model, controller version, immutable image and
policy hash. This hash fingerprints the effective runtime configuration JSON; it
is not the SHA-256 of the mounted `policy.md` file. Verification and handoff are deterministic and have no model;
handoff has no job container. Mock executions also have no model; arbitrary
custom commands have unknown model selection rather than a fabricated provider
default. Only supported Codex/Pi profiles record a configured model request.
A requested model is configuration, not independent
proof of the model/provider that served inference. Changing the installation's
profile affects subsequent attempts, never the recorded history. A changed
check/review policy still invalidates acceptance of earlier proof.

Attempts made before this metadata existed display **Not recorded
(legacy/unknown)**. Do not copy today's profile onto them. For an investigation,
compare the retained per-attempt measurement, logs, candidate/check/review hashes
and any contemporaneous private configuration backup. Record only corroborated
facts in a separate private incident note with evidence paths and unknowns; leave
the original queue/evidence unchanged. Without that evidence, model/image facts
cannot be reconstructed reliably.

### Legacy source records

Jobs admitted before source retention keep their historical candidate and review
evidence without an invented admission-time SHA. A complete existing candidate
can still pass the normal current candidate, policy, review and approval guards;
the handoff labels its source **Not recorded (legacy/unknown)**. An unpinned
queued job is blocked on controller restart, and an unpinned job cannot retry or
request implementation changes. Submit a replacement job to capture the
configured or explicit source ref before execution. Do not reconstruct proof
from the current checkout, issue text or a later ref value.

If a retained store is missing or corrupt, retry and revision stop with an
explicit source error. Restore the private state backup containing that job's
retained Git objects, or submit a replacement from a source ref that still
resolves. The controller never substitutes the mutable configured checkout.

### Interrupted image selection or controller startup

`installation.lock` serializes image changes with controller startup, including
managed boot/restarts. A live supervisor then prevents image changes while work
can run. If an operation is interrupted, preserve the lock and inspect its PID
and action. Remove it only after confirming that process and its image build or
startup have stopped, then run `doctor` and reconcile image metadata before
starting again. The CLI does not automatically clear an unknown lock.

## Unconfirmed repository issue creation

Use `issue submissions` and `issue recover --key REQUEST_ID` against the same
controller state. Recovery reads the original provider using the original
identity; it does not publish again. Do not use a new request key to retry an
uncertain write. See [provider ownership and recovery limits](integrations.md).

## Trusted PR delivery

Delivery is available only for an accepted software job with current source,
candidate, check, independent review and approval records. Trusted publication
also requires matching private per-run execution records: native Codex/Pi for
build and review, deterministic verification and handoff, and explicitly
non-synthetic bound candidate/check/review artifacts. Missing, unknown,
synthetic or inconsistent evidence is not publication proof. Status, CLI, API
and dashboard use the same guard. The private operator configuration pins the
GitHub repository and target; task text and worker reports cannot provide
either. The controller stores the intent and remote branch/PR identifiers in
the job row before it writes. Status and task details show the receipt
separately from integration or deployment.

Inspect the same installation before recovery:

```sh
software-defence-factory status --state /private/state/project
software-defence-factory publish JOB_ID --state /private/state/project
```

After a lost response or controller restart, repeat `publish`. The controller
reads the exact configured target, generated branch and PR before attempting a
missing stage. A matching branch/PR is reused; a different remote head, target,
repository or collision is preserved and blocks recovery. It never force-pushes,
rebases, creates a second PR to avoid an uncertain response, or merges. Restore
the original trusted repository/target configuration if it changed; do not
redirect a saved intent.

Before any new content, branch or PR write, a saved intent is rechecked against
the protected run profiles and linked artifacts. A mock/synthetic record cannot
authorize a new write on retry. A known receipt or PR-creation checkpoint can
still use read-only provider reconciliation; if that cannot establish the
existing effect, the uncertain record remains blocked from further writes.

Before advertising or attempting a new write, status and the shared publisher
qualify the exact accepted Git trees again. Factory reads the immutable admitted
base commit and reconstructs the accepted candidate tree from the protected,
digest-bound patch. Added, changed, deleted or symlinked
`.github/workflows/*.yml` and `*.yaml` definitions block trusted publication.
Every base workflow must parse with the bundled YAML parser and use the
supported literal `push`, `pull_request`, `pull_request_target` or
`workflow_dispatch` trigger subset; dispatch inputs and other events such as
`workflow_run` or `workflow_call` are unsupported. A manual dispatch is
evaluated with the generated branch as its selected ref, as GitHub permits
dispatching a workflow against a selected branch ([manual workflow runs](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/manually-run-a-workflow)).
Any declared PR activity type is treated as potentially active for that
candidate PR. Branch filters are interpreted only when their patterns contain
ASCII letters, digits, `.`, `_`, `-` or `/`; exact literals are checked against
the generated branch and configured target. Other patterns are treated as
possible matches. This includes `*`, `**`, `?`, `+`, `[]`, `!` and escaped
characters from GitHub's [filter syntax](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax#filter-pattern-cheat-sheet).
Path filters are also treated as possible matches.

Conditions support only `&&`-joined `==`/`!=` comparisons against quoted
strings using `github.ref`, `github.event_name`, `github.head_ref`,
`github.base_ref` or `vars.NAME`; `||`, functions and other contexts are
refused. Supported ASCII string comparisons follow GitHub's case-insensitive
[expression semantics](https://docs.github.com/en/actions/reference/workflows-and-actions/expressions).
Non-ASCII mismatches stay unknown rather than guessing Unicode case folding.
For `pull_request`, `github.ref` stays unknown because the future merge ref
cannot be established from a guessed PR number. Unknown comparisons cannot
prove a privileged job inactive. Dynamic permissions, malformed YAML and
ambiguous guards block publication with a reason while leaving patch delivery
available.

Each job that could run for the generated branch push, a branch-selected
manual dispatch or a PR event must have explicit effective permissions limited
to `contents: read` or `none`, a known GitHub-hosted runner, and no secret
context, protected environment, reusable workflow call, OIDC permission or
deployment permission. A privileged release job can qualify only when a simple
literal conjunction proves it cannot run for each matching event. The current
`ci.yml` main-only release guard is supported. Before any content, branch or PR
write, the existing provider readback still confirms that the configured
target commit and tree are the exact accepted base. Active jobs must use one of
the supported literal runner labels (`ubuntu-latest`,
`ubuntu-22.04`, `ubuntu-24.04`, `ubuntu-26.04`, `windows-latest`,
`windows-2022`, `windows-2025`, `macos-latest`, `macos-14`, `macos-15` or
`macos-26`). External action steps must be local or pinned to an immutable
commit SHA or container digest.

This bounded check does not establish that all CI is safe. It does not inspect
repository/organization rules, webhooks, external CI or other organization
automation, nor does it audit the behavior of referenced third-party actions.
Unsupported cases refuse trusted publication and leave normal local checks,
review, approval and manual patch delivery available.

After publication is confirmed, readback follows the saved PR identity and
records its current open draft/ready, closed or merged state and checks. This
read-only refresh does not require the source branch to remain after closure or
the PR base commit to equal today's target commit. It still checks the saved
repository, target and branch names, PR head, and accepted delivery commit's
tree and parent. A changed identity or candidate stays a visible conflict; a
provider outage retains the last known publication receipt. First publication
continues to require the accepted current base and an open draft PR.

The dashboard offers reconciliation for saved `intent`, `publishing`,
`uncertain` and safely retryable `blocked` checkpoints. Legacy accepted jobs
without candidate-bound check, review and approval evidence are labelled
unverified and cannot be published. Deleting an issue with any unconfirmed
delivery record is blocked in the dashboard and controller API; inspect or
reconcile the saved remote effect before removing the job. A confirmed
`published` receipt is no longer unresolved.

The shared capability advertises new publication only with ready evidence and
no saved delivery or a known resumable write state. A branch-only `conflict`
has no publish action; inspect it and use explicit local abandonment only
after the exact branch head and absence of an associated PR are confirmed.
Conflicts with a saved PR receipt and pending PR-creation checkpoints retain a
read-only reconciliation action. Unknown and abandoned delivery states cannot
advertise or start publication.

The shared delivery status marks each available PR action as `publish` or
`reconcile`; task details use that mode for idle and pending button wording.
While a request is pending, publication shows “Publishing…” and read-only
recovery shows “Reconciling…”. A conflicted record with a saved PR receipt
therefore stays visibly a readback action.

A collision found while the record is still at `intent` is known to precede
provider writes. Inspect the exact branch in GitHub, then use the task action
**Abandon local delivery; keep remote branch**, or confirm its current head with
the CLI:

```sh
software-defence-factory status --state /private/state/project
software-defence-factory abandon-delivery JOB_ID --branch-sha INSPECTED_SHA --state /private/state/project
```

The controller checks the latest run, saved delivery identity, current branch
head and exact repository/target, then confirms that no PR is attached. It
records the inspected identity and local resolution in the job row. It does not
write, update or delete the remote branch or create/accept a PR. The `abandoned`
state disables later publication and permits local issue removal while retaining
the delivery record, run history and evidence. A stale or changed branch, any
associated/unknown PR, changed destination, later delivery stage or uncertain
provider effect remains blocked; reconcile or inspect it before taking another
action.

CLI publication and branch-resolution requests have a ten-minute deadline
because they can require multiple provider requests. Other CLI API requests
keep their five-second deadline. If the client reaches its deadline, inspect
`status` after the controller action finishes. Repeat `publish` to reconcile a
publication; repeat `abandon-delivery` only after inspecting the currently
reported branch identity.

The receipt reads the exact PR head's check runs and commit statuses. Raw
conclusions are retained. `success`, `skipped` and `neutral` do not make the
aggregate fail, while skipped/neutral are distinct from an executed passing
check. `pending`, `unknown`, failed and unavailable remain distinct; unknown
conclusions and incomplete pagination stay unknown. This aggregate does not
establish required-check completeness or merge authorization. A target/base,
candidate or policy change requires fresh applicable checks, review and
approval; do not edit SQLite or acceptance evidence to bypass the guard. A stale
target after branch creation leaves that unique branch for inspection and does
not open a PR. A PR does not imply integration or deployment.
