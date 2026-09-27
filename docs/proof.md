# Capability and verification map

Factory binds each result to its exact revision and current policy. Source
checks, independent review, installed qualification, protected CI and publication
establish separate facts. Passing fixtures do not qualify model judgment,
security or production readiness.

## Delivered capabilities

| Capability | Release / delivery | Boundary |
| --- | --- | --- |
| Immutable source admission | 0.7.0 · [PR #65](https://github.com/arcitai/software-and-defence-factory/pull/65) | Retained source and explicit revisions; unknown provenance stays unknown. |
| Trusted PR handoff | 0.8.0 · [PR #80](https://github.com/arcitai/software-and-defence-factory/pull/80) | Protected evidence, workflow checks and durable receipts; no merge/deploy authority. |
| Optional browser verification | 0.9.0 · [PR #81](https://github.com/arcitai/software-and-defence-factory/pull/81) | Tool/story/revision-bound artifacts; explicit policy and actual browser readiness required. |
| Compatible protected evidence | 0.9.1 · [PR #85](https://github.com/arcitai/software-and-defence-factory/pull/85) | Exact supported writers and current provenance/policy guards; no rewritten acceptance or hashes. |
| Reviewed-candidate continuation | 0.10.0 · [PR #87](https://github.com/arcitai/software-and-defence-factory/pull/87) | Original source baseline preserved; aggregate checks/review repeated. Unfinished Build checkpoint recovery remains [#42](https://github.com/arcitai/software-and-defence-factory/issues/42). |
| Repository Inbox lifecycle | 0.11.0 · [PR #89](https://github.com/arcitai/software-and-defence-factory/pull/89) | Explicit admission, creation-only issues, canonical execution history and duplicate-active refusal. |

Delivered 0.11.0 verification covered protected Node 22/24 CI, 279 runtime/package
and 58 dashboard checks, 12 installed provider/native cases, six browser cases
at 1440/390/320px in both themes, and all 103 public package files. Installed
adoption preserved histories. Those results apply to 0.11.0, not later revisions.

## Current source verification

| Check route | Coverage | Limit |
| --- | --- | --- |
| `npm ci --ignore-scripts`; `npm run build:dashboard`; `npm run check` | Locked dependencies, built assets, syntax and runtime/package/dashboard regressions | Does not prove protected remote CI or registry publication. |
| [Tarball tests](../tests/npm.test.mjs) | Disposable global install; shared bin help/version/state; collision refusal; offline npm exec/npx; cached dispatch; source-checkout refusal; served HTML/assets | Controlled bootstrap fixture, not an exact published old-release upgrade or rendered browser inspection. |
| [Profile](../tests/execution-profile.test.mjs) and [delivery tests](../tests/delivery.test.mjs) | Exact writer versions, unchanged retained records, current provenance/policy/revision guards and unsupported writer rejection | Controlled records/providers do not prove live account writes. |
| [Service](../tests/services.test.mjs) and [source admission tests](../tests/source-admission.test.mjs) | Stable launch/update contracts and retained-source behavior | Does not prove a running installation's service/image/history preservation. |

Factory 0.11.1 adds the shared `factory` executable and product identity; package,
repository and persistent identifiers retain their [compatibility contracts](npm.md).
Its release qualification is tracked in [#61](https://github.com/arcitai/software-and-defence-factory/issues/61)
and linked delivery PRs: exact installed upgrades, protected CI/publication and
registry readback, rendered branding at desktop/narrow widths in both themes,
and service/history preservation require release-specific evidence. Source
checks and prior delivered proof do not establish that external acceptance.

## Remaining limits

- Namespace/account migration and automated GitHub Releases remain separate work
  under [#61](https://github.com/arcitai/software-and-defence-factory/issues/61); see [release prerequisites](npm.md#release-flow).
- Synthetic Docker qualification requires an explicit disposable installation;
  follow [setup](setup.md), [browser verification](web-verification.md) and
  [recovery](recovery.md). Never qualify against an application installation.
- Live provider, browser, model and security capabilities need scoped evidence
  on the actual installation. Skills alone supply neither tools nor authority.
- Unknown usage/cost stays unknown. Defence supports private scoped investigation,
  not production monitoring or autonomous recovery.
