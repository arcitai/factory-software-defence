---
name: factory-spec
description: Write an implementable factory task with observable acceptance criteria, required capabilities and a bounded verification plan.
---

# factory-spec

Use the project’s established terminology and standards. Reuse accepted answers;
research factual gaps and ask only for decisions that materially affect the work.

Use the supplied business outcome and repository facts to write a short task: problem, intended behavior, allowed changes, exclusions, required capabilities, verification, risk and recovery. For uncertain implementation choices, propose a small experiment with a stop condition.

A new feature may need both product behavior and technical approach; do not force two long documents for a simple repair. Reference the relevant code and existing test commands. Unknown facts stay unknown. Specify which evidence would settle them.

Add a compact architecture sketch only for unresolved choices that materially
affect interfaces, ownership or data shape, or an explicit architecture request.
Ground it in the affected code and the project's language and architecture
records: show caller usage, relevant types/data shape, ownership/interfaces and
significant failure behavior. File count, newness and size alone do not trigger
it; routine repairs and already-accepted architecture need no new ceremony.
Carry accepted decisions and current project standards forward.

For empirical uncertainty, use a small local trial with a concrete stop condition
and evidence that selects the shape. Mark the sketch provisional, distinct from
runnable production. Pass the selected shape into the first runnable vertical
slice and its verification. Revise the sketch when observed implementation
evidence contradicts it or repeated friction exposes a mismatch; do not
automatically discard code after one unusual case. Bind checks and independent
review to the actual candidate. The sketch adds no approval gate.

Plan substantial implementation as vertical slices: each delivers one observable behavior through the necessary layers, with an executable check and relevant failure case. Identify the first runnable slice and a short extension order. Do not make database, backend and frontend separate delivery phases. Tie prerequisite work to its consuming slice; small fixes may be one slice. Slice boundaries organize work within the accepted scope and do not create additional approval gates.

When splitting a roadmap into issues, record blockers by real identifiers and
keep each task independently reviewable. Only work whose prerequisites are
resolved can be admitted. Preserve uncertain future decisions as open questions
instead of inventing implementation tickets. Runtime dependency scheduling is
not implied: the operator still selects and admits ready work.

Use the owner's accepted task or the project's established readiness policy to identify repository, allowed changes, selected execution profile, capability requirements and acceptance criteria. A profile can be a readable installation record; no particular controller is required. Material changes to accepted scope require renewed acceptance. Produce the proposed scope without inventing approval or starting a job merely because this skill was loaded.

When the project uses lifecycle labels, consult its reviewed catalog and map
only labels that the source actually carries. Specification may be skipped for
accepted small work. Do not turn a planning label into an execution trigger or
infer that a Codex process is creating a specification.
