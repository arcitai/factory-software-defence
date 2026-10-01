# Packages and releases

The npm package is `factory-software-defence`. It provides `factory` and
`factory-software-defence`; `software-defence-factory` remains an explicit
executable alias for existing scripts. All three invoke the same bundled CLI.
Use the explicit package/version when another tool owns `factory`.
The canonical 0.18.4 package is a source candidate until reviewed publication;
the former package's 0.18.4 candidate was never published.

```sh
npm install --global factory-software-defence@next
factory --version
factory runtime --state /absolute/private/factory-state
```

`npm exec --package=factory-software-defence@next -- factory help` is convenient
for occasional use. A long-running service pins an installed package and the
chosen Node binary; it must not run from an editable source checkout or depend on
an npx cache being retained.

## Switch global package names

An older global `software-defence-factory` install can own the same `factory`
command. After confirming that any running service uses its pinned copy and
recording the old installation for recovery, switch the global command deliberately:

```sh
npm uninstall --global software-defence-factory
npm install --global factory-software-defence@next
```

The uninstall affects the old global npm command, not the pinned service runtime,
private state, Codex home, credentials or history. Do not remove a service pin or
run login as part of the rename. Qualify the new installed package before changing
the service. Do not use `--force` to resolve a global command collision.

## Check a selected channel

```sh
factory updates check --channel next
```

Choose `next` or `latest` explicitly. The command reads public metadata for
`factory-software-defence` and compares it with **the CLI package executing the
check**, not the pinned running
service. Use `factory service status --state PATH` to inspect that service's
version separately. A global npm upgrade does not activate a service release.

The JSON result distinguishes `newer`, `current` and `older`. An older channel is
never an upgrade. The former package's `latest` 0.17 and `next` 0.18.3 tags do not
define the new package's channels. A missing new-package tag is unavailable, not
a reason to query or install the former package. A different 0.x minor line
requires deliberate migration. A successful lookup exits zero,
including when a newer release exists; unavailable, oversized or invalid metadata
exits nonzero and means availability is unknown. Metadata is not package integrity,
provenance, review or compatibility proof.

Checking requires no Factory state, GitHub/Codex login or npm credentials. It does
not download, install or activate a release, touch native history, or call a model.

## Optional Linux release-check timer

Use the OS for periodic checking. After selecting an installed release that
supports the command, create the following **new** files in your user systemd
directory (`$XDG_CONFIG_HOME/systemd/user`, normally `~/.config/systemd/user`).
Inspect existing files first; do not overwrite another operator's units.

`factory-release-check.service`:

```ini
[Unit]
Description=Check the selected Factory release channel

[Service]
Type=oneshot
ExecStart="/absolute/node" "/absolute/installed/package/bin/software-defence-factory.mjs" updates check --channel next
TimeoutStartSec=30
UMask=0077
NoNewPrivileges=true
```

Replace both executable paths with the selected Node and installed package paths;
`factory runtime` reports the package directory as `entrypoint`; append
`/bin/software-defence-factory.mjs` for the script path and confirm
`source_checkout` is false. A version-pinned package can be used instead of the
global installation. Keep the chosen channel explicit. This unit
only reads metadata; it never invokes `npm install` or `factory service restart`.

`factory-release-check.timer`:

```ini
[Unit]
Description=Daily Factory release check

[Timer]
OnCalendar=daily
RandomizedDelaySec=15m
Persistent=true

[Install]
WantedBy=timers.target
```

Validate both files, run one actual lookup, inspect its result, then opt in:

```sh
systemd-analyze --user verify /absolute/path/factory-release-check.service /absolute/path/factory-release-check.timer
systemctl --user daemon-reload
systemctl --user start factory-release-check.service
journalctl --user -u factory-release-check.service -n 20 --no-pager
systemctl --user enable --now factory-release-check.timer
systemctl --user list-timers factory-release-check.timer
```

The result and errors remain in the OS journal; this is not a dashboard alert or
an automatic updater. The user service manager must be running; boot without login
depends on the host's lingering and disk-unlock policy. `Persistent` catches up a
missed calendar check, subject to the configured random delay; it does not replay
agent work. See the [systemd timer reference](https://www.freedesktop.org/software/systemd/man/latest/systemd.timer.html).

To opt out, disable and stop `factory-release-check.timer`, then remove only the
two files you created and run `systemctl --user daemon-reload`. This does not stop
the separate Factory Inbox service or modify native credentials and history.
Other OS scheduling recipes require separate qualification. No Factory scheduler
or background loop is installed by the CLI.

## Update deliberately

0.18 uses `next` on the new package. Disable old automatic updaters before local
adoption. There is no Factory scheduler or replacement background update daemon
in this release.

Inspect and explicitly select a reviewed installed package that includes the
`service adopt` command. Invoke **that target package's CLI** with the existing
private state:

```sh
/absolute/selected/node /absolute/installed-target/bin/software-defence-factory.mjs service adopt --state /absolute/private/factory-state
```

There is no package URL, registry or download option on this command. It pins
the executing installed `factory-software-defence` package before stopping the
old service. The retained `bin/software-defence-factory.mjs` path serves both
package names so existing owned unit definitions remain verifiable. It accepts a
newer patch in the same 0.x minor line; identical bytes at the same version
return `no_op`. A legacy and canonical package at the same version have different
bytes and cannot replace each other's pin. Changed bytes at the same version,
a downgrade, a different minor line, a mutable checkout, an unowned unit, busy
or unknown native work,
and uncertain service ownership are refused. A different minor line needs an
explicit migration policy, not this command. The existing Node, port, unit,
repository, Codex setup, credentials, receipts and native history remain selected.

Adoption holds admissions, replaces the owned unit, reconnects to its new bridge
and requires native readiness. A failed target may restore the previous verified
service only after the new process is reconciled idle or stopped. Results use
`adopted`, `no_op`, `adoption_failed` with an explicit rollback disposition, or
`unresolved`; failures exit nonzero. The prior package must declare startup admission gating; older packages such as
0.18.3 need an explicit one-off migration before this command can be used. The
new private gate is published before old-owner preparation, so an automatic
restart cannot reopen admission while adoption is pending. The old pin and
private operation evidence are retained. An unresolved operation requires [manual reconciliation](recovery.md#service-adoption)
before another service change. A healthy process alone is insufficient.

An npm upgrade alone does not change a pinned service. Compare native
requirements and staged skills before selecting the target; access/profile
changes still require separate qualification. Review installed history and UI
after a successful adoption. This command does not approve a release, run an
update check, change native permissions or replay agent work. Source support
remains a candidate until a reviewed package is published and installed.

The optional timer above checks only. An opt-in OS download/check/activation
recipe remains a separate qualification slice; this command is a deliberate
activation primitive, not automatic updating.
Do not describe a manual update procedure as an automatic updater.

## Repository delivery

Build the dashboard, run the locked checks, review the exact candidate, and use a
protected PR. CI checks Node22/24. When enabled, the main-branch release job publishes
a new package version through npm's configured trusted publisher. `publishConfig.tag`
selects the channel; package and lockfile versions must agree. Verify the published
bytes, release notes and installed artifact before claiming adoption.

Required licensing notices stay in the tarball. Private receipts, native login,
execution history and raw evidence never belong in a release package.
