import { describe, it, expect } from 'vitest';
import { buildRolloutCards, detectRollback, cardVerdict, cardStateMark } from './rollout-cards';
import { rankBehindBy, rankLabel } from './view-models/env-rank';

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
		expect(rankLabel(c.rank)).toBe('24 behind');
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
	const rank = ['24 behind', 'prod is 24 versions behind the newest'] as const;
	const back = { from: 'aa17645', to: '51b976a', by: 7 };

	it('passes the rank straight through when nothing happened to it', () => {
		const v = cardVerdict({ rolledBack: null, pinnedVersion: null }, ...rank);
		expect(v.label).toBe('24 behind');
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
		expect(v.label).toBe('24 behind');
		expect(v.title).toContain('Rolled back 7 versions');
		expect(v.title).toContain(rank[1]);
	});

	it('KEEPS THE RANK IN THE CHIP when the rollout is pinned', () => {
		const v = cardVerdict({ rolledBack: null, pinnedVersion: 'main-abc' }, ...rank);
		expect(v.label).toBe('24 behind');
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
		expect(v.label).toBe('24 behind');
		expect(cardStateMark(c)!.kind).toBe('rolled-back');
	});
});
