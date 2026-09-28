---
name: factory-foundation
description: Prepare or assess a repository and its execution host for Factory, including CI, access, harness configuration, services and a bounded qualification.
---

# Factory Foundation

Prepare the selected project for the accepted Factory use. Start from its local
instructions, existing source and session decisions. Preserve useful work and
licenses. Assessment-only requests stay read-only. A method-only adoption needs
no runtime, Docker host or model account.

The [setup plan](../../../docs/setup.md) owns supported commands and checkpoints.
Read the relevant sections rather than inventing a host-specific setup recipe.
Choose this skill explicitly when adopting Factory. Project preparation tools
need no knowledge of Factory and do not invoke this transition automatically.
It is not an execution-job skill and grants no infrastructure or account access.

## Establish the boundary

Identify the repository, responsible owner, intended work, checks and delivery
destination. Distinguish application hosting from Factory execution compute.
Use the actual host's OS, service manager, hardware and private network; do not
assume a machine model, a VPN provider, a cloud, Git forge, issue tracker, CI
provider or particular harness. Inspect the configured remote and actual provider
capabilities. GitHub is one adapter; an unsupported host keeps local execution
without guessed API calls. Use [integration ownership](../../../docs/integrations.md).

Find the project's owner-approved VISION.md or equivalent product brief and
record that canonical source in its instructions. Preserve existing decisions;
do not add a competing vision document. If none exists, stage a short draft from
[the vision template](../../../adlc/vision-template.md), using accepted owner
context and marking unresolved choices. A draft does not authorize new scope.
Self-improvement proposals must identify the observed problem, classify alignment
with that brief, and define an observable check. Unclear or out-of-scope proposals
need an owner decision; agents cannot approve their own scope or access expansion.
Ordinary fixes within accepted scope continue under existing authority.

Use the existing task/issue record for missing obligations and evidence. Avoid a
second project registry or a template conversion of an existing application.
Continue authorized repairs; ask only for decisions or authority actually missing.

For native-harness adoption, use the [migration contract](../../../docs/architecture.md#migration-contract).
Keep each project's settings and connection identities deliberate; qualify its
effective tools separately from unattended approval mode. The controller/image
steps below describe the currently shipped optional runtime.

## Prepare and prove

- **Repository:** inspect instructions, scope/design, architecture, dependencies,
  real checks, code/design standards, secrets, ownership and recovery. Preserve
  the project’s canonical sources and confirm that jobs can discover them through
  repository instructions. Adapt the staged method to the
  project; do not overwrite its files. Reconcile the chosen provider’s issue forms/labels (where supported), CI triggers,
  required checks, protection rules and the intended PR/release path using
  [repository readiness](../../../adlc/repository.md). Before trusted GitHub PR
  delivery, confirm active candidate-triggered workflows fit the bounded
  qualification in [recovery](../../../docs/recovery.md#trusted-pr-delivery);
  unsupported workflows keep delivery patch-only. Organization hooks and
  external CI remain operator-owned. File presence is not proof.
- **Infrastructure:** choose a private state directory, loopback port, host and
  unprivileged operator. Verify actual SSH authentication, host key, network,
  Docker and stable Node executable where needed. Factory needs no unrestricted
  sudo. Jobs must not receive Docker, SSH, forge or deployment credentials.
- **Harness and model:** select supported tools and a compatible job image;
  verify the intended inference route from that image/network. Keep credentials
  private and scoped. A working model endpoint does not qualify output quality.
- **Operation:** enable only intended controllers, tunnels and update services.
  Inspect old queues before startup: queued work resumes. Verify backups,
  stop/recovery and boot/login dependencies; record observed proof separately
  from an untested reboot or unattended-start claim.
- **Qualification:** use a separate synthetic state for runtime checks. When
  real application qualification is requested, admit one bounded task, inspect
  the exact candidate, run real checks, obtain separate review and verify the
  authorized delivery. A synthetic success is not application qualification.

Skills guide agents; the selected native harness owns sessions, tools,
permissions and execution. Remote issues stay in the selected provider. The
legacy optional runtime still uses its controller and SQLite for retained jobs;
do not introduce those into a native installation. Creating an issue or assigning
a label does not start work.
Optional schedules belong to the selected harness and call Factory CLI/API; do
not install a parallel cron module or enable schedules during ordinary setup.
Verify each requested provider action separately from job/inference access.

## Handoff

Record source/runtime/image revisions, check results, host/state/service paths,
credential references (never values), delivery/recovery ownership and remaining
obligations in the private installation handoff. Keep public repository docs
portable. Distinguish prepared, connected and qualified states. Use the actual
CLI/API and dashboard evidence; do not declare unsupported capabilities ready.
