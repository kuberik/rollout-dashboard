import { describe, it, expect } from 'vitest';
import {
	newerReleaseCount,
	newestCandidate,
	promotionBlock,
	detectStuckPromotion,
	gateAllows,
	promotionCandidates,
	newestDeployableCandidate,
	isDeployable
} from './promotion';
import type { Rollout } from '$lib/../types';

// Fixtures below are built from the VERIFIED GROUND TRUTH for
// app `hello-world-app` (see task spec): three envs sharing one app,
// prod 24 releases behind, dev/staging at head.

type GateFixture = { name: string; passing?: boolean; allowedVersions?: string[] | null };
type ReleaseFixture = { version: string; tag?: string; created?: string };

function makeReleaseCandidates(n: number, prefix = 'rc'): ReleaseFixture[] {
	// NEWEST-FIRST, as releaseCandidates is documented to be. Each carries a
	// `tag` distinct from its `version`, mirroring the live payload
	// ({version:"9f10e49", tag:"main-1785344304-9f10e494d5..."}) — that
	// distinction is the whole point of the gate-key tests below.
	return Array.from({ length: n }, (_, i) => ({
		version: `${prefix}-${n - i}`,
		tag: `main-000-${prefix}-${n - i}`,
		created: `2026-07-${String(29 - i).padStart(2, '0')}T16:58:26Z`
	}));
}

function rollout(opts: {
	currentVersion: string;
	historyTimestamp?: string;
	releaseCandidates?: ReleaseFixture[]; // absent -> key not present in payload
	availableReleases?: ReleaseFixture[]; // OLDEST-FIRST
	gates?: GateFixture[];
	wantedVersion?: string;
}): Rollout {
	const status: any = {
		history: [
			{
				version: { version: opts.currentVersion },
				timestamp: opts.historyTimestamp ?? '2026-07-21T20:01:09Z'
			}
		],
		gates: opts.gates ?? []
	};
	if (opts.releaseCandidates) status.releaseCandidates = opts.releaseCandidates;
	if (opts.availableReleases) status.availableReleases = opts.availableReleases;

	return {
		metadata: { name: 'hello-world-app', namespace: 'x' },
		spec: opts.wantedVersion ? { wantedVersion: opts.wantedVersion } : {},
		status
	} as unknown as Rollout;
}

// --- prod: releaseCandidates length 24, all three prod gates block every candidate ---
const PROD_CANDIDATES = makeReleaseCandidates(24);
const PROD_GATES: GateFixture[] = [
	{
		name: 'ghd-cmppc',
		passing: true,
		// Mirrors the LIVE payload: this gate allows 15 of the 24 candidates,
		// and it lists them BY TAG. Keyed on tag it is NOT a blocking gate;
		// keyed on display version it looks like it blocks all 24. The whole
		// point of the tag fix is that this gate must NOT be named a blocker.
		allowedVersions: PROD_CANDIDATES.slice(0, 15).map((c) => c.tag!)
	},
	{ name: 'hello-world-manual-approval', passing: true, allowedVersions: [] },
	{ name: 'schedule-gate-q25wv', passing: false, allowedVersions: null }
];
function prodRollout(overrides: Partial<Parameters<typeof rollout>[0]> = {}) {
	return rollout({
		currentVersion: '205a312',
		historyTimestamp: '2026-07-21T20:01:09Z',
		releaseCandidates: PROD_CANDIDATES,
		gates: PROD_GATES,
		...overrides
	});
}

// --- dev at head: releaseCandidates key ABSENT, availableReleases length 29,
// current at index 28 (last -> distance 0). ---
const DEV_AVAILABLE = Array.from({ length: 29 }, (_, i) => ({
	version: i === 28 ? '9f10e49' : `old-${i}`,
	created: `2026-07-${String(1 + i).padStart(2, '0')}T00:00:00Z`
}));
const DEV_GATES: GateFixture[] = [
	{ name: 'ghd-4clfd', passing: true, allowedVersions: null },
	{ name: 'schedule-gate-tmdgh', passing: false, allowedVersions: null }
];
function devRollout() {
	return rollout({
		currentVersion: '9f10e49',
		historyTimestamp: '2026-07-29T16:59:25Z',
		availableReleases: DEV_AVAILABLE,
		gates: DEV_GATES
	});
}

// --- staging at head: same shape as dev, but the gate is
// passing=true / allowedVersions=[] (empty allow-list, nothing to allow). ---
const STAGING_AVAILABLE = Array.from({ length: 30 }, (_, i) => ({
	version: i === 29 ? '9f10e49' : `old-${i}`,
	created: `2026-07-${String(1 + (i % 28)).padStart(2, '0')}T00:00:00Z`
}));
function stagingRollout() {
	return rollout({
		currentVersion: '9f10e49',
		historyTimestamp: '2026-07-29T17:04:49Z',
		availableReleases: STAGING_AVAILABLE,
		gates: [{ name: 'ghd-dg5s5', passing: true, allowedVersions: [] }]
	});
}

describe('newerReleaseCount', () => {
	it('prod: uses releaseCandidates.length (24), not the old ≤1 index ceiling', () => {
		const count = newerReleaseCount(prodRollout());
		expect(count).toBe(24);
		expect(count).not.toBe(1);
	});

	it('dev at head: availableReleases fallback gives 0 when current is the last (newest) entry', () => {
		expect(newerReleaseCount(devRollout())).toBe(0);
	});

	it('retention truncation: current version absent from its own availableReleases -> null, never negative/fabricated', () => {
		const r = rollout({
			currentVersion: 'not-in-list',
			availableReleases: Array.from({ length: 5 }, (_, i) => ({ version: `v${i}` }))
		});
		expect(newerReleaseCount(r)).toBeNull();
	});

	it('no releaseCandidates and no availableReleases -> null', () => {
		expect(newerReleaseCount(rollout({ currentVersion: 'v1' }))).toBeNull();
	});

	// THE guard test. rollout-controller returns an EMPTY releaseCandidates
	// slice in two different situations: (a) we are at the head, and (b) our
	// current version was garbage-collected out of availableReleases, so it
	// has no idea how far behind we are. Reading (b) as "0 behind / newest"
	// is the stale-env-labelled-NEWEST bug this change exists to remove, and
	// it fails in the worst direction — the further behind a rollout falls,
	// the likelier its version has aged out.
	//
	// UNREACHABLE IN A BROWSER: `current ∈ availableReleases` holds for all
	// 15 rollouts in the live cluster, so QA cannot catch this. This fixture
	// is the only verification it gets.
	it('AMBIGUOUS EMPTY: releaseCandidates:[] but current aged out of availableReleases -> null, NOT 0', () => {
		const r = rollout({
			currentVersion: 'garbage-collected',
			releaseCandidates: [], // controller's "we don't know how to upgrade" answer
			availableReleases: Array.from({ length: 5 }, (_, i) => ({ version: `v${i}` }))
		});
		const count = newerReleaseCount(r);
		expect(count).toBeNull();
		expect(count).not.toBe(0); // must never render as "newest" / "in sync"
	});

	it('AMBIGUOUS EMPTY, in-sync twin: releaseCandidates:[] and current IS the head -> 0', () => {
		const r = rollout({
			currentVersion: 'v4',
			releaseCandidates: [],
			availableReleases: Array.from({ length: 5 }, (_, i) => ({ version: `v${i}` }))
		});
		expect(newerReleaseCount(r)).toBe(0);
	});
});

describe('gateAllows', () => {
	it('array containing the version -> true', () => {
		expect(gateAllows({ allowedVersions: ['a', 'b'] }, 'a')).toBe(true);
	});
	it('array not containing the version -> false', () => {
		expect(gateAllows({ allowedVersions: ['a', 'b'] }, 'c')).toBe(false);
	});
	it('null allowedVersions + passing:true -> true', () => {
		expect(gateAllows({ allowedVersions: null, passing: true }, 'a')).toBe(true);
	});
	it('null allowedVersions + passing:false -> false', () => {
		expect(gateAllows({ allowedVersions: null, passing: false }, 'a')).toBe(false);
	});
});

describe('promotionBlock', () => {
	// ── The gate-KEY regression suite. `allowedVersions` holds TAGS. ──────
	it('REGRESSION: ghd-cmppc allows 15/24 by tag, so it must NOT be named a blocking gate', () => {
		const b = promotionBlock(prodRollout());
		expect(b.blockingGates).not.toContain('ghd-cmppc');
		expect(b.blockingGates).toEqual([
			'hello-world-manual-approval',
			'schedule-gate-q25wv'
		]);
		// A count-only assertion would let the bug back in; pin the names.
		expect(b.blockingGates).toHaveLength(2);
	});

	it('REGRESSION: still blocked overall — right verdict, now for the right reason', () => {
		const b = promotionBlock(prodRollout());
		expect(b.blocked).toBe(true);
		expect(b.candidateCount).toBe(24);
		expect(b.deployableCount).toBe(0);
	});

	it('classifies blockers by what would clear them, structurally not by name', () => {
		const b = promotionBlock(prodRollout());
		// published an allow-list admitting nothing -> needs a person
		expect(b.awaitingApprovalGates).toEqual(['hello-world-manual-approval']);
		// no allow-list, simply not passing -> time/condition bounded
		expect(b.notPassingGates).toEqual(['schedule-gate-q25wv']);
	});

	it('a purely not-passing block is WAITING, not stuck — no amber', () => {
		const r = rollout({
			currentVersion: '205a312',
			releaseCandidates: PROD_CANDIDATES,
			// only a schedule-style gate: no allow-list, just not passing
			gates: [{ name: 'schedule-gate-q25wv', passing: false, allowedVersions: null }]
		});
		expect(promotionBlock(r).blocked).toBe(true);
		expect(promotionBlock(r).awaitingApprovalGates).toEqual([]);
		expect(detectStuckPromotion(r, { now: new Date('2026-08-22T00:00:00Z') })).toBeNull();
	});

	it('prod: 24 candidates, 0 deployable, blocked, hello-world-manual-approval named', () => {
		const b = promotionBlock(prodRollout());
		expect(b.candidateCount).toBe(24);
		expect(b.deployableCount).toBe(0);
		expect(b.blocked).toBe(true);
		expect(b.blockingGates).toContain('hello-world-manual-approval');
	});

	it('dev at head: never blocked, no matter what its gates say (THE negative case)', () => {
		const b = promotionBlock(devRollout());
		expect(b.candidateCount).toBe(0);
		expect(b.blocked).toBe(false);
		expect(b.blockingGates).toEqual([]);
	});

	it('staging at head with passing=true/allowedVersions=[] gate: still not blocked (nothing to allow)', () => {
		const b = promotionBlock(stagingRollout());
		expect(b.blocked).toBe(false);
	});

	it('passing:true is not a get-out: a rollout WITH candidates whose only gate is passing=true/allowedVersions=[] is blocked', () => {
		const r = rollout({
			currentVersion: 'v1',
			releaseCandidates: [{ version: 'v2' }],
			gates: [{ name: 'g1', passing: true, allowedVersions: [] }]
		});
		const b = promotionBlock(r);
		expect(b.blocked).toBe(true);
		expect(b.blockingGates).toEqual(['g1']);
	});

	it('retention truncation: candidateCount 0, blocked false, never negative/fabricated', () => {
		const r = rollout({
			currentVersion: 'not-in-list',
			availableReleases: Array.from({ length: 5 }, (_, i) => ({ version: `v${i}` }))
		});
		const b = promotionBlock(r);
		expect(b.candidateCount).toBe(0);
		expect(b.blocked).toBe(false);
	});
});

describe('promotionBlock with NO GATES AT ALL — the `checkout-edge` shape', () => {
	// This is the fixture that exposed the fabricated cause. An app with no
	// `gates` array is not an exotic case; it is the default for anything
	// deploying straight through. The diagnostic result recorded here is
	// that `promotionBlock` is RIGHT — the bug was one level up, in the
	// sentence, which reached for a gate that had never existed.
	const noGates = rollout({
		currentVersion: 'rc-6',
		releaseCandidates: makeReleaseCandidates(19),
		gates: []
	});

	it('does NOT report blocked: with no gate to refuse them, every candidate is deployable', () => {
		const b = promotionBlock(noGates);
		expect(b.candidateCount).toBe(19);
		expect(b.deployableCount).toBe(19);
		expect(b.blocked).toBe(false);
	});

	it('reports no gates of either kind, and no blocking gates', () => {
		const b = promotionBlock(noGates);
		expect(b.blockingGates).toEqual([]);
		expect(b.awaitingApprovalGates).toEqual([]);
		expect(b.notPassingGates).toEqual([]);
	});

	it('an undefined `gates` key behaves identically to an empty one', () => {
		const r = rollout({ currentVersion: 'rc-6', releaseCandidates: makeReleaseCandidates(19) });
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		delete (r.status as any).gates;
		const b = promotionBlock(r);
		expect(b.blocked).toBe(false);
		expect(b.awaitingApprovalGates).toEqual([]);
		expect(b.notPassingGates).toEqual([]);
	});

	it('INVARIANT: blocked with both gate lists empty is never produced by a gateless rollout', () => {
		for (const n of [0, 1, 5, 19, 24]) {
			const b = promotionBlock(
				rollout({ currentVersion: 'rc-1', releaseCandidates: makeReleaseCandidates(n), gates: [] })
			);
			expect(b.blocked).toBe(false);
		}
	});
});

describe('promotionBlock validity guard', () => {
	it('releaseCandidates:[] with current aged out -> candidateCount 0, blocked false (we do not know, so we do not claim)', () => {
		const r = rollout({
			currentVersion: 'garbage-collected',
			releaseCandidates: [],
			availableReleases: Array.from({ length: 5 }, (_, i) => ({ version: `v${i}` })),
			gates: [{ name: 'some-gate', passing: false, allowedVersions: null }]
		});
		expect(promotionBlock(r)).toEqual({
			candidateCount: 0,
			deployableCount: 0,
			blocked: false,
			blockingGates: [],
			awaitingApprovalGates: [],
			notPassingGates: []
		});
	});

	it('aged-out rollout is not reported as stuck either (lag unknown)', () => {
		const r = rollout({
			currentVersion: 'garbage-collected',
			releaseCandidates: [],
			availableReleases: Array.from({ length: 5 }, (_, i) => ({ version: `v${i}` }))
		});
		expect(detectStuckPromotion(r, { now: new Date('2026-08-22T00:00:00Z') })).toBeNull();
	});
});

describe('newestCandidate', () => {
	it('prod: releaseCandidates[0] (newest-first)', () => {
		const c = newestCandidate(prodRollout());
		expect(c?.version).toBe(PROD_CANDIDATES[0].version);
	});

	it('dev at head: no releaseCandidates and newerReleaseCount is 0 -> null', () => {
		expect(newestCandidate(devRollout())).toBeNull();
	});
});

describe('detectStuckPromotion', () => {
	const NOW = new Date('2026-08-22T00:00:00Z');

	it('prod: stuck, candidateCount 24', () => {
		const reason = detectStuckPromotion(prodRollout(), { now: NOW });
		expect(reason).not.toBeNull();
		expect(reason?.kind).toBe('promotion');
		if (reason?.kind === 'promotion') {
			expect(reason.candidateCount).toBe(24);
		}
	});

	it('dev at head: not stuck (no candidates waiting)', () => {
		expect(detectStuckPromotion(devRollout(), { now: NOW })).toBeNull();
	});

	it('prod pinned via spec.wantedVersion: not stuck (user choice)', () => {
		const pinned = prodRollout({ wantedVersion: '205a312' });
		expect(detectStuckPromotion(pinned, { now: NOW })).toBeNull();
	});

	it('a GATELESS rollout still reports stuck, but hands back NO gate names', () => {
		// The honest shape for "19 builds have sat here for weeks and
		// nothing is refusing them". It is a real anomaly and worth the
		// amber chip; what it is not is a gate. Every consumer of
		// `blockingGates` must treat [] as "we cannot say why" — StuckBadge
		// already omits its `blocked by` clause, and the verdict line now
		// omits the mechanism entirely.
		const candidates = makeReleaseCandidates(19);
		candidates[0].created = '2026-07-01T00:00:00Z';
		const gateless = rollout({
			currentVersion: 'rc-6',
			releaseCandidates: candidates,
			gates: []
		});
		const reason = detectStuckPromotion(gateless, { now: NOW });
		expect(reason).not.toBeNull();
		expect(reason?.blockingGates).toEqual([]);
	});
});


// ─────────────────────────────────────────────────────────────────────────
// THE PROMOTE PREDICATE.
//
// A promote control may only exist where a promote would succeed. The
// rollout detail page's recorded defect — "Deployments currently blocked"
// printed above 24 ENABLED Deploy buttons — is what happens when the
// control is rendered from the candidate list instead of the deployable
// one. These tests pin the difference.
// ─────────────────────────────────────────────────────────────────────────

describe('promotionCandidates — one contract, newest first', () => {
	it('passes releaseCandidates through, which is already newest-first', () => {
		const r = rollout({ currentVersion: 'cur', releaseCandidates: makeReleaseCandidates(3) });
		expect(promotionCandidates(r).map((c) => c.version)).toEqual(['rc-3', 'rc-2', 'rc-1']);
	});

	// availableReleases is OLDEST-first. A `[0]` taken off that slice without
	// reversing preselects the OLDEST waiting build — a promote button that
	// moves the environment almost nowhere.
	it('REVERSES the availableReleases fallback so [0] is genuinely the newest', () => {
		const r = rollout({
			currentVersion: 'v1',
			availableReleases: [
				{ version: 'v1', tag: 't1' },
				{ version: 'v2', tag: 't2' },
				{ version: 'v3', tag: 't3' }
			]
		});
		expect(promotionCandidates(r).map((c) => c.version)).toEqual(['v3', 'v2']);
	});

	it('is empty when the lag is unknowable', () => {
		const r = rollout({
			currentVersion: 'gone',
			availableReleases: [{ version: 'v1', tag: 't1' }, { version: 'v2', tag: 't2' }]
		});
		expect(promotionCandidates(r)).toEqual([]);
	});
});

describe('newestDeployableCandidate', () => {
	it('is null when nothing is waiting', () => {
		expect(newestDeployableCandidate(rollout({ currentVersion: 'cur' }))).toBeNull();
		expect(newestDeployableCandidate(null)).toBeNull();
	});

	it('is the newest candidate when no gate objects', () => {
		const r = rollout({ currentVersion: 'cur', releaseCandidates: makeReleaseCandidates(3) });
		expect(newestDeployableCandidate(r)?.version).toBe('rc-3');
	});

	// The exact live shape: a gate publishes an allow-list keyed on the TAG
	// and admits nothing. Every candidate is refused, so there is no promote.
	it('is NULL when a gate blocks every candidate — no promote may be offered', () => {
		const r = rollout({
			currentVersion: 'cur',
			releaseCandidates: makeReleaseCandidates(3),
			gates: [{ name: 'manual-approval', passing: true, allowedVersions: [] }]
		});
		expect(promotionBlock(r).blocked).toBe(true);
		expect(newestDeployableCandidate(r)).toBeNull();
	});

	// A gate can hold the newest build while allowing an older one. Preselecting
	// the newest there sends the operator into a modal that cannot succeed.
	it('skips a blocked newest and returns the newest build the gates DO allow', () => {
		const cands = makeReleaseCandidates(3); // rc-3 (newest), rc-2, rc-1
		const r = rollout({
			currentVersion: 'cur',
			releaseCandidates: cands,
			gates: [{ name: 'ghd', passing: true, allowedVersions: [cands[1].tag!, cands[2].tag!] }]
		});
		expect(newestCandidate(r)?.version).toBe('rc-3');
		expect(promotionBlock(r).deployableCount).toBe(2);
		expect(newestDeployableCandidate(r)?.version).toBe('rc-2');
	});

	// A not-passing gate with no allow-list refuses everything too. It clears
	// on its own, which is why it is not `stuck` — but it is still not
	// promotable right now, so no button.
	it('is NULL behind a not-passing gate with no allow-list', () => {
		const r = rollout({
			currentVersion: 'cur',
			releaseCandidates: makeReleaseCandidates(2),
			gates: [{ name: 'schedule-gate', passing: false }]
		});
		expect(newestDeployableCandidate(r)).toBeNull();
	});

	// The invariant the page's promote control is keyed on, stated directly:
	// deployableCount > 0 <=> there is something to preselect.
	it('agrees with promotionBlock.deployableCount in both directions', () => {
		const open = rollout({ currentVersion: 'cur', releaseCandidates: makeReleaseCandidates(4) });
		expect(promotionBlock(open).deployableCount).toBeGreaterThan(0);
		expect(newestDeployableCandidate(open)).not.toBeNull();

		const shut = rollout({
			currentVersion: 'cur',
			releaseCandidates: makeReleaseCandidates(4),
			gates: [{ name: 'nope', passing: true, allowedVersions: [] }]
		});
		expect(promotionBlock(shut).deployableCount).toBe(0);
		expect(newestDeployableCandidate(shut)).toBeNull();
	});
});


describe('isDeployable — the set row\'s promote target', () => {
	it('is false for a null tag or a tag nobody offers', () => {
		const r = rollout({ currentVersion: 'cur', releaseCandidates: makeReleaseCandidates(3) });
		expect(isDeployable(r, null)).toBe(false);
		expect(isDeployable(r, 'main-000-nope')).toBe(false);
	});

	it('is true for a waiting candidate every gate allows', () => {
		const cands = makeReleaseCandidates(3);
		const r = rollout({ currentVersion: 'cur', releaseCandidates: cands });
		expect(isDeployable(r, cands[1].tag!)).toBe(true);
	});

	it('is false when a gate refuses that specific tag', () => {
		const cands = makeReleaseCandidates(3);
		const r = rollout({
			currentVersion: 'cur',
			releaseCandidates: cands,
			gates: [{ name: 'ghd', passing: true, allowedVersions: [cands[0].tag!] }]
		});
		expect(isDeployable(r, cands[0].tag!)).toBe(true);
		expect(isDeployable(r, cands[1].tag!)).toBe(false);
	});

	// The straggler is AHEAD of the fan-out's modal build. There is no
	// candidate for it, so "promote" is the wrong verb and no button appears.
	it('is false when the tag is not newer than what the rollout already runs', () => {
		const r = rollout({
			currentVersion: 'v3',
			availableReleases: [
				{ version: 'v1', tag: 't1' },
				{ version: 'v2', tag: 't2' },
				{ version: 'v3', tag: 't3' }
			]
		});
		expect(isDeployable(r, 't2')).toBe(false);
		expect(isDeployable(r, 't3')).toBe(false);
	});
});
