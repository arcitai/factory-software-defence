---
name: factory-spec
description: Write an implementable factory task with observable acceptance criteria, required capabilities and a bounded verification plan.
---

# factory-spec

Use the project’s established terminology and standards. Reuse accepted answers;
research factual gaps and ask only for decisions that materially affect the work.

Use the supplied business outcome and repository facts to write a short task: problem, intended behavior, allowed changes, exclusions, required capabilities, verification, risk and recovery. For uncertain implementation choices, propose a small experiment with a stop condition.

A new feature may need both product behavior and technical approach; do not force two long documents for a simple repair. Reference the relevant code and existing test commands. Unknown facts stay unknown. Specify which evidence would settle them.

Plan substantial implementation as vertical slices: each delivers one observable behavior through the necessary layers, with an executable check and relevant failure case. Identify the first runnable slice and a short extension order. Do not make database, backend and frontend separate delivery phases. Tie prerequisite work to its consuming slice; small fixes may be one slice. Slice boundaries organize work within the accepted scope and do not create additional approval gates.

When splitting a roadmap into issues, record blockers by real identifiers and
keep each task independently reviewable. Only work whose prerequisites are
resolved can be admitted. Preserve uncertain future decisions as open questions
instead of inventing implementation tickets. Runtime dependency scheduling is
not implied: the operator still selects and admits ready work.

Use the owner's accepted task or the project's established readiness policy to identify repository, allowed changes, selected execution profile, capability requirements and acceptance criteria. A profile can be a readable installation record; no particular controller is required. Material changes to accepted scope require renewed acceptance. Produce the proposed scope without inventing approval or starting a job merely because this skill was loaded.
