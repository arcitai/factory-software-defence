# Migrate to the native-only release

0.18 is a breaking change on the canonical package's explicit npm `next` tag.
The former package's `latest` remains on the earlier line while installations
migrate deliberately.
The native-only package does not contain the old controller, SQLite queue,
Docker/Pi executor, workflow/model editors, custom updater or delivery engine.

The canonical npm name is `factory-software-defence`. The former
`software-defence-factory` package and global `factory` command are separate from
the new package; use the [explicit global package switch](npm.md#switch-global-package-names)
only after confirming the old service runs from its retained pin. The source
CLI file path and private state/writer-lock paths keep their older names for
compatibility. Do not rename them or copy login/history during this switch.

## Preserve before changing

1. Reconcile every old installation: active jobs, processes/containers, state,
   services, timers, source work and release versions. Finish or explicitly
   reconcile work before replacement; do not destroy a healthy active job.
2. Save private state/database backups and verify them. Preserve workspaces,
   results, private configuration and the old package/unit definitions outside
   the current source. Keep credentials private; do not copy them into reports.
3. Disable the old automatic updater and obsolete service/tunnel registrations
   deliberately so they cannot restart or change the new installation.
4. Keep unrelated application projects and personal model services unchanged.

Old SQLite records are historical evidence, not new native Codex threads. They
are not imported as queued work. The old implementation remains available in Git
tags/releases for recovery, not as a fallback hidden inside the active product.

## Qualify and switch

Prepare a new native environment using [setup](setup.md). An existing 0.17 native
pilot can retain its private Codex home, login, receipts and thread identities.
Compare the packaged ADLC catalog before adopting changed skills; preserve prior
files and hashes. Do not copy personal auth or silently broaden native permissions.

Qualify a small real issue, explicit continuation, result visibility, duplicate
rejection, effective sandbox and independent review. Then install the pinned
native service on the selected stable port and check the operator's SSH tunnel.
Verify actual service enablement and an idle restart. A reboot claim needs an
observed reboot, not just a generated unit file.

Retain a private installation record with release/package hashes, preserved
history locations, service identity and tested/untested limits. Roll back only
with a verified idle owner and explicit old-state selection; never point the old
runtime at native state or let both write the same workspace.

For native session visibility and context boundaries, see [setup](setup.md#native-codex-session-visibility).
