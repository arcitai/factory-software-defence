---
name: Software & Defence Factory
version: 1
---

# Project work, clearly presented

The operator should immediately understand which project is selected, what is
running and what needs a decision. The dashboard is the human interface to the
same runtime used by the CLI. This is the accepted direction for issue #1;
it describes intended implementation, not features already shipped.

## Reference and ownership

The owner selected [Build by Warp](https://build.warp.dev/). Its public overview
was visually inspected on 25 September 2026: a narrow navigation rail, large
project heading, compact issue rows, fine separators, status groups/counts and
search/filter controls. Adapt those hierarchy and density choices to Factory's
actual records. No Warp assets, logos or source code are imported. Retain notices
for existing adapted components until their licensed material is replaced.
Mobile behavior below is our adaptation and needs rendered validation.

## Composition and navigation

- Keep the configured project name in the header. Full local paths belong in
  a secondary disclosure that wraps safely. Do not infer an owner/repository,
  source revision or active model from the directory name.
- Make Tasks the main view, with a list as the default, visible search and status
  filtering. Preserve the alternate board view and stable detail routes.
- Use a compact status summary or filter rail beside the list on wide screens.
  Counts reflect the actual queue and state; never imply a GitHub backlog has
  been synchronized when it has not.
- Keep task title, textual state/phase, last activity and the next meaningful
  action together. Display supporting evidence progressively in details.
- Keep worker/executor health accessible as secondary operational information.
  A machine inventory is not the primary project view. Preserve access to
  history, analytics and workflows without inventing an active trigger system.
- One project/controller per dashboard. No global app switcher in this scope.

## Typography, color and spacing

Use the existing Manrope stack with system sans-serif fallbacks, a strong 26–32px project heading,
14–16px primary row text and readable 12–13px metadata. Use monospace for hashes,
commands and paths, not all prose. Prefer 4/8px spacing increments, 16–24px group
gaps and enough row padding to distinguish adjacent tasks.

Light mode uses white/off-white surfaces, charcoal text and fine neutral borders;
dark mode uses near-black and charcoal surfaces with light text. Use one
restrained blue/violet accent for primary actions and selection. Green means
confirmed success, amber attention and red failure; always include text/icon
meaning. Keep rounded corners modest (6–10px), shadows rare and surfaces flat.
No decorative gradients, glowing machine cards or repeated equal-weight panels.
These are product defaults, not a claim that an external Arcitai brand guide was
provided. Optional project themes remain issue #27.

## Truthful states and actions

Preserve actual running/failed/interrupted/blocked/awaiting-approval/completed
distinctions. A successful agent report is not approval or a merged PR. Show
unknown cost, model and provenance as unknown. An old snapshot after a failed
refresh must appear stale/offline, with recovery available.

Keep loading, no-tasks, no-filter-results, failure and synthetic states distinct.
Provide a clear reset for filters. Keep cancel, retry, request changes and
approval semantically separate, with existing stale-action protection. Artifact
previews/downloads and prior attempts must remain reachable. Do not render raw
model reasoning or credentials as a result summary.

## Responsive and accessible behavior

At narrow widths, collapse the navigation and status rail into labelled controls
above the list. Rows stack their metadata without losing task identity or action.
Preserve content at 320px; long identifiers wrap or have an accessible disclosure.
Use semantic links/buttons, visible keyboard focus, labelled inputs, associated
errors and status text independent of color. Avoid motion beyond useful feedback
and respect reduced motion. Inspect actual light/dark desktop and narrow layouts,
keyboard search/filter/detail navigation, long text, empty and failure states.

## Scope discipline

Preserve existing capabilities while improving composition. The shared CLI/API
and dashboard contract is issue #37. Issue browsing, setup controls or PR actions
need real common backend support; do not add decorative controls or a separate
UI-only execution path. Publishing the UI uses the existing npm package/update
flow and never replaces a running job's controller mid-attempt.
