# Contributing to Factory

Start with [AGENTS.md](AGENTS.md), the relevant [documentation](docs/README.md)
and an accepted issue with observable acceptance criteria. The ordered
[todo](todo.md) links the current work; GitHub issues own the detailed scope.

## Local development

Use Node 22.13+ and Git. CI checks Node 22 and 24. Dependency lockfiles in the
root and `dashboard/` are committed; use `npm ci`, not an unconstrained install.

```sh
npm ci --ignore-scripts
npm run build:dashboard
npm run check
```

`build:dashboard` installs the locked frontend dependencies and builds the
assets into ignored `factory/ui/`. Run it before the package tests, which
install a real tarball and require those assets. `check` validates JavaScript
and JSON and runs the runtime/package and dashboard suites. It does not start
Docker or prove a model's judgment, browser behavior or production access.

| Area | Responsibility |
| --- | --- |
| `bin/` | CLI entrypoint and operator commands |
| `factory/` | Controller, queue, executor, services, updates and packaged UI |
| `dashboard/` | React interface and its tests; edit source here, not generated assets |
| `kit/`, `kit/skills/` | Portable method and the canonical job-mounted specialist instructions |
| `.agents/skills/` | Repository/operator guidance, including explicit Factory Foundation adoption |
| `tests/`, `scripts/` | Runtime/package regressions, validation and release helpers |
| `docs/` | Maintained setup, architecture, operation and proof |

UI changes need a real browser walkthrough at desktop and narrow sizes, in
both themes, exercising the changed interaction and its failure states.
Runtime isolation/recovery changes need relevant synthetic Docker qualification
as described in [proof](docs/proof.md) and [recovery](docs/recovery.md). Never run
`demo` or `qualify` against an application installation.

## Project code standards

This section owns Factory's coding standards; DESIGN.md owns dashboard visuals.
Keep domain names aligned with `factory/terminology.json`. Add behavior at the
module that owns its state/policy, with CLI and UI consuming the same contract.
Prefer a small shared interface over parallel implementations or speculative
extension layers. Document supported compatibility aliases and their removal
conditions; never silently rewrite admitted attempt configuration or evidence.

Tests exercise observable outcomes, including relevant failure/recovery paths.
Use fixed expected results independent of the implementation. A refactor should
not require replacing assertions solely because private helpers moved. Preserve
precise user-visible errors, stale-action guards and unknown measurements.

When a failure reveals a reusable lesson, first fix or wire the executable check
that can catch it. Record judgment-dependent guidance here or in DESIGN.md only
when it changes future decisions, with its rationale. Correct weak navigation at
the owning entrypoint, and remove obsolete/duplicate rules. Keep a specific
incident in its issue/evidence rather than growing a permanent rule for every
mistake. Review requirement coverage and standard conformance independently.

## Issue, candidate and PR

Use a short task branch from `main`, one writer per checkout and a PR back to
`main`. Keep the issue, source revision, relevant checks and review evidence
linked in the PR. A passing agent report is not independent acceptance.
Never commit credentials, operational state or raw model/customer evidence.

The repository's main protection requires up-to-date GitHub Actions checks
`check (22)` and `check (24)`, a PR and resolved conversations, including for
administrators. Force pushes and branch deletion are disabled. The solo-owner
workflow does not require a second GitHub identity's approval; candidate review
still happens before handoff. Reconcile the actual branch settings if this
policy changes; this document does not enforce them.

CI builds/checks PRs and main. Its existing npm release job publishes a new
version on main only when release configuration permits it; unchanged published
versions are skipped. Keep package and lockfile versions aligned for a release,
verify the installed artifact and follow [npm delivery](docs/npm.md).
Neither issue assignment nor Factory acceptance authorizes autonomous merge,
release or deployment. Do not replace a running controller from a source checkout.

For development through Factory on a worker, use the
[self-development recipe](docs/development.md).
