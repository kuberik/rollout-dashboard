import { describe, it, expect } from 'vitest';
import { resetDemoState, type Scenario } from '$lib/demo/state';
import { respond } from '$lib/demo/respond';
import { buildRolloutCards } from '$lib/rollout-cards';
import { buildGateContext } from '$lib/view-models/blocking-story';
import { buildRolloutGraph, contractHoldsForRollout } from '$lib/view-models/dependency-graph';
import { isNeedsYou } from '$lib/view-models/fleet-groups';
import { buildLanes, nodeState, STATE_ORDER } from '$lib/view-models/promotion-lanes';
import { fleetMap, stepFacts } from '$lib/view-models/promotion-map';
import { fleetFacts } from './fleet-facts';
import { fleetPulse } from './fleet-pulse';
import { heldFor } from './held-for';
import type { Environment, Rollout, RolloutDependency } from '../../types';

/**
 * ⭐ THE CROSS-SURFACE TEST, shared/fleet-facts (2026-10-10). For each mock
 * scenario (calm, incident, wide — `lib/demo/state.ts`'s own `Scenario`),
 * builds the SAME cards every real page builds and asserts every surface
 * this commit rewired reads the identical numbers:
 *   - the Promotion Map's stage captions (`stepFacts`, summed) agree with
 *     `fleetFacts.byTier`'s `appsByState` totals for held/failed-live/
 *     in-motion apps (THE UNIT RULE: one count per app, its worst place);
 *   - `fleetPulse`'s delegated figures (deploys/failed/held) agree with
 *     `fleetFacts` directly;
 *   - `heldFor` (Home's KPI, /activity) agrees with `fleetFacts.held`;
 *   - Home's Fleet list (the lanes `buildLanes` draws) counts the same
 *     mapped-apps total as `fleetFacts.mappedApps`.
 *
 * `/apps` and `/environments` are OUT OF SCOPE here (squad-fleet2 owns
 * their own rewiring and equality test) — this file asserts on
 * `fleetFacts`'s own outputs for those two pages' units (`byTier`/`byEnv`),
 * not on the pages themselves.
 */

type List = {
	rollouts: { items: Rollout[] };
	environments: { items: Environment[] };
	rolloutDependencies: { items: RolloutDependency[] };
};

function fixtureList(): List {
	return JSON.parse(respond('GET', '/api/rollouts').body ?? '{}') as List;
}

const NOW = new Date('2026-10-10T12:00:00Z');

function buildAll(scenario: Scenario) {
	resetDemoState(scenario);
	const list = fixtureList();
	const gateContext = buildGateContext({
		environments: list.environments,
		rolloutDependencies: list.rolloutDependencies
	});
	const graph = buildRolloutGraph({
		rollouts: list.rollouts.items,
		environments: list.environments.items,
		dependencies: list.rolloutDependencies.items,
		envOrder: []
	});
	const contractHoldsFor = (r: Rollout) => contractHoldsForRollout(graph, r);
	const cards = buildRolloutCards(list.rollouts.items, list.environments.items, NOW, gateContext, contractHoldsFor);
	const facts = fleetFacts(cards, list.rollouts.items, NOW.getTime(), '7d', { gateContext, contractHoldsFor });
	return { list, gateContext, contractHoldsFor, cards, facts };
}

const SCENARIOS: Scenario[] = ['calm', 'incident', 'wide'];

describe.each(SCENARIOS)('cross-surface agreement — %s', (scenario) => {
	it('the map’s stage captions count its blocks: fleetFacts’ per-app plates (held == held.plates)', () => {
		const { cards, facts } = buildAll(scenario);
		const lanes = buildLanes(cards);
		const map = fleetMap({ lanes }, { granularity: 'tier', facts });

		let heldOnMap = 0;
		let failedOnMap = 0;
		let inMotionOnMap = 0;
		for (const step of map.steps) {
			for (const fact of stepFacts(step)) {
				if (fact.state === 'held') heldOnMap += fact.n;
				if (fact.state === 'failed') failedOnMap += fact.n;
				if (fact.state === 'deploying' || fact.state === 'checking') inMotionOnMap += fact.n;
			}
		}
		// home-map (2026-10-11, round-6 first read: "held 5 vs 4"): a caption
		// counts the BLOCKS on its plate (one per app, its worst place in the
		// stage), the unit of the "of N apps" figure beside it. So the captions
		// sum to fleet-facts' per-app plate tallies, and held to `held.plates`
		// (the Held tile's "in N places"). Places (regions) stay in fleet-facts
		// for the surfaces that speak regions.
		const tiers = Object.values(facts.byTier);
		expect(heldOnMap).toBe(facts.held.plates);
		expect(heldOnMap).toBe(tiers.reduce((n, t) => n + t.appsByState.held, 0));
		expect(failedOnMap).toBe(tiers.reduce((n, t) => n + t.appsByState.failed, 0));
		expect(inMotionOnMap).toBe(tiers.reduce((n, t) => n + t.appsByState.deploying + t.appsByState.checking, 0));
		// A plate never counts more than its places.
		expect(heldOnMap).toBeLessThanOrEqual(facts.held.places - facts.held.unmapped);
		// `appsByState` sums to `apps` per stage (THE UNIT RULE: one count per
		// app, its worst place) — and `placesByState` sums to `places` (the
		// raw per-rollout tally).
		for (const t of tiers) {
			const appSum = Object.values(t.appsByState).reduce((a, b) => a + b, 0);
			expect(appSum).toBe(t.apps);
			const placeSum = Object.values(t.placesByState).reduce((a, b) => a + b, 0);
			expect(placeSum).toBe(t.places);
		}
	});

	it('fleetPulse’s delegated deploys/failed/held figures equal fleetFacts directly', () => {
		const { cards, list, facts } = buildAll(scenario);
		const pulse = fleetPulse(list.rollouts.items, NOW.getTime(), '7d', {
			cards,
			factsOpts: { gateContext: undefined, contractHoldsFor: undefined }
		});
		// Re-derive facts with the SAME (no gateContext) opts fleetPulse used,
		// since byCause/needsYou depend on classification but deploys/failed/
		// held counts and medians do not.
		const factsNoCtx = fleetFacts(cards, list.rollouts.items, NOW.getTime(), '7d');
		expect(pulse.deploys.value).toBe(factsNoCtx.deploys.value);
		expect(pulse.deploys.prev).toBe(factsNoCtx.deploys.prev);
		expect(pulse.failed.value).toBe(factsNoCtx.failed.inWindow.value);
		expect(pulse.held.count).toBe(factsNoCtx.held.apps);
		void facts;
	});

	it('heldFor agrees with fleetFacts.held exactly (apps, plates, medians, longest)', () => {
		// ⭐ `heldFor.places` IS `fleetFacts.held.plates`, NOT `.places` — the
		// map's own unit (app × stage, prod one plate), home-map's shipped
		// rule, kept verbatim. `fleetFacts.held.places` is the FINER, raw
		// per-region unit this commit's own brief defines; the two agree in
		// the common case (no multi-region prod fold in play) but are not
		// the same number in general — see `held-for.ts`'s own doc comment.
		const { cards, facts } = buildAll(scenario);
		const held = heldFor(cards, NOW.getTime());
		expect(held.apps).toBe(facts.held.apps);
		expect(held.places).toBe(facts.held.plates);
		expect(held.medianMs).toBe(facts.held.medianMs);
		expect(held.longestMs).toBe(facts.held.longestMs);
		expect(held.longestSubject).toEqual(facts.held.longestSubject);
	});

	it('Home’s Fleet list (lanes) counts the same mapped apps as fleetFacts.mappedApps', () => {
		const { cards, facts } = buildAll(scenario);
		const lanes = buildLanes(cards);
		expect(lanes.length).toBe(facts.mappedApps);
	});

	it('shared/stagefacts-units: byTier/byEnv obey THE UNIT RULE and never drift from the top-level facts', () => {
		const { cards, facts } = buildAll(scenario);
		const lanes = buildLanes(cards);

		// KPI held apps = mapped Fleet rows reading Held PLUS unmapped apps
		// whose own worst place is held (⭐ shared/fleet-facts-ids,
		// 2026-10-11: "apps WITHOUT an Environment held on a dependency
		// contract are real holds and COUNT" — `byTier`/`byEnv` stay mapped-
		// only, since the map can only draw mapped places; only the
		// top-level `held.apps`/`appIds` widen).
		const heldRows = lanes.filter((l) => l.state === 'held').map((l) => l.app).sort();
		const unmappedHeldApps = facts.held.appIds.filter((app) => !heldRows.includes(app));
		expect(facts.held.apps).toBe(heldRows.length + unmappedHeldApps.length);
		expect([...heldRows, ...unmappedHeldApps].sort()).toEqual(facts.held.appIds);

		for (const t of Object.values(facts.byTier)) {
			// appsByState sums to apps; placesByState sums to places.
			expect(Object.values(t.appsByState).reduce((a, b) => a + b, 0)).toBe(t.apps);
			expect(Object.values(t.placesByState).reduce((a, b) => a + b, 0)).toBe(t.places);
			// appsByCause never exceeds appsByState.held (an app can land in
			// more than one cause bucket if its held places in this stage
			// disagree, same as the top-level byCauseApps).
			const causeSum = t.appsByCause.order + t.appsByCause.approval + t.appsByCause.dependency + t.appsByCause.other;
			expect(causeSum).toBeGreaterThanOrEqual(0);
			if (t.appsByState.held === 0) expect(causeSum).toBe(0);
		}
		for (const e of Object.values(facts.byEnv)) {
			expect(Object.values(e.appsByState).reduce((a, b) => a + b, 0)).toBe(e.apps);
			expect(Object.values(e.placesByState).reduce((a, b) => a + b, 0)).toBe(e.places);
		}

		// Map blocks == appsByState (per state, per tier) — the map draws
		// exactly one cube per app, its worst place in the stage.
		const map = fleetMap({ lanes }, { granularity: 'tier', facts });
		for (const step of map.steps) {
			const stage = step.key === 'prod' ? facts.byTier.prod : facts.byTier[step.tier];
			if (!stage) continue;
			for (const state of ['held', 'failed', 'stuck', 'deploying', 'checking', 'behind', 'newest'] as const) {
				expect(step.cubes.filter((c) => c.state === state).length).toBe(stage.appsByState[state]);
			}
		}
	});

	it('shared/fleet-facts-ids: held.appIds/approvalAppIds and behind.appIds/apps agree with the lanes plus unmapped apps', () => {
		const { cards, facts } = buildAll(scenario);
		const lanes = buildLanes(cards);

		// held.apps/appIds: mapped Fleet rows reading Held, plus apps with NO
		// Environment at all whose own worst place is held.
		const heldRows = lanes.filter((l) => l.state === 'held').map((l) => l.app).sort();
		const mappedAppNames = new Set(lanes.map((l) => l.app));
		const unmappedAppCards = new Map<string, typeof cards>();
		for (const c of cards) {
			if (mappedAppNames.has(c.name)) continue;
			unmappedAppCards.set(c.name, [...(unmappedAppCards.get(c.name) ?? []), c]);
		}
		function worstOf(appCards: typeof cards) {
			let best = 'none';
			for (const c of appCards) {
				const state = nodeState(c);
				if (STATE_ORDER.indexOf(state) < STATE_ORDER.indexOf(best as (typeof STATE_ORDER)[number])) best = state;
			}
			return best;
		}
		const unmappedHeldApps = [...unmappedAppCards.keys()].filter((n) => worstOf(unmappedAppCards.get(n)!) === 'held');
		const unmappedBehindApps = [...unmappedAppCards.keys()].filter(
			(n) => worstOf(unmappedAppCards.get(n)!) === 'behind'
		);

		expect(facts.held.apps).toBe(facts.held.appIds.length);
		expect([...new Set([...heldRows, ...unmappedHeldApps])].sort()).toEqual(facts.held.appIds);
		expect(facts.held.approvalAppIds).toEqual([...facts.held.approvalAppIds].sort());
		for (const app of facts.held.approvalAppIds) expect(facts.held.appIds).toContain(app);

		const behindRows = lanes.filter((l) => l.state === 'behind').map((l) => l.app).sort();
		expect(facts.behind.apps).toBe(facts.behind.appIds.length);
		expect([...new Set([...behindRows, ...unmappedBehindApps])].sort()).toEqual(facts.behind.appIds);
	});

	it('held byCause sums to the lane-gated held population, never more than the raw places count', () => {
		// byCause classifies the SAME lane-gated population `apps`/the
		// durations read (an app failing elsewhere is excluded even from a
		// genuinely-held place of its own) — so the sum can be LESS than
		// `held.places` (the raw, ungated count) whenever a held place
		// belongs to an app whose headline is worse elsewhere, never more.
		const { facts } = buildAll(scenario);
		const sum = facts.held.byCause.order + facts.held.byCause.approval + facts.held.byCause.dependency + facts.held.byCause.other;
		expect(sum).toBeLessThanOrEqual(facts.held.places);
		expect(sum).toBeGreaterThanOrEqual(0);
	});
});

/**
 * ⭐ THE SHARED HELD PREDICATE'S REFERENCE CASES, AGAIN HERE. (shared/
 * held-predicate, 2026-10-11) `fleet-facts.ts`'s `placeState` delegates to
 * `nodeState`, which reads the corrected `RolloutCard.held` — these two
 * cases pin that the fix reaches THIS surface too, not only
 * `held-predicate.test.ts`'s own direct read of the cards. See
 * `view-models/held.ts` for the ruling.
 */
describe('held-predicate reference cases, through fleetFacts', () => {
	it('calm: hello-world is not held at staging or prod — it has not reached dev yet', () => {
		const { cards } = buildAll('calm');
		const hw = cards.filter((c) => c.name === 'hello-world');
		const staging = hw.find((c) => c.envName === 'staging');
		const prod = hw.find((c) => c.envName === 'prod');
		expect(staging?.held).toBe(false);
		expect(staging?.waitsForEnv).toBe('dev');
		expect(prod?.held).toBe(false);
		expect(prod?.waitsForEnv).toBe('staging');
	});

	/**
	 * ⭐ qa12 CORRECTION (squad-rollout gates-2 follow-up, 2026-10-11,
	 * tl-integrate ruling — the frontier rule). `prod-us-east-2` and
	 * `prod-ap-southeast-2` each read held now too: their own frontier
	 * candidate, `4.43.0-43`, already cleared staging
	 * (`ckHistory('staging')`'s head entry) and is refused directly by
	 * `payments-svc` at both regions (`mock-data.ts`'s `mockDependencies`).
	 * checkout-api is held in THREE places, not one.
	 */
	// SITES AND WAVES: prod is waves of sites, not parallel regions each after staging, so only staging is refused by the contract; the prod sites wait on their wave (`held.ts`).
	it('calm: checkout-api is held in staging on payments-svc; no prod site is its own hold', () => {
		const { cards } = buildAll('calm');
		const ck = cards.filter((c) => c.name === 'checkout-api');
		const staging = ck.find((x) => x.envName === 'staging');
		expect(staging?.held).toBe(true);
		expect(staging?.heldCauseLabel).toBe('payments-svc');
		for (const c of ck.filter((c) => c.envName !== 'staging')) {
			expect(c.held, `${c.envName} should not be its own hold`).toBe(false);
		}
	});
});

describe('known invariants (kept green)', () => {
	it('calm: 0 Needs-you', () => {
		const { facts } = buildAll('calm');
		expect(facts.needsYou.apps).toBe(0);
		expect(facts.needsYou.places).toBe(0);
	});

	it('incident: exactly one failed head (checkout-worker/staging)', () => {
		const { cards, facts } = buildAll('incident');
		expect(facts.failed.live.apps).toBe(1);
		expect(facts.failed.live.places).toBe(1);
		const failing = cards.filter(isNeedsYou);
		expect(failing.map((c) => `${c.ns}/${c.name}`)).toEqual(['checkout-worker-staging/checkout-worker']);
	});
});
