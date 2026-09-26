# One runtime, CLI and dashboard

Issue [#37](https://github.com/arcitai/software-and-defence-factory/issues/37)
owns complete bidirectional capability parity. This inventory records current
gaps; it is not a claim that parity is complete. Keep it current in each relevant
change. The queue/controller owns task state, policy and acceptance in both
interfaces. Host operations need a deliberate operator API, never an arbitrary
shell endpoint or a second scheduler.

| Capability | CLI | Shared API | Dashboard | Remaining work |
| --- | --- | --- | --- | --- |
| Project/queue/attempt state | `status`, `inbox` JSON | `GET /api/v1/status` | Project, tasks, details/history | Stable versioned agent result/error contract |
| Start local work | `issue start --file --title`, `--draft` or `--url`, explicit `--workflow`, optional `--model` | `POST /api/v1/jobs` | Local execution only → review → Create & start locally | Persistent unstarted drafts and typed incident intake remain separate |
| Browse/import repository issues | `issue list --source remote [--page N]`, `issue preview --url URL` via controller provider | Authenticated `GET /api/v1/issues`, `POST /api/v1/issues/preview` using shared readers | Paged open-issue list, search loaded results, preview and explicit start for either type | Issue → execution links retained; no implicit polling |
| Create repository issue / recovery | `issue connection`, `create --key`, `submissions`, `recover --key` | Authenticated connection, `POST /issues`, receipts and recovery | Display destination/actor, create without execution, recover uncertain result | GitHub adapter first; assignees/projects and other providers unimplemented |
| Repository issue templates | `issue templates`, `issue draft --template --sha --file` | Authenticated template list and draft compilation | Chooser, fields/defaults/validation, review | Supports Markdown and YAML markdown/input/textarea/dropdown/checkboxes; unsupported templates link to GitHub |
| Suggest task type | `issue recommend --file` or `--url` | Authenticated `POST /api/v1/intake/recommend`; issue preview includes suggestion | Editable recommendation after source selection | Deterministic label/brief rules; no model judgment or execution authority |
| Cancel/retry/approve | Commands | Job action endpoints with current run ID | Task controls | JSON action results and consistent needs-attention outcomes |
| Request changes | `revise --file` | `request_changes` action | Feedback form | JSON action result; retain shared stale-action guards |
| Remove a stopped task | No command | `DELETE /api/v1/jobs/:id` | Remove action | Add CLI; keep existing recoverability/history semantics |
| Evidence list/read/download | No command | Authenticated artifact routes | Files/preview/download | Add CLI with matching access and size/path rules |
| Roles, workflows and packaged skills | `definition`, `agents`, `skills` JSON (also while stopped) | `GET /api/v1/definitions` | Agents, Skills and Definition | Shared read-only catalog; future editing must preserve common policy/gates |
| Project repository links | Validated links in `status` | `project_links` from configured Git origin | View repo / optional GitHub issue link | Provider creates/issues reads are separate from Git source links |
| Recorded token usage | Per-attempt `usage` and `token_usage` in `status` | Same status records | Analytics, task rows, metadata/history | No billing estimate; partial/unknown coverage stays explicit |
| Analytics/filtering | Raw status available | Source queue records | Derived views | Expose equivalent queries/summaries without inventing usage data |
| Scoped incident admission | `incident --file` validates/deduplicates private evidence | No equivalent typed intake endpoint | Generic Defence form is not equivalent admission | Common typed intake, gaps and deduplication before execution |
| Initialize/configure | `init` | No operator setup endpoint | None | Preserve app files, explicit state and private secrets |
| Select/install job image | `install [--image LOCAL_REF]` (#30) | No operator image endpoint | None | Shared supported controls after host-operation boundary; runtime checks alone do not qualify a toolchain/model |
| Diagnostics | `doctor` | Limited status/definitions only | Runtime status only | Equivalent checks/results and truthful qualification status |
| Controller lifecycle | `up`, `stop`, `serve`, `service` | Operator-only maintenance reservation | No lifecycle controls | Define safe behavior while stopped/restarting; GUI must not bypass maintenance |
| Runtime updates | `update`, `service update`, auto-update settings | No update endpoint | None | Idle-only activation, rollback and common progress/errors |
| SSH tunnels | `tunnel` | No tunnel endpoint | None | Client-host ownership; distinguish operator machine from worker |
| Method export | `kit --output` | No export endpoint | None | Equivalent download/export preserving staging-only adoption |
| Synthetic qualification | `demo`, `qualify` | No qualification endpoint | Synthetic disclosure only | Explicit separate state; never target an application accidentally |
| Immutable source admission | `init --source-ref`, `run --source-ref`, `issue start --source-ref`; status and build evidence carry the resolved SHA | `POST /api/v1/jobs` resolves/retains before acknowledgement; shared source metadata in status | New issue and revision forms accept a ref; task detail shows requested ref, resolved SHA and prior source commits | Build/retry use retained objects; revisions keep the recorded source unless a new ref is explicit; legacy source remains unknown |
| Trusted PR handoff | `publish JOB_ID` publishes or reconciles a saved delivery intent with a bounded ten-minute request | Authenticated `POST /api/v1/jobs/:id/publish`; shared receipt and checks; unresolved delivery blocks `DELETE` | Deliberate action on an accepted software result; unresolved delivery disables Delete issue; raw check conclusions and recovery state are visible | Optional GitHub destination/`main` or `dev` target comes from private operator config; unknown providers and unset delivery remain patch-only |

The current generic task form can name the Defence workflow; that is not a
substitute for the CLI's validated incident admission. Treat the typed intake
gap as unfinished functionality, not a qualified human workflow.

Implement the smaller task/evidence/JSON gaps first. Setup/lifecycle controls
need an operator boundary that remains usable when a project controller is
stopped, preserves least privilege and cannot expose host commands to task text.
Do not equate the browser's current project session with host administrator
authority. Headless use and GUI use must ultimately reach the same outcomes;
intermediate releases must explicitly retain their unimplemented rows here.

Infrastructure exposes detected host capacity and the local worker through
`infrastructure` and the same status API. `automations` returns the harness
ownership contract; the UI explains that external schedules are not discovered.
Factory has no cron module. The v1 `automations: []` field remains a compatibility
view; `automation_control` owns the current semantics.
`foundation` prints the packaged operator skill without configuring anything;
the Skills page reads that same file. Full safe setup controls remain #37.
The roadmap is split into Defence #50, quality measurement #51, GitHub intake
#52, editable definitions #53 and scoped MCP #54. Existing REST endpoints are
local single-operator interfaces, not a public multi-user API.
