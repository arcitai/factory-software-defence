# Prepare a repository

The method works with existing agents, issue trackers and CI. The current Factory
Inbox integrates GitHub; another forge requires a qualified integration and is
not silently treated as GitHub. Labels are planning metadata, never execution
permission.

## Establish the baseline

Identify the canonical origin, owner, target branch, source revision, real check
command and native execution environment. Preserve useful uncommitted work.
Keep the application's approved vision and canonical instructions, code standards
and design sources. Avoid duplicate Factory-specific versions of those files.

Verify meaningful checks on the intended host and in CI. Inspect actual branch
and environment protections, required checks, merge authority and release policy.
A workflow file does not activate service-side protection. Record unavailable
controls without changing billing or visibility to obtain them.

## Adopt issue forms and labels

Review the staged `.github/ISSUE_TEMPLATE/` forms and
`.factory-kit/lifecycle.json`. The source catalog is `adlc/lifecycle.json`;
`adlc/labels.json` and the exported `.factory-kit/labels.json` are its flat label
projection. Treat the catalog as the single default for stage IDs, label names,
colors, closure reasons and presentation. Keep the adopting repository's existing
labels and readiness mapping where they differ; do not replace its conventions
with an unrelated global scheme.

Inspect actual labels and issue state before deciding which catalog entries to
adopt. Preserve unrelated labels and templates. If an authorized operator adopts
or changes selected labels, use ordinary GitHub edits and read the result back.
Do not rewrite historical issues as part of catalog adoption. A repository phase
is resolved from one actual phase label on an open issue; missing, conflicting,
stale or unloaded source metadata remains unresolved. Closed is Done only when
GitHub supplies the completed reason. Declined or reasonless closure remains
Closed.

Stage labels declare repository intent; they are not proof of a running agent.
Show Codex running, completed, failed, interrupted or unknown state separately.
Changing labels and browsing the Inbox do not start or resume work.

## Admit and deliver

A ready issue states the desired behavior, allowed scope, non-goals, dependencies,
checks and required capabilities. Split large work into independently reviewable
outcomes. Explicitly arrange browser or other proof missing from the selected
native environment. An issue author cannot grant accounts, tools or publication.

The Inbox loads repository issues. New issue uses the repository's forms and
creates the issue without running an agent. Start work is a separate deliberate
action; the host rechecks current content and ownership. Continue uses the same
native history with explicit feedback. Harness-owned schedules, if selected and
qualified, remain outside Factory.

Review and test the exact resulting candidate. Native completion is not acceptance.
Use the repository's normal branch, PR, CI and authorized delivery process; there
is no Factory publication engine. Link the issue, native session, revision,
checks and review without exposing private paths, credentials or raw findings.
One successful task qualifies that tested path, not arbitrary unattended work.

The export omits this repository's security contact links. Configure a private
reporting route owned by the adopting project.
