/**
 * ⭐ `promotionHoldBreakdown` — THE PER-BUILD HELD FACT, PINNED. (New,
 * 2026-10-09, squad-rollout coordinator / design-rollout TL.)
 *
 * The fixture mirrors the live case that found the defect this helper
 * fixes: `checkout-api/prod-us-east-2`, CHECKING on `4.42.0-42` with two
 * newer candidates, one of which a promotion gate refuses and one of which
 * it does not. `blockingStory.blocked` is correctly `false` there (an older
 * candidate can still deploy) while the graph/rollup still correctly count
 * one build held — the two questions this helper and `blockingStory`
 * answer are genuinely different, and this file pins that they never
 * silently answer the SAME question two different ways.
 */
import { describe, it, expect } from 'vitest';
import {
	blockingStory,
	promotionHoldBreakdown,
	holdCausePhrase,
	EMPTY_GATE_CONTEXT,
	type GateContext,
	type ContractHold
} from './blocking-story';

const GATE_NAME = 'promotion-prod-us-east-2';

const OLD = { tag: 'tag-old', version: '4.42.0-42' };
const MID = { tag: 'tag-mid', version: '4.43.0-43' };
const NEW = { tag: 'tag-new', version: '4.44.0-44' };

/**
 * `gates` controls which of MID/NEW the one promotion gate allows —
 * `allowedVersions` is keyed on TAG, the live payload's own rule
 * (`promotion.ts`'s `gateKeyOf` doc comment).
 */
function rollout(allowedVersions: string[]) {
	return {
		metadata: { namespace: 'checkout-api-prod-us-east-2', name: 'checkout-api' },
		spec: {},
		status: {
			availableReleases: [OLD, MID, NEW],
			// Newest-first, as the live payload's own `releaseCandidates` is.
			releaseCandidates: [NEW, MID],
			history: [{ version: OLD, timestamp: '2026-10-09T00:00:00Z' }],
			gates: [{ name: GATE_NAME, passing: false, allowedVersions }]
		}
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
	} as any;
}

const ctx: GateContext = EMPTY_GATE_CONTEXT;

describe('promotionHoldBreakdown: mixed — one candidate held, one deployable', () => {
	const r = rollout(['tag-old', 'tag-mid']); // allows MID, refuses NEW
	const b = promotionHoldBreakdown(r, ctx, { place: 'prod-us-east-2' });

	it('names the SAME build ids the "Newer builds" row would — not every candidate', () => {
		expect(b.held.map((h) => h.build)).toEqual(['4.44.0-44']);
		expect(b.deployable).toEqual(['4.43.0-43']);
	});

	it('names the SAME gate that refused it', () => {
		expect(b.held[0].gateNames).toEqual([GATE_NAME]);
	});

	it('is anyHeld, not allHeld', () => {
		expect(b.anyHeld).toBe(true);
		expect(b.allHeld).toBe(false);
	});

	it('carries both facts as data: which build waits, which can deploy', () => {
		expect(b.held.map((h) => h.build)).toContain('4.44.0-44');
		expect(b.deployable).toContain('4.43.0-43');
	});

	it('does NOT claim this matches blockingStory — the rollout is not globally blocked', () => {
		const story = blockingStory(r, ctx, { place: 'prod-us-east-2' });
		expect(story.blocked).toBe(false);
		// The breakdown still knows something is held even though the story
		// (correctly) says nothing blocks promotion outright.
		expect(b.anyHeld).toBe(true);
	});
});

describe('promotionHoldBreakdown: every candidate held — must agree with blockingStory', () => {
	const r = rollout(['tag-old']); // refuses both MID and NEW
	const b = promotionHoldBreakdown(r, ctx, { place: 'prod-us-east-2' });
	const story = blockingStory(r, ctx, { place: 'prod-us-east-2' });

	it('is allHeld, with no deployable candidate', () => {
		expect(b.allHeld).toBe(true);
		expect(b.deployable).toEqual([]);
		expect(b.held.map((h) => h.build)).toEqual(['4.44.0-44', '4.43.0-43']);
	});

	it('allHeld is exactly blockingStory.blocked (the banner case)', () => {
		expect(story.blocked).toBe(true);
		expect(b.allHeld).toBe(story.blocked);
	});
});

describe('promotionHoldBreakdown: nothing held', () => {
	const r = rollout(['tag-old', 'tag-mid', 'tag-new']); // allows everything
	const b = promotionHoldBreakdown(r, ctx, { place: 'prod-us-east-2' });

	it('anyHeld and allHeld are both false, and no sentence is invented', () => {
		expect(b.anyHeld).toBe(false);
		expect(b.allHeld).toBe(false);
		expect(b.held).toEqual([]);
	});

	it('still lists every candidate as deployable', () => {
		expect(b.deployable).toEqual(['4.44.0-44', '4.43.0-43']);
	});
});

/**
 * ⭐ THE HOLD-ONE-RULE. (2026-10-09, coordinator ruling: "held" = refused by
 * a gate OR held by a dependency-contract, per build.) `checkout-api/
 * prod-us-east-2` is the fixture the ruling was written against: a
 * staging-first promotion gate refuses the two newest candidates,
 * `4.45.0-45` and `4.44.0-44`, and a `payments-svc` contract — deliberately
 * never published on `rollout.status.gates` (`ckGates()`'s own comment,
 * `lib/demo/mock-data.ts`) — holds the one candidate the gate does not
 * touch, `4.43.0-43`. Before this ruling `blockingStory` read gates alone
 * and called `4.43.0-43` deployable, so the whole rollout read "not
 * blocked" with every single newer build actually held. Three candidates,
 * newest first, mirroring `rollout()` above but with a THIRD, older
 * candidate and a real staging-first gate name.
 */
const STAGING_GATE = 'promotion-staging-first';
const OLDEST = { tag: 'tag-oldest', version: '4.42.0-42' };
const HELD_BY_CONTRACT = { tag: 'tag-4.43', version: '4.43.0-43' };
const HELD_BY_GATE_MID = { tag: 'tag-4.44', version: '4.44.0-44' };
const HELD_BY_GATE_NEW = { tag: 'tag-4.45', version: '4.45.0-45' };

function threeCandidateRollout() {
	return {
		metadata: { namespace: 'checkout-api-prod-us-east-2', name: 'checkout-api' },
		spec: {},
		status: {
			availableReleases: [OLDEST, HELD_BY_CONTRACT, HELD_BY_GATE_MID, HELD_BY_GATE_NEW],
			releaseCandidates: [HELD_BY_GATE_NEW, HELD_BY_GATE_MID, HELD_BY_CONTRACT],
			history: [{ version: OLDEST, timestamp: '2026-10-09T00:00:00Z' }],
			// The gate refuses the two NEWEST only — `4.43.0-43` is not on its
			// allow-list check at all, by omission: it refuses everything NOT
			// named, so it must explicitly allow 4.43's tag too.
			gates: [
				{
					name: STAGING_GATE,
					passing: false,
					allowedVersions: ['tag-oldest', 'tag-4.43']
				}
			]
		}
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
	} as any;
}

const PAYMENTS_HOLD: ContractHold = { provider: 'payments-svc', required: '~2.9.0', has: '2.4.1' };

describe('promotionHoldBreakdown + blockingStory: the hold-one-rule (gate OR contract)', () => {
	const r = threeCandidateRollout();
	const contractHolds = new Map<string, ContractHold[]>([['4.43.0-43', [PAYMENTS_HOLD]]]);

	it('without the contract map, the gate alone makes the oldest candidate look deployable (the defect)', () => {
		const b = promotionHoldBreakdown(r, ctx, { place: 'prod-us-east-2' });
		expect(b.deployable).toEqual(['4.43.0-43']);
		expect(b.allHeld).toBe(false);
		const story = blockingStory(r, ctx, { place: 'prod-us-east-2' });
		expect(story.blocked).toBe(false);
	});

	it('with the contract map, every candidate is held and none is deployable', () => {
		const b = promotionHoldBreakdown(r, ctx, { place: 'prod-us-east-2', contractHolds });
		expect(b.deployable).toEqual([]);
		expect(b.held.map((h) => h.build)).toEqual(['4.45.0-45', '4.44.0-44', '4.43.0-43']);
		expect(b.held.find((h) => h.build === '4.43.0-43')?.contract).toEqual(PAYMENTS_HOLD);
		expect(b.allHeld).toBe(true);
	});

	it('blockingStory.blocked agrees with the breakdown, and names payments-svc', () => {
		const story = blockingStory(r, ctx, { place: 'prod-us-east-2', contractHolds });
		const b = promotionHoldBreakdown(r, ctx, { place: 'prod-us-east-2', contractHolds });
		expect(story.blocked).toBe(b.allHeld);
		expect(story.blocked).toBe(true);
		expect(story.headline + story.consequence + story.verdict + story.resolution).toContain('payments-svc');
		expect(story.headline + story.consequence + story.verdict + story.resolution).toContain('2.9.0');
	});

	it('the synthetic contract gate rides in story.gates/story.upstream, deduped by provider', () => {
		const story = blockingStory(r, ctx, { place: 'prod-us-east-2', contractHolds });
		const contractEntries = story.gates.filter((g) => g.subject === 'payments-svc');
		expect(contractEntries).toHaveLength(1);
		expect(contractEntries[0].clears).toBe('upstream');
		expect(contractEntries[0].kind).toBe('dependency');
	});
});

/**
 * ⭐ TWO CONTRACTS, ONE BUILD. (2026-10-10, QA finding.) `contractHoldsForRollout`
 * used to key its map with a bare `ContractHold` and `Map.set`, so a build
 * refused by BOTH `payments-svc` and `auth` at once collapsed to whichever
 * `RolloutDependency` edge the join visited last — the banner named only one
 * provider. The newest candidate here is held by both; nothing may overwrite
 * the other.
 */
const AUTH_HOLD: ContractHold = { provider: 'auth', required: '~1.4', has: '1.3.0' };

/** One candidate, no status gate at all — the only thing that can hold it
 *  is `options.contractHolds`, so a `kind: 'unknown'` gate never rides along
 *  and masks the dependency-only story this fixture exists to isolate. */
function singleCandidateRollout() {
	const V1 = { tag: 'tag-v1', version: 'v1' };
	return {
		metadata: { namespace: 'standalone-prod', name: 'standalone-api' },
		spec: {},
		status: {
			availableReleases: [V1],
			releaseCandidates: [V1],
			history: [],
			gates: []
		}
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
	} as any;
}

describe('promotionHoldBreakdown + blockingStory: one build held by TWO contracts at once', () => {
	const r = singleCandidateRollout();
	const contractHolds = new Map<string, ContractHold[]>([['v1', [PAYMENTS_HOLD, AUTH_HOLD]]]);

	it('the breakdown carries both holds on the same build — neither is dropped', () => {
		const b = promotionHoldBreakdown(r, ctx, { place: 'prod-us-east-2', contractHolds });
		const newest = b.held.find((h) => h.build === 'v1');
		expect(newest?.contracts).toEqual([PAYMENTS_HOLD, AUTH_HOLD]);
		// The compat single-value field keeps naming the first, for callers
		// that only ever expected one.
		expect(newest?.contract).toEqual(PAYMENTS_HOLD);
	});

	it('blockingStory names BOTH providers, not just one', () => {
		const story = blockingStory(r, ctx, { place: 'prod-us-east-2', contractHolds });
		expect(story.blocked).toBe(true);
		const contractEntries = story.gates.filter((g) => g.kind === 'dependency');
		expect(contractEntries.map((g) => g.subject).sort()).toEqual(['auth', 'payments-svc']);
	});

	it('holdCausePhrase names both providers with the house list joiner', () => {
		// `story.gates` sorts worst-first then by id (`contract:auth` before
		// `contract:payments-svc`); `promotionHoldBreakdown`'s own
		// `held[].contracts` carries no such sort -- it is the raw list
		// `options.contractHolds` named, in the order the caller gave it.
		const story = blockingStory(r, ctx, { place: 'prod-us-east-2', contractHolds });
		expect(holdCausePhrase(story, { place: 'prod-us-east-2' })).toBe(
			'prod-us-east-2 is waiting for auth ~1.4 and payments-svc ~2.9.0'
		);
		const b = promotionHoldBreakdown(r, ctx, { place: 'prod-us-east-2', contractHolds });
		expect(holdCausePhrase(b, { place: 'prod-us-east-2' })).toBe(
			'prod-us-east-2 is waiting for payments-svc ~2.9.0 and auth ~1.4'
		);
	});
});

describe('promotionHoldBreakdown + blockingStory: a deployable OLDER candidate keeps the story calm', () => {
	// Same shape, but the contract is already satisfied (the map has no entry
	// for 4.43.0-43) — the staging gate still refuses the two newer builds,
	// but nothing refuses the oldest, so promotion is not stuck.
	const r = threeCandidateRollout();
	const emptyContractHolds = new Map<string, ContractHold[]>();

	it('is anyHeld but not allHeld — the mixed case', () => {
		const b = promotionHoldBreakdown(r, ctx, { place: 'prod-us-east-2', contractHolds: emptyContractHolds });
		expect(b.deployable).toEqual(['4.43.0-43']);
		expect(b.anyHeld).toBe(true);
		expect(b.allHeld).toBe(false);
	});

	it('blockingStory shows no banner', () => {
		const story = blockingStory(r, ctx, { place: 'prod-us-east-2', contractHolds: emptyContractHolds });
		expect(story.blocked).toBe(false);
	});
});
