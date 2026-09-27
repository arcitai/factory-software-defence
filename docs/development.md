# Developing Factory through Factory

Factory can treat this repository as an application. The released package runs
the job; the job edits a separate source checkout. This prevents a candidate
from changing the controller, protected policy or evidence that will accept it.

## Keep the three locations separate

| Location | Purpose |
| --- | --- |
| Developer checkout | Committed source, task branches and PR handoff |
| Installed npm release | Stable CLI/controller used to execute the job |
| Private application state | Configuration, model environment, jobs and evidence |

Give Factory development its own state path and loopback port. Use one
dashboard/controller per project. A synthetic demo remains a separate
installation; it is not the project dashboard or proof of product work.
Other applications need not run while Factory itself is being developed.

The dashboard identifies the configured directory and keeps its full path in a
secondary disclosure (#25). The readable task-form label still submits `app`. Optional project identity
from `DESIGN.md` is planned in #27; it is not supported configuration yet.
Shared navigation, state meanings, evidence and approvals remain Factory-owned.

## Prepare the source and checks

Follow the [contributor setup](../CONTRIBUTING.md), then verify the exact source
revision and a clean checkout. Preserve unfinished work in its existing branch
or worktree. Job admission resolves the configured ref, a CLI `--source-ref` or
the dashboard source-ref field, and retains that commit before acknowledging
the job. Use a full SHA when Factory development must use one exact candidate base; task text naming
a SHA does not pin it. Compare each recorded candidate base with the intended
SHA before acceptance.

For this repository, the configured full check is:

```sh
npm ci --ignore-scripts && npm run build:dashboard && npm run check
```

Select an image containing the supported Node/Git toolchain and chosen agent.
Exercise the full baseline inside that image before the first task. The check
does not need the Docker socket inside the container. Controller/runtime
qualification is performed by the operator outside implementation jobs, in
separate synthetic state. Browser acceptance likewise needs an explicitly
available browser; the stock image does not promise one.

## Configure the released runtime

Establish host access, inference and resource limits using the existing
[setup plan](setup.md). These example paths/ports are placeholders and must be
replaced with user-owned locations and an unused port:

```sh
software-defence-factory init --repo /absolute/path/to/factory-source --harness pi --check "npm ci --ignore-scripts && npm run build:dashboard && npm run check" --source-ref main --state /private/state/factory-development --port 7343
software-defence-factory install --image FACTORY_DEV_IMAGE --state /private/state/factory-development
software-defence-factory doctor --state /private/state/factory-development
```

Replace `FACTORY_DEV_IMAGE` with an image reference already present in the
worker's local Docker daemon and compatible with the selected agent and checks.
The command validates and retains its exact ID, records private runtime/image
metadata and does not download or build it. Stop and reconcile the installation
before changing images. Plain `install` remains available when the standard
image is wanted. Configure the chosen model and only its inference environment
in private state; never copy GitHub/npm credentials, personal agent
configuration or the host's Docker socket into a job. A local model endpoint
must be reachable from the actual isolated image/network. The setup plan covers
that separate connectivity/boot obligation. `doctor` verifies image readiness;
model and toolchain qualification remain separate checks.

For the small dashboard pilot, a bounded profile uses four CPUs, 4 GiB of job
RAM, 512 processes and a 30-minute phase deadline. The local inference server
has its own host resource budget. Record actual model, runtime/image versions,
limits, source and evidence privately; these values are a tested project
profile, not minimum requirements for every model or task.

## Submit one ready slice

Inspect the queue before starting an existing state. `up` or a managed service
will execute already queued work. For a newly configured, empty state:

```sh
software-defence-factory up --state /private/state/factory-development
software-defence-factory run --issue https://github.com/arcitai/software-and-defence-factory/issues/25 --state /private/state/factory-development
```

Choose an **open, accepted issue** from the [todo](../todo.md); #25 is the first
pilot, not an instruction to repeat a completed task. `run --file` is also
supported. The controller owns build → configured checks → independent review
→ approval/handoff. Review uses a separate model context over the exact
candidate and policy. The operator reads the actual patch and evidence and
completes any browser or other external acceptance before approving.

Inspect failures rather than resubmitting blindly. `cancel JOB_ID` stops the
selected attempt; after reconciliation, `retry JOB_ID` retains prior evidence.
A validated software review returning `changes` or `blocked` can receive explicit
revision feedback through **Request changes**, or:

```sh
software-defence-factory revise JOB_ID --file /private/revision.md --state /private/state/factory-development
```

This preserves the failed review, candidate and evidence and begins a new build,
checks and independent review before a new approval gate. **Retry** repeats the
stopped phase on the same candidate; it does not implement review feedback.
Missing or malformed reviews must first be diagnosed, not reclassified as passes.
See [recovery](recovery.md) for logs, attempt profiles and legacy evidence.

UI tasks need a browser-capable operator to inspect the built assets, including
any corrections made after automated review. A stopped review may legitimately
require that external proof. Keep it tied to the final UI hashes and distinguish
lead acceptance from the controller's acceptance record. A model response or
JSDOM test does not establish the rendered layout.

## Handoff, delivery and operation

The CLI returns an accepted patch. Optional trusted PR publication is delivered
under [#29](https://github.com/arcitai/software-and-defence-factory/issues/29)
when the installation is explicitly configured; it remains a separate operator
action. Apply a patch on a unique branch at its recorded base, compare the
resulting diff/tree, run applicable integration checks and open a PR when using
patch-only handoff. Changed content or base needs fresh relevant review. The
repository's actual required checks still govern integration. Keep raw prompts
and host-specific paths private.

Use [managed services and tunnels](services.md) for boot/login startup and
operator access to the project's loopback dashboard. Installed npm updates
change the orchestration runtime only while idle; they do not update this
source checkout, merge its PRs or rebuild the selected job image.

A candidate dashboard can be previewed in separate private state on another
unused port after its assets build. Do not run an unreviewed candidate server
against the existing job database. Publishing the reviewed version and adopting
it through the normal updater is a separate release step.

Retain the issue/job/base/candidate/check/review/PR chain and update
[proof](proof.md) only with observed results and limitations. One successful
dashboard task does not complete the wider security/model qualification (#6),
live Defence workflow (#7) or arbitrary unattended software development.
