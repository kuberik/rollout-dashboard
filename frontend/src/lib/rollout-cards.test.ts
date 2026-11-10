import { describe, it, expect } from 'vitest';
import {
	buildRolloutCards,
	detectRollback,
	detectRolloutStuck,
	cardVerdict,
	cardStateMark,
	heldCauseText,
	CHANGE_STATE_RANK,
	changeStateRankFor,
	worstChangeCell,
	isEnvHeld
} from './rollout-cards';
import type { PrCell, PrState } from './view-models/pr-pipeline';
import { rankBehindBy, rankLabel } from './view-models/env-rank';
import type { BlockingStory, ClassifiedGate } from './view-models/blocking-story';
import { buildGateContext } from './view-models/blocking-story';
import type { Rollout, Environment, RolloutDependency } from '../types';

// Fixtures reproduce the live `hello-world-app` shape that exposed the bug:
// prod is 24 releases and 32 days behind, but its current version has already
// fallen out of dev/staging's 5-entry `status.history`, so `compareRollouts`
// returns 'divergent' and the old `computeBehind` returned null. Callers doing
// `(behind?.behindBy ?? 0) === 0` then rendered prod as `newest` / "steady".

const NOW = new Date('2026-08-22T00:00:00Z');

function env(name: string, ns: string) {
	return {
		metadata: { name, namespace: ns },
		spec: { environment: name, rolloutRef: { name: 'hello-world-app' } }
	} as any;
}

function rollout(opts: {
	ns: string;
	current: string;
	timestamp: string;
	history: string[];
	availableReleases: string[]; // OLDEST-FIRST
	releaseCandidates?: string[]; // NEWEST-FIRST; omit -> key absent
}) {
	const status: any = {
		history: opts.history.map((v, i) => ({
			version: { version: v },
			timestamp: i === 0 ? opts.timestamp : '2026-07-01T00:00:00Z',
			bakeStatus: 'Succeeded'
		})),
		availableReleases: opts.availableReleases.map((v) => ({ version: v })),
		gates: []
	};
	if (opts.releaseCandidates) {
		status.releaseCandidates = opts.releaseCandidates.map((v) => ({ version: v }));
	}
	return {
		metadata: { name: 'hello-world-app', namespace: opts.ns },
		spec: {},
		status
	} as any;
}

// prod: current 205a312 at index 8 of 33 -> 24 newer. Its history holds only
// old prod versions, and 205a312 does NOT appear in dev/staging's history.
const PROD_AVAILABLE = Array.from({ length: 33 }, (_, i) => (i === 8 ? '205a312' : `rel-${i}`));
const prod = rollout({
	ns: 'hello-world-prod',
	current: '205a312',
	timestamp: '2026-07-21T20:01:09Z',
	history: ['205a312', '2bcb8be', '7424c7c'],
	availableReleases: PROD_AVAILABLE,
	releaseCandidates: Array.from({ length: 24 }, (_, i) => `rc-${24 - i}`)
});

// dev / staging: at the head of their own lists, releaseCandidates key ABSENT.
const DEV_AVAILABLE = Array.from({ length: 29 }, (_, i) => (i === 28 ? '9f10e49' : `rel-${i}`));
const dev = rollout({
	ns: 'hello-world-dev',
	current: '9f10e49',
	timestamp: '2026-07-29T16:59:25Z',
	history: ['9f10e49', '8375506', '3cc206c', '7cdafab', 'b5f36d8'],
	availableReleases: DEV_AVAILABLE
});
const staging = rollout({
	ns: 'hello-world-staging',
	current: '9f10e49',
	timestamp: '2026-07-29T17:04:49Z',
	history: ['9f10e49', '8375506', '3cc206c', '7cdafab', 'b5f36d8'],
	availableReleases: DEV_AVAILABLE
});

const ENVIRONMENTS = [
	env('dev', 'hello-world-dev'),
	env('staging', 'hello-world-staging'),
	env('prod', 'hello-world-prod')
];

function cardFor(ns: string, cards: ReturnType<typeof buildRolloutCards>) {
	return cards.find((c) => c.ns === ns)!;
}

describe('computeBehind (via buildRolloutCards)', () => {
	const cards = buildRolloutCards([dev, staging, prod], ENVIRONMENTS, NOW);

	// ⛔ THE NUMBER MOVED 26 → 24, AND IT IS BACK WHERE THE CONTROLLER PUT IT.
	// (2026-08-31, reversing 2026-08-30.) 26 was the APP LADDER — the union
	// across every environment — and the union holds two builds prod's own
	// list does not: dev's head `9f10e49` and `rel-8`. Prod cannot deploy
	// either: neither is in its `availableReleases`, so neither appears in
	// Change Version, and neither is in its `releaseCandidates`, so rollout
	// detail's `N upgrades available` never counted them. 24 is what this
	// rollout's own controller published and what every control on the page
	// will offer. See `env-rank.ts` for the full measurement.
	it('reports prod as 24 behind — its own candidate count — even though its version aged out of every peer history', () => {
		const c = cardFor('hello-world-prod', cards);
		expect(c.rank).toEqual({ kind: 'behind', by: 24 });
		expect(c.behind).not.toBeNull();
		expect(c.behind!.behindBy).toBe(24);
		// The number the chip prints IS the length of the upgrade list rollout
		// detail renders. That equality is the whole ruling.
		expect(rankBehindBy(c.rank)).toBe(prod.status.releaseCandidates.length);
	});

	it('does NOT collapse to a falsy rank — the home page must not classify prod as steady', () => {
		const c = cardFor('hello-world-prod', cards);
		// This is the exact expression ControlCenter.svelte uses to bucket a
		// rollout into `steadyAll` and render it `newest`.
		expect(c.rank.kind === 'newest').toBe(false);
		expect(rankBehindBy(c.rank) > 0).toBe(true);
	});

	it('attributes the lag to a peer that is genuinely ahead', () => {
		const c = cardFor('hello-world-prod', cards);
		expect(['dev', 'staging']).toContain(c.behind!.fromEnv);
		expect(c.behind!.version).toBe('9f10e49');
	});

	it('leaves in-sync envs alone — dev and staging are at head and must not be flagged', () => {
		expect(cardFor('hello-world-dev', cards).behind).toBeNull();
		expect(cardFor('hello-world-staging', cards).behind).toBeNull();
	});

	it('a pinned rollout names no PEER — that attribution is a user choice', () => {
		const pinned = { ...prod, spec: { wantedVersion: '205a312' } };
		const pinnedCards = buildRolloutCards([dev, staging, pinned], ENVIRONMENTS, NOW);
		expect(cardFor('hello-world-prod', pinnedCards).behind).toBeNull();
	});

	// ⛔ BUT IT STILL HAS A RANK, AND THIS IS A VISIBLE CHANGE ON `/` AND
	// `/rollouts`. (2026-08-30) `behind: null` used to render as the word
	// `newest`, so a rollout PINNED twenty-three builds back was the product's
	// good-news word on the two pages the human uses most. The pin is a reason
	// the rollout is behind, not a reason it is not; `PinBadge` names the cause
	// beside the chip, which is what `/apps` and `/apps/[name]` already did
	// (*"the actual cause was the pin, which the page never mentions"*).
	it('a pinned rollout still reports its true rank, never `newest`', () => {
		const pinned = { ...prod, spec: { wantedVersion: '205a312' } };
		const pinnedCards = buildRolloutCards([dev, staging, pinned], ENVIRONMENTS, NOW);
		const c = cardFor('hello-world-prod', pinnedCards);
		expect(c.rank).toEqual({ kind: 'behind', by: 24 });
		expect(rankLabel(c.rank)).toBe('24 builds behind');
	});

	// QA correctly flagged the previous version of this test as a TAUTOLOGY: it
	// used an orphan version that `compareRollouts` also could not match, so
	// `behind` was null on both the old and the new implementation and the
	// assertions passed either way. It would not have caught the guard
	// regressing. Rewritten as a genuine discriminator: the orphan's version IS
	// present in the peer's history, so `compareRollouts` DOES return 'behind'
	// and produces a non-null `best` — which means the assertion below is
	// actually about what the new code does with `myNewer === null`.
	it('lag-unknowable: keeps the peer attribution but never fabricates a count from it', () => {
		// 'b5f36d8' is in dev/staging's history (so compareRollouts resolves)
		// but NOT in this rollout's own availableReleases (so newerReleaseCount
		// returns null — the retention-truncation case).
		const orphan = rollout({
			ns: 'hello-world-prod',
			current: 'b5f36d8',
			timestamp: '2026-07-21T20:01:09Z',
			history: ['b5f36d8'],
			availableReleases: PROD_AVAILABLE, // does NOT contain b5f36d8
			releaseCandidates: [] // controller's "I don't know how to upgrade"
		});
		const cards = buildRolloutCards([dev, staging, orphan], ENVIRONMENTS, NOW);
		const c = cardFor('hello-world-prod', cards);
		// compareRollouts found a real peer, so we still say WHO it trails...
		expect(c.behind).not.toBeNull();
		expect(['dev', 'staging']).toContain(c.behind!.fromEnv);
		// ...but the count must come from compareRollouts' own index, never be
		// invented by us, and never be a fabricated 24.
		expect(c.behind!.behindBy).not.toBe(24);
	});

	it('myNewer === 0 with a non-null compareRollouts result: does not invent a count', () => {
		// The one path where `/` and `/apps/[name]` could disagree: this
		// rollout IS at the head of its own release list (newerReleaseCount 0)
		// yet compareRollouts still resolves it as behind a peer. We keep
		// compareRollouts' answer rather than overwriting it with 0 — but the
		// two surfaces can then differ, so pin the behaviour explicitly.
		const atHeadButTrailing = rollout({
			ns: 'hello-world-prod',
			current: '9f10e49',
			timestamp: '2026-07-21T20:01:09Z',
			history: ['9f10e49'],
			availableReleases: DEV_AVAILABLE // 9f10e49 IS the last entry -> 0 newer
		});
		const cards = buildRolloutCards([dev, staging, atHeadButTrailing], ENVIRONMENTS, NOW);
		const c = cardFor('hello-world-prod', cards);
		// All three are on the same version, so nobody is behind anybody.
		expect(c.behind).toBeNull();
	});
});

/**
 * ⛔ GOING BACKWARDS WAS DRAWN AS GOING FORWARDS.
 *
 * The live shape, `hello-world-prod/hello-world-app` on 2026-08-30: history
 * `id 3` is `51b976a` at `availableReleases` index 0, and it replaced `id 2`
 * `aa17645` at index 7. Every list surface rendered that identically to a
 * forward deploy.
 */
describe('detectRollback', () => {
	function r(history: string[], available: string[]) {
		return {
			metadata: { name: 'hello-world-app', namespace: 'hello-world-prod' },
			spec: {},
			status: {
				history: history.map((v) => ({ version: { tag: v, version: v } })),
				availableReleases: available.map((v) => ({ tag: v, version: v }))
			}
		} as any;
	}
	const LIST = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];

	it('marks the live case: index 0 now, index 7 before', () => {
		const mark = detectRollback(r(['a', 'h'], LIST))!;
		expect(mark).not.toBeNull();
		expect(mark.by).toBe(7);
		expect(mark.from).toBe('h');
		expect(mark.to).toBe('a');
	});

	it('says nothing about a forward deploy', () => {
		expect(detectRollback(r(['h', 'a'], LIST))).toBeNull();
	});

	it('says nothing when there is only one deploy in history', () => {
		expect(detectRollback(r(['a'], LIST))).toBeNull();
	});

	it('says nothing when the version is not in the release list — no ordering exists', () => {
		expect(detectRollback(r(['custom-tag', 'h'], LIST))).toBeNull();
		expect(detectRollback(r(['a', 'aged-out'], LIST))).toBeNull();
	});

	it('says nothing when the same version was redeployed', () => {
		expect(detectRollback(r(['c', 'c'], LIST))).toBeNull();
	});

	it('rides on the card so every list surface reads one answer', () => {
		const rolledBack = rollout({
			ns: 'hello-world-prod',
			current: '51b976a',
			timestamp: '2026-08-29T11:10:39Z',
			history: ['51b976a', 'aa17645'],
			availableReleases: ['51b976a', 'x', 'y', 'aa17645']
		});
		const cards = buildRolloutCards([rolledBack], ENVIRONMENTS, NOW);
		expect(cardFor('hello-world-prod', cards).rolledBack?.by).toBe(3);
	});
});

/**
 * ⛔ THE FIRST FIX FOR "SAY THE WORD ROLLBACK" COST THE APP NAME.
 *
 * Measured on `/` at 1440 light with loose `ROLLED BACK` + `PINNED` marks:
 *
 *     [PROD][ROLLED BACK][PINNED][23 BEHIND][aa17645]  name width 0 of 108
 *     hello…[PROD][ROLLED BACK][24 BEHIND][51b976a]    scrollWidth 415 / 398
 *
 * The row holds one verdict chip. These tests pin WHICH verdict it holds and
 * that the other fact survives in the title rather than being deleted.
 */
describe('cardVerdict', () => {
	const rank = ['24 builds behind', 'prod is 24 versions behind the newest'] as const;
	const back = { from: 'aa17645', to: '51b976a', by: 7 };

	it('passes the rank straight through when nothing happened to it', () => {
		const v = cardVerdict({ rolledBack: null, pinnedVersion: null }, ...rank);
		expect(v.label).toBe('24 builds behind');
		expect(v.title).toBe(rank[1]);
	});

	/**
	 * ⛔ THE STATE NEVER EVICTS THE NUMBER. (2026-08-31)
	 *
	 * The live defect: prod printed `ROLLED BACK 51b976a` with NO number on
	 * `/` and `/rollouts` while it was the most-behind rollout in the fleet,
	 * filed under a header reading "healthy, but behind a newer build". The
	 * old precedence (`rolled back` > `pinned` > rank) ranked two facts by
	 * deleting one. The word moved to the status disc (`cardStateMark`), so
	 * the chip keeps the rank on every row.
	 */
	it('KEEPS THE RANK IN THE CHIP when the rollout was rolled back', () => {
		const v = cardVerdict({ rolledBack: back, pinnedVersion: null }, ...rank);
		expect(v.label).toBe('24 builds behind');
		expect(v.title).toContain('Rolled back 7 versions');
		expect(v.title).toContain(rank[1]);
	});

	it('KEEPS THE RANK IN THE CHIP when the rollout is pinned', () => {
		const v = cardVerdict({ rolledBack: null, pinnedVersion: 'main-abc' }, ...rank);
		expect(v.label).toBe('24 builds behind');
		expect(v.title).toContain('main-abc');
		expect(v.title).toContain('automatic deploys are paused');
		expect(v.title).toContain(rank[1]);
	});

	/**
	 * A rollback PINS by construction (`ChangeVersionModal.mustPin`), so both
	 * are true on every rollback. The disc holds ONE glyph, and it is the
	 * rollback's — going backwards is the news, the pin is its mechanism.
	 */
	it('marks ROLLED BACK, not PINNED, when both are true', () => {
		const m = cardStateMark({ rolledBack: back, pinnedVersion: 'main-abc' });
		expect(m).not.toBeNull();
		expect(m!.kind).toBe('rolled-back');
		expect(m!.word).toBe('rolled back');
	});

	/**
	 * ⭐ HELD OUTRANKS ROLLED BACK AND PINNED. (2026-09-03, operator-walk
	 * finding P6) Measured live: `hello-world-app` DEV showed the rollback
	 * arrow while it was, right now, held by a dependency contract nothing
	 * in this cluster can satisfy — the disc named a past event instead of
	 * the current one. `held` is a fact about right now; a stale rollback
	 * arrow is not. This does NOT reopen "rolled back vs pinned" above —
	 * that ordering is unchanged and still tested.
	 */
	it('marks HELD over ROLLED BACK, even with a pin too', () => {
		const m = cardStateMark({ rolledBack: back, pinnedVersion: 'main-abc', held: true });
		expect(m).not.toBeNull();
		expect(m!.kind).toBe('held');
	});

	it('marks HELD over a plain PIN', () => {
		const m = cardStateMark({ rolledBack: null, pinnedVersion: 'main-abc', held: true });
		expect(m!.kind).toBe('held');
	});

	/**
	 * ⭐ THE PIN HALF IS THE ONLY THING `/` AND `/rollouts` SAY ABOUT THE
	 * DIFFERENCE, AND IT COSTS NOTHING. A rollback started in this product
	 * always pins (`ChangeVersionModal.mustPin`), so a rollback WITHOUT one
	 * means somebody cleared it and the controller will move the rollout
	 * forward again. That changes what an operator DOES, not whether the row
	 * is worth opening, so it rides in the disc's title and `sr-only` text
	 * rather than earning a second glyph the closed row budget cannot afford.
	 *
	 * ⚠️ `can`, NEVER `will`. This function sees no gate state. Only
	 * `rollbackStory` — which reads `autoDeployState` — is allowed to say when.
	 */
	it('says the rollback is HELD when a pin is holding it', () => {
		const m = cardStateMark({ rolledBack: back, pinnedVersion: 'main-abc' });
		expect(m!.title).toContain('Pinned there.');
		expect(m!.title).not.toMatch(/will/);
	});

	it('says the rollback is NOT held when nothing is pinned', () => {
		const m = cardStateMark({ rolledBack: back, pinnedVersion: null });
		expect(m!.title).toContain('Not pinned, so it can move forward again.');
	});

	it('draws NO state glyph on an ordinary rollout', () => {
		expect(cardStateMark({ rolledBack: null, pinnedVersion: null })).toBeNull();
	});

	it('gives the pin its own glyph and its own word', () => {
		const m = cardStateMark({ rolledBack: null, pinnedVersion: 'main-abc' });
		expect(m!.kind).toBe('pinned');
		expect(m!.word).toBe('pinned');
		expect(m!.title).toContain('main-abc');
	});

	it('keeps BOTH facts — the rank sentence survives in every title', () => {
		expect(cardVerdict({ rolledBack: back, pinnedVersion: null }, ...rank).title).toContain(rank[1]);
		expect(cardVerdict({ rolledBack: null, pinnedVersion: 'x' }, ...rank).title).toContain(rank[1]);
	});

	it('spells the rollback distance', () => {
		const v = cardVerdict({ rolledBack: back, pinnedVersion: null }, ...rank);
		expect(v.title).toContain('Rolled back 7 versions: aa17645 → 51b976a');
	});

	it('says "1 version", not "1 versions"', () => {
		const v = cardVerdict({ rolledBack: { from: 'b', to: 'a', by: 1 }, pinnedVersion: null }, ...rank);
		expect(v.title).toContain('Rolled back 1 version:');
	});

	it('a rolled-back rollout on `/` still shows its lag — the whole finding', () => {
		// End to end on the fixture: prod IS behind, and rolling it back must
		// not silence that. The row shows `24 behind` in the chip and the
		// rollback in the disc, both at rest.
		// `rel-20` sits at index 20 of PROD_AVAILABLE and `205a312` at index 8,
		// so the current build is EARLIER in the list than the one it replaced
		// — the controller's own ordering saying "this went backwards".
		const back3 = ['205a312', 'rel-20', 'rel-19'];
		const rolled = rollout({
			ns: 'hello-world-prod',
			current: '205a312',
			timestamp: '2026-07-21T20:01:09Z',
			history: back3,
			availableReleases: PROD_AVAILABLE,
			releaseCandidates: Array.from({ length: 24 }, (_, i) => `rc-${24 - i}`)
		});
		const cs = buildRolloutCards([dev, staging, rolled], ENVIRONMENTS, NOW);
		const c = cardFor('hello-world-prod', cs);
		expect(c.rolledBack).not.toBeNull();
		const v = cardVerdict(c, rankLabel(c.rank), 'sentence');
		expect(v.label).toBe('24 builds behind');
		expect(cardStateMark(c)!.kind).toBe('rolled-back');
	});
});

/**
 * ⭐ `heldCauseText` — one line naming why a held card is held. (operator-walk
 * finding P6) `gate()` fills in only the fields the function reads; the rest
 * are `blocking-story.ts`'s own concern and are asserted there.
 */
function gate(overrides: Partial<ClassifiedGate>): ClassifiedGate {
	return {
		id: 'g',
		kind: 'dependency',
		clears: 'upstream',
		label: 'l',
		clause: 'c',
		short: 'short',
		clearsAt: null,
		timezone: null,
		subject: null,
		subjectKind: null,
		predicate: null,
		contract: null,
		have: null,
		need: null,
		...overrides
	};
}
function story(gates: ClassifiedGate[]): BlockingStory {
	return { gates } as BlockingStory;
}

describe('heldCauseText', () => {
	it('names the provider and the required range for a dependency gate', () => {
		const g = gate({ subject: 'hello-api-app', need: '^1.67.0' });
		expect(heldCauseText(story([g]))).toBe('waiting on hello-api-app ^1.67.0');
	});

	it('names just the provider when the required range is not knowable', () => {
		const g = gate({ subject: 'hello-api-app', need: null });
		expect(heldCauseText(story([g]))).toBe('waiting on hello-api-app');
	});

	it('names the reopen time for a closed deploy window, never the raw label', () => {
		const g = gate({
			clears: 'clock',
			clearsAt: '2026-09-03T13:00:00Z',
			short: 'Outside the Business Hours Only deploy window'
		});
		const text = heldCauseText(story([g]));
		// ⛔ "ON ITS OWN" IS THE POINT (2026-09-03, coordinator relay,
		// operator-walk item): a closed window clears itself, unlike the
		// other held causes tested above — the Held section header used to
		// claim every held card "will not move on their own", which was
		// false of exactly this one.
		expect(text).toMatch(/^reopens .* on its own$/);
	});

	it('falls back to `short` when there is no second party to draw', () => {
		const g = gate({ subject: null, short: 'A check is not passing' });
		expect(heldCauseText(story([g]))).toBe('A check is not passing');
	});

	it('is null when nothing is holding it', () => {
		expect(heldCauseText(story([]))).toBeNull();
	});

	it('reads the WORST gate — the first one — when several hold it at once', () => {
		const worst = gate({ subject: 'hello-api-app', need: '^1.67.0' });
		const other = gate({ clears: 'clock', clearsAt: '2026-09-03T13:00:00Z' });
		expect(heldCauseText(story([worst, other]))).toBe('waiting on hello-api-app ^1.67.0');
	});
});

// ─────────────────────────────────────────────────────────────────────────
// `detectRolloutStuck` — THE ONE PREDICATE (U-2 class, 2026-10-09).
//
// Reproduces the exact shape of the checkout-api bug: `/apps/checkout-api`
// showed five environments `STUCK` while Home showed none of them, because
// `buildRolloutCards` (what Home / `/rollouts` / the command palette all
// read `.stuck` from) only ever ran the own-rollout baking/deploying
// detector — never the promotion or peer-behind detectors `/apps/[name]`
// already composed locally. These tests pin the join this predicate now
// does for every surface, and the edge cases a caller must get right:
// held by a gate, pinned, failed, deploying recently, and no newer build.
// ─────────────────────────────────────────────────────────────────────────
describe('detectRolloutStuck', () => {
	const NOW = new Date('2026-08-22T00:00:00Z');

	function mk(opts: {
		currentVersion: string;
		timestamp?: string;
		bakeStatus?: string;
		wantedVersion?: string;
		releaseCandidates?: { version: string; tag?: string; created?: string }[];
		availableReleases?: { version: string; tag?: string }[];
		gates?: { name: string; passing?: boolean; allowedVersions?: string[] | null }[];
	}): Rollout {
		const status: any = {
			history: [
				{
					version: { version: opts.currentVersion },
					timestamp: opts.timestamp ?? '2026-08-21T23:00:00Z',
					bakeStatus: opts.bakeStatus ?? 'Succeeded'
				}
			],
			gates: opts.gates ?? []
		};
		if (opts.releaseCandidates) status.releaseCandidates = opts.releaseCandidates;
		if (opts.availableReleases) status.availableReleases = opts.availableReleases;
		return {
			metadata: { name: 'checkout-api', namespace: 'x' },
			spec: opts.wantedVersion ? { wantedVersion: opts.wantedVersion } : {},
			status
		} as unknown as Rollout;
	}

	function peer(envName: string, r: Rollout) {
		return { envName, rollout: r };
	}

	it('own: baking (InProgress) past 1h is stuck, with no peers and no gates needed', () => {
		const r = mk({
			currentVersion: 'b-45',
			bakeStatus: 'InProgress',
			timestamp: new Date(NOW.getTime() - 90 * 60 * 1000).toISOString() // 90m ago
		});
		const reason = detectRolloutStuck(r, [], { now: NOW });
		expect(reason?.kind).toBe('baking');
	});

	it('EDGE CASE — deploying recently (under 1h) is not stuck', () => {
		const r = mk({
			currentVersion: 'b-45',
			bakeStatus: 'Deploying',
			timestamp: new Date(NOW.getTime() - 10 * 60 * 1000).toISOString() // 10m ago
		});
		expect(detectRolloutStuck(r, [], { now: NOW })).toBeNull();
	});

	it('EDGE CASE — no newer build anywhere: not stuck (nothing to be behind)', () => {
		const r = mk({ currentVersion: 'b-45' });
		const samePeer = peer('staging', mk({ currentVersion: 'b-45' }));
		expect(detectRolloutStuck(r, [samePeer], { now: NOW })).toBeNull();
	});

	it('EDGE CASE — failed bake, no gate block, no stale peer: not stuck (failure is tracked by statusKey, not this predicate)', () => {
		const r = mk({ currentVersion: 'b-40', bakeStatus: 'Failed' });
		expect(detectRolloutStuck(r, [], { now: NOW })).toBeNull();
	});

	it('EDGE CASE — pinned: never stuck, even behind a peer that advanced over 24h ago', () => {
		const pinned = mk({ currentVersion: 'b-40', wantedVersion: 'b-40' });
		const aheadPeer = peer(
			'dev',
			mk({
				currentVersion: 'b-45',
				timestamp: new Date(NOW.getTime() - 41 * 24 * 60 * 60 * 1000).toISOString()
			})
		);
		expect(detectRolloutStuck(pinned, [aheadPeer], { now: NOW })).toBeNull();
	});

	// `ghd-x`: environment controller's promotion gate (owned, upstream).
	const envGate: Environment = {
		metadata: { namespace: 'x' },
		status: { rolloutGateRef: { name: 'ghd-x' } },
		spec: { name: 'x', environment: 'staging' }
	} as unknown as Environment;
	const devSibling: Environment = {
		metadata: { namespace: 'x-dev' },
		status: {},
		spec: { name: 'x', environment: 'dev' }
	} as unknown as Environment;
	// `dependency-checkout-needs-payments`: RolloutDependency contract gate.
	const depGate: RolloutDependency = {
		metadata: { namespace: 'x' },
		status: {
			gateName: 'dependency-checkout-needs-payments',
			providedVersion: '1.0.0',
			blockedReleases: [{ requiredVersion: '^1.1.0' }]
		},
		spec: { providerRef: { name: 'payments-svc' } }
	} as unknown as RolloutDependency;

	it('EDGE CASE — held by a gate that does not need a person (upstream/dependency): not stuck, even far past every threshold', () => {
		const held = mk({
			currentVersion: 'b-43',
			timestamp: '2026-07-01T00:00:00Z',
			releaseCandidates: [{ version: 'b-44', tag: 'b-44', created: '2026-07-01T00:00:00Z' }],
			gates: [
				{ name: 'ghd-x', passing: true, allowedVersions: [] },
				{ name: 'dependency-checkout-needs-payments', passing: true, allowedVersions: ['b-43'] }
			]
		});
		const ctx = buildGateContext({
			environments: { items: [devSibling, envGate] },
			rolloutDependencies: { items: [depGate] }
		});
		const aheadPeer = peer(
			'dev',
			mk({
				currentVersion: 'b-45',
				timestamp: new Date(NOW.getTime() - 41 * 24 * 60 * 60 * 1000).toISOString()
			})
		);
		// Both the promotion-level question AND the peer-behind question
		// must come back excused — this is the exact `detectRolloutStuck`
		// shape (guard BETWEEN them), not two independent calls.
		expect(detectRolloutStuck(held, [aheadPeer], { now: NOW, gateContext: ctx })).toBeNull();
	});

	it('EDGE CASE — held by a hand-authored approval gate (needs a person): stuck via promotion', () => {
		const held = mk({
			currentVersion: 'b-43',
			timestamp: '2026-07-01T00:00:00Z',
			releaseCandidates: [{ version: 'b-44', tag: 'b-44', created: '2026-07-01T00:00:00Z' }],
			gates: [{ name: 'checkout-manual-approval', passing: true, allowedVersions: [] }]
		});
		const ctx = buildGateContext({ environments: { items: [] }, rolloutDependencies: { items: [] } });
		const reason = detectRolloutStuck(held, [], { now: NOW, gateContext: ctx });
		expect(reason?.kind).toBe('promotion');
	});

	// ── THE CHECKOUT-API REPRO ───────────────────────────────────────────
	// `staging` is behind `dev` by one release; `dev` advanced long ago;
	// NOTHING blocks staging (its own promotion gate vacuously passes once
	// dev has already deployed the newer build — the live fixture's own
	// shape). This is "no progress for 41d and nothing is holding it on
	// purpose" — genuinely stuck, gatelessly, and the fact Home used to
	// miss entirely.
	it('THE CHECKOUT-API REPRO — gateless staleness behind a peer is stuck, with no gate at all', () => {
		// Shared `availableReleases` (oldest-first) is what lets
		// `compareRollouts` place `b-43` before `b-45` — exactly the join
		// the live fixture's `CK_RELEASES` list provides.
		const releases = [{ version: 'b-43' }, { version: 'b-44' }, { version: 'b-45' }];
		const staging = mk({ currentVersion: 'b-43', availableReleases: releases });
		const dev = mk({
			currentVersion: 'b-45',
			availableReleases: releases,
			timestamp: new Date(NOW.getTime() - 41 * 24 * 60 * 60 * 1000).toISOString()
		});
		const reason = detectRolloutStuck(staging, [peer('dev', dev)], { now: NOW });
		expect(reason?.kind).toBe('behind');
		if (reason?.kind === 'behind') {
			expect(reason.peerEnv).toBe('dev');
		}
	});
});

// ── WORST-WINS CHANGE VERDICT (squad-changes round 2, 2026-10-09) ──────────
//
// `changeStateRankFor`/`worstChangeCell` — see their own doc comments in
// `rollout-cards.ts` for the coordinator's ruling. These build the minimal
// `Pick<PrCell, 'state' | 'stuck' | 'held' | 'envRank' | 'cluster'>` shape
// both functions actually read, never a full `PrCell` literal (the real
// shape's other ~25 fields are irrelevant to ranking).

type RankCell = Pick<PrCell, 'state' | 'stuck' | 'held' | 'envRank' | 'cluster'>;

function rc(state: PrState, envRank: number, extra: Partial<RankCell> = {}): RankCell {
	// `stuck`/`held` default to `undefined`, same as a real `PrCell` that
	// never ran the real pipeline — `isEnvHeld`'s own fallback then reads
	// `state` (`gated`/`pinned`/`waiting-upstream`) exactly as the pre-round-2
	// `changeHeld` check did.
	return { state, envRank, cluster: 'hub', ...extra };
}

describe('changeStateRankFor / worstChangeCell — worst-wins change verdict', () => {
	it('orders failed > stuck > held > deploying/checking > queued, matching NeedsYouCard', () => {
		expect(changeStateRankFor(rc('failed', 0))).toBeLessThan(
			changeStateRankFor(rc('deploying', 0, { stuck: true }))
		);
		expect(changeStateRankFor(rc('deploying', 0, { stuck: true }))).toBeLessThan(
			changeStateRankFor(rc('gated', 0))
		);
		expect(changeStateRankFor(rc('gated', 0))).toBeLessThan(changeStateRankFor(rc('deploying', 0)));
		expect(changeStateRankFor(rc('deploying', 0))).toBeLessThan(changeStateRankFor(rc('queued', 0)));
		expect(changeStateRankFor(rc('queued', 0))).toBeLessThan(changeStateRankFor(rc('live', 0)));

		// ⭐ NeedsYouCard's own `KIND_RANK` (home-v2's file, not switched to
		// import this module — see the coordinator's ruling) must never
		// drift from this order for the three kinds it shares. Copied by
		// hand with this comment naming the twin, since NeedsYouCard does
		// not export its constant: `const KIND_RANK: Record<Kind, number> =
		// { failed: 0, stuck: 1, held: 2 }` (`NeedsYouCard.svelte`).
		const NEEDS_YOU_KIND_RANK = { failed: 0, stuck: 1, held: 2 };
		expect(CHANGE_STATE_RANK.failed).toBeLessThan(CHANGE_STATE_RANK.stuck);
		expect(CHANGE_STATE_RANK.stuck).toBeLessThan(CHANGE_STATE_RANK.held);
		expect(
			[NEEDS_YOU_KIND_RANK.failed, NEEDS_YOU_KIND_RANK.stuck, NEEDS_YOU_KIND_RANK.held]
		).toEqual(
			[...[NEEDS_YOU_KIND_RANK.failed, NEEDS_YOU_KIND_RANK.stuck, NEEDS_YOU_KIND_RANK.held]].sort(
				(a, b) => a - b
			)
		);
		// The two orders are the SAME relative order (failed < stuck < held),
		// even though the numeric values differ once `deploying`/`queued`/
		// `live` are added on this side.
		expect(Math.sign(CHANGE_STATE_RANK.stuck - CHANGE_STATE_RANK.failed)).toBe(
			Math.sign(NEEDS_YOU_KIND_RANK.stuck - NEEDS_YOU_KIND_RANK.failed)
		);
		expect(Math.sign(CHANGE_STATE_RANK.held - CHANGE_STATE_RANK.stuck)).toBe(
			Math.sign(NEEDS_YOU_KIND_RANK.held - NEEDS_YOU_KIND_RANK.stuck)
		);
	});

	// THE WIDE PR #20 REPRO — failed in prod, held in prod (a second
	// service), checking in dev. The old "earliest env rank" rule picked
	// dev's checking cell (rank 1) over prod's failure (rank 7+) and the
	// title chip read "Deploying" with no banner at all.
	it('wide PR #20 — failed in prod outranks held in prod and checking in dev', () => {
		const devChecking = { cell: rc('baking', 1, { cluster: 'hub' }), appName: 'api' };
		const prodHeld = { cell: rc('gated', 9, { cluster: 'hub' }), appName: 'worker' };
		const prodFailed = { cell: rc('failed', 9, { cluster: 'hub' }), appName: 'telemetry-forwarder' };
		const worst = worstChangeCell([devChecking, prodHeld, prodFailed]);
		expect(worst?.appName).toBe('telemetry-forwarder');
		expect(worst?.cell.state).toBe('failed');
	});

	it('calm — a single held cell is its own worst, real state', () => {
		const onlyCandidate = { cell: rc('gated', 3), appName: 'hello-world-app' };
		const worst = worstChangeCell([onlyCandidate]);
		expect(worst?.cell.state).toBe('gated');
	});

	it('a tie in severity breaks on env rank — the earlier environment wins', () => {
		const laterEnv = { cell: rc('gated', 9, { cluster: 'hub' }), appName: 'prod-service' };
		const earlierEnv = { cell: rc('gated', 3, { cluster: 'hub' }), appName: 'dev-service' };
		const worst = worstChangeCell([laterEnv, earlierEnv]);
		expect(worst?.appName).toBe('dev-service');
		expect(worst?.cell.envRank).toBe(3);
	});

	it('held is `promotionHoldBreakdown(...).allHeld`, not a bare gated/pinned/waiting-upstream guess', () => {
		// A cell whose STATE looks held but whose real pipeline run says only
		// an older build is held (`allHeld: false`) must not outrank a
		// genuine failure elsewhere — `held` explicitly set `false` is
		// trusted over the state-based fallback.
		const notReallyHeld = { cell: rc('gated', 0, { held: false }), appName: 'api' };
		const genuinelyFailed = { cell: rc('failed', 9, { held: false }), appName: 'worker' };
		const worst = worstChangeCell([notReallyHeld, genuinelyFailed]);
		expect(worst?.appName).toBe('worker');
	});

	it('worstChangeCell returns null for an empty list', () => {
		expect(worstChangeCell([])).toBeNull();
	});

	// ⛔ LIVE REGRESSION (incident PR #30, found in the 2x2 screenshots): a
	// `queued` cell (a bare promotion-order wait — gates ALLOW it, nothing is
	// refusing it) with `held: true` set at the ROLLOUT level
	// (`promotionHoldBreakdown(...).allHeld` answers "is every candidate for
	// this rollout held", a different, broader question than "is the ONE
	// candidate carrying THIS change held") must NOT read as held — the title
	// chip (`frontierTone`, pr-pipeline.ts) only ever reads `gated`/`pinned`/
	// `waiting-upstream` as held, and the banner must never disagree with it.
	it('a queued cell is never held, even when `held: true` is set at the rollout level', () => {
		const queuedButRolloutHeld = rc('queued', 3, { held: true });
		expect(isEnvHeld(queuedButRolloutHeld)).toBe(false);
		expect(changeStateRankFor(queuedButRolloutHeld)).toBe(CHANGE_STATE_RANK.queued);
	});

	it('a gated cell with `held: true` IS held — the state already said so, `held` confirms it', () => {
		const genuinelyHeld = rc('gated', 3, { held: true });
		expect(isEnvHeld(genuinelyHeld)).toBe(true);
		expect(changeStateRankFor(genuinelyHeld)).toBe(CHANGE_STATE_RANK.held);
	});
});
