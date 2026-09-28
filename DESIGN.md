---
name: Factory
version: 1
---

# The project Inbox

The operator should immediately see the selected project, its issues, native
work and the next useful action. The owner-selected reference is
[Build by Warp](https://build.warp.dev/). Preserve the accepted list/status rail,
checkbox filters, horizontal Kanban and progressive detail composition.
Use Factory's own wordmark and assets, not Warp logos or source.

## Composition

- Keep `factory.` with the smaller SOFTWARE & DEFENCE descriptor. Inbox is the
  primary page; theme and infrequent controls belong in the sidebar footer.
  Do not restore the retired Agents/Definition/Infrastructure/Analytics pages.
- Show the real project identity, with a hover/focus/tap tooltip for its path.
  Long names wrap; never infer owner, model or revision from a directory name.
- Default to the compact searchable list with a left status rail on wide screens.
  Board uses readable non-wrapping columns in a horizontally scrollable region,
  with visible scrollbar and keyboard access. It must not stack columns.
- Keep a stable count line, repository disclosure and compact toolbar. Opening
  filters or loading results must not push the list down. Do not add a misleading
  repository-total badge to the Inbox nav.
- Rows/cards show the title, compact wrapping metadata and actual colored labels.
  Unknown assignment/model data stays absent or explicitly unknown. Do not repeat
  zero attempts and empty fields. Readiness labels remain separate from execution.
- Detail preserves the list/board, filters and scroll position underneath. Keep
  close/Escape, filtered previous/next, copy link and the metadata column. Display
  native result/history identities and useful actions within that composition.
- One project per Inbox; no global project hub or machine-management dashboard.

## Filtering and source state

List and board share search and work-type/model/status/label facets. Values within
one facet use OR; facets combine by intersection. Whole rows toggle checkboxes.
Select all, Reset, individual deselection and clearing the selected status work
without shifting content or unexpectedly closing the filter.

An anchored Repository disclosure offers open/closed/all, refresh and paging.
Show loaded scope; do not invent a remote total. Search covers loaded issues and
retained native associations. Missing/off-page issues retain history and a not
loaded source state; absence is not closure. Failed refresh marks old data stale.
Keep loading, initial error, empty page and no filter match distinct.

Planning states and native execution states are different. Show actual Running,
Needs review, Failed, Interrupted and Unknown states; no native turn means Not
started. Never map completed inference to accepted/merged. Model/cost/token data
requires actual evidence, not estimates presented as measurements.

## Issue creation and native actions

New issue opens a modal with repository templates or a blank form. Existing issues
are already in Inbox; there is no import-as-new-issue picker. Show the destination
and acting host-side identity before creation. Keep sensitive findings on the
private reporting route. Creation ends with its provider receipt and Done, then
refreshes Inbox. It never starts execution.

Opening an issue may suggest Software/Defence guidance. Start is explicit and
rechecks issue content, readiness and writer ownership. Continue supplies feedback
to the existing native thread with an expected terminal turn; interruption targets
the exact active turn. Reconnect never means retry. Preserve inputs after errors
and show concrete reasons for unavailable actions. Unknown request outcomes require
reconciliation, not a blind retry button.

Use normalized bridge capabilities. Codex-specific protocol/configuration fields
belong inside its integration; unsupported harness actions are not decorative UI.
View repo uses a validated origin and GitHub icon. Do not render private auth,
raw reasoning or untrusted HTML in results.

## Typography and color

Keep the accepted reference scale: roughly203px nav rail,36px/40px project heading,
14px/20px titles and toolbar,12px/16px muted metadata. Use pinned self-hosted Geist
with system fallback,40–56px main margins,4/8px spacing increments,36px controls,
6–8px corners and fine horizontal dividers. Rows have12–14px vertical padding.
Prefer flat surfaces and rare shadows; do not shrink the entire interface.

Default light: white,#0a0a0a text,#e5e5e5 borders. Default dark:#101012 surfaces,
#f5f5f5 text,subtle charcoal borders. Primary creation uses restrained blue.
Status colors also have text labels. Optional reviewed project accent remains
[#27](https://github.com/arcitai/software-and-defence-factory/issues/27); arbitrary
Markdown is not executable CSS and missing theme data retains the full default.

At320–390px collapse navigation/status into labelled controls; wrap row metadata
and long identities without page overflow. Keep the board's own horizontal scroll.
Use semantic controls, visible focus, associated errors and reduced-motion support.
Inspect both themes, desktop/narrow views, filters, detail, long text and failure
states. Match the accepted composition without copying a reference's clipping.
