# Adopt the Factory method

Keep the application's architecture, code, instructions, CI and hosting.
Factory supplies a portable way to scope, implement, check and independently
review work. A dashboard or particular model account is not required.

## Stage, review, adopt

```sh
factory kit --output NEW_DIRECTORY
```

The exporter stages this method, six `.agents/skills/factory-*` directories,
optional issue forms/labels and an inactive CI example. It does not overwrite an
application, install global skills, grant access or start work. Foundation is a
separate setup skill and is not part of the execution catalog.

The default repository-stage and label catalog is [lifecycle.json](lifecycle.json).
The exported `labels.json` is its flat label projection. Existing
`factory:triage`, `factory:spec`, `factory:ready` and `factory:blocked` readiness
labels remain supported; `factory:ready` means ready to implement and allows a
small accepted task to skip specification. Review the catalog against the
adopting repository's existing labels before adopting it. Unmatched, conflicting
or stale source labels stay unresolved in the Inbox. A stage label is a
repository declaration, never evidence that a native turn is running.
`factory:not-planned` retains open work before Triaging. It is distinct from
GitHub closure with reason `not_planned`; unlabeled work remains unresolved.
The catalog supplies defaults; preserve repository edits when adopting or
re-running Foundation. Adding a stage never starts or accepts native work.

Ask the application's agent to read its existing instructions and adopt only the
relevant material on a branch. Merge conflicts deliberately and preserve the
canonical AGENTS.md, design and coding standards. Fill the [installation record](installation.md)
from actual evidence and accepted choices; keep secrets out.

Find the owner's approved VISION.md or equivalent brief. Preserve that source.
If absent, stage the supplied vision template for review; a draft does not grant
new scope. For example, fixing a CSV import bug fits an approved CSV-import brief;
turning it into a hosted platform requires an owner decision. A file named
`docs/product.md` can be sufficient—do not create a duplicate just for its name.

## Work and improve

The six skills cover triage, specification, implementation, review, security and
evaluation. Use only what is relevant; six skills do not require six agents.
Follow [policy](policy.md), [repository readiness](repository.md) and the
[delivery record](delivery.md).

Choose one small real task with an observable acceptance check. Exercise the
actual environment and obtain separate review of the delivered revision. Copied
skills or a synthetic test alone do not qualify an application. Improvements
must fit the owner's vision and show an observed problem; they cannot alter
permissions or rewrite the vision to justify themselves.

When using the native Factory integration, setup stages these skills in its
separate Codex home. Otherwise verify discovery using the chosen harness's native
mechanism. Native instruction-loading support is version-specific; do not assume
all harnesses discover identical directories. The method does not install tools,
providers or schedules.

Update by exporting a new version and reviewing differences. Preserve completed
adoption records. The manifest contains source and file hashes; it is provenance,
not a signature or active policy. MIT applies to the method, not to the app's code.
