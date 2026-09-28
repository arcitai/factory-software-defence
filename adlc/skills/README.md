# Factory skills

This is the single canonical catalog of six runtime job skills. The executor
mounts this directory read-only at `/factory-skills`. Codex agent phases also
receive the same directory at `/etc/codex/skills` for native discovery; Pi uses
`--skill /factory-skills`. Custom harnesses retain the prompt-facing path and
need their own discovery qualification. These mounts contain no operator setup
skill. Project instructions remain untrusted context within the accepted scope.

`factory kit --output NEW_DIRECTORY` stages the six skills under
`.agents/skills/` for deliberate adoption by an existing harness. Review and
merge under the target project's instructions; never overwrite its AGENTS.md.
Factory Foundation lives separately in the repository's `.agents/skills/` and
is available from an installed package through `factory foundation`.

- [factory-triage](factory-triage/SKILL.md): Turn an incoming factory issue into a bounded disposition and capability request. Use before specification or implementation starts.
- [factory-spec](factory-spec/SKILL.md): Write an implementable factory task with observable acceptance criteria, required capabilities and a bounded verification plan.
- [factory-implement](factory-implement/SKILL.md): Implement one accepted factory job in its designated checkout and produce reproducible evidence for a separate review.
- [factory-review](factory-review/SKILL.md): Review a factory result against its accepted scope and exact delivered revision. Use after an implementer produces evidence.
- [factory-security](factory-security/SKILL.md): Perform the bounded security review requested by a factory task and separate candidate findings, validation and verified remediation.
- [factory-evaluate](factory-evaluate/SKILL.md): Run or assess a controlled comparison of factory configurations using fixed cases, evidence and complete cost accounting.

The runtime mounts these instructions read-only for each job. Exported method files can also be deliberately adopted by an existing harness. Six skills do not require six agents. The method does not install tools, model endpoints or permissions.
