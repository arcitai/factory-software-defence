# Factory Foundation: repository and execution setup

The operator skill is available through `factory foundation`, including from
an installed npm package without a source checkout. Its canonical source is
[.agents/skills/factory-foundation/SKILL.md](../.agents/skills/factory-foundation/SKILL.md).
Use it explicitly for adoption; it is independent of AIOS. Repository/operator
guidance stays outside the runtime catalog at `kit/skills/`.
See [Factory concepts](concepts.md) for host, worker, harness and agent roles.
The [setup/deployment view](architecture.md#setup-and-deployment) shows operator
access, the private execution host and the separate application delivery boundary.

Use this plan for a new installation or when moving an existing Factory to an
execution host. Complete the applicable checkpoints in order and record the
result in a **private** copy of the checklist below. The plan applies to any
operator/worker names and any suitable private network. Install the npm package
on the execution host; a source checkout is unnecessary.

The operator owns access and infrastructure choices. Factory maintainers own
this plan and the linked command guides and update them with behavior changes.
Paths beginning `/private/state` or `/absolute/path` below are placeholders;
replace them with user-owned absolute directories outside the application and
installed package.

## 1. Choose the scope and hosts

| Choice | Record before installation |
| --- | --- |
| Method only or runtime | Method export needs no Docker, background service or model |
| Operator/client | Local machine, user and how the dashboard will be opened |
| Execution host | Linux/systemd for managed controllers; macOS can use manual `up` |
| Applications | Canonical repository, branch, preserved WIP and responsible owner |
| Runtime | Stable Node executable (22.13+), Git, Docker, CPU/RAM/disk budget |
| State | Private state path and unused loopback port for each installation |
| Inference | Provider/model, credential reference, job image and network path |
| Automation | Which controllers may start, update policy and who may submit work |
| Recovery | Private backup location, retained runtime/image and recovery contact |

One installation owns one repository and port. A synthetic qualification
installation can provide a running dashboard while product controllers remain
stopped. There is no multi-project controller or second scheduler hidden in
this plan.

For method-only adoption, run `factory kit --output NEW_DIRECTORY`
and follow [the adoption guide](../kit/README.md). The remaining host/runtime
steps apply only when using Factory's optional controller. Export maps the six
job skills into staged `.agents/skills/`; it never changes the application's
AGENTS.md or installs global skills. Foundation stays in the installed package.

Runtime jobs receive only the reviewed catalog as read-only `/factory-skills`.
Codex agent phases also discover that same catalog at `/etc/codex/skills`; Pi
uses `--skill /factory-skills`. Verify discovery on the exact installed image
without credentials or inference (Codex native listing and Pi RPC
`get_commands`), then qualify inference separately when authorized. Custom
harness discovery remains operator-owned. A directory listing alone is not
native discovery proof. Bundled instructions install no model, browser, Docker
or provider access. Repository guidance remains readable project context and
cannot expand job permissions.

## 2. Establish host access and boot prerequisites

Use an unprivileged operator account. Check `node --version`, `git --version`
and `docker info` from the actual login/SSH session. Install dependencies using
the host's supported method. For a Linux worker, Docker, SSH and any private
network client must start at boot; inspect their actual unit names instead of
assuming every distribution uses the same service names.

For remote access:

1. Establish a reachable private address, including across networks if needed.
2. Enroll the worker's verified SSH host key and configure key authentication.
3. Create an SSH alias such as `factory-worker`; verify
   `ssh -o BatchMode=yes factory-worker 'id -un'` from the operator machine.
4. Verify firewall/interface scope. Keep the dashboard on loopback; do not
   expose it publicly or disable host-key checking to make the tunnel work.

Administrator access is a separate host choice. Installing/running Factory user
services does **not** require root or unrestricted passwordless sudo. If the
owner deliberately chooses passwordless administration, inspect `sudo -n -l`
for the intended `NOPASSWD` policy and repeat the permitted command after a
fresh reboot. A successful `sudo -n` command can merely reuse cached
credentials. A missing rule must be installed by an authenticated administrator;
record that remaining step without blocking unprivileged Factory operation.

Record disk unlock, login and power behavior explicitly. Linux user lingering
can start services without desktop login **after the OS and home are available**;
it cannot unlock an encrypted disk. A sleeping laptop is not an available
worker. Choose AC/battery/sleep behavior with the owner; do not disable disk
security or change power policy as a side effect of Factory setup.

Checkpoint: noninteractive SSH (when needed), Docker and the chosen Node binary
work, and required host dependencies have a documented startup/recovery owner.

## 3. Install the package and qualify the runtime

```sh
npm install --global software-defence-factory@latest
factory --version
factory help
```

Use a user-writable npm prefix or the existing Node manager; do not turn the
controller into a root process to work around installation permissions. For
example, Linux users choosing `--prefix "$HOME/.local"` must also make
`$HOME/.local/bin` available in their login PATH. `npx` uses the same package;
managed services retain a runtime outside its cache. Keep the service's recorded
Node executable available. See [installation and updates](npm.md).

Use a **separate synthetic state and unused port** to exercise the runtime:

```sh
factory demo --state /private/state/runtime-proof --port 7345
# Inspect and finish the sample handoff before qualification.
factory qualify --state /private/state/runtime-proof
```

These commands deliberately create synthetic jobs, including failed/interrupted
attempts. Never use application state for `demo` or `qualify`. They make no model
calls and prove neither model quality nor application readiness. Preserve the
qualification record; stop this controller unless it is the selected dashboard.

## 4. Prepare each application and inference profile

Preserve existing commits, branches, uncommitted work and licenses before moving
anything. Verify the canonical Git origin and main branch's tracking target;
a fork may still track its upstream product. Move application sources into the
chosen workspace, not into the npm package or private runtime state.

Use [repository readiness](../kit/repository.md) for issue forms, labels, CI
policy and the explicit issue-to-job handoff. A ready label does not start a job.

Before admitting development work, establish:

- Reproducible toolchain/dependency pins and an actual build/check command.
- A compatible job image for native libraries, browser/mobile tools or custom
  model adapters; the standard image does not supply every application stack.
- Meaningful checks in the selected CI on the selected revision, plus the intended
  review/branch policy. Record plan/access limits if enforcement is unavailable.
- Applicable application instructions, design/scope, resource limits, secret
  references and a clear delivery destination. Keep unfinished WIP separate
  until intentionally integrated; jobs clone committed source only.

Configure a new installation using [the quickstart](quickstart.md):

```sh
factory init --repo /absolute/path/to/app --harness pi --check "npm ci && npm test" --state /private/state/my-app --port 7331
factory install --state /private/state/my-app
factory doctor --state /private/state/my-app
```

Replace the harness/check/paths with the accepted application profile. Plain
`install` builds the standard image. To use an application-specific image, build
it on the worker first and select its existing local tag instead:

```sh
factory install --image LOCAL_IMAGE_REF --state /private/state/my-app
```

This command checks the local Docker daemon, records and retains the exact image
ID, and does not download or build the selected image. Stop the installation and
reconcile every job before changing its image. Running plain `install` later
still rebuilds and selects the standard image. `init` does not edit the app,
install personal skills or submit a task. Runtime jobs receive the bundled
method and six skills automatically.

For a local model, verify the existing model service, intended model name and
its startup. Test the model API from a disposable container using the **selected
job image and network**. Host `127.0.0.1` inside a container is not the host's
loopback. Any host bridge/proxy and narrow firewall rule are explicit machine
infrastructure; they need their own startup and reboot checks. A bridge address may appear
after the user service manager starts; configure retry/readiness and verify
recovery rather than assuming startup order from enablement alone. Avoid duplicate
model servers, public listeners, Docker socket mounts or whole account folders.
Cloud inference likewise needs a real provider/model connectivity check without
printing credentials. A model-list/health response is connectivity evidence;
qualifying model output requires a separately accepted bounded task.
Store only supported inference settings in `model.env`; jobs reject unrelated
names such as deployment credentials. Codex receives its OpenAI setting group,
and Pi receives only its operator-selected provider group. Use
`--inference-provider` with `init` when Pi's provider is not encoded in the
operator-configured model name or when multiple provider groups are stored.
An installation already using Codex account auth may set the validated
`FACTORY_CODEX_AUTH_JSON` single-line JSON value in private `model.env`; only
Codex agent phases receive it. Pi and checks do not. See the [quickstart
inference guidance](quickstart.md#connect-an-application) for constraints.

For separate Implement/Review/Investigate harnesses or models, export and review
[the portable role definition](definition.md), then explicitly apply its preview
through the idle controller. No overrides preserves the current private command
and legacy evidence. Do not put credential values, host paths, resources or
arbitrary command arguments in that file. Shared settings remain in private
`factory.json`; inference stays in `model.env`. Adoption starts no work or schedule.
Keep harness final-message capture in ephemeral `/tmp`, separate from durable
Factory reports. Review reuses protected exact-candidate checks; its read-only
workspace and noexec temporary space cannot repeat every dependency install or
executable fixture. Qualify each selected role with the actual image, provider
and platform; declared configuration and a discovered binary are not model proof.

Checkpoint: record the exact source revision, image ID, check command, resource
limits, inference connectivity and CI result. Keep product controllers stopped
until their tasks are explicitly ready to run.

Optional web verification is configured separately from the selected harness
and model. The execution-host owner prepares and pins the Playwright/Chromium
image, writes trusted stories in private `factory.json`, then runs `web probe`
and `doctor` on that installation. Use [the browser setup and story contract](web-verification.md)
for the recipe, dependency preparation and limits. Verify uses separate isolated
Linux preview and browser containers and cannot qualify native/mobile operating
systems.

### Optional trusted PR delivery

Patch-only handoff is the default. When the operator intends to enable GitHub
delivery for this installation, configure the exact canonical repository and
target while initializing it, for example:

```sh
factory init --repo /absolute/path/to/app --harness pi \
  --check "npm ci && npm test" --source-ref main \
  --delivery-provider github \
  --delivery-repository https://github.com/OWNER/REPO \
  --delivery-target main --state /private/state/my-app
```

The admitted source ref and PR target are independent. Only `main` and `dev`
are supported target choices in this release. The destination must match the
canonical origin retained at admission. A changed/renamed origin, moved target
base or changed Factory policy blocks delivery until fresh applicable evidence
exists. Configure this before admitting work. Unknown providers remain
patch-only.

Before enabling trusted PR delivery, confirm the repository workflows fit the
bounded qualification in [recovery](recovery.md#trusted-pr-delivery). Factory
compares the immutable admitted base and accepted candidate trees, refuses any
candidate change to a GitHub Actions workflow, and requires jobs that can run
for generated-branch pushes, PR events or selected-ref manual dispatches to use
explicit `contents: read` or `none`, a known GitHub-hosted runner, and no
secrets, protected environments, OIDC or deploy permissions. Unsupported
workflow syntax keeps the patch-only path available. Organization hooks and
other external CI automation remain operator-owned and are not audited by this
check.

The operator's authenticated `gh` identity stays on the controller. Keep GitHub
credentials out of `model.env`, project files and worker containers. Do not add
deploy credentials or a Docker socket for PR delivery. Use only the existing
authorized repository and the repository access already approved for the
operator; do not create a new fixture repository or request broader access.

The release lead owns the live provider/browser qualification after installing
the published candidate separately. Use a separate private state against the
already authorized Factory repository and `main`; ordinary issue admission,
checks, independent review and approval must produce the disposable candidate.
Give its issue a title beginning **[Factory PR handoff proof]**, then use the
normal **Publish accepted candidate as draft PR** action. Record the job,
candidate SHA/tree, generated unique branch, exact draft PR, base/head/tree and
triggered check states. The CLI allows up to ten minutes for this multi-request
controller action; other CLI API requests retain their five-second deadline.
If the client deadline expires, inspect status and repeat `publish JOB_ID` so
the controller can reconcile its saved intent. Restart the installed controller
and repeat `publish JOB_ID`; verify the same branch and PR head are read back
and no second PR appears. Remove local execution history is disabled while the delivery is
unresolved, and the controller rejects the same removal through its API. Leave
pending/unknown checks labelled as such. After inspection, close the proof PR
without merging its fixture change. Do not publish a worker candidate from
inside its sandbox.

Mocks exercise controller and receipt behavior only. They are not live GitHub
publication or browser proof; record each separately in [qualification](proof.md).

## 5. Enable only the intended background services

A newly initialized state has no jobs. Before adopting older state, establish
that its queue may resume; starting **any** controller executes queued work.
If queue ownership/state is uncertain, reconcile it before enabling autostart.

On the Linux worker, select the state that should stay available:

```sh
factory stop --state /private/state/runtime-proof
factory service install --state /private/state/runtime-proof
factory service status --state /private/state/runtime-proof
factory service updates --auto on
factory service updates --auto status
```

Follow [services](services.md) for user lingering, existing Docker group
membership, logs, stop/start, uninstall and maintenance recovery. A user manager
started before Docker group membership changed may need `--group docker`; this
applies an existing group and grants no new membership. Enable lingering only
for the intended account through the host's administrator.

On the operator machine, stop any old manual tunnel, then:

```sh
factory tunnel install --host factory-worker --port 7345
factory tunnel status --host factory-worker --port 7345
```

Use the actual selected dashboard port on both sides. macOS tunnels start at
user login; Linux uses its user service manager. Open `http://127.0.0.1:7345`.
This is the worker's loopback dashboard forwarded through SSH.

Managed daily updates reserve idle controllers and preserve the prior running
set; they defer when busy and attempt rollback if the new runtime is unhealthy.
A deliberate `service stop` leaves boot enablement in place: use `uninstall`
when a controller must also remain disabled across reboots. Preserve private
state and previous releases. The timer does not rebuild application images,
start product tasks, change a model or publish application changes.

## 6. Prove reboot recovery and hand over

Choose a reboot window with disk unlock/recovery available. Save a private
baseline of the boot ID (`cat /proc/sys/kernel/random/boot_id`), runtime version,
job IDs/states/attempts, selected enabled services and paused installations.
After the owner reboots/unlocks the worker, check **before manually starting
anything**:

- SSH returns and a changed boot ID confirms a new boot.
- Docker, private network and model/proxy services are healthy, with no relevant
  failed units or repeated restart loop. Inspect their current-boot logs.
- `service status --state PATH` reports enabled/running/healthy, the intended
  runtime version and no unexpected maintenance reservation.
- The update timer is enabled and has a next execution time.
- The operator's tunnel reconnects and the dashboard responds at the same URL.
- Job history is unchanged and intentionally disabled product controllers have
  no listeners or executor processes. Probe model connectivity from the job
  container again without starting a product agent.
- The intended administrator policy still works, if that capability was chosen.

Record actual observations and failures separately. An observed boot after
manual unlock/login does not prove an unattended cold boot; a worker reboot
does not prove operator-machine login startup. Process crash recovery and tests
across two physical networks are also distinct checks. Use [recovery](recovery.md)
and [service recovery](services.md#recovery-and-proof-limits) for failures; do not
start a second controller or clear unknown process locks to make status green.

Copy this private completion record into the installation's handoff:

| Checkpoint | Result | Evidence / remaining action |
| --- | --- | --- |
| Host roles, owner, source and private state selected | Pending | |
| SSH, Docker, Node and host startup prerequisites | Pending | |
| Synthetic runtime qualification | Pending | |
| Application image, real checks/CI and preserved WIP | Pending | |
| Inference path and chosen model | Pending | |
| Controller/tunnel/timer installation and recovery | Pending | |
| Worker reboot after required unlock/login | Pending | |
| Operator login recovery / separate networks | Pending | Record separately |
| History and intentionally stopped products preserved | Pending | |
| Backups, logs, stop/update/rollback owner and guide | Pending | |
| First bounded application task | Not started | Separate task authority and proof |
| Optional trusted PR provider and target explicitly configured, or patch-only retained | Pending | |
| Release lead live disposable Factory draft PR/readback/restart/close proof | Not started | Separate from mocked provider tests |

Use Pass, Fail or Not applicable with a reason; never infer success from an
installed file. Keep host identities, credentials, raw logs and customer details
out of public issues and package contents. A ready worker is only the foundation:
follow [the method](../kit/README.md#first-real-task) for the first explicitly
accepted application task and revision-bound checks/review/handoff.


## Repository Inbox and explicit execution

The controller's configured repository selects its issue adapter. On GitHub,
use the controller host's existing read access; browser login does not supply
credentials. Open Inbox, verify the provider/repository, refresh and page through
Open/Closed/All states. Provider failures remain visible; local execution and
retained history remain available on unsupported hosts. Creating through New
issue and browsing must leave the execution queue unchanged. Open the issue and
choose Start work only after reviewing its scope and work type.

Readiness is separate from execution state. To use different repository labels,
set `issueReadinessLabels` in private `factory.json` while stopped and restart:
`{"triage":"factory:triage","spec":"factory:spec","ready":"factory:ready","blocked":"factory:blocked"}`.
All four values must be distinct label names. Definition displays the effective
mapping. This only interprets read metadata; it installs no labels or automations.
Keep private security reports on their configured private route.

Before adopting 0.11.0, qualify the exact installed package and real provider
lifecycle, including creation without execution, explicit start, duplicate
rejection and linked subsequent attempts. Inspect affected flows at desktop,
390px and 320px in both themes, including failures. Component/provider-fixture
tests do not qualify those native interactions. Existing source retention,
continuation, review and trusted delivery acceptance remain required.

CLI `inbox --state PATH` opens the same repository page (open issues, page 1).
Use `--page N` and `--issue-state closed|all` for additional issues/history;
`inbox --source factory` explicitly selects the legacy execution-only array.
To add operator scope at admission, use `issue start --url URL --workflow software
--brief-file operator.md --state PATH` with an optional UTF-8 brief of at most
16000 characters. This keeps the remote identity and current-content check;
local requests still use `issue start --file` or `--draft` without `--brief-file`.


## Optional keyless local or hybrid inference

Use the [local binding recipe](definition.md#opt-in-local-bindings-0150-69) to adopt
an explicit private endpoint/model map and portable Pi role references. Keep the
working default and a stopped private-state backup; preview, apply while idle and
use revision-guarded rollback. A local Implement role can be paired with an existing
cloud Review role. No downloads, service restarts, port changes or jobs occur during
configuration. Authenticated endpoints, sampling overrides and custom thinking
maps are unsupported. Local bindings may request OpenAI-style `reasoningEffort`:
`default` (or omitted), `none`, `low`, `medium` or `high`. Default omits the request;
it does not disable server thinking. Qualify the endpoint's actual semantics before
using a request as a thinking-budget control. Unsupported requests fail without
fallback when the endpoint rejects them; transport success alone cannot prove a
server honored the request. Existing omitted choices remain unchanged.

Qualify the actual installed image and endpoint from an isolated job before using
it for application work. Record server/harness versions, exact model ID and digest,
quantization, GPU/backend and actual offload, available and peak memory, endpoint
reachability, tool-call/result compatibility and report/check/review outcomes.
Keep host inference access separate from controller/forge credentials. Unknown
values stay unknown; registry discovery only proves client capability.

Reconcile the client's configured context with the server's actual allocation and
per-request/model overrides. Do not infer a 65k allocation from a remembered agent
setting or a server default. A bounded 64k/128k allocation experiment, where
supported, must record KV-cache and Flash Attention settings, memory and allocation
success separately from long-context task quality. This worker supplies no such
measurements or driver/kernel advice. Do not recommend larger windows from the
schema's upper limit.

The operator still owns #69's matched two-fixture comparison: pinned bases,
comparable prompts/contexts/trials, a measured existing local baseline and one
selected alternative, decisive independent checks and separate Review contexts.
Retain failures, repairs and human time. Record wall time, observable prefill/decode,
input/cached/output tokens, memory/offload and all reviewer usage. Factory currently
leaves Pi usage unknown; controlled protocol fixtures are not token or quality
benchmarks. Include cloud Review in hybrid totals. No provider token billing for
local inference does not mean zero electricity, hardware or operator cost. Only
then qualify a suitable real Factory issue; no customer jobs are part of this slice.


## Local Pi project resources (0.15.3, #103)

The local launcher gives each invocation a private `0700` directory under the
job's existing `/tmp` tmpfs for Pi runtime stores/locks. `PI_CODING_AGENT_DIR`
points there; it is never the read-only `/factory-local` binding mount. The
selected `models.json` is linked to that mount, and the launcher/context adapter,
policy and six Factory skills remain read-only. No host home, saved trust,
authentication or settings are copied. Normal exit removes this state; container
teardown removes interrupted state. Build and Review never share it. The root
filesystem and Review checkout remain read-only.

Pinned Pi 0.87.1 consults project trust even for an empty `.agents/skills`
directory. Factory explicitly passes `--no-approve` to deny project settings,
packages and executable resource loading, while retaining `--no-extensions`,
`--no-skills` and `--no-prompt-templates`. A writable Pi home does not authorize
project dependency installation. Only the explicit bundled context extension
and `--skill /factory-skills` catalog are supported; their loading and the
context-ready handshake are tested against actual Pi. Task stdin and ordinary
`AGENTS.md` context remain available as untrusted text. Repository Pi settings,
extensions/packages and automatically discovered repository skills are not a
supported configuration path. Explicit task-driven file reads are still possible
within the sandbox and grant no additional authority.

Before accepting this repair, the lead must qualify the exact installed 0.15.3
package/image through CLI/API, representative native local Build and separate
read-only Review, and one actual local-model run. `npm run qualify:pi` uses actual
Pi with **synthetic HTTP inference**, not model judgment. See [trust-store
proof and limits](proof.md#pi-project-trust-startup-0153-103). Retain the failed
#51 attempt unchanged and unaccepted; retry only through a newly authorized
attempt after qualification. Do not modify private installations from a job.

## Local context budget and worker image (0.15.2, #100)

The standard worker recipe pins **`@earendil-works/pi-coding-agent@0.87.1`** from
[earendil-works/pi](https://github.com/earendil-works/pi/tree/v0.87.1), replacing
`@mariozechner/pi-coding-agent@0.73.1`. Pi requires **Node >=22.19.0**; the image
installation enforces dependency engines. Factory's controller Node requirement
is unchanged. The separate Codex pin remains **0.156.1**. A CLI upgrade does not
rebuild or replace an admitted job image. Source transport proof is documented in
[proof](proof.md#pi-context-boundary-first-slice-0152-100); installed image and real
local-model qualification are separate acceptance gates.

Set the selected private binding's `contextWindow` no higher than the server's
**actually allocated** context for that exact model/request, and set `maxTokens`
within both endpoint support and available headroom. These existing fields have
the same CLI/API/dashboard validation and frozen policy. An advertised registry
window allocates no server memory. For Ollama, configure allocation through its
supported server/model controls and inspect the running allocation with
`ollama ps`; see [Ollama context length](https://docs.ollama.com/context-length).
Factory does not pass an undocumented `num_ctx`, patch a model template or tune
the host. Unsupported endpoint controls require an explicit capability limit.

Pi 0.87.1's upstream defaults reserve 16,384 tokens and keep approximately 20,000
recent tokens. At a declared 65,536, its threshold is 49,152, checked **after tool
results and before the next assistant request in the same run**. This repairs a
missing check in 0.73.1; increasing its reserve alone cannot add that check. Output
reservation, tool-result growth, system/tools overhead and summarization must all
fit the allocation. Prefix compaction alone cannot shrink one large retained
assistant/tool-result group. The bundled local adapter therefore projects tool
text into a conservative byte budget before generation and summarization, keeping
the exact task and tool identities/order. Truncation notices tell the model to
re-read with offset/limit or narrower queries; raw events/files stay independent
of this projection. Every request reserves the full configured output, includes
schemas/arguments and adds template headroom. This is conservative estimation,
not measured token usage or an allocation/completion guarantee. Unshrinkable
instructions/arguments fail explicitly rather than being silently removed.
Pi estimates native history before the wire projection and can reduce output to
one token. The adapter restores the selected generation allowance only with a
fitting final payload; explicit upstream summary caps stay bounded separately.
Both admitted `max_tokens` and `max_completion_tokens` compatibility fields are
supported. The existing OpenAI `reasoning_effort` selection remains inside that
total output ceiling; no extra reasoning allowance is added. Numeric/nested
thinking-budget formats are unsupported and fail explicitly instead of being
guessed or silently rewritten. Do not add project Pi settings to bypass
the admitted binding or rely on custom tuning that has not been qualified.
See [pinned compaction behavior](https://github.com/earendil-works/pi/blob/v0.87.1/packages/coding-agent/docs/compaction.md).

Before adoption, stop and reconcile all work, retain the old immutable image ID
and a stopped private-state backup. Build/qualify the exact candidate image, then
explicitly select it with `factory install --image LOCAL_IMAGE_REF --state PRIVATE_STATE`
while idle. The normal install path retains the previously selected image. Plain
`factory install` builds the standard recipe, now tagged `software-defence-factory-job:0.4.0`;
updating the CLI alone does neither. Confirm the selected image ID and `pi --version`
in that image. The protected local launcher requires exactly 0.87.1 and loads only
its bundled read-only adapter with automatic extension discovery disabled. Missing
adapter files or an older worker image fail explicitly; old evidence remains
readable and cloud profiles keep their existing wrapper. Roll back with the retained old image through the same idle install
path and restore the previously working role definition through revision-guarded
rollback. Do not change frozen attempts or relabel old failed results.

Lead's bounded actual-inference fixture must include enough tool results to trigger
summarization, resumed useful tool work, the required report, checks and independent
Review. Record the exact image/model digest, harness/server versions, allocated
window, output/reasoning request, tool growth, compaction ordering, elapsed time,
quality outcome and peak memory; unknown measurements remain null. Set an explicit
job deadline/resource budget and preserve any unfinished checkout and diagnostic
artifacts. A short successful prompt is insufficient. A larger actually allocated
window is a later measured comparison only if this evidence warrants it; do not
switch model or cloud provider automatically. The failed #83 local attempt is not
local delivery. An operator-selected fresh cloud retry and unfinished-checkpoint
recovery remain governed by [recovery](recovery.md) and #42.
