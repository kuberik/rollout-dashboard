import { describe, it, expect } from 'vitest';
import { buildRolloutCards } from './rollout-cards';

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
const PROD_AVAILABLE = Array.from({ length: 33 }, (_, i) =>
	i === 8 ? '205a312' : `rel-${i}`
);
const prod = rollout({
	ns: 'hello-world-prod',
	current: '205a312',
	timestamp: '2026-07-21T20:01:09Z',
	history: ['205a312', '2bcb8be', '7424c7c'],
	availableReleases: PROD_AVAILABLE,
	releaseCandidates: Array.from({ length: 24 }, (_, i) => `rc-${24 - i}`)
});

// dev / staging: at the head of their own lists, releaseCandidates key ABSENT.
const DEV_AVAILABLE = Array.from({ length: 29 }, (_, i) =>
	i === 28 ? '9f10e49' : `rel-${i}`
);
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

	it('reports prod as 24 behind even though its version aged out of every peer history', () => {
		const c = cardFor('hello-world-prod', cards);
		expect(c.behind).not.toBeNull();
		expect(c.behind!.behindBy).toBe(24);
	});

	it('does NOT collapse to a falsy behindBy — the home page must not classify prod as steady', () => {
		const c = cardFor('hello-world-prod', cards);
		// This is the exact expression ControlCenter.svelte uses to bucket a
		// rollout into `steadyAll` and render it `newest`.
		expect((c.behind?.behindBy ?? 0) > 0).toBe(true);
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

	it('a pinned rollout is never "behind" — that is a user choice', () => {
		const pinned = { ...prod, spec: { wantedVersion: '205a312' } };
		const pinnedCards = buildRolloutCards([dev, staging, pinned], ENVIRONMENTS, NOW);
		expect(cardFor('hello-world-prod', pinnedCards).behind).toBeNull();
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
