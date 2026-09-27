# Install and update the CLI

Requires Node 22.13 or later. The method export needs no Docker. Running jobs
also requires Git and a running Docker Engine or Docker Desktop on Linux/macOS.

```sh
npm install --global software-defence-factory
software-defence-factory help
```

For a one-off invocation:

```sh
npx software-defence-factory@latest help
```

Both commands use the same package. A development checkout is unnecessary.
Use `software-defence-factory kit --output /new/staging/directory` to export the portable
method. It refuses an existing destination and does not modify an app. Use
`software-defence-factory init --repo /path/to/app --harness codex --check "npm ci && npm test"`
only when configuring the optional local job runner. `init` does not start jobs,
copy skills into the app, or copy account credentials. Runtime jobs receive the
bundled policy and skills directly. Model access is configured separately.

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
start a fresh state directory for the native 0.3 runtime. Earlier engine journals are not automatically migrated; keep them separately as evidence.

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
software-defence-factory update --check
software-defence-factory update
software-defence-factory update --auto off
software-defence-factory update --auto on
```

Updates use npm with lifecycle scripts disabled and retain immutable releases
under `${XDG_DATA_HOME:-$HOME/.local/share}/software-defence-factory/releases`. Failed or
offline downloads retain the working version. Private state, model credentials,
jobs and history are preserved. Existing processes keep their original code.
Set `SDF_AUTO_UPDATE=0` to skip automatic network checks for a command.
Source checkouts remain managed by Git and do not update themselves.

CLI updates do not rebuild or update Docker images automatically. Stop the
installation and run `install --state PATH` when intentionally adopting a new
runtime image; repeat the relevant qualification before resuming jobs. Install retains the old and new
image IDs under `software-defence-factory-retained` tags, so another installation
rebuilding the shared tag cannot remove an existing installation's pinned image.
These retained images are recovery data; remove them only after confirming no
installation or retained attempt needs them.

## Protected evidence compatibility

0.10.0 recognizes version-1 execution profiles emitted by native **0.8.0,
0.9.0, 0.9.1 and 0.10.0**. This is an exact allowlist in
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

The 0.10.0 writer retains the same profile format and original-base, aggregate
single-parent candidate/check/review/approval guarantees. Continuation adds
separate provenance; it is not acceptance evidence. The audited 0.8.0, 0.9.0 and
0.9.1 writers remain supported only when their old records meet all current
checks. For continuation specifically, the current completed review, successful
Build/Verify, protected per-attempt artifacts, current policy and clean candidate
objects must also be present and agree. An old runtime string alone never makes
a checkpoint usable. Browser-disabled 0.8.0 records cannot satisfy a newly
enabled browser policy. Missing or unsupported records stay unchanged and
unavailable; no schema migration, profile relabeling or policy repair occurs.

#71 shipped 0.9.0 through PR #81 and #84 shipped 0.9.1 through PR #85; both
passed installed qualification, as reported by the lead. For this 0.10.0 slice,
native Verify/Review remain required. The lead owns installed continuation,
disposable protected PR/CI and desktop/narrow light/dark browser qualification
on Z13. Controlled source fixtures do not supply that proof. New publication
still requires the current remote target to equal the original accepted base;
reviewed-candidate continuation preserves that baseline, while target refresh
remains #72.

## Release flow

`.github/workflows/ci.yml` tests pull requests and pushes on Node 22 and 24,
including installation from the actual npm tarball. A successful `main` push
publishes an increased `package.json` version. Existing versions are skipped;
registry errors fail the release instead of masquerading as a missing version.
The workflow can also be started manually from `main`.

For a release, update both manifests with `npm version patch --no-git-tag-version`,
review the change, and push through the project's normal review flow. A code
push without a version bump is tested but does not overwrite a published package.

The first release is published by the maintainer. Then configure npm trusted
publishing for GitHub owner `arcitai`, repository `software-and-defence-factory`,
workflow filename `ci.yml`, with direct publishing enabled. Subsequent releases
use short-lived OIDC authentication; no npm write token belongs in the repo or
Z13. The source repository remains private, so npm cannot issue public source
provenance for it. The public npm package contains an explicit runtime/method
allowlist, excluding operational state, account data and retired research. It includes the explicitly labelled synthetic runtime fixture used by demo and qualification.

Set the GitHub repository variable `NPM_PUBLISH_ENABLED=true` only after that
first publication and trusted-publisher binding are complete. Until then CI
still builds and tests every change, while publishing is deliberately skipped.
After a CLI update, restart a stopped dashboard with `up --state PATH` and refresh
the browser to load the new bundled interface. Updates do not replace the code
of a controller that is still running.

References: [npm/npx](https://docs.npmjs.com/cli/v11/commands/npx/),
[npm trusted publishing](https://docs.npmjs.com/trusted-publishers/).
