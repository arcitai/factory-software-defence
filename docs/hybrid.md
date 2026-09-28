# Local Build · Cloud Review

An optional recipe using the existing role definition: **Local Build** runs the
isolated implementation worker against an explicitly selected model on
operator-controlled inference hardware; **Cloud Review** runs a separate,
read-only review context against an explicitly selected hosted model. Both
workers can run on the same local or VPS execution host. Worker hosting and
inference location are separate choices; hosted Factory infrastructure is not
required.

![Execution stages and separate local and hosted inference boundaries](diagrams/hybrid.svg)

[Editable diagram](diagrams/hybrid.excalidraw) · [Architecture](architecture.md#local-build--cloud-review)

Issue / explicit admission → Local Build → deterministic Verify → Cloud Review
→ operator acceptance → optional protected PR and repository CI. Build returns
to Factory; it does not launch a duplicate review pipeline. Checks and Review
cover the exact candidate and current policy. Review is no correctness guarantee
or automatic merge; merge, release and application deployment retain their own
authority. Reserve **Audit** for scoped audit/Defence work.

## Select and qualify

Use the delivered [local/hybrid setup guide](setup.md#optional-keyless-local-or-hybrid-inference)
and [definition binding instructions](definition.md#opt-in-local-bindings-0150-69).
Select a private local Pi binding for `implement` and an explicit supported
hosted harness/model for `review` through the shared CLI/API or Agents/Definition
editor. These readable recipe names add no roles, commands, schema fields or
scheduler. The working default remains unchanged until explicit adoption.

- **Preserve and preview.** Save the working portable definition, private bindings,
  stopped-state backup and immutable worker image ID. Preview the effective
  selections before revision-guarded, idle adoption. Each attempt freezes its
  resolved profiles and common timeout, resource and skill policy. Broader
  per-role skill/access restrictions remain planned.
- **Qualify from isolation.** Probe the selected endpoint and exact model from the
  job image/network, including tool calls and report completion. Record model
  digest/version, quantization, backend/offload and memory. Reconcile declared
  context and output limits with actual server/model/request allocation and
  headroom using the [context guidance](setup.md#local-context-budget-and-worker-image-0152-100).
  Allocation success is separate from long-context task quality. Keep inference
  access separate from forge/controller credentials; missing models/providers
  must fail without silent cloud substitution.
- **Retain independent evidence.** Configured profiles are desired selections,
  not qualified quality. Use bounded fixtures with decisive acceptance tests
  independent of Build and separate Review contexts before real work. Retain
  failed attempts, repairs and both local and cloud Review usage under the
  [usage coverage contract](usage.md). Pi observations are partial; unknown
  usage/cost stays unknown. Local inference avoids provider token billing, not
  electricity, hardware or operator cost; no speed or saving is guaranteed.
- **Roll back deliberately.** Restore the saved roles/bindings through
  [revision-guarded rollback](definition.md#inspect-review-and-adopt) while idle;
  image rollback is separate. Preserve history and frozen attempts.

The latest recorded real repository local attempt failed; see
[retained qualification evidence](proof.md#short-local-pi-history-recovery-0155-candidate-105).
This recipe establishes no local-AI success. Broader role definitions (#53) and
local/hybrid software-quality qualification (#69) remain open.
