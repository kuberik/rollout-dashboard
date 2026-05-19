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

_(None tracked at the moment.)_

## Recently addressed (do not regress)

- ✅ **Handoff v3 — real pipeline data + polish pass.**
  - **Pipeline glyph uses real KruiseRollout stages.** Backend list endpoint (`main.go`) now returns `kruiseRollouts` (lightweight list across queried namespaces) using new `GetKruiseRolloutsAllNamespaces` / `GetKruiseRollouts` helpers. Frontend correlates each kuberik Rollout to its KruiseRollouts via the linked Kustomization's inventory entries (`{ns}_{name}_rollouts.kruise.io_Rollout`) in new `lib/pipeline.ts`. PipelineGlyph now takes a `stages: StageState[]` array; RolloutGrid passes `buildPipelineStages(rollout, kruiseRolloutsForRollout(...))`. Falls back to a synthesised glyph when no KruiseRollouts are linked yet.
  - **Top-right header meta reordered** to `LAST 24H · [spark] · N deploys` to match the design — previously it was `N · deploys · 24h · [spark]`.
  - **Removed `query.isFetching` refetch spinners** from every page (rollouts, apps, environments, env-detail, namespace-detail, app-detail, activity). The brief flicker after each 10–15s poll read as a visual bug; the dashboard now refetches silently.
  - **Command palette env badge** — `getRolloutEnvironmentTheme(r)` was called without the Environment object so rollouts without `environment-theme-*` annotations (e.g. `kuberik-demo-app`) showed no badge. Now passes the matching `Environment` from the list, so every rollout that has an Environment binding gets a badge.
  - **Activity row alignment** — locked the status-circle column to 28px and moved the vertical rail to `left-[30px]` so it passes exactly through every circle center. Bumped the circle to `h-7 w-7` to match the rail column width, and tuned the outer ring to `dark:ring-gray-900` so it matches the page background instead of the card.
  - **Rollout-detail tabs: no horizontal scroll on mobile** — the tabs row dropped `overflow-x-auto`. On `<sm` viewports the labels hide (`hidden sm:inline`), tabs split evenly across the row (`flex-1`), and the four icon-only tabs always fit without scrolling. From `sm:` upward the labels reappear and tabs revert to flex-initial.

- ✅ **Handoff v2 — alignment + rank pass.** Pinned all list-view rows to fixed-width grid templates so columns line up across rows and across sections.
  - **Rollouts list** (`RolloutGrid.svelte`, `app.css`): grid template `40px 1fr 140px 70px 110px 60px` at `lg`, with a sticky column-header row (`Rollout · Pipeline · 24h · Version·age`). Replaced per-env stat tiles with compact env filter pills next to the search input.
  - **Pipeline glyph** (`PipelineGlyph.svelte`): now 9 synthesised pipeline stages derived from `latest.bakeStatus` + `categorizeFailure(latest.bakeStatusMessage)`. The failure category controls where the red dot lands (`test=1`, `image=2`, `gate=3`, `healthcheck≈6`, `timeout=8`) so failures don't look like "5 empty slots + 1 red". Connector bars are `w-2 h-px gray-300`.
  - **Rank logic (`AppVelocityCard.svelte` + `apps/[name]/+page.svelte`)** — replaced deploy-timestamp-based ranking with **`version.created`-based release order**. A version pinned in staging no longer reads as "newer" than an unpinned version released later. Demo cluster: PROD (`f960d39`) now correctly shows `newest`, STAGING (`75945b5`, pinned) shows `−1 from newest`. The app-detail per-env rank chip uses the same `versionReleaseRank` lookup.
  - **Apps list** (`apps/+page.svelte`): stripped the search bar and per-env summary tiles per the design — only stat tiles + 2-up `AppVelocityCard` grid remain.
  - **Environments list** (`environments/+page.svelte`): rows pinned to `36px 1.5fr 180px 110px 60px` template so status / title / history-strip / version / age line up across env sections. Version and age use `justify-self-end`.
  - **Gantt** (`apps/[name]/+page.svelte`): switched lane header + lane rows to a shared grid template `80px minmax(0,1fr)` so the env-badge column and tick header align by definition (was flex+width before). Time range picker now offers `1h / 6h / 12h / 24h / 7d / 30d / all`.
  - **Activity page** (`activity/+page.svelte`): rebuilt to match the design — `Activity · N events · last 7 days` header with a 20-bucket 24h sparkline + total on the right; status-class filter chips (`All / Deploys / In progress / Failures`) on the left and env filter chips on the right; cluster headers with count chip; per-row format `[status circle] · [time] · [actor] [verb] [app] to [ENV badge] [version] · [status]` with `was <prev>` line-through on the trailing right; vertical timeline rail through the dots in each cluster.
  - **Activity rails** (`apps/[name]`, `envs/[name]`, `namespaces/[name]`, `ActivityRail.svelte`): replaced the `bg-gradient-to-b … to-transparent` spine with a solid `bg-gray-200 dark:bg-gray-700/80` line so it doesn't read as a fading "thin line".
  - **Per-row 24h sparkline** (`DeployVolumeSparkline.svelte`): added a `buckets` prop so callers can decouple bucket count from window length. Rollouts list passes `hours={24} buckets={12}` (2h buckets → wider, more visible bars). Bars switched to emerald with a 30% minimum height so they read at a glance.

- ✅ **Handoff redesign landed (7 pages):** implemented the design-handoff bundle (`/tmp/claude/kuberik_design/...`).
  - Rollouts list: per-row 6-dot **pipeline glyph** (`PipelineGlyph.svelte` — last 6 history outcomes coloured by `bakeStatus`) and per-row **24h hourly sparkline** (`DeployVolumeSparkline` extended with `hours` prop). Title column now carries the diagnostic line (failed / behind / baking / deploying); version+age merged into a single right-aligned column.
  - Apps list (`/apps`): replaced per-app panel with **Velocity Cards** grid (`AppVelocityCard.svelte`, `grid-cols-1 md:grid-cols-2`). Each card has header + per-env lane chart (stable per-version palette, current segment ringed by status colour), per-lane rank chip (**`newest`** in mint, **`−N`** in **neutral gray** — never amber), and a newest-first version legend.
  - Environments list (`/environments`): replaced matrix layout with **stacked env sections**. Each section has a tight header (env badge · counts · 24h sparkline · app count) and a per-app row with a 6-tick deploy history strip + one-line summary ("all recent succeeded" / "2/6 failed" / "currently deploying" / "stuck — see detail").
  - App detail (`/apps/[name]`): replaced promotion-flow + 5-col grid with the **two-pane workspace** (`lg:grid-cols-[1fr_320px]`). Left column has per-env action cards (status circle · env badge · namespace mono · rank chip · `View on GitHub` / `Change Version` / `Rollback` button row matching rollout-detail), with 3-col body (Version · State · Recent deploys 5-tick strip). Right rail keeps the existing activity timeline. Compact Gantt with range picker + version ladder lives below.
  - Env detail (`/envs/[name]`): added the **metrics strip** (Apps · Deploys 24h + spark · Median bake · Promotion rate) and a per-app inline **promotion chain** (env chips ordered by `compareEnvironmentNames`, current env mint-highlighted, joined by `ChevronRightOutline`, "only bound to X" fallback for single-env apps). No env-level chain.
  - Namespace detail (`/namespaces/[name]`): replaced correlation-timeline + 3-col card grid + deployment-timeline with a **mini dashboard**: 4 stat tiles (Rollouts · Healthy · Failing · Deploys 24h + spark) + `lg:grid-cols-[1fr_320px]` body (rollouts list left, activity rail right).
  - Activity (`/activity`): clusters now include **"In the last hour"** and **"Older"** in addition to Today / Yesterday / weekday. Row copy switched to actor-verb format: `[actor] [verb] [app] to [env]` with `previousVersion → currentVersion` chip on the right.

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
