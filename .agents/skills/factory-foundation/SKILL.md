---
name: factory-foundation
description: Prepare or assess a project and its execution host for Factory, including repository checks, isolated native harness configuration and startup qualification.
---

# Factory Foundation

Use for an explicitly requested Factory adoption or assessment. Preserve the
project's instructions, accepted decisions and useful work; assessment stays
read-only. Follow the [setup guide](../../../docs/setup.md) for supported
commands. Method-only adoption needs no running dashboard or model account.

## Scope the installation

Identify the project, owner, intended work and delivery destination. Find its
approved VISION.md or equivalent brief and keep that source canonical. If it
is missing, stage a short draft from the [vision template](../../../adlc/vision-template.md)
using accepted context. A draft cannot authorize new goals. Improvements must
state the observed problem, fit with the vision and an observable acceptance
check. Scope or access expansion needs the owner's decision.

Inspect the actual host, repository remote and native harness. Codex and GitHub
are the current supported integration; record unsupported capabilities rather
than inventing an adapter or treating binary discovery as readiness. Application
hosting is separate from Factory's execution host. Discover the intended operator
route and host/workload isolation before setup. On a shared personal host, prefer
a supported VM with its own guest identity and sandbox. A suitable dedicated VPS
can use an unprivileged OS user plus sandbox, with shared-kernel risks recorded.
This is guidance, not authority to migrate hosts or change worker permissions.
Keep missing obligations in the existing issue/task record, not a second project registry.

## Prepare and qualify

- **Repository:** preserve canonical instructions, design and code standards,
  real tests and deployment rules. Adapt [repository readiness](../../../adlc/repository.md),
  issue forms/labels and CI checks to the existing project. Stage the selected
  ADLC method before adoption; do not overwrite application files. Inspect the
  actual required checks and workflow access, not just file presence. Compare
  the [lifecycle catalog](../../../adlc/lifecycle.json), forms and label names,
  colors and meanings with the real repository before deliberate adoption.
  Preserve its conventions. GitHub phases and closure reasons describe repository
  work; native running/completed state and accepted delivery remain separate.
- **Native environment:** use separate Factory configuration, native login and
  selected ADLC skills. Do not copy personal login, plugins or connections.
  A dedicated OS user is recommended; a separate configuration directory under
  the same user is not OS isolation. Verify effective workspace permissions,
  private-path denial and the tool/connection inventory. Unattended approval
  does not mean unrestricted host access. Keep provider credentials with the
  component needing them, outside the agent environment unless explicitly needed.
- **Operation:** install a pinned package, stable Node and Codex binaries, a
  private state directory and a loopback listener. Use the supported OS service
  manager; loopback plus authenticated SSH forwarding is the default remote route.
  Remote HTTPS is an explicit private installation choice. Stage an existing native
  authenticated proxy/tunnel, exact trusted HTTPS origin and approved identities/
  devices together, using [private operator access](../../../docs/private-ingress.md).
  Keep transport configuration and evidence in private installation state, outside
  source, method YAML and the portable kit. No setup step automatically publishes
  the Inbox. Tailscale Serve is an optional recipe, not a runtime dependency;
  same-tailnet membership alone is insufficient authorization. Keep Funnel/public
  exposure disabled. Preserve SSH until the replacement is qualified. Record
  boot/login/TLS/network prerequisites and test restart/reconnection without
  starting another native turn. Operator ingress is separate from worker egress.
  Updating or stopping an active or unknown writer must not silently interrupt
  it. Native history and local references remain outside the package. Offer the
  [optional OS release check](../../../docs/npm.md#optional-linux-release-check-timer)
  only when selected; a metadata lookup does not install or activate a release.
- **Private access proof:** when remote HTTPS is selected, qualify the actual
  approved-device route, assets, same-origin authenticated API reads and a harmless
  draft/preview. Prove session, exact Host/Origin, cross-site and header-spoofing
  refusals; inspect actual native identity/device policy and node sharing. Record
  off-tailnet inaccessibility separately from denied same-tailnet identities/
  devices and HTTP protection. A listener, certificate discovery or one-owner
  status is not proof of TLS or authorization. Missing denied-device proof or
  unknown/weakened boundaries remain concrete readiness gaps. Preserve the
  accepted Inbox at desktop/narrow widths; do not create issues or admit work
  merely to test transport. Record deliberate native startup, removal/rollback
  and retention of the approved origin/access policy through release maintenance.
- **Proof:** start one bounded issue through the installed Inbox or CLI; inspect
  its native result, explicitly continue it, then run the project's checks and
  independent review against the exact candidate. Qualify only the authorized
  delivery. Distinguish mock/synthetic checks from real integration and a tested
  restart from an untested reboot.

Codex owns sessions, tools, context and execution. Requested schedules belong
to the native harness; do not install a Factory scheduler. Issue creation and
labels alone never authorize execution. Model choices such as Local Build ·
Cloud Review need support and measured qualification through the chosen harness.
Defence findings and production recovery retain their separate access and
publication boundaries.

## Migration and handoff

Follow [recovery](../../../docs/recovery.md) before replacing an old installation:
reconcile active work, preserve private history, disable obsolete services and
updaters deliberately, qualify the replacement, and retain a recovery route.
Do not carry the old runtime into the active source or package for archival use.

Record versions, project/state/service paths, connection identities without
secrets, observed checks and remaining limits in the private installation
handoff. Keep public instructions portable and installation claims precise.
