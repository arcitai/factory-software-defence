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

## Update deliberately

0.18 uses `next` so old auto-updaters following `latest` do not silently activate a
breaking migration. Disable those old updaters before local adoption. There is no
Factory scheduler or replacement background update daemon in this release.

Inspect a new release and compare native requirements and staged skills. Preserve
the previous pinned package/state, reconcile idle work through the owning bridge,
then perform the supported service replacement and verify readiness/history/UI.
Keep access/profile changes explicit. An npm upgrade alone does not change a
pinned running service. See [migration](migration.md) and [recovery](recovery.md).

Automated release checking can belong to an OS service/timer, but unattended
activation remains deferred until safe maintenance and rollback are qualified.
Do not describe a manual update procedure as an automatic updater.

## Repository delivery

Build the dashboard, run the locked checks, review the exact candidate, and use a
protected PR. CI checks Node22/24. When enabled, the main-branch release job publishes
a new package version through npm's configured trusted publisher. `publishConfig.tag`
selects the channel; package and lockfile versions must agree. Verify the published
bytes, release notes and installed artifact before claiming adoption.

Required licensing notices stay in the tarball. Private receipts, native login,
execution history and raw evidence never belong in a release package.
