# Set up a project Inbox

## Prepare the project

Read `factory foundation`. Keep the project's own instructions, approved vision,
code/design standards, real checks and delivery rules. Use [repository readiness](../adlc/repository.md)
to adapt issue templates, labels and CI. Factory does not modify these automatically.

The executable integration currently requires Linux, Node 22.13+, Git, native
Codex and the GitHub CLI authenticated for the selected repository. A stable
external Codex installation is required. `factory probe codex` discovers the
binary/version; it does not prove login, isolation or tool readiness.

Discover the host/workload boundary and intended operator route before setup.
On a shared personal host, prefer a supported VM with its own guest identity and
native sandbox. A suitable dedicated VPS can use an unprivileged OS user plus
sandbox; its shared kernel remains a risk. Separate configuration under a
personal user is not OS isolation. Keep application services separate. No host
migration or worker permission change follows from choosing operator ingress.

## Configure Codex deliberately

Install the canonical `factory-software-defence` [native release](npm.md). If an
older global install owns `factory`, follow the [explicit package switch](npm.md#switch-global-package-names).
Choose absolute paths for an existing Git
root and a **new** private state directory whose parent exists:

```sh
factory setup --repo /absolute/project --state /absolute/private/factory-state
factory login --state /absolute/private/factory-state
factory doctor --state /absolute/private/factory-state
```

Pass `--codex /absolute/path/to/codex` if discovery cannot select it. If that
installation needs a runtime bundle, `--bundle-read` must identify the narrow
Codex installation directory, never an operator home or broad tool folder.

Setup stages six ADLC skills in the separate Codex home. It does not copy personal
login, plugins, connections or settings. Login is performed natively in that home.
The initial profile has unattended approvals but restricted filesystem/network
access; personal apps/MCP/plugins are excluded. The host GitHub integration uses
the operator's GitHub identity without forwarding its environment to the agent.

Doctor checks effective configuration and connection inventory. A passing doctor
is not a real execution or sandbox proof. Model preferences belong in the native
configuration; access changes require deliberate requalification. Factory refuses
an unexplained change to its pinned configuration or skill catalog.

## Native Codex session visibility

Codex stores configuration, authentication and history under `CODEX_HOME`
([configuration and state locations](https://learn.chatgpt.com/docs/config-file/config-advanced#config-and-state-locations)).
Factory uses its dedicated Codex home, so the same ChatGPT account does not
combine local configuration or history. The supported Factory surface is the
project Inbox and these commands through its owning bridge:

```sh
factory status --state /absolute/private/factory-state
factory result ID --state /absolute/private/factory-state
factory continue ID --turn TURN_ID --feedback TEXT --state /absolute/private/factory-state
```

A separate personal Codex Desktop or remote connection must not be expected to
show Factory sessions. Desktop remote connections start their server in the
remote user's login shell ([remote connection documentation](https://learn.chatgpt.com/docs/remote-connections#connect-to-an-ssh-host)).
Do not copy or symlink authentication, session or database files, or enable
personal connections to expose Factory work. A persisted native read does not
authorize another writer. Desktop visibility or resume requires qualification
for that deployment and is not needed for Factory's current surface.

Local-home separation is not account or plan separation. API authentication and
subscription login are distinct; do not infer plan or quota behavior from local
state or promise automatic token refresh or indefinite coexistence. For expired
or revoked login, follow [native Codex login recovery](recovery.md#native-codex-login-recovery).

## Start and reach the Inbox

```sh
factory serve --state /absolute/private/factory-state --port 7332
```

Open `http://127.0.0.1:7332`. For a remote host, use an existing trusted SSH alias:

```sh
ssh -N -T -L 127.0.0.1:7332:127.0.0.1:7332 HOST_ALIAS
```

Use the same local and remote port. Keep the HTTP listener private. Closing the
browser or SSH tunnel does not stop native work; stopping the owning bridge may.
Loopback/SSH remains the default. For an explicitly chosen private HTTPS route,
stage exact origin, authenticated proxy identity and approved operator/device
scope together using [private operator access](private-ingress.md). Its optional
Unix listener shares this bridge; no setup step enables a public endpoint. Retain
SSH until real-route checks qualify the replacement.

For automatic startup, stop an idle manually served bridge and install a pinned
Linux user service from the installed npm package:

```sh
factory service install --state /absolute/private/factory-state --port 7332
factory service status --state /absolute/private/factory-state
```

The service pins package bytes and the selected Node/state/repository paths.
The package rename does not rename an existing service unit, state directory,
Codex home, credentials or native history. Preserve an old pin until its owner
is reconciled and a new installed package is qualified.
Every systemd start verifies the runtime, including its bundled dependency,
against the recorded digest. Unused npm executable shims are excluded; changed
runtime bytes block startup. This detects drift, not a hostile shared OS user.
Login normally starts a user service; boot without login needs the host's user
lingering policy. Record disk-unlock and network prerequisites. Do not claim a
reboot was tested merely because a service is enabled.
The optional `ingress.json` is private installation state read at startup; service
argv and native permission/skill hashes stay the same. Adoption retains it and
requires compatible live ingress, while TLS and native access-policy qualification
remain separate. Unknown/weakened ingress is a readiness gap, not automatic setup.

## Create and deliver an issue

In the Inbox, choose **New issue** and select a repository template or **Blank
issue**. Complete every required field. Review the compiled title and description,
then check the repository and acting GitHub identity shown before choosing **Create
issue**. The receipt confirms the GitHub issue; creation does not start Codex.
**Done** returns to the Inbox, which refreshes its issue list.

Once the UI shows **Issue #N created**, GitHub creation is confirmed, even if the
browser closes before **Done**. Do not create a replacement issue. If the POST
response disappears before confirmation, treat the upstream outcome as uncertain
until that same submission is reconciled. The composer checks its receipt after a
lost response; use **Check submission** when an uncertain receipt is listed. From
the CLI, inspect the submission and reconcile its existing ID:

```sh
factory issues submissions --state PATH
factory issues recover REQUEST_ID --state PATH
```

Keep the original request ID; do not submit the same content again with a new ID
while its outcome is uncertain. Reloading the browser is not a way to preserve an
unsent form. **Check submission** can recover an earlier issue without replacing
the draft currently in the composer; follow its recovered-issue link. When the
recovered submission matches the current content, the form confirms it as created
and prevents another submission.

After the issue appears in the Inbox, open it, review its current content and
readiness, then choose **Start work** deliberately. The result shows the native
Codex response and thread identity. A completed turn needs project checks and an
independent review of the exact candidate. Use **Continue** to send bounded
feedback to that same thread. Prepare a protected pull request through the
project's normal GitHub process, then wait for its required CI checks and review;
Factory does not treat a completed turn as acceptance or publish a PR for you.

The Inbox shows the repository phase from actual GitHub labels and open/closed
metadata, beside Codex's separate native state. Review the exported lifecycle
catalog against existing repository labels before adopting it. Changing list,
phase, history or page only reads repository data; phase labels and issue creation
do not start work. Closed history is paged GitHub data: Done requires a completed
closure reason, while declined or reasonless issues remain Closed.

## Qualify one bounded issue

1. Inspect readiness and verify a permitted workspace write plus denial of a
   private sibling path, unauthorized network/tool access and privilege escalation.
2. Choose one accepted issue, Start it, and inspect the actual native result.
3. Continue with bounded feedback in the same thread. Stale/double actions must
   fail, and reconnect must not create another turn.
4. Run real project checks and independent review against the resulting revision.
5. Exercise idle service restart and confirm retained history. Record reboot
   evidence separately when a reboot is actually performed.

A completed native turn appears as needing review. Factory does not automatically
commit, merge or deploy. See [interfaces](interfaces.md) and [recovery](recovery.md).
