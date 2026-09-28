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
