# Prepare a repository for Factory work

The method works with an existing agent and CI. The optional runtime adds a
queue, isolated execution and dashboard. Use the chosen Git forge, issue tracker
and CI. GitHub is the currently implemented runtime issue adapter and the example
below, not a requirement of the method. Unknown hosts retain local brief execution;
do not translate these commands into guessed provider APIs. Labels are planning
metadata, not execution triggers.

## Establish a reproducible baseline

Record the canonical Git origin, target branch, committed source revision,
toolchain, check command and existing owner instructions. Preserve WIP separately.
Verify the real checks in the intended job image and CI. Inspect the actual
branch protection/ruleset: required checks, current-base behavior, PR policy and
merge authority. If an account plan prevents enforcement, record the limitation;
do not silently change billing or repository visibility.

## Carry project contracts into execution

Use the repository's maintained instructions and canonical standards. Discover
coding rules in CODE_STANDARDS.md, CODING_STANDARDS.md or CONTRIBUTING; keep one
home. DESIGN.md owns the visual direction; a separate DESIGN_SYSTEM.md may own
reusable components/tokens. Preserve existing paths, link code/configuration,
and update guidance with the changes it describes. Do not manufacture duplicate
files or assume that an old implementation is the intended standard.

Before admission, check that the committed source contains the relevant guidance
and AGENTS routes a fresh job to it. Record terminology and durable decisions
where the project already keeps them. Skills guide behavior; enforce mechanical
rules through actual checks and access limits. A prose rule is not a sandbox.

## Adopt provider-appropriate issue forms and labels

Preserve the adopter’s conventions. The following GitHub example only applies
when GitHub was selected; other providers require their own supported formats.

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

Submit the selected issue with `factory run --issue URL --state
PATH`, or submit a reviewed task file using `run --file`. Issue submission uses
the operator's `gh` authentication and checks the issue against the configured
origin. The dashboard and `issue create` can create a GitHub issue through the selected
provider, without starting execution. `issue start` or a deliberate UI Start
admits work separately. Remote issues remain the provider’s backlog; SQLite
retains execution and creation receipts. Browser login is separate from host
access. Optional schedules belong to the harness, not a Factory polling module.

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

The staged kit includes Factory task, Bug report and Feature request forms. Review them before adoption. Its export deliberately omits this repository’s security contact links; configure a private reporting route owned by the adopting repository. New issues remain backlog until explicitly admitted.
