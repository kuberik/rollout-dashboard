/**
 * ⭐ `reconcileNeighbourhoodHolds` — THE CANVAS AGREES WITH THE BREAKDOWN,
 * AND A CHAIN PREDECESSOR IS NEVER A HOLD. (squad-rollout Lane G round 4,
 * item 1, 2026-10-10, AD ruling; corrected squad-rollout gates-2 follow-up,
 * 2026-10-11, qa11 finding.)
 *
 * The round-4 fixture mirrored the live defect: `checkout-api/prod-us-east-2`'s
 * canvas drew the staging-first promotion link as "Nothing held" (its own
 * edge state, computed independently) directly beside a lead row and a
 * "Held builds" card that both named `4.45.0-45`/`4.44.0-44` as held by that
 * exact gate — and the round-4 fix made this function reconcile the link TO
 * `blocked`. qa11 found that fix itself overstated the truth: staging is an
 * EARLIER-TIER environment, so this link is plain chain sequencing — the
 * build has not reached prod-us-east-2 yet, never a hold ON prod-us-east-2.
 * `NeighbourLink.chainPredecessor` (`rollout-neighbourhood.ts`, computed from
 * the two environments' tiers, never from `state`) is what this function now
 * reads to leave such a link alone outright: its raw state is kept VERBATIM
 * (never flipped to `blocked`) and it is never counted in `holding`. A
 * same-tier contract hold (payments-svc) is unaffected — this pins that the
 * two kinds of upstream link are reconciled differently, on purpose.
 */
import { describe, it, expect } from 'vitest';
import { reconcileNeighbourhoodHolds } from './rollout-neighbourhood';
import type { NeighbourLink } from './rollout-neighbourhood';
import type { GraphNode } from './dependency-graph';

function node(name: string, env: string): GraphNode {
	return {
		id: `c/ns/${name}`,
		cluster: 'c',
		namespace: 'ns',
		name,
		env,
		envRank: 0,
		unresolved: false,
		build: 'b1',
		candidateCount: 0,
		waiting: false,
		blocked: false,
		holds: []
	};
}

const GATE_NAME = 'promotion-prod-us-east-2';

// The STAGING link — a CHAIN PREDECESSOR (staging is an earlier tier than
// prod-us-east-2). Its raw edge state is `clear` here on purpose: this
// function must never promote it to `blocked`, however the breakdown
// classifies the same gate name.
const stagingLink: NeighbourLink = {
	key: 'promotion:focus:staging',
	side: 'upstream',
	writer: 'promotion',
	state: 'clear',
	node: node('checkout-api', 'staging'),
	held: [],
	contract: null,
	requiredVersion: null,
	providedVersion: null,
	cyclic: false,
	gate: GATE_NAME,
	chainPredecessor: true
};

// The payments-svc CONTRACT link — already correctly blocked on the edge's
// own read, held by a DIFFERENT build (`4.43.0-43`), unaffected by the
// promotion gate's own chain exclusion. A contract link is never a chain
// predecessor (it carries no environment tier).
const paymentsLink: NeighbourLink = {
	key: 'contract:focus:payments-svc',
	side: 'upstream',
	writer: 'contract',
	state: 'blocked',
	node: node('payments-svc', 'platform-prod'),
	held: ['4.43.0-43'],
	contract: 'payments',
	requiredVersion: '~2.9.0',
	providedVersion: '2.4.1',
	cyclic: false,
	gate: 'dependency-payments',
	chainPredecessor: false
};

const breakdown = {
	held: [
		{ build: '4.45.0-45', gateNames: [GATE_NAME], contract: undefined },
		{ build: '4.44.0-44', gateNames: [GATE_NAME], contract: undefined },
		{ build: '4.43.0-43', gateNames: [], contract: { provider: 'payments-svc' } }
	]
};

describe('reconcileNeighbourhoodHolds: a chain predecessor is left alone; a real hold is reconciled', () => {
	const { upstream, holding } = reconcileNeighbourhoodHolds([stagingLink, paymentsLink], breakdown);

	it('never reconciles the staging-first (chain) link to `blocked` — it is not a hold', () => {
		const staging = upstream.find((l) => l.key === stagingLink.key)!;
		expect(staging.state).toBe('clear');
		expect(staging.held).toEqual([]);
	});

	it('leaves an already-correct contract link alone', () => {
		const payments = upstream.find((l) => l.key === paymentsLink.key)!;
		expect(payments.state).toBe('blocked');
		expect(payments.held).toEqual(['4.43.0-43']);
	});

	it('the rollup count is 1 of 2 holding — the chain link never counts, however many builds the breakdown names for its gate', () => {
		expect(holding).toBe(1);
		expect(upstream.length).toBe(2);
	});

	it('AGREEMENT: the only build any reconciled upstream link now names is the one actually held here', () => {
		const canvasBuilds = new Set(upstream.flatMap((l) => l.held));
		expect(canvasBuilds).toEqual(new Set(['4.43.0-43']));
	});
});

describe('reconcileNeighbourhoodHolds: a same-tier promotion link (not a chain predecessor) still reconciles', () => {
	it('a non-chain promotion link whose builds have not reached here still reads clear (sequencing, not a hold)', () => {
		const sibling: NeighbourLink = {
			...stagingLink,
			key: 'promotion:focus:prod-eu-central',
			node: node('checkout-api', 'prod-eu-central'),
			chainPredecessor: false
		};
		const { upstream, holding } = reconcileNeighbourhoodHolds([sibling], breakdown, { heldHere: () => false });
		expect(upstream[0]).toMatchObject({ state: 'clear', held: [] });
		expect(holding).toBe(0);
	});
	it('a sibling order gate the breakdown names IS reconciled to blocked', () => {
		const sibling: NeighbourLink = {
			...stagingLink,
			key: 'promotion:focus:prod-eu-central',
			node: node('checkout-api', 'prod-eu-central'),
			chainPredecessor: false
		};
		const { upstream, holding } = reconcileNeighbourhoodHolds([sibling], breakdown);
		expect(upstream[0].state).toBe('blocked');
		expect(upstream[0].held).toEqual(['4.45.0-45', '4.44.0-44']);
		expect(holding).toBe(1);
	});
});

describe('reconcileNeighbourhoodHolds: a link the breakdown does not name keeps its own state', () => {
	it('an upstream link for a gate/provider absent from the breakdown is untouched', () => {
		const other: NeighbourLink = {
			...stagingLink,
			key: 'promotion:focus:dev',
			gate: 'promotion-dev',
			state: 'clear',
			held: [],
			chainPredecessor: false
		};
		const { upstream } = reconcileNeighbourhoodHolds([other], { held: [] });
		expect(upstream[0].state).toBe('clear');
		expect(upstream[0].held).toEqual([]);
	});
});
