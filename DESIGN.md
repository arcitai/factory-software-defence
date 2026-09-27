---
name: Software & Defence Factory
version: 1
---

# Project work, clearly presented

The operator should immediately understand which project is selected, what is
running and what needs a decision. The dashboard is the human interface to the
same runtime used by the CLI. This is the implemented direction for issues #1 and #45. Optional project colors remain
a separate follow-up in #27.

## Reference and ownership

The owner selected [Build by Warp](https://build.warp.dev/) as the visual
reference. Its rendered overview was inspected on 25 September 2026 in desktop,
light and dark modes, with a narrow view. Follow its composition closely: a
roughly 203px navigation rail; main content beginning around 56px from the rail
with about 40px top spacing; a 36px project heading; compact toolbar; status
filters beside a fine-divided task list; restrained controls and progressive
task detail. Use the bold `factory.` wordmark with a smaller SOFTWARE & DEFENCE descriptor, Factory records and actions. Do not use Warp
logos, media or source code.

The desktop composition is the fidelity target. At 320–390px, adapt the layout
so navigation and status filters collapse into labelled controls, rows stack
their metadata and all project identity and actions remain available. The
reference's clipped narrow view is not part of the target.

## Composition and navigation

- Keep the configured project name prominent across routes. Let long names and
  paths wrap safely; expose the full configured path in a hover/focus/tap tooltip that does not shift the layout.
  Do not infer an owner/repository, source revision or active model from a path.
- Make Inbox the main view and default to its searchable list. Keep Board as an
  alternate view with readable, non-wrapping columns in a horizontally scrollable region, a visible scrollbar and keyboard access. Use a compact left status rail on wide screens and a labelled
  status selector at narrow widths.
- Show real Factory state groups and counts. Include queued/running work,
  failed or blocked work, review revision availability, pending acceptance,
  completed work, cancellation and unknown states. Repository issue readiness is separate from these execution states. Inbox fetches provider pages explicitly; it is not a background synchronization service.
- Make the task title, actual state and workflow phase, last activity and next
  operator action scannable in each row. Use the runtime's `updated_at` for
  activity. Put result, workflow stages, instructions, execution details,
  history and artifact controls in progressive task detail.
- Keep Analytics, Agents, Skills, Automations, Definition and Infrastructure
  accessible as secondary views. Worker health is not the primary work
  overview. Preserve existing actions and stale-action protection.
- Derive View repo and optional source-issue links only from a validated GitHub origin on the
  configured project. Unknown or credential-bearing origins expose no link.
- Place real workflow, requested-model and status checkbox multiselects beside search, with Select all, individual toggle-off and Reset. Keep the result-count and clear-action row at a stable height.
  Their intersection drives both list and board; clear resets them together.
  Status groups expand to their actual Factory states and clicking the selected group clears it. Do not add unconnected
  contributor or GitHub-label controls.
- Task detail has previous/next navigation within the current filtered list,
  copy-link feedback, a close button (Escape) and a metadata column. Open at
  the top and restore the list position on return. Keep all artifact and
  revision actions available inside the same detail.
- Keep Software and Defence in the same task list, visibly named by workflow.
  Filter tasks and analytics by workflow; a source issue link does not choose
  the execution type. Defence remains scoped investigation, distinct from
  software delivery and from production recovery authority.
- New issue only opens a repository template chooser or blank form for creation. Existing issues are selected in Inbox. Review the destination and acting identity before publishing. Creation saves the remote issue without execution; Start work is a separate action. Local execution is explicitly labelled. Project/model defaults are inherited and advanced options stay secondary.
- Agents distinguish roles from deterministic checks and operator gates. Skills expose actual instructions; Definition exposes shared settings. Automations explain harness-owned scheduling and show when schedule discovery is unavailable. Both interfaces inspect the same installed catalog.
- One project/controller per dashboard. There is no global project hub.

## Typography, color and spacing

Use the self-hosted, pinned Geist variable font with system sans-serif
fallbacks. Match the reference's readable hierarchy: 36px/40px, weight 600 for
the project heading; 14px/20px for task titles; 12px/16px muted task metadata;
and 14px/20px toolbar text. Search and view controls are about 36px tall with
8px corners. List the most recently active tasks first, using recorded timestamps. Keep rows compact, with 12–14px vertical padding and fine
horizontal separators. Use about 40–56px main margins on desktop, 4/8px spacing
increments and modest 6–8px corners. Prefer flat surfaces and rare shadows.

The default visual palette is monochrome. Light mode uses white surfaces,
#0a0a0a text and #e5e5e5 borders. Dark mode uses #101012 surfaces, #f5f5f5
text and subtle charcoal borders. Primary creation actions use the reference's restrained blue; other controls remain monochrome. Small semantic status colors may mark success, attention
and failure, with text labels so color is never the only signal.

An optional reviewed project accent belongs to issue #27. Until that shared
theme contract is implemented, missing, invalid or unreadable project colors
use the complete monochrome default. Markdown prose is not executable theme
configuration and cannot load arbitrary CSS. A project theme does not change
shared control colors or state meanings.

## Truthful states and actions

Preserve actual queued, running, failed, timed-out, blocked, interrupted,
awaiting-acceptance, cancelled and completed distinctions. A failed review with
revision available stays failed and retains its revision flow. A successful
review waits for operator approval before handoff. A completed Factory workflow
is distinct from an agent's summary: run summaries are claims, and missing PR,
cost, model, usage, source-pin or readiness data stays unknown.

An old snapshot after a failed refresh must be marked stale and offer recovery.
Keep loading, initial status error, no tasks, no search/filter results, stale
data and synthetic demo states distinct. Search and status filters combine;
provide a clear reset. Keep cancel, retry, request changes and approval
semantically separate, with current-run guards. Artifact previews/downloads and
prior attempts remain reachable. Do not render raw model reasoning or
credentials as a result summary.

## Responsive and accessible behavior

Use semantic links and buttons, labelled search and status controls, visible
keyboard focus, associated form errors and status text independent of color.
Keep task titles and identity available at 320px; long text wraps without
overflow. Avoid motion beyond useful feedback and respect reduced motion.
Inspect desktop and narrow layouts in light and dark themes, including search,
filter combinations, keyboard navigation, long text, empty and failure states.

## Scope discipline

Preserve Factory capabilities while rebuilding the presentation. The shared
CLI/API and dashboard contract is issue #37. Issue browsing, setup controls,
PR actions or source admission need real common backend support; do not add
decorative controls or a separate UI-only execution path. Publishing the UI
uses the existing npm package/update flow and never replaces a running job's
controller mid-attempt.

## Task intake

New issue starts with repository templates or a blank form. Inbox owns the provider issue list, state filters, paging and explicit Start work. GitHub is the first supported adapter. Unknown providers retain an explicitly local brief. Keep work type
out of the first step; review the shared, editable suggestion before execution.
Issue rows show open-state icon, title, number and wrapping label pills. Map
Provider label colors into the accessible light/dark palette, without interpreting
remote strings as CSS. Search names the loaded-result boundary; pagination,
loading, errors and retry remain visible.

Definition is infrequent setup: put its existing route in the sidebar footer
above the theme control, separated from primary work navigation. Keep it in a
separate section of the narrow-screen menu. The name matches CLI `definition`.

The publication step names the repository and host-side acting account, exposes
requested labels and any missing-label result, and keeps an ambiguous submission
recoverable through its saved receipt. Freeze the published content; a successful
issue link is not proof that work started. Do not claim browser GitHub sign-in or
background synchronization.

## Repository Inbox lifecycle (0.11.0)

Inbox opens on repository issues. Identify the provider/repository, loaded page,
open/closed/all filter, unknown total and refresh time. A failed request leaves
an explicitly stale page or an unavailable state, never an empty-repository claim.
Search covers only the loaded page and visible execution associations. A single
canonical provider/repository/number row owns its separate execution attempts.
Local execution requests and remote histories outside the page remain visible,
with source state explicitly unknown until preview succeeds. The execution history
tab retains workflow/model/state filters, list and board; its counts are executions.
Its filters and empty states name executions. The Inbox navigation has no count
badge: a local job count cannot stand for the unknown repository issue total.

Opening an issue reads context and a deterministic Software/Defence suggestion;
Start work is explicit. Preserve issue context, choices and operator brief across
navigation and errors. The controller rechecks current context and rejects stale
scope or duplicate active work atomically. Closed issues, blocked or conflicting
readiness, and active/unresolved work explain why new admission is unavailable.
An unknown readiness label is not evidence of activity or scope approval.

Default readiness labels map factory:triage/spec/ready/blocked to Needs triage,
Needs specification, Ready and Blocked. The private issueReadinessLabels mapping
is exposed in Definition; labels remain provider-owned. No label writes or triage
agent run occurs during browsing. All other project labels remain visible.

Creation ends with the provider receipt and Done; it refreshes Inbox without a
job. Unsupported hosts clearly offer a local execution request. Sensitive security
reports retain their private contact/incident route. Removal controls say Remove
local execution history; they never imply deletion of a repository issue.
