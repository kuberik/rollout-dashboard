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

- Reuse status colours: green (succeeded/healthy), red (failed), yellow (in-progress AND deploying — they share yellow), amber (stuck), gray (pending/no-deploy/behind context). Do NOT use blue for Deploying — that clashes with env themes.
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

1. **Home rollout list still looks the most inconsistent** with the rest of the dashboard. The card design is unified now but the page structure (namespace grouping, search/filter bar) differs from /apps. Audit and align.

## Recently addressed (do not regress)

- ✅ Restored section breadcrumb as a static link (`Apps`, `Environments`, etc.) in the navbar — sidebar is the switcher, the navbar label is just a link.
- ✅ Sidebar is collapsible with a toggle at the bottom, state persisted to localStorage.
- ✅ Magnifying-glass search button removed; ⌘K kbd hint lives on the rollout breadcrumb selector.
- ✅ ⌘K palette rebuilt as a unified surface (`CommandPalette.svelte`) that searches across rollouts, apps, environments, namespaces, and top-level pages with kind-aware scoring and grouped sections.
- ✅ /apps/[name] promotion flow now uses Svelte Flow + dagre; auto-reflows LR ↔ TB based on viewport, pannable, zoomable.
- ✅ /apps/[name] version lifecycle replaced the lane-Gantt with a chronological env-chip trail per version. Each row reads as `[ENV] 2h › [ENV] 1h › …` so promotion velocity is visible without a scaled axis.

## Working principles

- Always test mobile AND desktop before declaring something done.
- Check this document before adding any new visual element.
- When new feedback lands, append it here so it survives session compaction.
