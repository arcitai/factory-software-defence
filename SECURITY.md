# Security boundaries

Factory is a private, single-operator tool. The host account, installed binaries
and OS are trusted. Prefer a dedicated unprivileged OS user. A separate native
configuration under an existing user does not remove that user's host authority.

The Inbox binds to loopback and validates Host, Origin and cross-site requests.
Protected reads and writes require a local session nonce. Remote access defaults
to an authenticated SSH tunnel. Optional private HTTPS uses the existing native
proxy and [private-ingress contract](docs/private-ingress.md): the proxy strips
client-supplied identity headers and sets one authenticated, allowlisted identity
at the private Unix socket. The same OS user and root are trusted to access that
socket; TLS and approved-device access remain native prerequisites. The session
nonce is not multi-user authentication. Do not expose the HTTP port publicly.

Native Codex enforces the selected workspace permissions. The initial profile
allows unattended work while denying private filesystem paths, shell network
access and inherited personal apps/MCP/plugins. Setup and doctor check effective
configuration; representative negative tests must prove the actual installation.
Never assume a file setting alone guarantees isolation. Codex's own model network
connection is separate from the agent's shell network permission.

Repository issues, source and model output are untrusted data. They cannot grant
credentials, change the project vision or authorize publication. GitHub access
stays with the host issue integration and is not forwarded in the agent environment.
Keep project-specific connections separate from personal or other customer access.

One writer owns a workspace. Private durable receipts record uncertain admission
or issue creation; an unknown outcome is not automatically retried. Native history
is preserved outside the package. A disconnected browser does not cancel work,
and a separate process's persisted-history read cannot prove an active owner idle.

Run checks and independent review on the actual candidate. Completion is not
acceptance or a security guarantee. Defensive investigation needs explicit scope;
production access/recovery and publication require their own authority.

Report vulnerabilities privately to a repository maintainer using GitHub private
vulnerability reporting when available. If no private route is available, ask for
one without disclosing the finding. Keep credentials, customer evidence and exploit
details out of public issues and package artifacts.
