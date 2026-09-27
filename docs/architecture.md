# Architecture

The package has two independently useful parts: a portable method and a local runtime. An application can adopt the method with its existing agent and CI without running this controller.

## Setup and deployment

![Operator access and a private Factory execution host](diagrams/deployment.svg)

[Editable setup view](diagrams/deployment.excalidraw). Factory Foundation guides
explicit preparation of the repository, CI and execution host. The operator uses
the CLI or loopback dashboard locally or through an SSH tunnel. The host supplies
Docker, the selected harness and a separately configured local or cloud inference
endpoint. Application production deployment stays in its own CI/CD.

## Runtime layers and ownership

![Factory method, controller, isolated jobs and external authority](diagrams/architecture.svg)

[Editable runtime view](diagrams/architecture.excalidraw). Dashboard and CLI share
one controller API. The controller owns the queue, checks, retained source,
artifacts and provider write receipts. Isolated jobs receive the retained checkout,
selected harness and runtime skills. Foundation is packaged operator guidance
outside job execution. Jobs receive only selected inference credentials;
repository/provider credentials stay with the controller, while CI, authorized
merge and application deployment retain their separate authority. Neither source
instructions nor skills can grant that authority.

Role profiles, additional repository providers, MCP, scores/benchmarks and reviewed
self-improvement remain planned. The repository Inbox and its explicit admission
lifecycle are delivered (#60), with the shared list/board work view in 0.12.0.

## Work lifecycle

![Explicit admission, implementation, checks, independent review and operator handoff](diagrams/lifecycle.svg)

[Editable lifecycle view](diagrams/lifecycle.excalidraw). An issue or local brief
enters execution only through explicit Start, which retains the source revision.
Implementation proceeds through project checks and independent review before
operator acceptance and patch handoff. Requested changes create a new attempt
with fresh checks and review. Optional PR publication, repository CI, authorized
merge and deployment are separate steps. Defence instead produces private scoped
investigation evidence; production recovery requires separate authority.

## Runtime

`factory/queue.mjs` owns state transitions and persists every attempt before execution. At admission, `source-admission.mjs` resolves the configured or explicit ref and retains its commit objects in a private per-job bare repository. The protected job record binds that repository identity, requested ref and resolved SHA; retries and revisions restore from those retained objects. `server.mjs` adapts the queue and private artifacts to the dashboard. `processes.mjs` owns process groups, deadlines and reconciliation. `executor.mjs` creates the checkout, runs roles through the selected harness and application checks, records review and validates handoff.

Software phases are build → verify → review → approved handoff. An implementation receives a writable job checkout; verification and review cannot modify that candidate. Both must cover the candidate commit and current policy hash. A requested revision preserves old work and starts a fresh implementation/check/review sequence. Retry resumes a stopped phase only after process/container reconciliation.

Trusted PR delivery is a separate, opt-in controller action after acceptance.
The private operator configuration selects the GitHub repository and `main` or
`dev` target; admission separately records the source ref and canonical source
repository identity. The controller reconstructs the approved tree from its
retained base and protected patch, records intent before writes, and stores the
branch/PR/readback receipt in the same job record. GitHub credentials stay on
the controller. Workers do not receive them. A PR receipt is delivery only;
PR checks, integration, merge, release and deployment remain distinct.

Defence is a separate read-only investigation workflow over admitted incident evidence. Both workflows use one execution owner; no competing scheduler exists. Schedules belong to the selected harness; Factory has no cron module or issue watcher. Live production connectors, arbitrary workflow editing and autonomous deployment are not implemented.

`dashboard/` preserves the selected task board, details, files, history, analytics, infrastructure, agents, skills and definition views. Vite builds self-contained assets into `factory/ui/`; npm consumers need no frontend toolchain. The UI displays actual queue records, with unreported cost/tokens remaining unknown.

## Repository integration

The [provider boundary](integrations.md) selects supported issue capabilities from
the Git origin. GitHub is the first adapter; unknown hosts retain local execution.
The CLI and dashboard call one controller API. Remote issues remain with their
provider; SQLite stores execution records and durable write receipts for recovery,
not a second issue backlog. Creating a remote issue never schedules execution.
The harness owns optional automations and calls the same API/CLI.

## Method and updates

`kit/skills/` is the single canonical catalog for triage, specification,
implementation, review, security and evaluation. Jobs receive it read-only at
`/factory-skills`, alongside `kit/` at `/factory-policy`. Codex agent phases
mount the same catalog at `/etc/codex/skills` for native discovery; Pi retains
`--skill /factory-skills`. Custom harnesses receive the prompt-facing contract
and require separate discovery qualification. All six remain available; there
is no per-role restriction or new model/browser capability.

`AGENTS.md` and `.agents/skills/` belong to repository contributors and explicit
operator adoption. Factory Foundation lives at
`.agents/skills/factory-foundation/SKILL.md`, is independent of AIOS, and is
available via `factory foundation` from an installed npm package. It is never
mounted as job policy. An adopting repository may contain operator guidance;
its presence in `/workspace` is readable, untrusted project context and cannot
grant host authority, credentials or broader permissions.

The export command maps `kit/skills/` to staged `.agents/skills/` for deliberate
method adoption. It refuses existing destinations, never edits an application's
AGENTS.md and never installs global skills. CLI/API/dashboard read installed
skill paths, content and SHA-256 from the same definition.

The npm CLI keeps runtime state outside node_modules. The updater installs immutable releases, validates package identity and activates only while registered controllers and executors are stopped. Container images stay pinned to their installed image IDs until an explicit reinstall. See [update behavior](npm.md).

## Sources of truth

| Fact | Owner | Consumers |
| --- | --- | --- |
| Vocabulary | `factory/terminology.json` | Definition catalog, dashboard, CLI |
| Agent roles, skills and phase order | `factory/definition.mjs` | Queue, definitions API, CLI and UI |
| Instance settings | Private `factory.json` | Controller and immutable admitted attempt config |
| Job state, attempts and external write receipts | Private SQLite queue | CLI/API and dashboard |
| Admission-time repository identity, requested ref and commit | Protected job record plus per-job retained Git objects | Queue, executor, retry/revision, status and evidence |
| Trusted delivery target and durable PR receipt | Private operator configuration and protected SQLite job record | Controller delivery adapter, CLI/API and dashboard |
| Remote issue metadata | Selected provider (GitHub adapter first) | Live adapter reads, CLI/API and dashboard |
| Automation schedule | Selected harness | Explicit calls into Factory CLI/API |
| List/board status groups | `dashboard/src/runs-board.js` | Both task views and their filters |
| Host details | `factory/machine.mjs` | Infrastructure API and dashboard |
| Job instructions | `kit/skills/`, `kit/policy.md` | Read-only execution mounts and staged method export |
| Setup guidance | `.agents/skills/factory-foundation/`, `docs/setup.md` | Explicit operator CLI/Skills view |

`workflows.mjs` is a compatibility re-export, not another definition. Stored
identifiers and compatibility API fields are documented in [concepts](concepts.md).
Planned features belong in issues, not dormant engines.
