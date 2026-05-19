# Rollout Dashboard — design constraints & open issues

Running log of user feedback. Each item is either **enforced** (already
landed and must stay landed) or **open** (still to address). Before
making any UI change, re-read this file and check whether the change
violates an enforced item.

## Enforced rules — do not regress

### Visual treatment

- **No colored borders.** No `border-l-4`, no thickened/coloured top/left/right/bottom strips, no `h-1`/`h-0.5` colored accent bars. Use dot indicators, icons, status circles or background tints (within the rules below) instead.
- **No popup hover effects** on list/grid cards. Specifically: no `hover:-translate-y-*`, no `hover:shadow-xl`/`hover:shadow-lg`, no `hover:ring-*` that materialises on hover. Plain `hover:bg-*` colour transitions only.
- **No status-driven background gradients.** `card-failed`/`card-active` linear-gradient tints are removed and must not be reintroduced. Status is conveyed via the status circle + inline text only.
- **No long composition / "succeeded vs failed" progress bars.** Removed from page headers (home, /apps, /envs/[name], /namespaces/[name]) and from /activity day headers and /environments env column headers. They look like progress bars but aren't.
- **No left-edge env-color gradient on rows** (the `environment-theme-edge` "vertical blue bar" class is deleted).
- **No env-themed band on top of the individual rollout page's main status card.** Card body sits on plain bg.
- **No status-colored boxed callouts on list cards.** Failure / behind / promote hints render as plain inline text in the status colour, not boxed `bg-red-50` / `bg-orange-50` / `bg-emerald-50` pills. The "healthcheck failed" boxed pill looked terrible; never reintroduce.

### Colour palette discipline

- Reuse status colours: green (succeeded/healthy), red (failed), yellow (InProgress / baking — RESERVED for baking only), blue (Deploying), amber (stuck), gray (pending/no-deploy/behind context). InProgress and Deploying are NOT the same state and must NOT share a colour.
- Env theme colours (dev/staging/prod/etc.) belong to env badges and the env band on /apps/[name] pipeline nodes. They do not apply to the card body.
- Stop adding new colour scopes. Audit existing colour uses before adding any new tint.

### Semantics

- **"Drift" is not a valid status.** Different versions across envs is the normal state during promotion. Removed the DriftBadge and all drift counters. Do not reintroduce drift framing.
- **"Stuck" is the valid promotion-health concept.** A rollout is stuck if:
  1. Its bake/deploy state has been running > 1h, or
  2. It is "behind" an upstream peer env for > 24h and unpinned.
  Surface stuck via `StuckBadge` on /apps cards, /environments matrix cells, /apps/[name] aggregate, and rollout detail status card.

### Navigation

- **Sidebar holds section nav** (Rollouts / Apps / Environments / Activity) on desktop. Mobile uses the bottom tab bar.
- **No section dropdown in the navbar.** A static breadcrumb-style label is OK; a popover/dropdown of sections is not.
- **Drop "Rollouts" hardcoded title from navbar.** It was redundant with section nav.
- **No status badge in navbar.** The Ready/Error/Unknown badge on rollout detail is redundant with the on-page status card.
- **No duplicate ⌘K hint.** The keyboard shortcut hint appears once; the standalone magnifying-glass search button is not the right home for it.

### Page layout

- **Headers stack on mobile.** Page title gets its own truncatable line; the meta/stats row sits below. Title must not be cut off by stats.
- **No horizontal scrolling for primary content on mobile.** Promotion flow and similar must reflow vertically.

## Open issues — still to address

1. **Rollout list (home `/`) and Apps list (`/apps`) need more inspiration.** Both have been simplified and aligned but still feel like generic card grids. Open question: what would a "delightful" landing page look like — surface fleet trends, recent activity, upcoming promotions?

## Recently addressed (do not regress)

- ✅ Restored section breadcrumb as a static link (`Apps`, `Environments`, etc.) in the navbar — sidebar is the switcher, the navbar label is just a link.
- ✅ Sidebar is collapsible with a toggle at the bottom, state persisted to localStorage.
- ✅ Magnifying-glass search button removed; ⌘K kbd hint lives on the rollout breadcrumb selector.
- ✅ ⌘K palette rebuilt as a unified surface (`CommandPalette.svelte`) that searches across rollouts, apps, environments, namespaces, and top-level pages with kind-aware scoring and grouped sections.
- ✅ /apps/[name] promotion flow now uses Svelte Flow + dagre; auto-reflows LR ↔ TB based on viewport. **Not pannable, not zoomable** — like /rollouts/[ns]/[name]/environments, it fits-to-view only.
- ✅ Rollout detail layout converted from a side sub-sidebar to horizontal top tabs (Overview / History / Environments / Logs). Eliminates the double-sidebar that used to appear next to the global sidebar.
- ✅ /apps/[name] version lifecycle is now a proper Gantt. One lane per env, each deploy a colored bar that runs until the next deploy in that env (or 'now'). Same version uses the same palette colour across lanes so a version's promotion arc traces visually. Has a real time axis with hour/day/week ticks, a 'now' edge marker, and a version-colour legend below.
- ✅ Gantt surfaces version ordering: each bar shows the version name plus a `−N` chip when behind the newest. The legend below is now a "newest first" ladder showing every version with its `newest` / `−N` rank.
- ✅ Mobile rollout-detail tabs no longer render a horizontal scrollbar (`.no-scrollbar` utility hides chrome on overflow-x).
- ✅ Promotion-flow SvelteFlow now reacts to container resize via ResizeObserver + `useSvelteFlow().fitView()`. Component is wrapped in `SvelteFlowProvider` so the hook is reachable. Orientation flips LR ↔ TB based on container width, not just initial viewport. Background and edge labels restyled to match dashboard chrome.
- ✅ Command palette has scoped levels:
  - ⌘K opens the global multi-type view.
  - Clicking a section name in the navbar breadcrumb opens the palette **scoped** to that kind (rollouts / apps / environments). The scope appears as a removable chip next to the search icon; placeholder updates to match.
  - First ESC clears the scope back to global; second ESC closes. Backspace on an empty query also pops the scope.
- ✅ Home rollout-list page header aligned with /apps: title stacks above meta on mobile, meta is a single line of count chips and the deploy-volume sparkline. Removes the unique "Recent 24h deploys" link element that made the header feel different from the other lists.

## Working principles

- Always test mobile AND desktop before declaring something done.
- Check this document before adding any new visual element.
- When new feedback lands, append it here so it survives session compaction.
