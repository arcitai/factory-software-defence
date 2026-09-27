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

Factory 0.11.1's naming first slice was delivered via protected maintainer
[PR #92](https://github.com/arcitai/software-and-defence-factory/pull/92), per the
operator brief. Native publication refused its malformed retained patch before
provider writes ([#91](https://github.com/arcitai/software-and-defence-factory/issues/91)).
That maintainer delivery does not establish successful native publication.

The 0.11.2 candidate preserves exact Buffer output for Build and handoff patches.
The executor regression failed on the original writer and passes with the fix:
trailing blank context, missing final newline, binary and non-UTF-8 text survive
continued Build and handoff; retained bytes/digest match Git output and replay
against the exact retained base to the candidate tree in new bare storage.
SHA-1 and SHA-256 local handoff are covered; GitHub publication remains SHA-1.
Malformed and wrong-tree patches fail before acceptance; scratch cleanup
preserves unrelated prior evidence. A modeled 0.11.1 accepted malformed patch
with a matching digest still refuses publication with zero provider writes and
unchanged patch/approval records. Exact supported v1 writers now include 0.11.2;
all current provenance, source, browser, workflow and publication gates remain.

`npm ci --ignore-scripts`, `npm run build:dashboard` and `npm run check`
passed for this candidate: 297 runtime/package tests and 58 dashboard tests.
These are real local Git/executor/controller regressions using controlled
Docker/model/provider fixtures, not installed native or live provider proof.
Operator installed/native proof on Z13, independent native Review, guarded
publication and adoption remain pending. No UI source changed; #90 remains the
next restoration slice before #62/#63. See [recovery](recovery.md) for preserving
old malformed evidence and the separately reviewed maintainer/new-attempt routes.

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
