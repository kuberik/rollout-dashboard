# Kuberik Dashboard Redesign — Design Spec

**Date:** 2026-07-19
**Source design:** claude.ai/design project `kuberik dashboard` (`Kuberik Dashboard.html` — a vanilla-JS multi-page prototype: `kuberik-app.js` + `kuberik-data.js`).
**Target:** `rollout-dashboard/frontend` (SvelteKit 2 + Svelte 5 + Tailwind v4 + flowbite-svelte).

## Goal

Port the prototype's **layouts and information architecture** onto the existing dashboard pages, wired to the **real rollout API**. Reuse the existing component library and design tokens rather than importing the prototype's aesthetic.

## Decisions (locked with user)

1. **Scope:** All prototype pages **except** the individual rollout-detail page and the activity page.
2. **Visual identity:** Layouts/IA only. Keep the app's existing tokens — flowbite components, orange brand (`--color-primary-*`, `#fe795d`), Montserrat + default monospace, and the existing status color semantics. **Do not** add a mint brand token, **do not** add JetBrains Mono, **do not** import the prototype's custom CSS wholesale.
3. **Data:** Wire to the real API via the existing `rolloutsListQueryOptions` (`GET /api/rollouts`) and the per-detail queries already in `src/lib/api/`.
4. **Borders:** Colored borders are permitted (this reverses an earlier standing rule). Side/left accent bars are allowed **only on square-cornered (non-rounded) elements** — never on elements with border-radius.

## Status color semantics (unchanged, from `bake-status.ts` / `DESIGN.md`)

- **green** = succeeded/healthy · **red** = failed · **yellow** = InProgress/baking (baking only) · **blue** = Deploying · **amber** = stuck · **gray** = pending / no-deploy / behind.

## Cross-cutting data mapping (prototype concept → real model)

| Prototype concept | Real model field(s) |
|---|---|
| rollout (app in one env) | `Rollout` (metadata.name/namespace) — already the model |
| app (across envs) | `groupRolloutsByApp(rollouts, environments)` → `AppGroup { appName, cells: AppCell[] }`, keyed by `Environment.spec.rolloutRef.name` |
| env tier | `Environment.spec.environment` |
| promotion chain edge | `Environment.spec.relationship { environment, type: "After"\|"Parallel" }` + `env-order.ts` heuristic rank |
| current version | `getDisplayVersion(Rollout.status.history[0].version)` (or `Environment.status.currentVersion`) |
| previous version ("was vX") | `previousSucceededVersion` (from `buildRolloutCards` / history) |
| pinned/wanted | `Rollout.spec.wantedVersion` (→ `PinBadge`) |
| deploy history strip | `Rollout.status.history[]` (id/timestamp/version/triggeredBy) |
| bake status | `history[0].bakeStatus` + `bakeStartTime`/`bakeEndTime`/`bakeStatusMessage` |
| bake progress `N/total` | compute from `bakeStartTime` + `spec.bakeTime` (parse via existing `parseGoDuration`) |
| stuck / behind | `detectStuck` / `detectStuckBehind` / `RolloutCard.behind {fromEnv, version, behindBy}` |
| failed health checks | `history[].failedHealthChecks[] {name, namespace, message?}` |
| gates | `Rollout.status.gates[] {name, passing?, allowedVersions?, bypassGates?}` |
| commit changelist | GitHub API `fetchCommits(...)` — **detail pages only**, requires OAuth |

### Two explicit compromises

- **"4 prod regions" / multi-site drift** → the real model represents this as **multi-cluster** (`RolloutsListResponse.clusters[]`, `clusterErrors[]`, `source-cluster` annotation, `cluster` query param), **not** four separate prod `Environment`s. The cross-env matrix renders over the real environment tiers; regional drift surfaces via multi-cluster cells where present.
- **Per-rollout pod counts (`4/4`)** → **not** available in the list query (only on tests / managed Deployments). **Omit** pod counts from list/matrix/dashboard rows. Keep them on detail pages where managed-resources are fetched.

## Page-by-page

Each page is independently shippable. Target files already exist (this is a re-IA + re-skin, not net-new routes).

| # | Page | Target file | Ported layout |
|---|---|---|---|
| 1 | Dashboard | `src/lib/ControlCenter.svelte` | status tiles (counts) + attention panel (failed/stuck) + namespace-grouped rollout rows |
| 2 | Rollouts | `src/lib/RolloutGrid.svelte` | ns-grouped rows: id · version+age · env badge · status · pipeline glyph |
| 3 | Apps | `src/routes/apps/+page.svelte` | tiles + attention strip + 2-col app cards with per-env lanes + version ladder |
| 4 | App detail | `src/routes/apps/[name]/+page.svelte` | promotion-flow board (env columns) + per-env cards + convergence view |
| 5 | Environments | `src/routes/environments/+page.svelte` | apps × env-tier **matrix** with lag/behind highlighting + legend |
| 6 | Env detail | `src/routes/envs/[name]/+page.svelte` | metrics strip + app rows (version, lag, freshness) |
| 7 | Versions | `src/routes/versions/+page.svelte` | version list grouped by repo (`shared · N apps` / `N live`) |
| 8 | Version detail | `src/routes/versions/[...slug]/+page.svelte` | **release frontier** — per-app env chain showing how far the version reached |

**Skipped:** rollout detail (`src/routes/rollouts/[cluster]/[namespace]/[name]/`), activity (`src/routes/activity/`).

## Shared atoms (flowbite + existing tokens)

Build/extend a small set of reusable pieces so the 8 pages stay consistent. Prefer extending existing components over duplicating:

- **Status circle / dot** — from `bake-status.ts` helpers (`getStatusCircleClass`, etc.).
- **Env badge** — existing `environment-theme.ts` (`getEnvironmentThemeStyle`, `shortEnvLabel`) + `JoinedBadge`.
- **Pipeline glyph** — existing `PipelineGlyph.svelte` (`derivePipeline`).
- **Deploy-history strip** — 6-tick recent-status strip (exists on environments/activity pages; extract to a shared atom).
- **Version ladder** — per-app color-coded version legend (new small atom, uses existing palette).
- **Lag / behind chip** — amber "N behind" indicator (existing `StuckBadge` pattern, extend).
- **Matrix cell** — apps × env grid cell with version + lag (new, environments page).
- **Pin badge** — existing `PinBadge.svelte`.

## Delivery order

1. Shared atoms (deploy-history strip, version ladder, lag chip, matrix cell).
2. Dashboard (`ControlCenter`).
3. Rollouts (`RolloutGrid`).
4. Apps + App detail.
5. Environments + Env detail.
6. Versions + Version detail.

## Constraints / house rules

- Reuse flowbite semantic `color=` props and `bake-status.ts` helpers; don't invent new tints.
- Dark mode is class-based (`.dark` on `<html>`); write colors as `x-100 dark:x-900/30` pairs.
- iOS input-zoom fix in `app.css` must stay **unlayered** (not inside `@layer`).
- No new routes — redesign existing files in place.

## Testing / verification

- `npm run check` (svelte-check) must pass for each page.
- Drive each redesigned page against the real API (or `MOCK_API=1 npm run dev:mock`) and confirm it renders with live data — per the repo `verify` discipline.
- Existing unit tests (`vitest`) for touched lib helpers must stay green.
