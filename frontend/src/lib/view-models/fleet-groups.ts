import type { RolloutCard } from '$lib/rollout-cards';
import { rankBehindBy } from './env-rank';

/**
 * ⛔ ONE GROUPING PREDICATE FOR THE FLEET. `/` AND `/rollouts` READ IT.
 * (2026-08-31)
 *
 * From a live critique: *"`/rollouts` says the fleet is fine while four other
 * surfaces say it isn't."* Its header read
 * `Attention 0 · In motion 1 · Pending 0 · Healthy 14` with `hello-world-app`
 * behind and gate-blocked in all three environments, at the same moment `/`
 * filed those three under **Trailing**, `/apps` drew a full-width amber
 * banner, `/environments` said "furthest behind: 20 versions" and `/versions`
 * said "5 blocked".
 *
 * The two pages were not disagreeing about any FACT. They were using the same
 * four words for four different sets, because `/rollouts` had a `healthy`
 * bucket that `/` does not have: `/` splits `succeeded && !stuck` into
 * **Steady** (at the head of its own release list) and **Trailing** (healthy,
 * but there is newer code it could take). `/rollouts` folded both into one
 * counter — so the page whose whole job is to let an operator scan everything
 * was the one page that could not show a lag at all.
 *
 * ⚠️ THE FIX IS NOT A NEW OPINION, IT IS THE REMOVAL OF THE SECOND ONE. Every
 * predicate below is `ControlCenter.svelte`'s, lifted verbatim. Both pages now
 * import them, so a bucket cannot drift on one surface and not the other, and
 * a rollout cannot be `Healthy` here and `Trailing` there.
 *
 * ⚠️ THE BUCKETS ARE NOT A PARTITION AND MUST NOT BE MADE ONE. A stuck rollout
 * that is also mid-deploy is in `needsYou` AND in `inMotion` — both are true,
 * and a filter tile is a question ("show me what is X"), not a slice of a pie.
 * `trailing` and `steady` ARE disjoint, and their union is exactly `healthy`.
 */

/**
 * Failed, stuck, or a health check failing under it. The only bucket that means
 * "wake someone up".
 *
 * ⛔ THE THIRD CLAUSE IS THE 2026-08-31 FIX AND IT IS NOT OPTIONAL.
 *
 * A critic set `hello-world-prod/hello-world-app`'s check to `Unhealthy` — "p99
 * latency 4.2s exceeds SLO of 500ms for 5m" — and the controller published
 * `DeploymentBlocked: True, reason: UnhealthyHealthChecks`. This function
 * returned `false`, so `/` filed it under **"Trailing 2 — healthy, but behind a
 * newer build"** and `/rollouts` printed **`Attention 0`**. Rollout detail was
 * the only correct surface in the product.
 *
 * *"An operator opens `/` at 3am, reads the word **healthy** on the rollout
 * whose SLO is blown, and goes back to bed."*
 *
 * The cause was not a missing fact. `statusKey` is the DEPLOY's verdict, and
 * the deploy really did succeed — the check failed afterwards. Both facts were
 * in the same payload and only one reached the buckets.
 */
export function isNeedsYou(c: RolloutCard): boolean {
	return c.statusKey === 'failed' || c.stuck != null || c.checkFailure != null;
}

/** Deploying or checking right now. */
export function isInMotion(c: RolloutCard): boolean {
	return c.isRunning;
}

/** Nothing deployed here yet. */
export function isPending(c: RolloutCard): boolean {
	return c.statusKey === 'pending';
}

/**
 * Last deploy succeeded and nothing is wedged. Splits into the two below.
 *
 * ⛔ IT MUST EXCLUDE A FAILING CHECK, AND FIXING `isNeedsYou` ALONE WOULD NOT
 * HAVE DONE IT. `needsYou`/`inMotion` are deliberately not a partition, but
 * `trailing` and `steady` ARE — their union is exactly this — and both of their
 * captions say the rollout is fine (`/`'s Trailing header is literally
 * *"healthy, but behind a newer build"*). Promoting a rollout into `Attention`
 * while still counting it under `Trailing 2` would have left the sentence that
 * sent the operator back to bed on the page, next to the alarm.
 */
export function isHealthy(c: RolloutCard): boolean {
	return c.statusKey === 'succeeded' && c.stuck == null && c.checkFailure == null;
}

/**
 * Healthy, but running older code than its own release list offers — or
 * running a build that is on no release line at all.
 *
 * ⛔ READS `rank`, NEVER a falsy `behind`. `rankBehindBy` is 0 for `newest`,
 * `diverged` and `unknown`, and only the first of those is steady — which is
 * why `diverged` is named explicitly here and `unknown` is not.
 */
export function isTrailing(c: RolloutCard): boolean {
	return isHealthy(c) && (rankBehindBy(c.rank) > 0 || c.rank.kind === 'diverged');
}

/**
 * Healthy and at the head of its own release list — or unresolvable, which is
 * not adverse and must not be counted as one. An `unknown` rollout has no
 * number to show; filing it under Trailing would be inventing a lag out of a
 * retention limit.
 */
export function isSteady(c: RolloutCard): boolean {
	return isHealthy(c) && (c.rank.kind === 'newest' || c.rank.kind === 'unknown');
}

/**
 * Trailing, but blocked by a gate — no candidate the rollout could take
 * passes every check, so this rollout will not move on its own.
 *
 * ⛔ LIFTED OUT OF `ControlCenter.svelte`, 2026-09-03 (F4 third re-check,
 * finding 5: "`Held 4` on `/` vs `Trailing 4` on `/rollouts` for the same
 * four"). `/` computed `held`/`trailing` as a local split of `trailingAll`
 * (`c.held` filtering a `$derived.by` two components never shared); `/rollouts`
 * had no `held` bucket at all and counted every one of those four rollouts
 * under its own `Trailing` pill instead — same four rollouts, two different
 * headline words for them on the two pages an operator moves between. One
 * predicate now, imported by both, so `held` cannot drift from `trailing`
 * (which still includes it — `held` is a REFINEMENT of trailing, not a
 * disjoint fifth bucket) on one surface and not the other.
 *
 * ⛔ WIDENED, 2026-09-03 (UX-walk iteration 2, finding 1): A PIN IS ALSO A
 * REASON THIS ROLLOUT WILL NOT MOVE ON ITS OWN. `c.held` (`promotionBlock`)
 * only ever looks at gates — it has no idea `spec.wantedVersion` exists — so
 * a rollout with every gate open but a pin set was `isHeld === false` and
 * fell into `Trailing`, filed on `/` under the header *"healthy, but behind
 * a newer build"* and counted by `/rollouts`' own `Trailing` pill, with
 * nothing on either page saying a person, not a rule, is the reason it has
 * not moved. `held` and `pinned` answer the identical downstream question —
 * "will automatic promotion take this rollout anywhere by itself" — so both
 * belong in the one bucket that question already has a name for. The WORD
 * shown for each stays distinct (`cardStateMark`'s `held` vs `pinned`
 * branches, and the chip vocabulary each list surface renders) — only the
 * BUCKET is shared, so `/` and `/rollouts` cannot count this rollout under
 * two different headline words again.
 */
export function isHeld(c: RolloutCard): boolean {
	return isTrailing(c) && (c.held || c.pinnedVersion != null);
}

/**
 * A rollout that will not move on its own SPECIFICALLY because a person
 * pinned it — as opposed to a rule (gate) refusing every candidate. The two
 * can co-occur (a pin does not know or care what the gates are doing), so
 * this is not `isHeld`'s complement; it is the independent fact a PINNED
 * chip renders from, on every list surface that shows one.
 */
export function isPinned(c: RolloutCard): boolean {
	return c.pinnedVersion != null;
}

/**
 * No `Environment` custom resource matched this rollout — `envName` comes
 * straight off `rolloutMatchesEnvironment` in `rollout-cards.ts` and is `''`
 * exactly when that search found nothing.
 *
 * ⛔ NOT THE SAME QUESTION AS "does the card have an env chip". A rollout can
 * still carry `envDisplay`/`theme` with no `Environment` object behind it —
 * `getRolloutEnvironmentTheme` also reads the rollout's OWN annotations and
 * infers a preset from the environment NAME string, so a card can draw a
 * fully-coloured `PROD` chip while `envName` (and therefore this predicate)
 * says there is no record. `/apps`, `/environments` and `/envs/[name]`
 * already name this exact gap (`unboundRolloutCount` / `excludedRollouts`) —
 * this is `/rollouts`' own copy of the same fact, so a rollout the hub
 * cannot bind to an `Environment` reads the same on every page that says so.
 * (2026-09-03, UX sweep finding 4.)
 */
export function isUnlinked(c: RolloutCard): boolean {
	return !c.envName;
}

export type FleetGroups = {
	needsYou: RolloutCard[];
	inMotion: RolloutCard[];
	held: RolloutCard[];
	trailing: RolloutCard[];
	steady: RolloutCard[];
	pending: RolloutCard[];
};

/**
 * ⭐ THE FINAL TIEBREAK — every fleet-grouped list ends here, so its render
 * order is a PURE FUNCTION OF THE DATA. (2026-09-04, coordinator finding:
 * "the home cards reshuffle between loads (4 distinct orders in 5 reloads)
 * because the sort has ties and the API's list order varies.")
 *
 * `buildRolloutCards` maps `rollouts` in the order `/api/rollouts` returned
 * them, with no sort of its own — and every bucket below used to be a bare
 * `.filter()` with no sort at all, so two cards tied on every meaningful key
 * (or a bucket with no primary key at all) rendered in whatever order that
 * one HTTP response happened to list them, which measurably varies between
 * polls. The backend is being made deterministic too, but the frontend must
 * not depend on that: `Array.prototype.sort` is stable, so chaining this
 * comparator AFTER a caller's own primary key only breaks ties that key
 * left open, and a caller with no primary key at all (`inMotion`, `held`,
 * `trailing`, `steady`, `pending`) can pass this comparator directly.
 *
 * Cluster, then namespace, then name — the same three-part identity
 * `RolloutGrid.svelte`'s own namespace grouping already keys on
 * (`clusterLabelForCard`/`ns`), so a card's position here agrees with its
 * position there.
 */
export function fleetTiebreak(a: RolloutCard, b: RolloutCard): number {
	const clusterA = a.sourceCluster || a.sourceURL || '';
	const clusterB = b.sourceCluster || b.sourceURL || '';
	return clusterA.localeCompare(clusterB) || a.ns.localeCompare(b.ns) || a.name.localeCompare(b.name);
}

/**
 * Every bucket at once, for a page that needs all six counts.
 *
 * ⛔ `held`/`trailing` READ `isHeld` NOW, NOT THE RAW `c.held` FIELD.
 * (2026-09-03, UX-walk iteration 2, finding 1) `isHeld` above now folds a
 * pin in alongside a gate block; filtering on `c.held` directly here would
 * have quietly reopened the exact drift this function exists to prevent —
 * a pinned-only rollout counted under `held` by `isHeld` callers but still
 * landing in `trailing` here.
 *
 * Every bucket is sorted by `fleetTiebreak` — see its own note.
 */
export function fleetGroups(cards: RolloutCard[]): FleetGroups {
	const trailingAll = cards.filter(isTrailing);
	return {
		needsYou: cards.filter(isNeedsYou).sort(fleetTiebreak),
		inMotion: cards.filter(isInMotion).sort(fleetTiebreak),
		held: trailingAll.filter(isHeld).sort(fleetTiebreak),
		trailing: trailingAll.filter((c) => !isHeld(c)).sort(fleetTiebreak),
		steady: cards.filter(isSteady).sort(fleetTiebreak),
		pending: cards.filter(isPending).sort(fleetTiebreak)
	};
}
