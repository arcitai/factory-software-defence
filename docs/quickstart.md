# Runtime quickstart

For a new execution host or remote operator, start with the [setup plan](setup.md).

Install Node 22.13+, Git and Docker Engine/Desktop. Use an unprivileged account with Docker access. Install `software-defence-factory` through npm, or invoke the same package with npx. No factory source checkout is required.

## Qualify a synthetic installation

```sh
software-defence-factory demo
```

Open the printed localhost URL, inspect the sample task and its files, then approve the handoff. This changes only an isolated synthetic repository and makes no inference calls. Once the sample finishes:

```sh
software-defence-factory qualify --state /absolute/path/printed/by/demo
```

The qualification intentionally creates failed, cancelled and interrupted tasks. They are expected evidence of failure handling. Never point qualification at an application installation.

## Connect an application

Commit an intentional, reviewed starting point in the application first. Jobs clone committed code only; uncommitted work stays in the source checkout.

```sh
software-defence-factory init --repo /absolute/path/to/app --harness codex --check "npm ci && npm test" --source-ref main --state /private/state/my-app --port 7331
software-defence-factory install --state /private/state/my-app
software-defence-factory doctor --state /private/state/my-app
```

`init --source-ref` selects the configured default ref (`HEAD` when omitted). Each job resolves that ref, or an explicit `--source-ref` on `run`/`issue start`, in the configured repository and durably retains its commit before acknowledging admission. It records the canonical GitHub origin identity when available; the CLI and dashboard show the requested ref and resolved SHA. Task text and reference links do not select a repository, source ref or PR target.

Verification commands receive `FACTORY_BASE_REVISION`, the resolved admission commit recorded as the candidate base. Diff-based checks should compare against this revision; the isolated checkout has no origin remote. The value comes from protected controller metadata, not the task text.

Replace the check with the application's actual verification command. `init` does not edit the app, copy global skills or start work. It creates factory.json, worker.token and model.env with private permissions. Each installation has one repository and a distinct state path/port. `--harness pi` selects Pi; `--harness custom --command-json '["executable","argument"]'` selects an available command in the job image. The bundled image provides Node, Git, Codex and Pi. Other toolchains require an intentionally built compatible image; do not claim Rust/mobile/browser capabilities from this image alone.

Configure supported inference settings in the private `model.env` file. It
rejects unrelated names such as `DEPLOY_TOKEN`; do not copy the operator's
account environment or authentication folders. Codex receives only its OpenAI
settings. Pi receives only the selected provider's settings. Set
`--inference-provider PROVIDER` during `init`, or pin an operator-selected
`provider/model` with `--model`; if multiple provider credential groups are in
`model.env`, an explicit provider is required. Task-level model overrides never
select a credential group. See the `inferenceProvider` entry in private
`factory.json` when editing trusted installation configuration directly.

Installations using the existing Codex account-auth command may also put its
single-line JSON object in `FACTORY_CODEX_AUTH_JSON` in private `model.env`.
Factory validates that value as JSON and gives it only to the selected Codex
build/review/defence worker through a temporary private env file; the configured
operator command that consumes this setting must materialize its temporary
native `auth.json` before invoking Codex; the bundled stock `codex exec` does
not do this by itself. Pi never receives this setting, including with the OpenAI provider, and
deterministic checks and output artifacts do not receive it. Keep `model.env`
private with mode `0600`; do not copy account folders or place the value in a
task, source file or report. This setting does not replace provider API-key or
local OpenAI-compatible endpoint configuration.

Factory's Pi provider identifiers are `anthropic`, `azure-openai-responses`,
`cerebras`, `cloudflare-ai-gateway`, `cloudflare-workers-ai`, `deepseek`,
`google`, `groq`, `huggingface`, `kimi-coding`, `minimax`, `minimax-cn`,
`mistral`, `openai`, `opencode`, `opencode-go`, `openrouter`,
`vercel-ai-gateway`, `xiaomi`, `xiaomi-token-plan-ams`,
`xiaomi-token-plan-cn`, `xiaomi-token-plan-sgp`, `xai` and `zai`. Factory
forwards provider API-key and endpoint settings from this map; it does not
forward OAuth files or ambient cloud identity credentials.

`OPENAI_BASE_URL` remains available for an OpenAI-compatible local endpoint
selected for Codex; the endpoint must be reachable from inside the job
container. Host loopback addresses do not automatically refer to the host from
Docker. The package does not automatically expose Ollama or import models.

```sh
software-defence-factory up --state /private/state/my-app
software-defence-factory run --file task.md --source-ref main --state /private/state/my-app
```

A task should describe the accepted outcome, allowed scope and observable checks. The CLI also accepts `--issue https://github.com/owner/repo/issues/123` for an issue belonging to the configured origin; it uses the operator's existing gh access outside the job. The dashboard supports the same task workflow. Source text and links do not grant additional authority.

## Review and handoff

Inspect the task's Result, Files and History tabs. Task details show the requested source ref, resolved admission SHA and previous source commits when a new base was selected. Build evidence includes candidate.json, change.patch and the implementation report; handoff records its source SHA. Checks and review identify their exact candidate commit and policy hash. Approval revalidates both before writing accepted.json. Request changes preserves the recorded source by default and starts fresh checks/review; an explicit new source ref is retained as a deliberate base change.

The source application is not changed and no branch, PR, merge or deployment is published automatically. A reviewed change.patch can be checked and applied with `git apply --check` and `git apply` on an appropriate branch at its recorded base revision; then follow the application's normal integrated checks and delivery policy.

### Optional trusted PR delivery

Patch-only remains the default. To enable the first delivery provider, select a
canonical GitHub origin and an explicit target while initializing the private
installation:

```sh
software-defence-factory init --repo /absolute/path/to/app --harness codex \
  --check "npm ci && npm test" --source-ref main \
  --delivery-provider github \
  --delivery-repository https://github.com/OWNER/REPO \
  --delivery-target main --state /private/state/my-app
```

Use `dev` only when it is the intended target. The source ref (`main` above)
and PR target are separate settings. The configured GitHub repository must
match the canonical origin captured at admission; a later repository rename or
remote change blocks delivery. Configure this before admitting work because a
configuration change invalidates earlier check/review/approval policy evidence.
Unknown providers and installations without `delivery` configuration keep the
patch-only flow.

After the ordinary check, independent review and operator approval complete,
use **Publish accepted candidate as draft PR** in task details or run:

```sh
software-defence-factory publish JOB_ID --state /private/state/my-app
```

Trusted publication requires protected per-run execution records for native
Codex/Pi build and review plus deterministic verification and handoff, bound to
non-synthetic candidate, check and review artifacts. Mock qualification remains
local exploration and cannot be published; missing or inconsistent provenance
keeps the action unavailable in status, CLI, API and dashboard. A saved intent
is checked again before new provider writes. Known PR receipts and PR-creation
checkpoints still allow read-only reconciliation.

New writes also require the shared GitHub Actions qualification described in
[setup](setup.md#optional-trusted-pr-delivery) and [recovery](recovery.md#trusted-pr-delivery).
Unsupported or candidate-changed workflows keep publication unavailable in
status, CLI, API and dashboard; the accepted patch remains available for normal
manual delivery.

The controller uses its existing `gh` identity. GitHub credentials are never
copied to `model.env` or mounted into jobs. The intent, generated branch, PR
identity, actual base/head/tree and triggered PR check results appear in the
same job. Unknown and pending checks remain visible and are not reported as
success. GitHub's raw `success`, `skipped` and `neutral` conclusions are
non-blocking in the Factory check summary; skipped and neutral remain visibly
distinct from an executed passing check. Unknown conclusions and incomplete
pagination keep the aggregate unknown. This summary does not determine branch
protection requirements or grant merge authorization. See [GitHub's required
status check guidance](https://docs.github.com/en/pull-requests/how-tos/merge-and-close-pull-requests/troubleshooting-required-status-checks).
Repeating `publish` refreshes/reconciles the same branch and PR; it does not
create a second PR or overwrite a changed branch. The CLI gives this bounded
multi-request action ten minutes; branch resolution uses the same bound and
other API calls keep their five-second deadline. If a client deadline expires,
inspect status and repeat `publish` to reconcile or recheck the reported branch
identity before `abandon-delivery`. Delete issue stays disabled while delivery
is unresolved, and the controller enforces the same guard on its API.
Publication does not merge, integrate, release or deploy. See [delivery
recovery](recovery.md#trusted-pr-delivery).

If status reports a reserved branch collision at the untouched `intent` stage,
inspect that branch in GitHub first. The task detail action **Abandon local
delivery; keep remote branch** or `abandon-delivery JOB_ID --branch-sha SHA`
records only a local resolution after the controller confirms the same branch
head and no associated PR. It preserves the remote branch and accepted evidence,
permits local issue removal, and permanently disables publication for that
delivery record. Changed identities, PRs and uncertain provider effects remain
blocked; see [recovery](recovery.md#trusted-pr-delivery).

## Remote access and operation

```sh
ssh -N -L 127.0.0.1:7331:127.0.0.1:7331 your-host
```

Open http://127.0.0.1:7331 on the client. Use the same local/remote port because the HTTP service validates its Host header. The SSH connection must remain open. Access also works across different networks when your configured private network connects the hosts.

Use `status`, `cancel JOB_ID`, `retry JOB_ID` and `stop`, always with the selected `--state`. `service install --state PATH` installs and enables the supported Linux user service; `service status`, `service logs` and `service uninstall` operate it. Bare `service` only prints a definition. For managed startup, persistent SSH tunnels and daily idle updates, follow [services](services.md). See [recovery](recovery.md) for interrupted attempts.

## Native application builds

Build a compatible application image on the execution host, then select its existing
local tag through the CLI:

```sh
software-defence-factory install --image LOCAL_IMAGE_REF --state /private/state/my-app
software-defence-factory doctor --state /private/state/my-app
```

Selection resolves and retains the immutable image ID. It does not pull or build
the reference. An unavailable image, a running controller, an unreconciled job
or a remaining job container makes selection fail without changing the last
working configuration. Plain `install` remains the standard-image build path
and selects the standard image again. `doctor` verifies that the recorded image
metadata matches the image selected in private state; it reports model and
toolchain qualification separately, and does not perform either qualification.

In `factory.json`, `cpus` (1–32, default 2), `pidsLimit` (64–16384, default 256), `memoryMiB` and
`timeoutSeconds` bound the job's resources. Verification uses a separate
disk-backed checkout, keeping the candidate read-only. Its private scratch
directory is removed after container termination is confirmed. Interrupted
executors may retain scratch under their attempt for recovery; stop/reconcile
the job before removing it. Ensure the state filesystem has sufficient space.
No Docker socket, operator credentials or unrelated project caches are mounted.


## Read the project dashboard

Inbox contains both Software delivery and Defence investigation. Select a
workflow to focus the list; workflow, requested-model, status-badge and text
filters combine. Analytics offers the same workflow separation for recorded
outcomes, duration and [token usage](usage.md). An issue link is a reference,
not an execution type. For validated, deduplicated private incident intake,
use the [Defence integration](defence-integration.md) recipe; the generic
Defence form is not that typed intake path.

The header names the configured project. View repo opens a validated GitHub
origin. New issue opens Factory’s local chooser: repository templates, a blank
form or existing GitHub issues. Create issue saves to the supported repository provider without execution. Start work queues local work. See [intake and CLI examples](workflows.md). The task detail provides previous/next within the filtered list, copy
link and close (Escape). Closing preserves the list's filters and position.

If the interface looks unexpectedly small, check the browser zoom. The design
is tested at 100%; changing browser zoom is separate from a project theme.

## Environment

Factory does not load a repository `.env` file. Configure the private
`factory.json` through `init`; put supported inference settings only in its
private `model.env`. A provider allowlist selects the configured Codex/Pi
settings before a worker starts; unrelated host, forge, deployment, cloud
identity and application variables are rejected. A repository `.env.example`
is unnecessary for this CLI. Optional
process settings are `SDF_AUTO_UPDATE=0` (skip automatic CLI update checks),
`XDG_STATE_HOME`, `XDG_DATA_HOME` and `XDG_CONFIG_HOME` (user-owned state, release
and service locations). They must be exported in the process environment.
Legacy prototype names such as `FACTORY_WORKER_CONFIG`, `FACTORY_MODEL`, `PORT`
and `FACTORY_DEMO` are not supported. See [concepts](concepts.md).
