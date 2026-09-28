# Factory

A portable method and a local runtime for taking a scoped software task through implementation, checks, independent review and an explicit handoff.

Published by [Arcitai](https://github.com/arcitai). Invoke **factory** with your existing repositories, Codex, Pi or a configured executor. The npm package remains **software-defence-factory**; the compatibility executable `software-defence-factory` uses the same implementation, state and updater.

## Start here

Install the published [npm package](https://www.npmjs.com/package/software-defence-factory). The CLI includes the dashboard; no source checkout is needed.

```sh
npm install --global software-defence-factory@latest
factory help
```

For occasional use: `npm exec --package=software-defence-factory@latest -- factory help`.

Starting with 0.11.1, the package provides both executable names. To upgrade an
older global installation, run
`npm install --global software-defence-factory@latest` to expose the new `factory`
executable. Private cached updates keep the old command working but do not add
global symlinks. Check `command -v factory` first; if it belongs to another tool,
keep the compatibility command or use the explicit `npm exec` invocation above.
Do not overwrite it with `--force`. See [installation compatibility](docs/npm.md).

Choose the part you need:

| Outcome | Command / guide |
| --- | --- |
| Set up an operator, worker and application | [Setup plan and acceptance checklist](docs/setup.md) |
| Use the method with your existing agent | `factory kit --output ./factory-kit` — exports a new staging directory |
| Discover installed Codex | `factory probe codex` — read-only version probe; readiness remains unknown |
| Try the runtime without inference | `factory demo` — Docker required; synthetic sample only |
| Connect an existing repository | [Runtime quickstart](docs/quickstart.md) |
| Understand installation and updates | [npm and npx](docs/npm.md) |
| Restore a dashboard after boot or reconnect remotely | [Services and SSH tunnels](docs/services.md) |
| Review the evidence and limits | [Qualification](docs/proof.md) |

The runtime supplies policy and six focused skills to its isolated jobs. `init` configures a private installation; it does not modify the application or start work. Model access and the application's real check command must be configured before using it for delivery.

## Native harness direction

Factory is moving toward a portable ADLC method, Foundation setup, the existing
project Inbox and a small setup/maintenance CLI. The selected harness owns agent
execution; GitHub owns issues, PRs and CI. Codex comes first, with Claude Code,
Cursor and Grok evaluated separately later. The currently shipped controller
remains available while its replacement is qualified. See the
[migration contract](docs/architecture.md#migration-contract) for ownership,
project-specific access and the gates for removing replaced runtime code.

## How the factory works

<a href="docs/architecture.md"><img src="docs/diagrams/deployment.svg" width="720" alt="Factory setup: operator access to a private execution host with Docker, a chosen harness and inference; application deployment remains in its own CI/CD."></a>

[Architecture and boundaries](docs/architecture.md). Editable views:
[Setup / deployment](docs/diagrams/deployment.excalidraw) ·
[Runtime layers / ownership](docs/diagrams/architecture.excalidraw) ·
[Work lifecycle](docs/diagrams/lifecycle.excalidraw)

Each result belongs to a specific candidate commit and policy. A failed check blocks delivery. Changing the candidate or check policy invalidates earlier evidence. Approval records a handoff; publishing, merging and deployment follow the application's separate authority.

The project dashboard has an **Inbox**, measured **Analytics**, **Agents**, **Skills**, **Automations**, **Definition** and **Infrastructure**. Inbox opens on a shared list/board of loaded repository issues and local work, with status, search and checkbox filters, readiness and linked execution attempts. New issue offers repository templates or a blank creation form. Create an issue on the supported repository provider, then choose Start work separately; local brief execution remains available. CLI `issue` exposes the same intake. Definition lives with settings above the theme control. The CLI reads the same definition and controller state. Agent roles use a selected harness such as Codex or Pi, with opt-in private keyless local bindings for local/hybrid setups; a worker executes their isolated jobs on a host. See [concepts](docs/concepts.md) and [supported interfaces](docs/interfaces.md). Optional automations belong to the selected harness, which calls Factory CLI/API. Factory runs no cron scheduler. See [provider boundaries](docs/integrations.md).

The optional **defence** workflow accepts scoped incident evidence and produces a private, read-only draft. It does not monitor production or claim verified recovery. See [defence integration](docs/defence-integration.md).

Start operator setup with `factory foundation` and the [Factory Foundation plan](docs/setup.md). Claude Code users should also follow the [native AGENTS.md loading note](adlc/README.md#native-instruction-loading).

## Repository map

| Directory | Responsibility |
| --- | --- |
| `bin/` | CLI entry point |
| `factory/` | Queue, HTTP API, isolation, evidence, updates and bundled dashboard assets |
| `dashboard/` | Dashboard source and UI tests |
| `adlc/`, `adlc/skills/` | Portable method, adoption records and the canonical six job skills |
| `.agents/skills/` | Repository/operator guidance, including explicit Factory Foundation adoption; outside the job catalog |
| `scripts/`, `tests/` | Packaging, qualification, release checks and behavioral tests |
| `docs/` | Setup, architecture, recovery, proof and ownership |

## Contributing

Requires Node 22.13+, npm and Git. Docker is needed only for integration qualification.

```sh
npm ci --ignore-scripts
npm run build:dashboard
npm run check
```

CI builds the dashboard and checks Node 22/24. A version increase merged to `main` is published to npm through the configured release workflow. Installed CLIs can update on invocation when all installations are stopped. See [release and update behavior](docs/npm.md).
Managed Linux services can also opt into daily updates that reserve idle controllers, preserve stopped projects and restore the prior release if startup fails. See [service operation](docs/services.md).

This is a test release. Synthetic qualification demonstrates control flow and isolation, not model quality, application correctness or production readiness. Follow [AGENTS.md](AGENTS.md) for contributions and [SECURITY.md](SECURITY.md) for the trust boundaries.

MIT for original code and method. Included dashboard components and fonts retain their licenses in [third-party notices](THIRD_PARTY_NOTICES.md).

See [CONTRIBUTING.md](CONTRIBUTING.md) for source setup and checks, the
[self-development recipe](docs/development.md) for running project work through
Factory, and [todo.md](todo.md) for the ordered issue backlog.
