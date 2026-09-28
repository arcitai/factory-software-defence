# Documentation

- [Contributing](../CONTRIBUTING.md): source setup, checks and PR/release policy.
- [Factory development](development.md): use the released runtime to develop this project on a worker.
- [Development queue](../todo.md): ordered, issue-backed work and dependencies.
- [Repository readiness](../kit/repository.md): GitHub labels/forms, explicit issue admission and reviewed delivery.
- [Dashboard design](../DESIGN.md): accepted project-focused visual direction and interface boundaries.
- [Factory concepts](concepts.md): host, controller, worker, harness, agent and compatibility.
- [Workflows, skills and intake](workflows.md): one method/catalog, explicit execution and customization boundaries.
- [Portable role definitions](definition.md): inheritance, shared schema, preview/apply/rollback and evidence.
- [CLI/dashboard capabilities](interfaces.md): current shared operations, gaps and parity work.

- [Setup plan](setup.md): host access, application/CI, inference, autostart, reboot proof and handoff.
- [Optional browser verification](web-verification.md): pinned Playwright/Chromium image, trusted story contract, readiness and limits.
- [Quickstart](quickstart.md): connect a repository, configure inference, run and inspect a task.
- [Install and update](npm.md): npm/npx, state paths, automatic updates and CI/CD.
- [Services and SSH tunnels](services.md): boot/login startup, remote dashboards, idle updates and recovery.
- [Architecture](architecture.md): setup, runtime ownership and work lifecycle, with text alternatives.
  Editable views: [setup/deployment](diagrams/deployment.excalidraw),
  [runtime layers](diagrams/architecture.excalidraw), [work lifecycle](diagrams/lifecycle.excalidraw).
- [Recovery](recovery.md): stopped, failed and interrupted attempts.
- [Defence integration](defence-integration.md): private incident intake and limits.
- [Usage measurements](usage.md): reported tokens, partial coverage and cost limits.
- [Qualification](proof.md): what was exercised and what remains unverified.
- [Ownership](ownership.md): original code, adapted interface and licensing.

For the portable method, start with [the adoption guide](../kit/README.md).
The [runtime catalog](../kit/skills/README.md) owns the six job skills;
[repository/operator guidance](../.agents/skills/README.md) owns explicit adoption
and [Foundation](../.agents/skills/factory-foundation/SKILL.md).

## Feature map

Start here when a report describes behavior rather than a filename. These rows
cover implemented capabilities. Update the owning row with a behavior change;
use the linked guides for details rather than copying their specifications.

| Operator outcome | Behavior and boundary | Implementation / proof entrypoint |
| --- | --- | --- |
| Prepare a repository | Staged method, preserved project contracts, explicit setup | [Foundation](setup.md), [kit export](../scripts/export-kit.mjs), [package tests](../tests/npm.test.mjs) |
| Browse issues and explicitly admit execution | Provider-backed Inbox, creation-only templates/blank form, canonical linked history and atomic duplicate-active rejection; no background backlog polling | [Intake](workflows.md), [server](../factory/server.mjs), [issue tests](../tests/issue-intake.test.mjs) |
| Execute Software or Defence | One queue; isolated roles/checks; Defence produces a private draft | [Architecture](architecture.md), [executor](../factory/executor.mjs), [controller tests](../tests/controller.test.mjs) |
| Verify a web candidate in a browser | Optional operator policy; pinned Playwright/Chromium in separate loopback-isolated preview/browser containers; bounded traces and screenshots bound to candidate and policy | [Browser setup and contract](web-verification.md), [runner](../factory/web/runner.mjs), [regressions](../tests/web-verification.test.mjs) |
| Review, revise and accept | Explicit fresh start, reviewed-candidate continuation or source replacement; evidence belongs to the complete candidate and policy; acceptance does not publish | [Recovery](recovery.md), [queue](../factory/queue.mjs), [review tests](../tests/review-evidence.test.mjs) |
| Publish an accepted candidate | Optional configured GitHub target; protected evidence and bounded workflow qualification before new writes; one draft PR with durable readback and actual PR checks | [Quickstart](quickstart.md), [recovery](recovery.md), [delivery regressions](../tests/delivery.test.mjs) |
| Inspect project work | Primary Inbox list/board, canonical all-work identities, shared filters and progressive task detail; real usage and unknown costs | [Design](../DESIGN.md), [dashboard](../dashboard/src/main.jsx), [dashboard tests](../dashboard/package.json) |
| Inspect configuration and compute | Catalog plus portable role harness/model editor and explicit private local bindings, shared validation/diff and idle atomic apply/rollback; host distinct from execution worker | [Concepts](concepts.md), [definition contract](definition.md), [role regressions](../tests/role-definition.test.mjs) |
| Qualify long local Pi tool use | Pinned upstream compaction plus bounded local tool-result projection, explicit recovery and fail-closed transport proof; actual inference remains separately qualified | [Local setup](setup.md#local-context-budget-and-worker-image-0152-100), [qualification](proof.md#pi-context-boundary-first-slice-0152-100), [CLI fixture](../tests/pi-context.test.mjs) |
| Start local Pi with project resources | Private ephemeral Pi stores, explicit denial of project resource trust, retained bundled extension and skills | [Local setup](setup.md#local-pi-project-resources-0153-103), [qualification](proof.md#pi-project-trust-startup-0153-103), [actual-Pi fixture](../tests/pi-trust.test.mjs) |
| Keep a private installation running | Services/tunnels, idle-only update activation, preserved state | [Operation](services.md), [updates](../factory/updates.mjs), [service tests](../tests/services.test.mjs) |

Roadmap features remain in [issues](https://github.com/arcitai/software-and-defence-factory/issues)
and the [interface gaps](interfaces.md), separate from this implemented map.

[Repository integrations](integrations.md) defines provider selection, data ownership and local fallback.
