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

Review the staged `.github/ISSUE_TEMPLATE/` forms and `.factory-kit/labels.json`.
The source catalog lives at `adlc/labels.json`. Merge with existing conventions;
never delete unrelated labels or overwrite templates indiscriminately.
For an authorized GitHub repository, inspect existing labels before creating or
editing the selected ones and read back the result.

| Label | Meaning |
| --- | --- |
| `factory:triage` | Report or idea needing scope |
| `factory:spec` | Outcome or acceptance needs definition |
| `factory:ready` | Accepted scope ready for explicit admission |
| `factory:review` | Candidate needs independent review |
| `factory:blocked` | Concrete dependency prevents progress |
| `track:software` | Software delivery |
| `track:security` | Scoped security work; sensitive findings stay private |

Use at most one planning-stage label. Actual native execution state is separate.
Closed issues can represent completion or a declined proposal. Factory does not
automatically rewrite labels or start a triage agent while browsing.

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
