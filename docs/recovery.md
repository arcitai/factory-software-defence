# Recovery

Preserve history and determine which process owns work before changing anything.
Reconnection, continuation and a fresh start are different operations.

| Observation | Action |
| --- | --- |
| Browser/tunnel closed, bridge still running | Reopen the tunnel/Inbox; inspect status. No new turn is needed. |
| Completed native turn needs revision | Continue with feedback and its current terminal turn ID. |
| Native turn running | Let it finish, or explicitly interrupt that exact turn. |
| Unknown outcome after a disconnected write | Inspect the native thread and private receipt before retrying. |
| Configuration or skill hashes changed | Preserve the changed files and reconcile the intended installation; do not bypass the check. |
| Service startup failed | Inspect the user-service journal and selected executable/package/state paths. |
| Host restarted during a turn | Reconcile native history and receipts. Startup never replays the turn. |

Use `factory status`, `factory result` and `factory reconnect` against the owning
bridge. Native Codex owns the full history. Another app-server may read persisted
history without knowing a different process's live state; that read alone cannot
authorize a competing writer or stopping the original process.

## Native Codex login recovery

For an expired or revoked login, first inspect work and the selected service:

```sh
factory status --state /absolute/private/factory-state
factory service status --state /absolute/private/factory-state
```

Keep unknown outcomes unknown. Preserve work and reconcile ownership through the
existing [service operation](#service-operation) rules; do not kill work to
repair login. Once work is idle and ownership is reconciled, run:

```sh
factory login --state /absolute/private/factory-state
factory doctor --state /absolute/private/factory-state
```

Login is native to the selected Factory Codex home; it does not replace personal
Codex login. Doctor alone does not prove live inference or token refresh. Do not
fall back to personal context or duplicate work if authentication remains
unavailable. For session visibility and account boundaries, see [setup](setup.md#native-codex-session-visibility).

A usage-limit response is different from an expired login. A valid account and a
passing doctor do not establish remaining inference capacity. Preserve the
current result and wait until native capacity is available; logging in again
is not a remedy for exhausted usage. Continue a reconciled terminal thread
explicitly when appropriate, rather than creating a replacement job or switching
accounts/providers automatically.

## Service operation

```sh
factory service status --state /absolute/private/factory-state
factory service restart --state /absolute/private/factory-state
factory service stop --state /absolute/private/factory-state
```

Normal stop/restart/removal must reconcile through the owning bridge and refuse
active or unresolved work. Maintenance blocks new admissions while that check and
shutdown complete. OS shutdown or a forced kill can still interrupt native work;
Factory does not promise seamless execution through power loss.

Service removal preserves the native state and pinned package for recovery.
Do not delete a writer/admission receipt simply to clear an error. If ownership
cannot be established, keep the files and obtain explicit operator reconciliation.

## Issue creation uncertainty

A lost GitHub response may follow a successful issue creation. Reconcile the
existing creation receipt with the provider; do not submit a second issue merely
because the browser displayed an error. Treat unresolved outcomes as unresolved.
Never log tokens or private findings in a public issue.

## Rollback and updates

Follow [migration](migration.md) and [package guidance](npm.md). Preserve the
previous pinned package and private state. Stop only an idle verified owner before
switching. Check package identity, native readiness, history and the actual Inbox
after startup. A failed update is not permission to automatically replay work.

A leftover `serve.lock.reconcile` directory means a process stopped during lock
reconciliation. Confirm the service and its native child have stopped, preserve
the directory and lock as evidence, then move that directory aside explicitly.
Factory never guesses that an unresolved reconciliation owner is safe to replace.

If an ordinary stop/restart/removal maintenance request loses its response, its
operation token is retained in private `maintenance.json`. Reconcile the same
operation or run `factory service cancel-maintenance --state PATH` to reopen
admission explicitly. An adoption with `service-adoption.json` pending follows
the stricter procedure below. A changed process instance never reuses the old
operation. Preserve unresolved `service-operation.lock` reconciliation records
just like the serving lock; do not guess that another process is inactive.

## Service adoption

Run a reviewed **installed target CLI**, not a checkout, with `factory service
adopt --state PATH` only after selecting a compatible patch release. `no_op`
means the already pinned bytes match. `adopted` means the replacement bridge
and native readiness were confirmed. `adoption_failed` with `rollback: restored`
means the earlier service was verified and restored, but the target failed; the
command exits nonzero. `unresolved` means ownership, stop/start outcome, native
work or admission state could not be proved; do not rerun adoption as a retry.

An interrupted adoption leaves private `service-adoption.json` and possibly
`maintenance.json` beside `service.json`. `factory service status --state PATH`
shows the pending phase. Preserve those files, both pinned releases, the user
unit, native writer/issue receipts and service journal before investigating.
A compatible prior or target bridge starts with admissions blocked while this
record is pending. Status reports an unreadable pending record without overwriting it.
`cancel-maintenance`, restart, remove and another adopt are refused until the
operation is explicitly reconciled; deleting the record merely to unlock a
command is unsafe. Inspect the exact systemd unit and MainPID, bridge instance,
native thread states and receipts. Never stop active or unknown work to force a
rollback. Systemd or host shutdown can still interrupt a native turn; adoption
does not replay it. Packages without the startup admission gate are refused before adoption. Their
one-off migration must prevent OS restart while reconciling the exact old owner;
preserve the unit, native state and pin. A Linux user-systemd runtime mask can
prevent restart, but it is not proof of idle native work. Reconcile ownership,
then deliberately replace the stopped service with a qualified installed package
and remove the mask only when the old unit cannot restart. Verify native
readiness and history before accepting the migration.
