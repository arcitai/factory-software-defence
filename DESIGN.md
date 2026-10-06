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

The specific composition reference for [#140](https://github.com/arcitai/factory-software-defence/issues/140)
is the first desktop list image from #90, `8b2dcd0a227f/list-1440-light.png`.
That historical Git object is absent. The owner approved the concrete reconstructed
`localhost:7344` preview using released v0.12.0 presentation components and richer
rows. Its five presentation files and reference record remain private composition
aids, separate from the current source and installed runtime. Fixture counts,
metrics, models, retired pages and queue/controller/action semantics are not
product requirements. The reference approves composition; the current catalog
and provider/native evidence own meaning.

## Composition

- Keep `factory.` with the smaller SOFTWARE & DEFENCE descriptor. Inbox is the
  primary page; theme and infrequent controls belong in the sidebar footer.
  Do not restore the retired Agents/Definition/Infrastructure pages.
  Analytics presents connected-harness usage from the existing native readings;
  historical charts remain a separate evidence-backed slice.
- Show the real project identity, with a hover/focus/tap tooltip for its path.
  Long names wrap; never infer owner, model or revision from a directory name.
- Default to the compact searchable list with a left status rail on wide screens.
  Board uses readable non-wrapping columns in a horizontally scrollable region,
  with visible scrollbar and keyboard access. It must not stack columns.
- The left rail uses the catalog's **native** category cards with expanded
  substate rows and visible category/substate counts. The category **name**
  toggles its filter; only the independent top-right **count** folds details.
  Show the count normally and a directional chevron on count hover or keyboard
  focus; touch shows both with a usable disclosure target. The count has
  `aria-expanded`/`aria-controls`; the name has `aria-pressed`. No nested buttons
  or separate Status details row. Folding retains selection. Repository phases
  remain separately accessible through the Phase facet, row/card badges and
  phase Kanban; native category selection never sets a repository phase.
- Keep the count, repository disclosure and compact filters in one toolbar. Opening
  filters or loading results must not push the list down. Do not add a misleading
  repository-total badge to the Inbox nav.
- Rows/cards show the title, catalogued repository phase, separate native state,
  compact metadata, GitHub author, assignees and actual colored labels. Author is
  not the person responsible by default. Unknown contributor/model data stays
  absent or explicitly unknown. Show overlapping label-color dots and an accurate
  count; expose real label names and hex colors on hover and keyboard focus.
  Do not repeat zero attempts and empty fields.
- Detail preserves the list/board, filters and scroll position underneath. Keep
  close/Escape, filtered previous/next, copy link and the metadata column. Display
  native result/history identities and useful actions within that composition.
- One project per Inbox; no global project hub or machine-management dashboard.

## Filtering and source state

List and board share search and work-type/model/native-state/repository-phase/
label facets. Values within one facet use OR; facets combine by intersection.
Whole rows toggle checkboxes. Select all, Reset, individual deselection and
clearing the selected phase or state work without shifting content or
unexpectedly closing the filter.
Category filters select their actual catalog substates, so individual deselection
after a category or Select all remains effective. Counts describe the loaded work
scope and retained associations independently of search/facet selections; the
result line reports the matching subset. Applied filter chips can clear one
selection without clearing the other facets. No Models facet is shown while the
normalized native records supply no actual model evidence.

An anchored Repository disclosure offers open/closed/all, refresh and paging.
Show loaded scope; do not invent a remote total. Search covers loaded issues and
retained native associations. Missing/off-page issues retain history and a not
loaded source state; absence is not closure. Failed refresh marks old phase and
contributor data stale until a provider read succeeds.
Keep loading, initial error, empty page and no filter match distinct.

GitHub labels, open/closed state and closure reason determine repository phase
through the shared ADLC catalog. Unlabeled, conflicting, stale or unloaded
source data stays unresolved. Closed with GitHub's completed reason can show
Done; declined or reasonless closure remains Closed. Keep Codex Running, native
turn completed, Failed, Interrupted and Unknown visible as separate state,
including on closed issues. No native turn means Not started. Never infer
acceptance or merge from a completed turn. Model/cost/token data requires actual
evidence, not estimates presented as measurements.

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
Use blue for implementation/running, violet for review, orange for blockers,
red for failures, green for completed closure and distinct neutral tones for
backlog and other closure. Reuse catalog glyphs across phase cards, rows, badges
and Kanban columns. Status colors also have text labels. Optional reviewed project accent remains
[#27](https://github.com/arcitai/factory-software-defence/issues/27); arbitrary
Markdown is not executable CSS and missing theme data retains the full default.

At320–390px collapse navigation/status into labelled controls; wrap row metadata
and long identities without page overflow. Keep the board's own horizontal scroll.
Use semantic controls, visible focus, associated errors and reduced-motion support.
Inspect both themes, desktop/narrow views, filters, detail, long text and failure
states. Match the accepted composition without copying a reference's clipping.

## Observable composition qualification

- At 1440px, compare the candidate to the approved reference: roughly203px
  navigation,56px main margins,212px status rail and48px gap leave a wide issue
  list. Retain the36px/40px project heading, compact facets to the left of view
  controls/search, one toolbar with inline result counts and fine row dividers. Source
  identity/closure/freshness, real activity/work type and author/assignee/label
  metadata have readable rows beneath14px/20px titles, rather than a compressed
  single metadata line. An unstarted issue has no invented work type or attempt.
- At320px and390px, navigation and Repository workflow discovery stay labelled, facets
  stay visible, and long project/issue titles, identities and metadata wrap with
  no page overflow. The collapsed status control reveals the same cards and
  count/name interactions. Board overflow belongs to its focusable region;
  columns remain horizontal, with a visible scrollbar and keyboard scrolling.
- In light and dark themes, inspect category/name/count focus, expanded and folded
  selection, provider label colors/count/tooltips, actual avatars and author vs
  assignee disclosure. Running/implementation is blue, native review violet, repository review pink, attention
  orange, failed red and true completed source closure green. A running native
  turn on a completed GitHub issue must still show both states.
- Exercise whole checkbox rows, Select all, individual deselection, Reset and
  facet intersection. Counts/notices and list position stay stable when menus
  open. Change list/board with active filters, open detail, use filtered previous/
  next, and return through close/Escape with filters, focus, vertical position
  and board horizontal position retained, including the initial no-hash route.
- Inspect loading, initial status/provider error, empty provider page, no match,
  stale source/native status and recovery separately; a failed source snapshot
  stays stale while a retry is pending, until a successful read. Inspect New issue templates,
  create receipts and native detail actions. The existing Node/React/jsdom
  regressions cover interaction/data separation; they do not measure visual
  geometry or prove provider/native functionality. Build, full checks, actual
  desktop/narrow browser and installed CLI/API proof, independent review and
  authorized protected delivery apply to the same final candidate.

The shared owner remains `adlc/lifecycle.json` → `factory/issue-lifecycle.mjs`,
with GitHub metadata from the provider and normalized Codex states from the native
engine. Inbox cards/facets/rows/board derive from these definitions. The catalog adds an explicit open `Not planned` stage before Triaging, using
`factory:not-planned`; it is not GitHub's closed/not-planned reason. Unlabeled
work remains unresolved. Existing readiness names, native states and protocols
stay compatible. The flat label export and Foundation guidance follow the same
catalog; adoption never overwrites a repository's edited labels. The
repository-only contributor review rule is not exported.

## Accepted October 5 refinement

The owner approved the local design and its Inbox release. At very wide widths,
keep the heading aligned with the toolbar and rail; do not center it in a second
capped container. Use dedicated label/contributor columns at wide widths and a
compact metadata footer at ordinary/narrow widths. Repository workflow is the
default rail; Display options can select the original native rail. The phase
children show only observed native activity in loaded work. They do not invent
Awaiting maintainer or other unsupported badges. Select all checks the children;
individual deselection changes the actual filter. Expansion alone never filters.

Display options groups the loaded list by repository Status or Agent activity,
with independently collapsible groups and activity/title ordering. List, detail
navigation and board use the same ordered filtered records. Empty board columns
can be hidden. Readable cards use subtle surfaces, restrained hover motion and
reduced-motion support. Counts always mean loaded scope.

Analytics with historical data, two-way GitHub label editing/dynamic workflow
mapping, and drag/drop repository transitions were explicitly separated into
follow-up issues by the owner. Do not ship preview sample data, dead controls or
pretend these backend capabilities are implemented. The current label chips and
facets continue to use the provider's actual names/colors on refresh.

## Connected-harness Analytics

The owner selected Analytics as the home for account usage, using Kastanje's
provider/window presentation as inspiration. Keep free-standing summary counts
and softly tinted provider surfaces. Show each reported window independently,
with a large remaining percentage, its used percentage and reset time. Never
sum quota percentages or infer window duration from a plan. Preserve the native
source, original observation time, Last known state and explicit missing data.
Unknown usage has no meter. Historical charts require the separate #51 data
work; do not restore preview metrics, account-pool controls or billing fixtures.
Analytics navigation must retain the Inbox's filters, board and scroll state.
