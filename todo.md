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
2. Completed: [#29 — optional trusted PR handoff](https://github.com/arcitai/software-and-defence-factory/issues/29), delivered in 0.8.0 via [PR #80](https://github.com/arcitai/software-and-defence-factory/pull/80). [#12](https://github.com/arcitai/software-and-defence-factory/issues/12) retains the overall source/delivery contract.

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

- [x] [#84 — protected execution evidence across runtime upgrades](https://github.com/arcitai/software-and-defence-factory/issues/84): shipped **0.9.1 via [PR #85](https://github.com/arcitai/software-and-defence-factory/pull/85)**; installed qualification passed. The 0.10.0 audit retains the exact compatible v1 writers only with current provenance/policy/browser/delivery guarantees; no record migration.
- [x] [#71 — optional trusted execution-host web verification](https://github.com/arcitai/software-and-defence-factory/issues/71): shipped **0.9.0 via [PR #81](https://github.com/arcitai/software-and-defence-factory/pull/81)**; installed qualification passed. Earlier failed/timed-out Build histories remain failed evidence.
- [x] [#42 — reviewed-candidate continuation, first bounded slice](https://github.com/arcitai/software-and-defence-factory/issues/42): delivered in **0.10.0 via [PR #87](https://github.com/arcitai/software-and-defence-factory/pull/87)**. Preserves the original source/delivery baseline and repeats Build/full Verify/independent Review/approval from the selected reviewed candidate. Remaining #42 scope stays open: unfinished/uncommitted Build checkpoints, exit-cause classification, live pending feedback and harness deadline hints. Target refresh stays #72; desktop/VM observation and browser recordings stay #82.
- [x] [#60 — repository Inbox lifecycle](https://github.com/arcitai/software-and-defence-factory/issues/60): delivered in **0.11.0 via [PR #89](https://github.com/arcitai/software-and-defence-factory/pull/89)**. Provider Inbox, readiness mapping, canonical linked execution history, creation-only New issue and atomic duplicate-active admission share CLI/API/dashboard state. Protected CI, installed provider/native and desktop/narrow browser qualification passed as reported by the lead; both hosts adopted with histories preserved. See [proof](docs/proof.md).
- [ ] [#61 — Factory naming and release migration](https://github.com/arcitai/software-and-defence-factory/issues/61): first slice delivered **0.11.1 via protected maintainer [PR #92](https://github.com/arcitai/software-and-defence-factory/pull/92)**, preserving the exact qualified naming candidate, both executable names and package/repository identities. Native publication failed safely due to [#91](https://github.com/arcitai/software-and-defence-factory/issues/91); maintainer delivery does not count as native publication. Successor `factory-sd`, repository rename, account/OIDC prerequisites and automated GitHub Release wiring remain separate; this does not close #61.
- [ ] [#91 — exact Git patch bytes](https://github.com/arcitai/software-and-defence-factory/issues/91): bounded **0.11.2 candidate** prerequisite on native Factory/Z13 before further general unattended delivery; source regression proof is recorded in [proof](docs/proof.md), installed/native qualification remains operator-owned.
- [ ] [#90 — restore the approved primary Warp Inbox](https://github.com/arcitai/software-and-defence-factory/issues/90): **0.12.0 implementation and qualification complete; protected release/adoption pending**, after the #61 naming slice and #91 prerequisite, before #62/#63. Includes the bounded [#94 fixture publication race](https://github.com/arcitai/software-and-defence-factory/issues/94). Candidate `ed3292ccd079a182ee573d6baf01e2fe1d9c3223` passed source/Verify, native independent aggregate Review, installed read-only CLI/API and desktop/390px/320px light/dark interaction and visual acceptance. Original #60 lifecycle guards remain. See [proof and verification boundaries](docs/proof.md#qualified-primary-inbox-90--94). Refreshed aggregate Review and final installed package comparison remain required for this documentation-only continuation before handoff; no shipped release is claimed.
- [ ] [#62 — operator and runtime skills](https://github.com/arcitai/software-and-defence-factory/issues/62): **0.13.0 implementation/source checks complete; checkpoint operator qualification passed; final acceptance/release pending**. One `kit/skills/` runtime catalog, `.agents/skills/factory-foundation` operator guidance, shared installed provenance, staged exports and Codex discovery mount. See [proof](docs/proof.md#skill-ownership-62). Checkpoint `7463a4c` passed installed CLI/API/export, synthetic Docker handoff and credential-free native Codex/Pi discovery. Combined native Verify/independent Review, final runtime-byte comparison and Skills browser acceptance remain required before release/adoption.
- [ ] [#63 — deployment, architecture and process diagrams](https://github.com/arcitai/software-and-defence-factory/issues/63): **0.13.0 documentation integrated; final review/visual acceptance pending**. Three operator-authored editable views and SVGs imported with verified hashes, replacing the overloaded diagram; README, architecture, setup and map links now follow setup, ownership and lifecycle. See [proof](docs/proof.md#ownership-diagrams-63).

The narrow revision-error visibility and legacy-detail overflow found during
#28 browser inspection remain part of #37's UI follow-up.

## Dashboard track

These scoped design changes can progress independently of automatic PR handoff.

1. [#1 — Factory dashboard refinement](https://github.com/arcitai/software-and-defence-factory/issues/1): implement the accepted shared visual direction and review it in the real UI.
2. [#27 — optional project theme from DESIGN.md](https://github.com/arcitai/software-and-defence-factory/issues/27), after the shared visual direction and #25; no runtime interpretation of arbitrary Markdown.

## Qualification and later scope

- [#6 — real model/application/security qualification](https://github.com/arcitai/software-and-defence-factory/issues/6). Reuse evidence from #25 where applicable; its security case and broader failure evidence remain separate obligations.
- [#7 — first bounded Defence case](https://github.com/arcitai/software-and-defence-factory/issues/7). Requires an explicitly selected isolated system and response boundary; no production monitoring is implied.
- [#32 — running-factory observability research](https://github.com/arcitai/software-and-defence-factory/issues/32). Assess the actual telemetry/operations gap before selecting connectors or starting live monitoring.
- [#22 — external inspiration](https://github.com/arcitai/software-and-defence-factory/issues/22). Both linked posts and the relevant skill collection are assessed in the issue. Adopted project contracts, feature navigation, review/diagnosis and dependency guidance are delivered with #49; larger runtime work stays in its owning issues.
- [#39 — optional Coolify/VPS hosting](https://github.com/arcitai/software-and-defence-factory/issues/39). Evaluate a hosting recipe for the optional runtime while keeping the method independently useful. No deployment is implied.

See [CONTRIBUTING.md](CONTRIBUTING.md)
and the [self-development recipe](docs/development.md) before submitting work.


## Dashboard delivery follow-up

- [x] #1: Warp-style frontend delivered in 0.4.5.
- [x] #45: finish the reference-matched overview, navigation and task detail; implemented and checked; publication readback remains the delivery PR gate.
- [x] #44: retain measured Codex token usage with honest coverage in both interfaces; native Factory build/check; its review findings are fixed in the integrated candidate with operator Docker/live-provider proof. The original run remains failed/unaccepted; integrated delivery is reviewed separately.
- #42: first reviewed-candidate continuation slice above; retained unfinished/unreviewed Build checkpoints after timeout remain deferred.
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
