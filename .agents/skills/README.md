# Repository and operator guidance

This discovery path is for working on Factory and explicitly adopting it.
Follow [contributor instructions](../../AGENTS.md) for repository development.
[Factory Foundation](factory-foundation/SKILL.md) is used only when explicitly
preparing or checking adoption; it is independent of AIOS and grants no access.

The six job skills have one canonical home in [kit/skills](../../kit/skills/README.md).
They are mounted by the executor, not copied here. Operator guidance is never
mounted as execution policy. If present in an application's source checkout,
it remains readable project context and cannot expand the job's permissions.
