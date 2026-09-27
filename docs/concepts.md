# Factory concepts

The canonical short definitions live in [terminology.json](../factory/terminology.json).
The CLI `definition` command and dashboard Definition page read that same catalog.

| Part | Responsibility | Current implementation |
| --- | --- | --- |
| Host | Compute, storage, OS and private network | Detected Linux/macOS machine; WSL2 as Linux |
| Controller | One project's queue, policy, HTTP API and dashboard | One Node/SQLite service |
| Worker | Executes jobs on a host | One local execution process; bounded Docker containers |
| Harness | Runs an agent | Codex, Pi, a custom command, or synthetic mock |
| Agent | Responsibility and instructions | Implement, Review, Investigate; one shared harness/model profile |
| Skill | Reusable instructions | Six job skills; separate operator Factory Foundation |
| Workflow | Ordered steps and gates | Software: Implement → Check → Review → Accept; Defence: Investigate |
| Issue | Bounded work request | Remote issue lives in its provider; a local brief needs no remote issue |
| Execution | Admitted work and its attempts | Stored in the private SQLite queue with source link and evidence |
| Provider | Repository issue integration | GitHub adapter first; unknown remotes retain local execution |
| Automation | External schedule and agent context | Owned by the selected harness; calls Factory CLI/API, no Factory cron |
| Definition | Effective roles, workflows, skills and settings | Installed method plus private factory.json; read-only catalog |

Inbox combines an explicitly loaded provider page with retained execution
history in one list/board, grouped by canonical issue identity. Off-page sources
remain unknown; local requests keep separate identities. New issue
creates a repository issue without execution; Start work admits execution
separately. The provider owns issue content/state; SQLite owns queue/attempts and
creation receipts for recovery. An unfinished local form is not a saved backlog.
An agent role is neither a machine nor a skill. Check is deterministic, and
Accept is an operator gate. Triage/specification precede admission; evaluation
is separately scoped work, not an automatic hidden agent phase.

All job skills are available read-only. Role instructions identify relevant
skills; per-role skill/access/harness profiles are not yet supported. Inference
authentication, GitHub identity and SSH access are separate boundaries. Browser
GitHub sign-in does not configure `gh` on the controller host, and host `gh` auth
does not sign a browser in. Writing a blank local issue needs neither a GitHub issue nor
browser GitHub login. Import uses the controller's configured-repository `gh`
access. See [interface support](interfaces.md).

## Compatibility

New installations write `harness` and use `init --harness`. Version-1 `agent`
config and `--agent` remain read aliases; conflicting values fail explicitly.
Configs are not silently rewritten: admitted policy hashes and historical
records retain their meaning. `definition` replaces the catalog command
`workflows`; the old command and old dashboard URLs route to current behavior.

Version-1 API `agent`, `workers`, `triggers` and `worker_name` remain compatibility
fields. Use `harness`, `infrastructure`, `automations` and `host_name` in new
clients. Old provenance `workerName` meant host name and is read as such; unknown
history is not fabricated. `worker.token` is the historical on-disk name of the
operator API token, not a credential for an agent or job container. It remains
private so existing installations can upgrade without credential migration.

Execution IDs (`build`, `verify`, `handoff`, `job_*`, `run_*`) are stable wire and
evidence identifiers. Human labels explain them without rewriting stored jobs.
Compatibility is handled at these boundaries; there is one active implementation.

CLI `issue` groups list, connection, templates, preview, draft, recommend, create,
start, submissions and recover. Since 0.6, `issue create` only publishes; migrate
0.5.1 execution callers to `issue start`. The
legacy `run`, `issues` (GitHub list) and `recommend` commands remain compatible.
Task/job field names and `/api/v1/jobs` are stable wire/storage identifiers for
these same local issues; the extra SQLite receipt table is external-write bookkeeping, not an issue mirror
or another scheduler.
