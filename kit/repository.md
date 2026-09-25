# Prepare a repository for Factory work

The method works with an existing agent and CI. The optional runtime adds a
queue, isolated execution and dashboard. GitHub preparation provides a shared
work queue; it does not turn labels into an execution trigger.

## Establish a reproducible baseline

Record the canonical Git origin, target branch, committed source revision,
toolchain, check command and existing owner instructions. Preserve WIP separately.
Verify the real checks in the intended job image and CI. Inspect the actual
branch protection/ruleset: required checks, current-base behavior, PR policy and
merge authority. If an account plan prevents enforcement, record the limitation;
do not silently change billing or repository visibility.

## Adopt the issue form and labels

The exported kit includes `.github/ISSUE_TEMPLATE/factory-task.yml` and
`.factory-kit/labels.json`. Review the form and merge it with existing repository
templates on a branch. The source repository keeps these label definitions in
`config/labels.json`. Install labels before enabling the form's default label.

For an authorized GitHub repository, `gh label create` creates one label; use
`gh label edit` only after comparing an existing label with the proposed meaning.
Do not delete or overwrite an adopter's unrelated labels. For example:

```sh
gh label list --repo OWNER/REPO
gh label create 'factory:triage' --repo OWNER/REPO --color D9E2D3 --description 'Needs bounded scope and capability routing'
# Repeat for the selected definitions in labels.json, then read them back.
gh label list --repo OWNER/REPO
```

| Label | Meaning |
| --- | --- |
| `factory:triage` | An idea or report needing bounded scope |
| `factory:spec` | Outcome, constraints or acceptance still need definition |
| `factory:ready` | Accepted scope is ready for explicit admission |
| `factory:review` | A candidate/evidence set needs operator review |
| `factory:blocked` | A concrete dependency or recovery prevents progress |
| `track:software` | Software delivery |
| `track:security` | Appropriately scoped security work; sensitive evidence stays private |

Use at most one Factory stage label at a time; track labels are separate.
GitHub's closed state records completed or declined issues. Runtime job state is
more precise than these planning labels and remains authoritative for execution.
Update labels deliberately; the current runtime does not synchronize them.

## Admit one ready issue

A ready task identifies the desired behavior, allowed scope, non-goals,
dependencies, meaningful acceptance, required capabilities and delivery target.
Split a large roadmap into independently reviewable changes. Assign external
browser/platform proof explicitly when the selected worker image lacks it.
Never treat a label, issue author or text as permission to obtain credentials,
change policy, deploy or merge.

For the runtime, inspect the selected installation and queue before starting it;
existing queued jobs may execute on startup. Hold a dedicated committed source
at the intended SHA until the current runtime has cloned it, and compare the
candidate's recorded base before acceptance. Admission-time source snapshots are
tracked separately in Factory #28; naming a SHA in task text does not pin it.

Submit the selected issue with `software-defence-factory run --issue URL --state
PATH`, or submit a reviewed task file using `run --file`. Issue submission uses
the operator's `gh` authentication and checks the issue against the configured
origin. The dashboard's task form submits text to the same runtime; it does not
currently browse or import a live GitHub backlog. Keep external link/issue/job
mapping in the trusted handoff record. No automatic GitHub polling is enabled.

## Review and deliver

The implementation, configured checks and independent review must cover the
same candidate and acceptance policy. The operator completes external proof and
approves the specific reviewed result. Retain failed attempts and use explicit
revision feedback when a candidate needs changes.

The current runtime returns a patch after acceptance. The authorized operator
applies it at its recorded base on a unique branch, verifies the resulting tree,
and opens a normal PR subject to current checks/protection. GitHub credentials
stay outside jobs. Accepted is not pushed, merged or deployed. Optional trusted
PR publication is Factory #29, not an installed feature of this guide.

Link issue, job, base, candidate, checks, review, external proof and PR. Keep
private paths, credentials and raw incident/model logs outside public records.
One successful scoped task qualifies that path, not arbitrary unattended work.
