# Persistent controllers and remote dashboards

For the complete host-to-application sequence and reboot checklist, start with
[the setup plan](setup.md). Install the npm CLI first. A Factory controller is a Linux systemd **user**
service; SSH tunnels support Linux systemd and macOS launchd. Neither needs a
root controller. macOS can still run a local controller with `up`.

## Linux controller

Configure and install a runtime using the [quickstart](quickstart.md), then:

```sh
factory stop --state /absolute/private/state
factory service install --state /absolute/private/state
factory service status --state /absolute/private/state
```

Installation enables and starts exactly this controller. It does not submit a
new task. Existing queued jobs will execute when any controller starts; inspect
the queue before adopting an installation. Interrupted attempts still require
the normal explicit reconciliation/retry. To keep a product paused, leave its
controller stopped and do not install a service for it.

The current user must have Docker access; Docker itself must be enabled at boot.
The CLI records the current PATH, Node executable and private state/data homes.
The launcher and installed runtime are retained outside the npm/npx cache.
Removing a Node installation referenced by the service still breaks startup:
reinstall the service using the intended Node executable after stopping it.
No credentials are copied into the unit or job containers.
Each service uses an immutable launcher for its installation version. Installing
another controller or enabling a timer cannot rewrite an existing launcher's
base. An explicit managed update controls subsequent release selection in
`service-release.json`. The separate ordinary CLI `updates.json` preference
cannot move an existing service to another release, even while all services
are stopped.

If Docker group membership was added after the user service manager started,
an SSH shell may have access while user services still get permission denied.
Refresh the login session at a suitable time, or install with the explicit
`service install --group docker --state PATH` option. This uses `sg` or a
command-capable util-linux `newgrp` to apply a group the user **already belongs
to**. It grants no new membership, needs no sudo and keeps the controller's user
identity. The group launcher is checked for support before installation.

For boot **without logging in**, an administrator must enable user lingering:

```sh
sudo loginctl enable-linger USERNAME
```

`service status` reports lingering, boot versus login startup, service enablement
and actual HTTP health separately. The CLI never silently grants sudo access or
changes system-wide Docker, firewall or login configuration. Systemd retries
startup every 15 seconds if Docker or the configured image is unavailable.

```sh
factory service stop --state /absolute/private/state
factory service start --state /absolute/private/state
factory service restart --state /absolute/private/state
factory service logs --state /absolute/private/state
factory service uninstall --state /absolute/private/state
```

`up` and `stop` detect a managed installation and use its service manager, so a
stop does not immediately respawn a second controller. An explicit stop/restart
may interrupt a job; use it deliberately. `stop` leaves boot enablement in place.
`uninstall` disables and removes only the registered service definition. It
preserves the database, credentials, artifacts, retained runtimes and history.
Repeated installation/removal is safe. Edited/unregistered service definitions
are refused rather than overwritten. Bare `service` (or `service print`) retains
the original print-only systemd-unit interface.

## Persistent SSH tunnel on the client

First establish key authentication and a verified host key using normal SSH.
The remote dashboard must bind to loopback and the machines must be reachable
(for example through an existing private VPN). Use a configured SSH alias:

```sh
factory tunnel install --host worker --port 7345
factory tunnel status --host worker --port 7345
factory tunnel logs --host worker --port 7345
factory tunnel stop --host worker --port 7345
factory tunnel start --host worker --port 7345
factory tunnel uninstall --host worker --port 7345
```

Visit `http://127.0.0.1:7345`. The local and remote ports are intentionally equal
to preserve the dashboard's Host/Origin protection. The tunnel uses only
loopback addresses, strict host-key checking and noninteractive authentication.
It exits on forwarding failure, detects dead connections and restarts through
the OS service manager. It never disables SSH checks or requests a password.
Stop an existing manual tunnel before installation; occupied ports are refused.

On macOS this is a LaunchAgent: it starts at **login**, not before FileVault is
unlocked. On Linux, lingering determines boot versus login startup. A sleeping
or offline peer is still unavailable; the tunnel reconnects when connectivity
returns. Tailscale/SSH/system power configuration remains machine infrastructure,
not a Factory network dependency. No root LaunchDaemon is installed.

## Updating an always-running controller

```sh
factory service update
factory service updates --auto on
factory service updates --auto status
factory service updates --auto off
```

`service update` manages all registered controllers for the current user. It
refuses unmanaged live controllers or unresolved executor fences. Every running
controller must atomically accept an idle maintenance reservation: queued work,
an active phase or a concurrent action defers the update. A reservation blocks
new tasks and actions and persists across restarts until explicitly released.
Downloads are immutable. Only the previously running managed controllers are
stopped and restarted; intentionally stopped projects stay stopped. HTTP health
must recover. A failed release startup restores the prior selection and starts
the old services before releasing maintenance. Images and application code are
never rebuilt or silently changed by this operation.
Lifecycle changes and updates share an exclusive operation lock. Concurrent
start/stop/install/uninstall commands fail clearly rather than undoing an update
or an operator's stop. A managed installation refuses ordinary foreground
`serve`; operate it through `service start`. Stop also checks for a remaining
controller outside the service before reporting success. Restart health must
report the expected runtime version, including during rollback.

The opt-in Linux timer checks daily, including a catch-up after downtime, with
up to one hour of random delay. A busy/unavailable installation causes a failed
attempt and remains unchanged; the next scheduled invocation retries. Inspect
`journalctl --user -u software-defence-factory-update.service`. This timer is
separate from `update --auto on|off`, which controls ordinary CLI invocations.
Remove the timer with `service updates --auto off` when retiring this setup.

## Recovery and proof limits

If a service operation is killed or the machine loses power, inspect
`STATE_HOME/software-defence-factory/service-update.lock`, its PID and the
service logs. The lock records the owning PID and action. Do not remove a lock belonging to a live or unknown process.
After confirming the updater stopped, remove that stale lock, inspect the
selected release and start/verify each prior service. Then release each remaining
reservation using `service resume --state PATH`. There is no automatic timeout
that might reopen a queue while an updater is still working.

If a generated service was edited outside the CLI, preserve the edit and
reconcile its recorded definition before using lifecycle commands. A service
health failure leaves installation and logs in place for diagnosis. Keep the
prior release, private state and pinned image; see [recovery](recovery.md).

Service enablement and process-restart tests are not proof of a full machine
reboot, pre-login disk availability or connectivity across two physical networks.
Record those observations separately. A healthy dashboard proves neither model
quality nor that a product agent should start.

References: [systemd service semantics](https://www.freedesktop.org/software/systemd/man/latest/systemd.service.html),
[loginctl lingering](https://www.freedesktop.org/software/systemd/man/latest/loginctl.html),
[Apple launchd definitions](https://github.com/apple-oss-distributions/launchd/blob/main/man/launchd.plist.5).
