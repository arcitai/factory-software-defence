# Architecture

Factory adds a method and an issue-oriented work surface to existing tools.
The native harness remains the execution engine.

![Responsibilities](diagrams/architecture.svg)

| Owner | Responsibility |
| --- | --- |
| Project | Approved vision, source, design/code standards, checks and delivery rules |
| Foundation and ADLC | Deliberate adoption, setup guidance and reusable working instructions |
| Dashboard and CLI | Select an issue, request a native action and display its actual result |
| Small bridge | Authenticate local requests, associate issues with native sessions, refuse ambiguous or duplicate operations |
| Codex | Agent loop, context, tools, permissions, sessions and execution history |
| GitHub | Repository issues, templates, PRs, checks and authorized publication |
| OS service manager | Start the pinned bridge after login/boot, supervise its process and optionally schedule metadata-only release checks |

## Small integration boundaries

The launcher composes the concrete native integration and repository provider.
The HTTP layer consumes a small runtime contract; the Inbox consumes its public
status/actions. Codex protocol calls and configuration stay within its integration.
Issue/template calls stay within the repository integration. Neither needs the
other's implementation details.

Add another harness by implementing and qualifying the operations the UI actually
uses: readiness, list/status/result, explicit start, continuation, interruption
and history reconnection. Declare unsupported operations. Do not create a provider
registry, universal agent engine or speculative compatibility layer. Codex is the
only implemented harness today.

The CLI and Inbox use the **same running bridge and native process**. A second
app-server may read persisted history without seeing another process's live turn,
so it cannot authorize stopping that process or starting a competing writer.

Factory keeps small private receipts for issue creation/admission and native IDs.
These receipts prevent uncertain writes being replayed; they are not a queue or
copy of native conversation history. There is one writer per project workspace.
The repository's normal Git tools own commits and branches.

Operator release checks read public npm metadata independently of the bridge or
native harness. An optional OS timer only schedules that read; activation remains
manual and must preserve native work. See [packages and releases](npm.md).

## Deployment

![Deployment](diagrams/deployment.svg)

Use a separate configuration/home/login for the selected harness. A separate OS
user provides another boundary; configuration separation under one OS user is not
full host isolation. Verify effective native permissions and available tools.
The first Codex profile excludes personal apps/MCP/plugins and uses a restricted
workspace sandbox. Browser or other capabilities require explicit qualification.

The bridge binds to loopback; remote access uses an authenticated SSH tunnel.
It is a private single-operator surface, not a hosted multi-tenant platform.
Application deployment remains in the application's CI/CD.

## Work lifecycle

![Work lifecycle](diagrams/lifecycle.svg)

An issue enters the Inbox without starting an agent. Start is deliberate; Continue
adds feedback to the same native history after a terminal turn. Refresh/reconnect
never starts another turn. Unknown outcomes remain unresolved until reconciled.

Check and independently review the exact candidate before an authorized PR or
release. Self-improvement must fit the project's approved vision; it cannot
expand scope, rewrite the vision to justify itself or grant more access.

**Local Build · Cloud Review** describes inference placement: local inference
implements, a separate cloud review context assesses the result. A worker's physical
location is a different choice. This remains a proposed native-harness recipe
([#69](https://github.com/arcitai/factory-software-defence/issues/69)), not a
bundled local-model engine. Tests, acceptance and protected PR/CI remain separate.

Editable diagrams: [architecture](diagrams/architecture.excalidraw),
[deployment](diagrams/deployment.excalidraw), [lifecycle](diagrams/lifecycle.excalidraw).
