# Factory

**Software & Defence. A method, a project Inbox, and your native coding agent.**

Factory connects a repository's issues to a separately configured Codex environment.
Keep the familiar list, Kanban, filters and issue detail; let Codex run the work
and GitHub handle issues, pull requests and CI. Published by [Arcitai](https://github.com/arcitai).

## What is included

- **Foundation**: guidance to prepare a project, its execution host and access.
- **ADLC skills**: portable triage, specification, implementation, review, security
  and evaluation instructions, adopted under the project's own vision.
- **Inbox**: repository issues, explicit Start and Continue, native status/results
  and issue creation using the repository's templates.
- **Small CLI and bridge**: setup, native login, diagnostics, the same operations
  as the Inbox, and pinned Linux user-service startup.

Factory does not run another agent loop, queue, execution database or scheduler.
The current integration is Codex on Linux with GitHub. Other harnesses and hosts
need their own qualified integration; the method can be used independently.

## Install

The native-only 0.18 release is an explicit migration channel:

```sh
npm install --global software-defence-factory@next
factory help
factory foundation
```

For occasional use, `npm exec --package=software-defence-factory@next -- factory help`.
The package name is `software-defence-factory`; its command is `factory`.
An existing command with that name should not be overwritten with `--force`.

Follow [setup](docs/setup.md) to prepare native Codex and a project Inbox.
Existing installations must follow [migration](docs/migration.md); old histories
stay outside the current package and are never automatically converted into work.
For method-only use, run `factory kit --output ./factory-kit` and review
[adoption](adlc/README.md) before merging any files into an application.

## Architecture

[![Factory responsibilities and native integration](docs/diagrams/architecture.svg)](docs/architecture.md)

The dashboard and CLI share one small bridge. It delegates to the selected harness
and issue provider, keeping their protocols out of the UI. Native history is the
execution record; Factory retains only issue associations and operation receipts
needed to avoid duplicate work. There is no Factory transcript database.

A completed agent turn needs checks and independent review. It is not automatic
acceptance, merge or deployment. The [project vision](VISION.md) bounds improvements.

## Repository map

| Path | Responsibility |
| --- | --- |
| `.agents/skills/` | Contributor/setup guidance, including Factory Foundation |
| `adlc/` | Portable method and six canonical skills |
| `bin/` | Small operator CLI and composition of supported integrations |
| `factory/` | Native bridge, issue integration and packaged UI assets |
| `dashboard/` | Inbox source and interaction tests |
| `docs/` | Setup, architecture, interfaces, migration and recovery |
| `scripts/`, `tests/` | Package checks and focused behavioral regressions |

[Documentation](docs/README.md) · [Contributing](CONTRIBUTING.md) ·
[Security](SECURITY.md) · [Current work](todo.md)

MIT for original code and method. Retained components and fonts are covered by
[third-party notices](THIRD_PARTY_NOTICES.md).
