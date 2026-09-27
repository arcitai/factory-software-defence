# Factory development queue

This is the ordering/entrypoint; linked GitHub issues own scope, acceptance and
current delivery state. Work one accepted slice at a time. The chosen product
boundary is **one controller/dashboard per project**, with common Factory
interaction and optional project identity. No global project hub is planned.

## Completed foundation and first slice

- [x] [#26 — contributor and worker development foundation](https://github.com/arcitai/software-and-defence-factory/issues/26).
- [x] [#25 — visible project identity and task composer label](https://github.com/arcitai/software-and-defence-factory/issues/25). Real worker pilot with separate browser acceptance and reviewed PR delivery; local-model attempts failed and remain qualification evidence, not a qualified profile.

## Completed reliability slice

- [x] [#35 — revise a stopped software review](https://github.com/arcitai/software-and-defence-factory/issues/35): explicit feedback starts fresh implementation/checks/review/approval and preserves failed attempts.
- [x] [#33 — retain terminal diagnostics](https://github.com/arcitai/software-and-defence-factory/issues/33): bounded beginning/tail logs, honest terminal exits and regression proof.
- [x] [#34 — per-attempt executor/model provenance](https://github.com/arcitai/software-and-defence-factory/issues/34): immutable effective profiles, honest legacy unknowns and restart proof.

- [x] [#30 — supported local custom job images](https://github.com/arcitai/software-and-defence-factory/issues/30): produced through a real Factory job, checked/reviewed against its exact candidate, and exercised with disposable Docker states. GUI setup controls remain #37.

## Ready for supervised self-development

The readiness threshold is one explicitly admitted issue completed by the released
Factory runtime against this repository: implementation, configured checks,
independent review, operator/platform proof and a normal protected PR. The
operator retains acceptance and delivery. A complete dashboard redesign or an
autonomous publisher is not a prerequisite for this scoped development path.

- [x] [#40 — repeatable repository readiness](https://github.com/arcitai/software-and-defence-factory/issues/40): issue forms/labels, honest admission guide, queue and a real self-development delivery.
- [#1 — project-focused dashboard](https://github.com/arcitai/software-and-defence-factory/issues/1): follow [DESIGN.md](DESIGN.md), inspired by Build by Warp. The owner has selected this direction; it supersedes preserving the inherited layout. Preserve working actions and evidence.

## Remove remaining operator work

1. Completed: [#28 — immutable source admission](https://github.com/arcitai/software-and-defence-factory/issues/28): retained source, explicit revisions and honest legacy provenance; 138 tests, independent review, 13 installed Docker paths and browser proof. Delivery: [PR #65](https://github.com/arcitai/software-and-defence-factory/pull/65).
2. [#29 — optional trusted PR handoff](https://github.com/arcitai/software-and-defence-factory/issues/29), after #28. [#12](https://github.com/arcitai/software-and-defence-factory/issues/12) retains the overall source/delivery contract.

## One Factory, two interfaces

[#37](https://github.com/arcitai/software-and-defence-factory/issues/37) owns full
CLI/API/dashboard parity. Both interfaces must use the same execution owner,
records, policy and stale-action guards. Deliver vertical slices against an
explicit [capability matrix](docs/interfaces.md):

1. Read/status/artifacts and machine-readable CLI results, plus the existing
   task actions through the common API.
2. GitHub backlog/admission with visible issue-to-job links and explicit scope;
   labels remain planning metadata; optional harness automations call the shared API/CLI.
3. Setup, image selection, diagnostics, services and updates through a supported
   operator boundary, including behavior when a project controller is stopped.
4. Source and delivery controls from #28/#29 in both interfaces.

Current gaps are tracked work, not shipped capabilities. Do not hide unsupported
operations behind decorative buttons or introduce another scheduler for the GUI.

## Next bounded slices

- [ ] [#71 — optional trusted execution-host web verification](https://github.com/arcitai/software-and-defence-factory/issues/71): browser evidence, packaged browser path and PNG CSP repairs from `7d5fb6a` await native Verify and independent Review of the entire aggregate from `380f74983d278f4a517d26a6a4bad4e3dbcb6809`, including both unaccepted checkpoints and the latest repair; both prior timed-out Build histories remain failed. Lead-owned installed Docker/browser and real PNG decode qualification remain pending. This manual checkpoint does not ship #42 support.
- [ ] [#60 — repository Inbox lifecycle](https://github.com/arcitai/software-and-defence-factory/issues/60): show the repository backlog, create through its templates, and admit execution explicitly. Remove the overlapping import chooser.
- [ ] [#61 — Factory naming and release migration](https://github.com/arcitai/software-and-defence-factory/issues/61): Factory, with Software & Defence as subtitle; preserve installed state, command and update compatibility.
- [ ] [#62 — operator and runtime skills](https://github.com/arcitai/software-and-defence-factory/issues/62): separate repository/setup guidance from instructions mounted into isolated jobs.
- [ ] [#63 — deployment, architecture and process diagrams](https://github.com/arcitai/software-and-defence-factory/issues/63): three focused editable views aligned with the delivered boundaries.

The narrow revision-error visibility and legacy-detail overflow found during
#28 browser inspection remain part of #37's UI follow-up.

## Dashboard track

These scoped design changes can progress independently of automatic PR handoff.

1. [#1 — Arcitai dashboard refinement](https://github.com/arcitai/software-and-defence-factory/issues/1): implement the accepted shared visual direction and review it in the real UI.
2. [#27 — optional project theme from DESIGN.md](https://github.com/arcitai/software-and-defence-factory/issues/27), after the shared visual direction and #25; no runtime interpretation of arbitrary Markdown.

## Qualification and later scope

- [#6 — real model/application/security qualification](https://github.com/arcitai/software-and-defence-factory/issues/6). Reuse evidence from #25 where applicable; its security case and broader failure evidence remain separate obligations.
- [#7 — first bounded Defence case](https://github.com/arcitai/software-and-defence-factory/issues/7). Requires an explicitly selected isolated system and response boundary; no production monitoring is implied.
- [#32 — running-factory observability research](https://github.com/arcitai/software-and-defence-factory/issues/32). Assess the actual telemetry/operations gap before selecting connectors or starting live monitoring.
- [#22 — external inspiration](https://github.com/arcitai/software-and-defence-factory/issues/22). Both linked posts and the relevant skill collection are assessed in the issue. Adopted project contracts, feature navigation, review/diagnosis and dependency guidance are delivered with #49; larger runtime work stays in its owning issues.
- [#39 — optional Coolify/VPS hosting](https://github.com/arcitai/software-and-defence-factory/issues/39). Evaluate a hosting recipe for the optional runtime while keeping the method independently useful. No deployment is implied.

AIOS-app and other application development are separate queues. This Factory
work does not start or resume those jobs. See [CONTRIBUTING.md](CONTRIBUTING.md)
and the [self-development recipe](docs/development.md) before submitting work.


## Dashboard delivery follow-up

- [x] #1: Warp-style frontend delivered in 0.4.5.
- [x] #45: finish the reference-matched overview, navigation and task detail; implemented and checked; publication readback remains the delivery PR gate.
- [x] #44: retain measured Codex token usage with honest coverage in both interfaces; native Factory build/check; its review findings are fixed in the integrated candidate with operator Docker/live-provider proof. The original run remains failed/unaccepted; integrated delivery is reviewed separately.
- #42: supported continuation from retained, unreviewed build checkpoints after a bounded timeout.
- #32: bounded/redacted real worker progress through the shared API/CLI/dashboard.
- #27: optional reviewed DESIGN.md project colors; monochrome remains the complete default.

## Current workbench slice

- [x] [#47 — shared workflows/skills and clearer task intake](https://github.com/arcitai/software-and-defence-factory/issues/47): implementation, 114 automated tests, Node 22/24 CI, independent code review and desktop/narrow light/dark browser acceptance passed. Includes generic worker identity, checkbox filters, horizontal Kanban, GitHub issue chooser and modal issue import. Normal publication and installed readback are recorded in PR #48.
- Workflow editing remains under #37. Optional issue admission is scheduled by the selected harness, calling the common CLI/API; issue creation alone must not start execution.

## Definition and foundation alignment

- [x] [#49 — one vocabulary, foundation ownership and workbench](https://github.com/arcitai/software-and-defence-factory/issues/49): shared catalog; operator skill in Factory; independent project contracts; whole-row filters, shared status groups and local task intake; repository cleanup. Verified in [PR #55](https://github.com/arcitai/software-and-defence-factory/pull/55); release/adoption evidence is recorded there.
- [ ] [#50 — Defence roles, skills and evidence](https://github.com/arcitai/software-and-defence-factory/issues/50), then the bounded case in #7.
- [ ] [#51 — scorers, benchmarks and improvement analytics](https://github.com/arcitai/software-and-defence-factory/issues/51). Recorded token coverage is not a quality score.
- [ ] [#52 — native intake and GitHub identity](https://github.com/arcitai/software-and-defence-factory/issues/52). Repository/credential boundaries and persistent intake scope; #58 delivers the first provider bridge.
- [ ] [#53 — versioned definitions and role profiles](https://github.com/arcitai/software-and-defence-factory/issues/53). Current roles share one installation profile; schedules belong to the selected harness.
- [ ] [#54 — scoped MCP over the shared API](https://github.com/arcitai/software-and-defence-factory/issues/54). One controller and authorization policy.

These extend the #37 parity track. Hosting (#39), observability (#32), quality
measurement (#51) and security investigation (#50) remain distinct scopes.

## Repository-backed issue intake

- [x] [#56 — repository forms and GitHub issue intake](https://github.com/arcitai/software-and-defence-factory/issues/56): shared `issue` commands, repository templates and required fields, paged issue picker with labels, editable recommendation and explicit start. Verified in [PR #57](https://github.com/arcitai/software-and-defence-factory/pull/57), with 119 automated tests, independent review and desktop/mobile browser acceptance. A bounded slice of #52/#37; no background admission or GitHub writes.

## Repository issue bridge

- [x] [#58 — modular repository issue bridge](https://github.com/arcitai/software-and-defence-factory/issues/58): GitHub publication through the shared API/CLI/dashboard, explicit later start, durable receipts and bounded recovery; other remotes retain local execution. Harnesses own scheduling. Implementation, real GitHub creation/readback, 127 tests, independent review and desktop/narrow light/dark inspection pass. Release/adoption readback is recorded in [PR #59](https://github.com/arcitai/software-and-defence-factory/pull/59). Broader hosted identity, unsent persistent drafts and additional provider adapters are not claimed.
