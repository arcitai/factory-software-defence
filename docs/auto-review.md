# Native Codex Auto-review

Auto-review lets Codex review eligible action approvals. The native harness
owns the decision; Factory does not approve requests or retry denied actions.
Project checks, independent code review and authorized delivery still apply.

Existing installations retain `never`: actions must fit the selected sandbox,
and requests for more authority are refused. To select Auto-review at setup:

```sh
factory setup --repo /absolute/project --state /absolute/private/factory-state \
  --approvals auto-review
factory login --state /absolute/private/factory-state
factory doctor --state /absolute/private/factory-state
```

For an existing installation, finish or reconcile its native work, stop its
Factory service, then select the mode explicitly:

```sh
factory service stop --state /absolute/private/factory-state
factory approvals auto-review --state /absolute/private/factory-state
factory service start --state /absolute/private/factory-state
```

The command refuses a running bridge or active/unresolved workspace. It preserves
the existing profile and native history, backs up the two configuration files,
and checks the changed effective configuration. A failed check restores the
previous files. The backup directory is printed before the first configuration
write. Use `factory approvals never --state PATH` with the service
stopped to return to the previous approval behavior. A crash between file writes
leaves a hash mismatch and blocks admission. With the service stopped, select
the backup for that change under `STATE/approval-backups/` and copy its
`config.toml` to `STATE/home/.codex/config.toml` and its `native.json` to
`STATE/native.json`, retaining private file permissions. Run doctor before
restarting. Do not discard job receipts. Returning to `never` can check the
configuration with an expired login; subsequent work still requires login.

The selection uses native `on-request` and `auto_review` on start, continuation
and reconnect. It retains Factory's filesystem/network policy and excludes
personal apps, MCP and plugins. A native refusal or managed restriction is never
replaced by full access or a Factory approval. A reviewer mismatch blocks work.
The currently qualified account path is native ChatGPT sign-in. Doctor checks
configuration, not entitlement, model execution or successful action review;
qualify an installed candidate with a disposable task before relying on it.

## Observe and recover

The issue result shows the latest bounded action-review observations from the
current bridge connection, correlated to the native thread, turn and review.
The displayed mode belongs to the recorded turn. Reconnecting after a mode
change starts no new turn and does not rewrite that historical selection.
It distinguishes approval, denial, timeout, interruption and unknown outcome.
Approval is not proof that the command executed or that the task is accepted.
Raw commands, tool arguments and review rationale stay in native history.

A bridge restart does not reconstruct decisions from silence. The panel then
has no observations for earlier work; an interrupted live review is unknown.
Factory does not automatically retry actions or start another turn. Unsupported
manual requests are refused and the native turn is interrupted. Inspect the
recorded session and reconcile its result before explicitly continuing it.

If the owner must decide, use the selected native chat and describe the exact
action, native reason and consequence. Codex's `/approve` flow can select a
recent denied action for one retry in its original context. Factory has no
approval button and never manufactures approval markers from issue text or
agent output. A chat reply is not automatically forwarded to another session.
The host/mobile Agent Ops route remains separately qualified under #143.

Native permission-review usage is separate from coding and independent review.
Factory displays the provider's reported limits without subtracting an inferred
free allowance. See [usage](usage.md), OpenAI's [Auto-review guidance](https://learn.chatgpt.com/docs/sandboxing/auto-review)
and [research](https://alignment.openai.com/auto-review/).
