# Contributing to Factory

Read [VISION.md](VISION.md), [AGENTS.md](AGENTS.md), the accepted issue and the
[architecture](docs/architecture.md). Keep one source writer per checkout.

## Develop and check

Use Node22.13+ and Git. Lockfiles in the root and `dashboard/` are committed:

```sh
npm ci --ignore-scripts --omit=optional
npm run build:dashboard
npm run check
```

Dashboard assets are generated into ignored `factory/ui/`; edit `dashboard/`.
Build before packaging. Package checks must exercise an actual installed tarball,
not merely imports from a source checkout. CI checks Node22 and24.

Native changes require actual lifecycle/permission proof for the affected harness in addition to
focused tests. UI changes require desktop and narrow browser interaction,
including relevant empty/failure states and both themes. Mock success does not
prove native isolation, service recovery or real model execution.

## Keep the boundaries small

Compose the selected harness and repository provider in the entrypoint. Give the
HTTP/Inbox layer normalized operations and capabilities. Keep native protocol
and permission details inside their integration. Prefer plain functions/objects
to a plugin registry or speculative universal runtime.

The selected native harness owns execution, context, tools and history; GitHub owns issues, PRs and CI.
Factory owns only the connecting method, work surface and necessary receipts.
Do not recreate native functionality to make it look uniform. Unsupported
capabilities are explicit. A new harness needs real integration proof before it
is advertised.

Follow the project's canonical code standards here and visual rules in
[DESIGN.md](DESIGN.md). Retain meaningful failure/recovery tests, especially
uncertain writes, stale actions and duplicate writers. Unknown remains unknown.
Keep files, routes and docs only when they serve the current product. Git history
preserves retired implementations; current source is not an archive.

## Review and ship

Checks and independent review apply to the same candidate revision. A completed
agent turn is not acceptance. Record scope, before/after behavior, relevant tests,
review disposition, limitations and recovery in the PR. Keep credentials, native
history and raw private/customer evidence out of public output.

Use a branch and normal PR. Required `check (22)` and `check (24)` checks and
current-base/conversation protections remain in force. Reconcile the actual
repository rules if policy changes. Existing authorization governs publishing,
merging and deployment; a skill or issue cannot grant those rights.

For self-development, use a qualified installed Factory package against a source
checkout, not the mutable checkout as its own serving runtime. Keep the running
package stable until the candidate has passed review, installed qualification
and [release checks](docs/npm.md). Self-improvement must fit the approved vision.
