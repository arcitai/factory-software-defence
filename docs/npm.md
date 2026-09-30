# Packages and releases

The npm package is `software-defence-factory`; both `factory` and the compatibility
executable `software-defence-factory` invoke it. Use the explicit package/version
when another tool already owns the `factory` command.

```sh
npm install --global software-defence-factory@next
factory --version
factory runtime --state /absolute/private/factory-state
```

`npm exec --package=software-defence-factory@next -- factory help` is convenient
for occasional use. A long-running service pins an installed package and the
chosen Node binary; it must not run from an editable source checkout or depend on
an npx cache being retained.

## Check a selected channel

```sh
factory updates check --channel next
```

Choose `next` or `latest` explicitly. The command reads public npm metadata and
compares it with **the CLI package executing the check**, not the pinned running
service. Use `factory service status --state PATH` to inspect that service's
version separately. A global npm upgrade does not activate a service release.

The JSON result distinguishes `newer`, `current` and `older`. An older channel is
never an upgrade: `latest` remains 0.17 while native 0.18 is on `next`. A different
0.x minor line requires deliberate migration. A successful lookup exits zero,
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
`factory runtime` reports the CLI entrypoint. A version-pinned package can be used
instead of the global installation. Keep the chosen channel explicit. This unit
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

0.18 uses `next` so old auto-updaters following `latest` do not silently activate a
breaking migration. Disable those old updaters before local adoption. There is no
Factory scheduler or replacement background update daemon in this release.

Inspect a new release and compare native requirements and staged skills. Preserve
the previous pinned package/state, reconcile idle work through the owning bridge,
then perform the supported service replacement and verify readiness/history/UI.
Keep access/profile changes explicit. An npm upgrade alone does not change a
pinned running service. See [migration](migration.md) and [recovery](recovery.md).

The optional timer above checks only. Unattended activation remains deferred
until safe maintenance and rollback are qualified.
Do not describe a manual update procedure as an automatic updater.

## Repository delivery

Build the dashboard, run the locked checks, review the exact candidate, and use a
protected PR. CI checks Node22/24. When enabled, the main-branch release job publishes
a new package version through npm's configured trusted publisher. `publishConfig.tag`
selects the channel; package and lockfile versions must agree. Verify the published
bytes, release notes and installed artifact before claiming adoption.

Required licensing notices stay in the tarball. Private receipts, native login,
execution history and raw evidence never belong in a release package.
