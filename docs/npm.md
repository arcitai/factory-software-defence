# Install and update the CLI

Requires Node 22.13 or later. The method export needs no Docker. Running jobs
also requires Git and a running Docker Engine or Docker Desktop on Linux/macOS.

```sh
npm install --global software-defence-factory@latest
factory help
```

For a one-off invocation:

```sh
npm exec --package=software-defence-factory@latest -- factory help
```

Both commands use the same package. A development checkout is unnecessary.
Use `factory kit --output /new/staging/directory` to export the portable
method. It refuses an existing destination and does not modify an app. Use
`factory init --repo /path/to/app --harness codex --check "npm ci && npm test"`
only when configuring the optional local job runner. `init` does not start jobs,
copy skills into the app, or copy account credentials. Runtime jobs receive the
bundled policy and skills directly. Model access is configured separately.

## Executable and package compatibility

Starting with 0.11.1, `factory` and `software-defence-factory` are bin aliases
for `bin/software-defence-factory.mjs`. They share one runtime, state and updater.
The npm package is still `software-defence-factory`, published by Arcitai from
`arcitai/software-and-defence-factory`. Release qualification is tracked in
[#61](https://github.com/arcitai/software-and-defence-factory/issues/61) and its linked delivery PRs.

An older global bootstrap upgraded through the private release cache keeps
working through `software-defence-factory`, including offline cached dispatch.
It does **not** gain a global `factory` symlink. To expose both bins with
0.11.1 or later, stop and reconcile installations, check `command -v factory`, then run
`npm install --global software-defence-factory@latest`.
If that name belongs to another tool, keep the compatibility executable or use
`npm exec --package=software-defence-factory@latest -- factory ...`. Do not use
`--force` to replace another program. npm refuses a conflicting unrelated bin.
Both bin keys point to the same file; tarball tests cover explicit executable
selection through npm exec and npx. The syntax above avoids relying
on package-name inference. Never use `npx factory` or `npm install factory` for
this product.

The selected successor package is `factory-sd`, but account/OIDC prerequisites
and namespace cutover remain pending under [#61](https://github.com/arcitai/software-and-defence-factory/issues/61).
The issue records `factory` as owned by another project and `factory-sd` as a
registry 404 on 2026-09-26; availability is not a reservation. Before cutover,
verify replacement publishing trust, package/updater identity, Actions references,
redirects and an explicit idle/recoverable upgrade route. Reconcile ambiguous
external-write receipts without replaying them under a renamed repository.

## Persistent data

The npm CLI stores private runtime data under
`${XDG_STATE_HOME:-$HOME/.local/state}/software-defence-factory/platform`.
The synthetic demo uses `demo-platform` beside it. `--state /absolute/path`
selects another installation, allowing separate projects and ports. The CLI
prints the selected path. State never lives inside an installed npm package,
the npx cache, or your application repository.

Source checkouts retain their existing `.factory/platform` and
`.factory/demo-platform` defaults. Stop the old controller before moving an
existing state directory. Update its `factory.json` repository path if necessary;
retain existing jobs, configuration and evidence. Branding requires no state move
or migration. State/service/tunnel names, configured image IDs, update keys and
historical policy/record hashes remain unchanged.

## Automatic updates

An npm-installed CLI checks npm's `latest` stable release at most once a day
when invoked. It downloads and activates a newer release when all registered
installations are stopped and no executor requires reconciliation. It does not
run a background updater or interrupt a job. Routine `status`, `stop`, `cancel`,
`serve`, service/tunnel management, help and version commands do not initiate automatic downloads.

For an always-running Linux installation, opt into the separate managed daily
timer with `service updates --auto on`. It reserves idle controllers, updates
and restores their prior running set without interrupting a job. See
[services](services.md) for installation, maintenance recovery and limitations.

```sh
factory update --check
factory update
factory update --auto off
factory update --auto on
```

Updates use npm with lifecycle scripts disabled and retain immutable releases
under `${XDG_DATA_HOME:-$HOME/.local/share}/software-defence-factory/releases`. Failed or
offline downloads retain the working version. Private state, model credentials,
jobs and history are preserved. Existing processes keep their original code.
Set `SDF_AUTO_UPDATE=0` to skip automatic network checks for a command.
Source checkouts remain managed by Git and do not update themselves.

The exact selected release is downloaded with npm's `--prefer-online` metadata
refresh and `--prefer-offline=false`; this does not change account settings.
An `ETARGET` visibility failure
gets at most three attempts, separated by one second, within the same total
120-second download budget (including waits). Offline, authentication and package
identity errors are not retried by Factory. A successful download must match the
requested package name, version and CLI entry before immutable adoption. Exhaustion
cleans only that download's staging directory and retains the selected runtime,
configuration and job history. Managed updates release their idle reservations on
download failure; normal reservation/recovery rules in [services](services.md)
still apply. The retries add no extra download maintenance budget.

CLI updates do not rebuild or update Docker images automatically. Stop the
installation and run `install --state PATH` when intentionally adopting a new
runtime image; repeat the relevant qualification before resuming jobs. Install retains the old and new
image IDs under `software-defence-factory-retained` tags, so another installation
rebuilding the shared tag cannot remove an existing installation's pinned image.
These retained images are recovery data; remove them only after confirming no
installation or retained attempt needs them.

## Protected evidence compatibility

Factory 0.15.1 recognizes version-1 execution profiles emitted by native
**0.8.0, 0.9.0, 0.9.1, 0.10.0, 0.11.0, 0.11.1, 0.11.2, 0.12.0, 0.13.0, 0.13.1, 0.14.0, 0.15.0 and 0.15.1**. This is an exact allowlist in
`factory/execution-profile.mjs`, independent of the installed package version;
it is not a semver range or an automatic promise for later releases. Unknown
runtime strings, unknown profile formats and incomplete legacy acceptance
remain unverified or blocked. New profiles still record the actual emitting
runtime version. Updates never relabel profiles, rewrite policy hashes,
re-approve jobs or retry old work.

Compatibility only permits interpreting the protected evidence. Publication
still requires exact protected-file/run-record equality, successful linked
phases with supported role/model provenance, the unchanged effective policy
hash, retained source and candidate/patch identity, passing checks, independent
review and bound approval. Synthetic or missing provenance cannot authorize
publication. Enabled browser verification still requires current tool, story,
candidate, attempt and retained artifact evidence; enabling or changing that
policy invalidates prior evidence. CLI, API and dashboard consume the same
delivery capability.

Before extending this list, inspect the released profile/evidence writers and
exercise both capability derivation and publication validation. Remove support
for an older writer whenever a trust-relevant format, isolation, provenance or
validation change makes its guarantees insufficient for current policy; bump
the evidence format when its meaning changes. A package version bump alone is
neither a reason to discard evidence nor proof of compatibility. Retain
unsupported records unchanged and obtain fresh applicable evidence through the
normal workflow; never repair them by editing private records or hashes.

Versions 0.11.0 and 0.11.1 use the same protected evidence writer and profile
format, with original-base, aggregate single-parent candidate/check/review/approval
guarantees. Continuation adds separate provenance; it is not acceptance evidence. The audited 0.8.0, 0.9.0 and
0.9.1 writers remain supported only when their old records meet all current
checks. For continuation specifically, the current completed review, successful
Build/Verify, protected per-attempt artifacts, current policy and clean candidate
objects must also be present and agree. An old runtime string alone never makes
a checkpoint usable. Browser-disabled 0.8.0 records cannot satisfy a newly
enabled browser policy. Missing or unsupported records stay unchanged and
unavailable; no schema migration, profile relabeling or policy repair occurs.

Version 0.11.2 retains the v1 profile/evidence schema and current provenance
rules while preserving exact patch bytes and requiring reconstruction before
new acceptance. Older writers remain compatible only when their retained patch
passes the current digest and tree reconstruction checks. A digest-matching
malformed patch remains blocked and unchanged; follow the [recovery guidance](recovery.md#already-accepted-malformed-patches-91).

Version 0.12.0 adds the all-work Inbox read model and restores the retained
overview. Protected execution writers and acceptance/publication guards are
unchanged; the explicit compatible-writer entry preserves all checks above.

Version 0.13.0 relocates byte-identical runtime skill instructions to
`kit/skills/` and adds a read-only alias of that catalog for Codex discovery.
The audit covers `execution-profile.mjs`, `processes.mjs`, executor candidate,
check, review and acceptance writers, `execution-evidence.mjs` and both delivery
capability/validation paths. The v1 schema, candidate reconstruction, current
policy checks, isolation and model credential rules are unchanged. Foundation
is outside the job catalog. Supported old immutable evidence remains subject
to every existing guard; unknown later versions receive no automatic trust.

Version 0.13.1 changes only delivered-commit check readback and its presentation.
The same writer/validator audit above found no changes to protected v1 execution,
candidate, check, review or acceptance writers, policy binding, isolation or
credentials. The explicit 0.13.1 entry is covered by retained-profile capability
and publication validation tests; old records remain immutable and unknown
versions remain blocked. Provider check observations are separate from protected
Verify evidence and cannot authorize acceptance or publication.

Version 0.14.0 preserves the v1 writer only for unchanged inherited installations:
policy bytes, candidate/check/review/acceptance bindings, mounts and credential
rules stay compatible. Adopted role overrides use **v2 from 0.14.0, 0.15.0 and 0.15.1**, recording
role/provider/effort and an exact selection digest. The executor verifies the
frozen common configuration before phase selection; continuation and both delivery
validation paths require matching protected v2 evidence and private frozen config.
V1 cannot attest an override. Mixed roles share one policy across deterministic
and agent phases. Rollback can restore a prior policy without rewriting a record.
See the [definition contract](definition.md); installed Docker/provider qualification
remains separate from schema compatibility.

Old installed releases retain their own files and mount paths until an idle,
reviewed update. No installed catalog, execution profile or historical hash is
rewritten by this layout change. Qualify the exact updated package/image before
resuming work; retained releases/evidence stay available for recovery.

New publication still requires the current remote target to equal the original
accepted base; reviewed-candidate continuation preserves that baseline, while
target refresh remains #72. See [the verification map](https://github.com/arcitai/software-and-defence-factory/blob/main/docs/proof.md) for delivered
capabilities and the distinction between source checks and installed proof.

## Release flow

`.github/workflows/ci.yml` tests pull requests and pushes on Node 22 and 24,
including installation from the actual npm tarball. A successful `main` push
publishes an increased `package.json` version. Existing versions are skipped;
registry errors fail the release instead of masquerading as a missing version.
The workflow can also be started manually from `main`.

An accepted npm publication may still be processing. It is not yet a verified,
downloadable release: exact-version and `latest` metadata can appear at different
times, and an npm install can briefly report `ETARGET` even after both appear.
Verify an exact package download and compare its contents with the reviewed
artifact before reporting release availability. If the bounded updater reports
that the release is not yet downloadable, retain the prior runtime and retry the
update later. This does not establish whether a particular delay came from a
local cache or registry propagation.

For a release, update both manifests with `npm version patch --no-git-tag-version`,
review the change, and push through the project's normal review flow. A code
push without a version bump is tested but does not overwrite a published package.

The current trusted-publisher identity is npm package `software-defence-factory`,
GitHub owner `arcitai`, repository `software-and-defence-factory`,
workflow filename `ci.yml`. The workflow uses short-lived OIDC authentication.
The source repository is **public**, but the current workflow explicitly sets
`NPM_CONFIG_PROVENANCE=false`; OIDC authenticates publication and does not mean
this release emits npm provenance. No npm write token belongs in the repository
or agent jobs. The public npm package contains an explicit runtime/method
allowlist, excluding operational state, account data and retired research. It includes the explicitly labelled synthetic runtime fixture used by demo and qualification.

Publication requires repository variable `NPM_PUBLISH_ENABLED=true` and the
matching npm account binding. Preserve the working identity until replacement
trust is verified. Changes must pass the normal protected PR/CI flow; do not
weaken protection or bypass merge checks.
After a CLI update, restart a stopped dashboard with `up --state PATH` and refresh
the browser to load the new bundled interface. Updates do not replace the code
of a controller that is still running.

The installed native publisher refuses `.github/workflows` changes. Keep that
guard. Automated GitHub Releases, immutable tags, registry readback and recovery
after npm succeeds but Release creation fails remain a separate maintainer
delivery under [#61](https://github.com/arcitai/software-and-defence-factory/issues/61).

References: [npm/npx](https://docs.npmjs.com/cli/v11/commands/npx/),
[npm trusted publishing](https://docs.npmjs.com/trusted-publishers/).


The 0.15.0 compatibility audit preserves unchanged v1/v2 policy construction,
protected checks, candidate reconstruction, read-only review and acceptance guards.
Historical 0.14.0 v2 validation compares its actual writer version rather than
relabeling it as the installed version. Local registry selection is a new execution
contract: every phase of a local/hybrid attempt requires **v3 from 0.15.0 or 0.15.1** and its
exact protected frozen configuration. v1/v2 cannot attest local binding fields,
providers or a common policy containing a selected local role. A selected endpoint,
model, limit or compatibility change invalidates the current policy; explicit
rollback can restore it without editing historical evidence. Controlled regressions
exercise legacy v2 readback and local v3 rejection/tamper cases. Installed-package
Docker and independent Review remain delivery qualification, not inferred from this
compatibility audit.

The 0.15.1 patch changes release downloads and preserves the 0.15.0 v1/v2/v3
writers, frozen configuration and policy bytes. The explicit allowlists include
both patch versions; supported v3 readback retains the original writer version
while still comparing every execution selection, phase and policy field. It does
not rewrite historical evidence or allow v1/v2 to attest local bindings.
