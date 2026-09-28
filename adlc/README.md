# Adopt the factory method

Factory gives an existing app a shared method for development, security and review. Keep the app's architecture, code, CI, hosting and established instructions.

## With the local runtime

Use the CLI's `init` and installation workflow. Jobs receive policy and the six skills directly as read-only mounts. No global skill installation or manual copying into the app is required. Initializing an installation does not start work.

## With your existing agent

Export a new staging directory with `factory kit --output NEW_DIRECTORY`. The exporter maps the canonical packaged `adlc/skills/` catalog into staged `.agents/skills/`; it does not export Factory Foundation or install global skills. Give that directory to the app's agent and ask it to adopt the relevant method on a branch:

> Read the app's instructions, architecture, tests and CI first. Apply the supplied factory method within its existing authority. Fill the installation record from the repository and known choices, merge intentionally, preserve existing files and report what was connected, tested or still missing. Start manually. Accounts, publishing and deployment follow my existing mandate.

The agent can reference the staged instructions or intentionally adopt relevant files. If copying is appropriate, review `.factory-kit/` and the needed `.agents/skills/factory-*` folders; merge naming conflicts and preserve AGENTS.md. Add a local route only when needed. The optional issue form and CI example are inactive until deliberately adapted. No secret belongs in the installation record.
Discover the project's existing VISION.md or equivalent explicit product brief. Preserve it. If none exists, the staged `.factory-kit/VISION.template.md` is a starting point for owner review, not an automatic replacement or mandatory duplicate.
Treat unclear scope as needing an owner decision before implementation; a completed task or agent turn does not change that boundary.

Example: if an owner-approved `docs/product.md` promises CSV import, fixing a bug that rejects a valid CSV is aligned; add a regression check. Moving the app to a hosted platform is unrelated to that brief and needs owner direction before changing scope. The approved `docs/product.md` is sufficient even when no file is named `VISION.md`.

The six skills cover triage, specification, implementation, review, security and evaluation. Use the ones needed; six instructions do not imply six concurrent agents. See [policy](policy.md), [installation](installation.md) and [delivery](delivery.md).

## First real task

Follow [repository readiness](repository.md) to adopt issue forms and labels,
verify CI/protection and explicitly admit a scoped task. Exporting this kit does
not install GitHub labels, poll issues or start agents.

Choose a small existing defect or improvement. Describe the intended user behavior, allowed scope and observable acceptance check. Implement a working vertical slice, exercise the app's relevant checks and obtain a separate review of the delivered revision. A demo or copied skill files alone do not qualify an application.

A PR requires the configured GitHub authority. Otherwise hand back the branch/diff and evidence with an honest status. Unknown cost/time remain unknown. Automated starts require separate qualification of triggers, deduplication, stop/restart and actual resource limits; a skill does not create a scheduler.

## Native instruction loading

Claude Code loads repository `AGENTS.md` files starting with version 2.1.277;
version 2.1.281 or newer avoids earlier provider and telemetry limitations.
A project or ancestor `CLAUDE.md`, `.claude/CLAUDE.md` or `CLAUDE.local.md`
can take precedence, and disabling built-in AGENTS.md support changes whether `AGENTS.md` is loaded. After
adoption, verify the effective instructions with `/context`. Do not change user
settings as part of adoption. See the [Claude Code memory documentation](https://code.claude.com/docs/en/memory#agents-md).

Update by exporting a new version and reviewing the differences. Preserve the app's completed installation record. The manifest records source revision and file hashes; it is provenance, not a signature or active runtime configuration. MIT applies to this method and does not change the app's license.
