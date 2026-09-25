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

## Ready for supervised self-development

The readiness threshold is one explicitly admitted issue completed by the released
Factory runtime against this repository: implementation, configured checks,
independent review, operator/platform proof and a normal protected PR. The
operator retains acceptance and delivery. A complete dashboard redesign or an
autonomous publisher is not a prerequisite for this scoped development path.

- [#40 — repeatable repository readiness](https://github.com/arcitai/software-and-defence-factory/issues/40): issue forms/labels, honest admission guide, queue and a real self-development delivery.
- [#1 — project-focused dashboard](https://github.com/arcitai/software-and-defence-factory/issues/1): follow [DESIGN.md](DESIGN.md), inspired by Build by Warp. The owner has selected this direction; it supersedes preserving the inherited layout. Preserve working actions and evidence.

## Remove remaining operator work

1. [#30 — supported custom job-image selection](https://github.com/arcitai/software-and-defence-factory/issues/30): remove the manual installation-metadata step.
2. [#28 — immutable source admission](https://github.com/arcitai/software-and-defence-factory/issues/28): eliminate the controlled-checkout workaround.
3. [#29 — optional trusted PR handoff](https://github.com/arcitai/software-and-defence-factory/issues/29), after #28. [#12](https://github.com/arcitai/software-and-defence-factory/issues/12) retains the overall source/delivery contract.

## One Factory, two interfaces

[#37](https://github.com/arcitai/software-and-defence-factory/issues/37) owns full
CLI/API/dashboard parity. Both interfaces must use the same execution owner,
records, policy and stale-action guards. Deliver vertical slices against an
explicit capability matrix:

1. Read/status/artifacts and machine-readable CLI results, plus the existing
   task actions through the common API.
2. GitHub backlog/admission with visible issue-to-job links and explicit scope;
   labels remain planning metadata until a trigger is separately qualified.
3. Setup, image selection, diagnostics, services and updates through a supported
   operator boundary, including behavior when a project controller is stopped.
4. Source and delivery controls from #28/#29 in both interfaces.

Current gaps are tracked work, not shipped capabilities. Do not hide unsupported
operations behind decorative buttons or introduce another scheduler for the GUI.

## Dashboard track

These scoped design changes can progress independently of automatic PR handoff.

1. [#1 — Arcitai dashboard refinement](https://github.com/arcitai/software-and-defence-factory/issues/1): implement the accepted shared visual direction and review it in the real UI.
2. [#27 — optional project theme from DESIGN.md](https://github.com/arcitai/software-and-defence-factory/issues/27), after the shared visual direction and #25; no runtime interpretation of arbitrary Markdown.

## Qualification and later scope

- [#6 — real model/application/security qualification](https://github.com/arcitai/software-and-defence-factory/issues/6). Reuse evidence from #25 where applicable; its security case and broader failure evidence remain separate obligations.
- [#7 — first bounded Defence case](https://github.com/arcitai/software-and-defence-factory/issues/7). Requires an explicitly selected isolated system and response boundary; no production monitoring is implied.
- [#32 — running-factory observability research](https://github.com/arcitai/software-and-defence-factory/issues/32). Assess the actual telemetry/operations gap before selecting connectors or starting live monitoring.
- [#22 — external inspiration](https://github.com/arcitai/software-and-defence-factory/issues/22). Research backlog only; extract a concrete accepted requirement before implementation.
- [#39 — optional Coolify/VPS hosting](https://github.com/arcitai/software-and-defence-factory/issues/39). Evaluate a hosting recipe for the optional runtime while keeping the method independently useful. No deployment is implied.

AIOS-app and other application development are separate queues. This Factory
work does not start or resume those jobs. See [CONTRIBUTING.md](CONTRIBUTING.md)
and the [self-development recipe](docs/development.md) before submitting work.
