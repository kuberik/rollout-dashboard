# Kuberik Dashboard Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Port the claude.ai design prototype's layouts and information architecture onto the existing rollout-dashboard pages, wired to the real rollout API, reusing the existing flowbite/token system.

**Architecture:** Two layers per page. (1) *Pure derivation helpers* in `src/lib/` that transform the existing `RolloutsListResponse` into view models (lag, matrix, release-frontier, bake-progress, deploy-history) — these are unit-tested with vitest. (2) *Svelte layout* that renders those view models with existing flowbite components and tokens — verified by `svelte-check` + driving the page against `MOCK_API=1`. New shared atoms are extracted once and reused across pages.

**Tech Stack:** SvelteKit 2, Svelte 5 (runes), Tailwind v4 (CSS-config in `app.css`), flowbite-svelte 1.x + flowbite-svelte-icons, TanStack Svelte Query, vitest, playwright.

## Global Constraints

- Reuse existing tokens: orange brand (`--color-primary-*`), Montserrat + default monospace. Do **not** add a mint token or JetBrains Mono. Do **not** import the prototype's CSS.
- Status colors (from `bake-status.ts`): green=succeeded/healthy, red=failed, yellow=baking/InProgress, blue=Deploying, amber=stuck, gray=pending/behind. Use flowbite semantic `color=` props + `bake-status.ts` helpers — do not invent tints.
- Dark mode is class-based (`.dark` on `<html>`); write colors as `x-100 dark:x-900/30` pairs.
- Colored borders are allowed. Side/left accent bars only on square-cornered (non-`rounded-*`) elements.
- iOS input-zoom fix in `app.css` stays unlayered.
- No new routes. Redesign existing files in place. Skip rollout-detail and activity pages entirely.
- All list/matrix/dashboard rows: **omit pod counts** (not in list query). Multi-region drift = multi-cluster (`clusters[]`), not extra prod environments.
- Data source: `rolloutsListQueryOptions()` (`GET /api/rollouts`) for lists; existing per-detail queries for detail pages.
- Each page's data derivation goes through `groupRolloutsByApp()` / `buildRolloutCards()` where they already fit; extend rather than duplicate.
- Every task ends green on `npm run check` (svelte-check) and, for helper tasks, `npm run test:unit -- --run <file>`.

---

## File Structure

**New helper modules (`src/lib/`):**
- `view-models/lag.ts` — per-cell "behind upstream" computation shared by matrix/app-detail/env-detail.
- `view-models/matrix.ts` — apps × env-tier matrix builder for the Environments page.
- `view-models/release-frontier.ts` — per-app env-chain reach for a given version (Version detail).
- `view-models/bake-progress.ts` — `{elapsed, total, fraction}` from `bakeStartTime` + `spec.bakeTime`.
- `view-models/deploy-history.ts` — normalize `status.history[]` into a fixed-length status-tick strip.

**New shared atom components (`src/lib/components/`):**
- `DeployHistoryStrip.svelte` — N-tick recent-status strip.
- `VersionLadder.svelte` — per-app color-coded version legend.
- `LagChip.svelte` — amber "N behind" chip (extends `StuckBadge` pattern).
- `StatusTile.svelte` — clickable count tile for dashboards.
- `MatrixCell.svelte` — apps×env grid cell (version + lag + status dot).

**Modified pages:**
- `src/lib/ControlCenter.svelte` (dashboard), `src/lib/RolloutGrid.svelte` (rollouts).
- `src/routes/apps/+page.svelte`, `src/routes/apps/[name]/+page.svelte`.
- `src/routes/environments/+page.svelte`, `src/routes/envs/[name]/+page.svelte`.
- `src/routes/versions/+page.svelte`, `src/routes/versions/[...slug]/+page.svelte`.

**Note on layout tasks:** exact markup is assembled iteratively against the running app. Layout tasks specify the *structure, real fields, and flowbite components* precisely and are verified by `svelte-check` + visual drive against `MOCK_API=1`. Derivation-helper tasks carry full TDD code.

---

## Phase 1 — Shared derivation helpers (TDD)

### Task 1: Bake-progress helper

**Files:**
- Create: `src/lib/view-models/bake-progress.ts`
- Test: `src/lib/view-models/bake-progress.test.ts`

**Interfaces:**
- Consumes: `parseGoDuration` (already in `src/lib/utils.ts` — verify export name; if it is not exported, export it). `HistoryEntry` from `$lib/../types`.
- Produces: `computeBakeProgress(bakeStartTime: string | undefined, bakeTime: string | undefined, now: Date): { elapsedMs: number; totalMs: number; fraction: number } | null` — returns `null` when either input missing or `bakeTime` unparseable.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { computeBakeProgress } from './bake-progress';

describe('computeBakeProgress', () => {
  const now = new Date('2026-07-19T12:10:00Z');
  it('returns null when start time missing', () => {
    expect(computeBakeProgress(undefined, '30m', now)).toBeNull();
  });
  it('returns null when bakeTime missing or unparseable', () => {
    expect(computeBakeProgress('2026-07-19T12:00:00Z', undefined, now)).toBeNull();
    expect(computeBakeProgress('2026-07-19T12:00:00Z', 'nonsense', now)).toBeNull();
  });
  it('computes fraction clamped to [0,1]', () => {
    const r = computeBakeProgress('2026-07-19T12:00:00Z', '30m', now)!;
    expect(r.totalMs).toBe(30 * 60 * 1000);
    expect(r.elapsedMs).toBe(10 * 60 * 1000);
    expect(r.fraction).toBeCloseTo(1 / 3, 5);
  });
  it('clamps fraction at 1 when elapsed exceeds total', () => {
    const r = computeBakeProgress('2026-07-19T11:00:00Z', '30m', now)!;
    expect(r.fraction).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:unit -- --run src/lib/view-models/bake-progress.test.ts`
Expected: FAIL (module not found / `computeBakeProgress` undefined).

- [ ] **Step 3: Write minimal implementation**

```ts
import { parseGoDuration } from '$lib/utils';

export function computeBakeProgress(
  bakeStartTime: string | undefined,
  bakeTime: string | undefined,
  now: Date
): { elapsedMs: number; totalMs: number; fraction: number } | null {
  if (!bakeStartTime || !bakeTime) return null;
  const totalMs = parseGoDuration(bakeTime);
  if (!totalMs || totalMs <= 0) return null;
  const start = new Date(bakeStartTime).getTime();
  if (Number.isNaN(start)) return null;
  const elapsedMs = Math.max(0, now.getTime() - start);
  const fraction = Math.min(1, elapsedMs / totalMs);
  return { elapsedMs, totalMs, fraction };
}
```

Note: if `parseGoDuration` is not already exported from `utils.ts`, add `export` to it and confirm it returns milliseconds (check its current return unit before relying on it; adjust the test's `totalMs` expectation if it returns seconds).

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:unit -- --run src/lib/view-models/bake-progress.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/view-models/bake-progress.ts src/lib/view-models/bake-progress.test.ts
git commit -m "feat(dashboard): add bake-progress derivation helper"
```

### Task 2: Deploy-history strip helper

**Files:**
- Create: `src/lib/view-models/deploy-history.ts`
- Test: `src/lib/view-models/deploy-history.test.ts`

**Interfaces:**
- Consumes: `HistoryEntry` (has `bakeStatus?`, `timestamp`, `version`, `failedHealthChecks?`).
- Produces: `historyTicks(history: HistoryEntry[] | undefined, count: number): Array<'ok' | 'fail' | 'active' | 'none'>` — most-recent-last, left-padded with `'none'` to length `count`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { historyTicks } from './deploy-history';

const h = (bakeStatus: string) => ({ timestamp: '2026-07-19T00:00:00Z', version: { tag: 'v' }, bakeStatus }) as any;

describe('historyTicks', () => {
  it('pads to length with none on the left', () => {
    expect(historyTicks([h('Succeeded')], 3)).toEqual(['none', 'none', 'ok']);
  });
  it('maps statuses and keeps chronological (oldest left)', () => {
    // history[0] is newest in the model → newest must be rightmost
    const out = historyTicks([h('Failed'), h('Succeeded'), h('InProgress')], 3);
    expect(out).toEqual(['active', 'ok', 'fail']);
  });
  it('truncates to the most recent `count`', () => {
    const out = historyTicks([h('Failed'), h('Succeeded'), h('Succeeded'), h('Succeeded')], 2);
    expect(out).toEqual(['ok', 'fail']);
  });
  it('handles empty/undefined', () => {
    expect(historyTicks(undefined, 2)).toEqual(['none', 'none']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:unit -- --run src/lib/view-models/deploy-history.test.ts`
Expected: FAIL.

- [ ] **Step 3: Write minimal implementation**

```ts
import type { HistoryEntry } from '$lib/../types';

type Tick = 'ok' | 'fail' | 'active' | 'none';

function tickOf(e: HistoryEntry): Tick {
  const s = e.bakeStatus;
  if (s === 'Failed' || s === 'Cancelled') return 'fail';
  if (s === 'InProgress' || s === 'Deploying') return 'active';
  return 'ok';
}

export function historyTicks(history: HistoryEntry[] | undefined, count: number): Tick[] {
  const recent = (history ?? []).slice(0, count).map(tickOf).reverse(); // oldest→newest
  const pad: Tick[] = Array(Math.max(0, count - recent.length)).fill('none');
  return [...pad, ...recent];
}
```

Adjust the `HistoryEntry` import path to match the barrel (`src/types/index.ts`) — verify the correct import specifier before finalizing.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:unit -- --run src/lib/view-models/deploy-history.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/view-models/deploy-history.ts src/lib/view-models/deploy-history.test.ts
git commit -m "feat(dashboard): add deploy-history tick helper"
```

### Task 3: Lag helper

**Files:**
- Create: `src/lib/view-models/lag.ts`
- Test: `src/lib/view-models/lag.test.ts`

**Interfaces:**
- Consumes: `AppGroup`/`AppCell` from `$lib/version-utils`, `compareEnvironmentNames` from `$lib/env-order`, `getDisplayVersion` from `$lib/utils`.
- Produces:
  - `upstreamCell(group: AppGroup, envName: string): AppCell | null` — the immediately-preceding environment's cell in promotion order (`Environment.spec.relationship.type === 'After'` edge if present, else `env-order` rank).
  - `cellLag(group: AppGroup, envName: string): { behindBy: number; upstreamVersion: string | null } | null` — how many deploys behind the upstream this cell is (0 = converged), or `null` if no upstream. `behindBy` is the index distance within the app's ordered version list; when versions are incomparable, return `behindBy: 0`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { upstreamCell, cellLag } from './lag';

// Build a minimal AppGroup with two cells: dev on v3, prod on v1.
function mkGroup(): any {
  const cell = (envName: string, version: string) => ({
    envName, environment: envName,
    rollout: { status: { history: [{ version: { version } }] } },
    repoKey: 'app:x'
  });
  return { appName: 'x', hasEnvironmentBinding: true, cells: [cell('dev', 'v3'), cell('prod', 'v1')] };
}

describe('lag', () => {
  it('finds the upstream env by promotion order', () => {
    const g = mkGroup();
    expect(upstreamCell(g, 'prod')?.envName).toBe('dev');
    expect(upstreamCell(g, 'dev')).toBeNull();
  });
  it('reports prod as behind dev', () => {
    const g = mkGroup();
    const lag = cellLag(g, 'prod')!;
    expect(lag.behindBy).toBeGreaterThan(0);
    expect(lag.upstreamVersion).toBe('v3');
  });
  it('reports converged as 0 behind', () => {
    const g = mkGroup();
    g.cells[1].rollout.status.history[0].version.version = 'v3';
    expect(cellLag(g, 'prod')!.behindBy).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:unit -- --run src/lib/view-models/lag.test.ts`
Expected: FAIL.

- [ ] **Step 3: Write minimal implementation**

Implement `upstreamCell` (order the group's cells by `env-order` `compareEnvironmentNames`, honoring an `After` relationship edge from `cell.rollout`/`environment` when available; return the cell one position earlier). Implement `cellLag` (build the ordered list of distinct versions seen across the app's cells newest-first; `behindBy` = index(cellVersion) − index(upstreamVersion), floored at 0). Use `getDisplayVersion(history[0].version)` to read each cell's current version. Keep it pure. Full code assembled to satisfy the tests above.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:unit -- --run src/lib/view-models/lag.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/view-models/lag.ts src/lib/view-models/lag.test.ts
git commit -m "feat(dashboard): add cross-env lag helper"
```

### Task 4: Matrix builder

**Files:**
- Create: `src/lib/view-models/matrix.ts`
- Test: `src/lib/view-models/matrix.test.ts`

**Interfaces:**
- Consumes: `groupRolloutsByApp` output, `sortEnvironmentNames` from `$lib/env-order`, `cellLag` (Task 3), `getDisplayVersion`.
- Produces: `buildMatrix(rollouts: Rollout[], environments: Environment[]): { envTiers: string[]; rows: MatrixRow[] }` where `MatrixRow = { appName: string; title: string; worstLag: number; cells: Record<string, MatrixCellVM | null> }` and `MatrixCellVM = { envName: string; version: string; statusKey: string; behindBy: number }`. `envTiers` is the sorted union of `Environment.spec.environment` tiers across all apps.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { buildMatrix } from './matrix';

// Two apps across dev/prod; one lagging in prod.
// (Construct minimal Rollout[] + Environment[] fixtures mirroring groupRolloutsByApp inputs.)
describe('buildMatrix', () => {
  it('produces sorted env tiers and one row per app', () => {
    const { envTiers, rows } = buildMatrix(FIXTURE_ROLLOUTS, FIXTURE_ENVS);
    expect(envTiers).toEqual(['dev', 'prod']);
    expect(rows.map(r => r.appName).sort()).toEqual(['a', 'b']);
  });
  it('marks a lagging cell with behindBy > 0 and sets worstLag', () => {
    const { rows } = buildMatrix(FIXTURE_ROLLOUTS, FIXTURE_ENVS);
    const a = rows.find(r => r.appName === 'a')!;
    expect(a.cells['prod']!.behindBy).toBeGreaterThan(0);
    expect(a.worstLag).toBe(a.cells['prod']!.behindBy);
  });
  it('leaves cells null where an app is not deployed to a tier', () => {
    const { rows } = buildMatrix(FIXTURE_ROLLOUTS, FIXTURE_ENVS);
    const b = rows.find(r => r.appName === 'b')!;
    expect(b.cells['prod']).toBeNull();
  });
});
```

Define `FIXTURE_ROLLOUTS` / `FIXTURE_ENVS` at the top of the test file as minimal objects that `groupRolloutsByApp` accepts (app `a`: dev=v3/prod=v1 both bound via `Environment.spec.rolloutRef`; app `b`: dev only). Verify the exact minimal shape by reading `groupRolloutsByApp` before writing the fixture.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:unit -- --run src/lib/view-models/matrix.test.ts`
Expected: FAIL.

- [ ] **Step 3: Write minimal implementation**

Implement `buildMatrix`: call `groupRolloutsByApp`; collect env tiers from each cell's `environment`; sort with `sortEnvironmentNames`; for each app build `cells[tier]` (or `null`), fill `version` via `getDisplayVersion`, `statusKey` via `buildRolloutCards`/`getRolloutStatus` on the cell rollout, `behindBy` via `cellLag`; `worstLag = max(behindBy)`. Full code to satisfy the tests.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:unit -- --run src/lib/view-models/matrix.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/view-models/matrix.ts src/lib/view-models/matrix.test.ts
git commit -m "feat(dashboard): add apps×env matrix builder"
```

### Task 5: Release-frontier builder

**Files:**
- Create: `src/lib/view-models/release-frontier.ts`
- Test: `src/lib/view-models/release-frontier.test.ts`

**Interfaces:**
- Consumes: `groupRolloutsByApp`, `repoKeyFor`, `sortEnvironmentNames`, `getDisplayVersion`.
- Produces: `buildReleaseFrontier(repoKey: string, version: string, rollouts: Rollout[], environments: Environment[]): { apps: FrontierApp[] }` where `FrontierApp = { appName: string; title: string; stops: FrontierStop[]; reached: number; total: number }` and `FrontierStop = { envName: string; state: 'live' | 'ahead' | 'behind' | 'absent'; version: string | null }`. `state` = `live` if the env currently runs exactly `version`; `ahead` if it runs a newer version; `behind` if older; `absent` if the app isn't deployed there.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { buildReleaseFrontier } from './release-frontier';

describe('buildReleaseFrontier', () => {
  it('classifies each env stop relative to the target version', () => {
    const { apps } = buildReleaseFrontier('app:a', 'v2', FIXTURE_ROLLOUTS, FIXTURE_ENVS);
    const a = apps.find(x => x.appName === 'a')!;
    const byEnv = Object.fromEntries(a.stops.map(s => [s.envName, s.state]));
    expect(byEnv['dev']).toBe('ahead');   // dev on v3
    expect(byEnv['staging']).toBe('live'); // staging on v2
    expect(byEnv['prod']).toBe('behind');  // prod on v1
    expect(a.reached).toBe(1); // only staging is live on v2
  });
  it('only includes apps whose repoKey matches', () => {
    const { apps } = buildReleaseFrontier('app:a', 'v2', FIXTURE_ROLLOUTS, FIXTURE_ENVS);
    expect(apps.every(x => x.appName === 'a')).toBe(true);
  });
});
```

Fixtures: app `a` with dev=v3, staging=v2, prod=v1; comparability by a shared ordered version list `['v3','v2','v1']` (newest first). Verify version ordering source (the app's cells' history) before finalizing the comparator.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:unit -- --run src/lib/view-models/release-frontier.test.ts`
Expected: FAIL.

- [ ] **Step 3: Write minimal implementation**

Implement `buildReleaseFrontier`: filter groups whose `repoKeyFor` matches `repoKey`; for each app, order env stops with `sortEnvironmentNames`; compare each stop's current version to `version` using the app's newest-first version list (index smaller = newer = `ahead`; equal = `live`; larger = `behind`; missing cell = `absent`); `reached` = count of `live`; `total` = count of non-`absent`. Full code to satisfy tests.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:unit -- --run src/lib/view-models/release-frontier.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/view-models/release-frontier.ts src/lib/view-models/release-frontier.test.ts
git commit -m "feat(dashboard): add release-frontier builder"
```

---

## Phase 2 — Shared atom components

Atoms are thin, presentational, prop-driven. Verification = `svelte-check` + a throwaway render in a page during the consuming task. Each atom task commits independently.

### Task 6: DeployHistoryStrip, LagChip, StatusTile, VersionLadder, MatrixCell

**Files:**
- Create: `src/lib/components/DeployHistoryStrip.svelte`, `LagChip.svelte`, `StatusTile.svelte`, `VersionLadder.svelte`, `MatrixCell.svelte`

**Interfaces (props — Svelte 5 `$props()`):**
- `DeployHistoryStrip`: `{ ticks: Array<'ok'|'fail'|'active'|'none'> }` → renders a row of small squares colored via `bake-status.ts` classes (`ok`→green, `fail`→red, `active`→blue, `none`→gray). Uses `dark:` pairs.
- `LagChip`: `{ behindBy: number }` → amber `Badge color="yellow"` reading `{behindBy} behind`; renders nothing when `behindBy <= 0`.
- `StatusTile`: `{ n: number; label: string; tone?: 'default'|'fail'; href?: string; onclick?: () => void }` → clickable count tile (large Montserrat number + uppercase label). `tone='fail'` uses red border (colored borders now allowed).
- `VersionLadder`: `{ versions: Array<{ version: string; color: string; isNew?: boolean }> }` → inline legend of color swatch + version, `isNew` gets an uppercase "new" tag.
- `MatrixCell`: `{ vm: MatrixCellVM | null }` (type from `matrix.ts`) → version + status dot + optional `LagChip`; empty state when `null`.

- [ ] **Step 1:** Create the five components with the prop contracts above, using only flowbite components (`Badge`) + existing status classes. No new tokens.
- [ ] **Step 2:** Run `npm run check`. Expected: PASS (no type errors).
- [ ] **Step 3: Commit**

```bash
git add src/lib/components/DeployHistoryStrip.svelte src/lib/components/LagChip.svelte src/lib/components/StatusTile.svelte src/lib/components/VersionLadder.svelte src/lib/components/MatrixCell.svelte
git commit -m "feat(dashboard): add shared dashboard atoms"
```

---

## Phase 3 — Pages (one task each)

Each page task: (a) build the view model from the list query using Phase-1 helpers, (b) assemble the ported layout with Phase-2 atoms + flowbite, (c) `npm run check`, (d) drive with `MOCK_API=1 npm run dev:mock` and confirm live render, (e) commit. Reference `kuberik-app.js` `page*` function named in each task for the exact structure.

### Task 7: Dashboard (`ControlCenter.svelte`) — mirrors `pageControl`

**Files:** Modify `src/lib/ControlCenter.svelte`.
**Interfaces:** Consumes `rolloutsListQueryOptions`, `buildRolloutCards`, `computeBakeProgress`, `historyTicks`, `StatusTile`, `DeployHistoryStrip`.

- [ ] **Step 1:** Add a status-tile row (counts of failed / in-motion / baking / healthy from `buildRolloutCards` partitions already computed here) using `StatusTile`.
- [ ] **Step 2:** Add the attention panel (failed + stuck cards) at top, each row linking to its rollout/app; use existing `StuckBadge`/`HealthCheckBadge`.
- [ ] **Step 3:** Render the remaining rollouts grouped by `metadata.namespace` (ns-group header + rows: title/name · version+age · env badge · status circle · `PipelineGlyph`). Omit pod counts.
- [ ] **Step 4:** Run `npm run check`. Expected: PASS.
- [ ] **Step 5:** Run `MOCK_API=1 npm run dev:mock`, open `/`, confirm tiles + attention + ns groups render with mock fleet data.
- [ ] **Step 6: Commit** `git commit -am "feat(dashboard): redesign Control Center to tiles + attention + ns groups"`

### Task 8: Rollouts (`RolloutGrid.svelte`) — mirrors `pageRollouts`

**Files:** Modify `src/lib/RolloutGrid.svelte`.

- [ ] **Step 1:** Group rollout cards by namespace; render ns-group header (name + count/meta) and a column header row.
- [ ] **Step 2:** Each rollout row: id (title + name) · version+age (mono) · env badge (`environment-theme`) · status circle · `PipelineGlyph`. Keep the existing multi-cluster filter pills.
- [ ] **Step 3:** `npm run check` → PASS.
- [ ] **Step 4:** Drive `/rollouts` under mock; confirm ns grouping + rows.
- [ ] **Step 5: Commit** `git commit -am "feat(dashboard): redesign Rollouts list to ns-grouped rows"`

### Task 9: Apps list (`routes/apps/+page.svelte`) — mirrors `pageApps`

**Files:** Modify `src/routes/apps/+page.svelte`.
**Interfaces:** `groupRolloutsByApp`, `StatusTile`, `VersionLadder`, `LagChip`, `cellLag`.

- [ ] **Step 1:** Keep the existing tiles + needs-attention strip; restyle to `StatusTile`.
- [ ] **Step 2:** 2-col app cards: header (title/name + summary), per-env lanes (env badge + version bar per env, colored by version), footer `VersionLadder`. Lagging envs show `LagChip`.
- [ ] **Step 3:** `npm run check` → PASS.
- [ ] **Step 4:** Drive `/apps` under mock.
- [ ] **Step 5: Commit** `git commit -am "feat(dashboard): redesign Apps list to per-env lane cards"`

### Task 10: App detail (`routes/apps/[name]/+page.svelte`) — mirrors `pageAppDetail`

**Files:** Modify `src/routes/apps/[name]/+page.svelte`.
**Interfaces:** `groupRolloutsByApp` (single app), `cellLag`, `computeBakeProgress`, `DeployHistoryStrip`, `LagChip`.

- [ ] **Step 1:** Header (app title, description from `status.title`/`status.description`, actions).
- [ ] **Step 2:** Promotion-flow board: one column per env in promotion order (env badge + version + state + next-env arrow with lag label from `cellLag`).
- [ ] **Step 3:** Per-env cards below with `DeployHistoryStrip` + bake progress (`computeBakeProgress`) where baking. Pod counts allowed here only if managed-resources already fetched by this page; otherwise omit.
- [ ] **Step 4:** `npm run check` → PASS.
- [ ] **Step 5:** Drive `/apps/hello-world` (the only fully-mocked detail) under mock.
- [ ] **Step 6: Commit** `git commit -am "feat(dashboard): redesign App detail to promotion-flow board"`

### Task 11: Environments (`routes/environments/+page.svelte`) — mirrors `pageEnvironments`

**Files:** Modify `src/routes/environments/+page.svelte`.
**Interfaces:** `buildMatrix` (Task 4), `MatrixCell`, `LagChip`.

- [ ] **Step 1:** Build the matrix via `buildMatrix(rollouts, environments)`.
- [ ] **Step 2:** Render sticky-left app column + one column per `envTiers` entry; cells via `MatrixCell`; lagging cells get an amber bg-tint; header shows per-env summary counts.
- [ ] **Step 3:** Add the legend (live / ahead / behind / lagging keys).
- [ ] **Step 4:** `npm run check` → PASS.
- [ ] **Step 5:** Drive `/environments` under mock; confirm matrix + lag highlighting.
- [ ] **Step 6: Commit** `git commit -am "feat(dashboard): redesign Environments to apps×env matrix"`

### Task 12: Env detail (`routes/envs/[name]/+page.svelte`) — mirrors `pageEnvDetail`

**Files:** Modify `src/routes/envs/[name]/+page.svelte`.
**Interfaces:** filter `groupRolloutsByApp` cells to this env tier; `cellLag`, `DeployHistoryStrip`, `LagChip`.

- [ ] **Step 1:** Metrics strip (apps deployed, # behind, # failed, most-recent deploy).
- [ ] **Step 2:** App rows: app id · current version+age · lag vs upstream (`LagChip`) · `DeployHistoryStrip` · last-change info. Omit pod counts.
- [ ] **Step 3:** `npm run check` → PASS.
- [ ] **Step 4:** Drive an env detail route under mock.
- [ ] **Step 5: Commit** `git commit -am "feat(dashboard): redesign Environment detail rows"`

### Task 13: Versions list (`routes/versions/+page.svelte`) — mirrors `pageVersions`

**Files:** Modify `src/routes/versions/+page.svelte`.

- [ ] **Step 1:** Keep existing repo grouping (`groupRolloutsByApp` + `repoKeyFor`); restyle rows: swatch · sha (mono) · message · `shared · N apps` badge · `N live` · chevron → `versionPath`.
- [ ] **Step 2:** `npm run check` → PASS.
- [ ] **Step 3:** Drive `/versions` under mock.
- [ ] **Step 4: Commit** `git commit -am "feat(dashboard): restyle Versions list rows"`

### Task 14: Version detail (`routes/versions/[...slug]/+page.svelte`) — mirrors `pageVersion`

**Files:** Modify `src/routes/versions/[...slug]/+page.svelte`.
**Interfaces:** `buildReleaseFrontier` (Task 5).

- [ ] **Step 1:** Parse `repoKey` + `version` from the slug (reuse existing slug parsing on this page); call `buildReleaseFrontier`.
- [ ] **Step 2:** Hero (version sha + message + reach summary `reached/total`).
- [ ] **Step 3:** Per-app env chain: for each `FrontierApp`, render its `stops` as a horizontal chain of env nodes colored by `state` (live=filled, ahead=outline, behind=dashed, absent=empty) + connectors + legend.
- [ ] **Step 4:** `npm run check` → PASS.
- [ ] **Step 5:** Drive a version detail route under mock.
- [ ] **Step 6: Commit** `git commit -am "feat(dashboard): redesign Version detail to release frontier"`

---

## Phase 4 — Integration verification

### Task 15: Full-app verification pass

- [ ] **Step 1:** Run `npm run check` (whole project) → PASS.
- [ ] **Step 2:** Run `npm run test:unit -- --run` → all green (new helper tests + existing).
- [ ] **Step 3:** Run `npm run test:e2e` (playwright) → existing e2e green; update any selector-based e2e that the re-IA broke (fix the test to the new DOM, not the reverse, when the new structure is correct).
- [ ] **Step 4:** With `MOCK_API=1 npm run dev:mock`, walk all 8 pages (`/`, `/rollouts`, `/apps`, `/apps/hello-world`, `/environments`, `/envs/<name>`, `/versions`, `/versions/<slug>`) and confirm each renders with live mock data, dark + light mode both readable.
- [ ] **Step 5:** Confirm no pod counts on list/matrix/dashboard; confirm multi-cluster pills still function on Rollouts.
- [ ] **Step 6: Commit** any test fixups `git commit -am "test(dashboard): update e2e for redesigned pages"`

---

## Self-Review Notes

- **Spec coverage:** every page in the spec's 8-row table maps to a Task (7–14); the two compromises (multi-cluster, no pod counts) are enforced in Global Constraints + Tasks 7/8/9/11/12/15; shared atoms (spec) = Phase 2; data mappings (spec) = Phase 1 helpers + existing `version-utils`/`rollout-cards`.
- **Skipped pages** (rollout detail, activity) are explicitly out of scope and untouched.
- **Verification discipline** honored: helper logic is TDD'd; layout is svelte-check + driven against mock, matching the repo's inability to unit-test visual markup meaningfully.
- **Open confirmations for implementer:** (1) `parseGoDuration` export + unit (ms vs s) — Task 1; (2) exact `HistoryEntry` import specifier — Task 2; (3) minimal `groupRolloutsByApp` fixture shape — Tasks 4/5. Each is called out in-task.
