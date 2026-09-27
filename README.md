# Software & Defence Factory

A portable method and a local runtime for taking a scoped software task through implementation, checks, independent review and an explicit handoff.

Developed by [Arcitai](https://github.com/arcitai). The CLI is **software-defence-factory**. It works with existing repositories, Codex, Pi or a configured executor. No personal context system is required.

## Start here

Install the published [npm package](https://www.npmjs.com/package/software-defence-factory). The CLI includes the dashboard; no source checkout is needed.

```sh
npm install --global software-defence-factory
software-defence-factory help
```

For occasional use: `npx software-defence-factory@latest help`.

Choose the part you need:

| Outcome | Command / guide |
| --- | --- |
| Set up an operator, worker and application | [Setup plan and acceptance checklist](docs/setup.md) |
| Use the method with your existing agent | `software-defence-factory kit --output ./factory-kit` — exports a new staging directory |
| Try the runtime without inference | `software-defence-factory demo` — Docker required; synthetic sample only |
| Connect an existing repository | [Runtime quickstart](docs/quickstart.md) |
| Understand installation and updates | [npm and npx](docs/npm.md) |
| Restore a dashboard after boot or reconnect remotely | [Services and SSH tunnels](docs/services.md) |
| Review the evidence and limits | [Qualification](docs/proof.md) |

The runtime supplies policy and six focused skills to its isolated jobs. `init` configures a private installation; it does not modify the application or start work. Model access and the application's real check command must be configured before using it for delivery.

## How the factory works

[![Factory setup, execution and delivery](https://raw.githubusercontent.com/arcitai/software-and-defence-factory/main/docs/architecture.svg)](https://github.com/arcitai/software-and-defence-factory/blob/main/docs/architecture.excalidraw)

[Architecture and boundaries](docs/architecture.md) · [Editable Excalidraw source](https://github.com/arcitai/software-and-defence-factory/blob/main/docs/architecture.excalidraw)

Each result belongs to a specific candidate commit and policy. A failed check blocks delivery. Changing the candidate or check policy invalidates earlier evidence. Approval records a handoff; publishing, merging and deployment follow the application's separate authority.

The project dashboard has an **Inbox**, measured **Analytics**, **Agents**, **Skills**, **Automations**, **Definition** and **Infrastructure**. Inbox lists repository issues with readiness and linked execution attempts. New issue offers repository templates or a blank creation form. Create an issue on the supported repository provider, then choose Start work separately; local brief execution remains available. CLI `issue` exposes the same intake. Definition lives with settings above the theme control. The CLI reads the same definition and controller state. Agent roles use a selected harness such as Codex or Pi; a worker executes their isolated jobs on a host. See [concepts](docs/concepts.md) and [supported interfaces](docs/interfaces.md). Optional automations belong to the selected harness, which calls Factory CLI/API. Factory runs no cron scheduler. See [provider boundaries](docs/integrations.md).

The optional **defence** workflow accepts scoped incident evidence and produces a private, read-only draft. It does not monitor production or claim verified recovery. See [defence integration](docs/defence-integration.md).

Start setup with `software-defence-factory foundation` and the [Factory Foundation plan](docs/setup.md). No AIOS installation is required.

## Repository map

| Directory | Responsibility |
| --- | --- |
| `bin/` | CLI entry point |
| `factory/` | Queue, HTTP API, isolation, evidence, updates and bundled dashboard assets |
| `dashboard/` | Dashboard source and UI tests |
| `kit/`, `.agents/skills/` | Portable method, adoption records and six job skills |
| `operator-skills/` | Factory Foundation setup guidance; never mounted into jobs |
| `scripts/`, `tests/` | Packaging, qualification, release checks and behavioral tests |
| `docs/` | Setup, architecture, recovery, proof and ownership |

The current runtime replaces earlier prototypes. Their source and research remain in Git history; they are not part of the installed package.

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
