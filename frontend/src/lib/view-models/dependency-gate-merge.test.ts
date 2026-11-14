/**
 * A dependency's RolloutGate and its contract hold are ONE cause.
 *
 * On a live cluster every dependency CONSUMER carries the dependency's
 * RolloutGate in status.gates (owner reference kind RolloutDependency) beside
 * the RolloutDependency the graph turns into a contract hold. These pin the
 * three places that listed it twice, with a minimal controller-faithful input
 * (never the Home fixture): the Gates lead sentence, the neighbourhood's
 * "Holding N here" count, and the Overview's per-build row decision.
 */
import { describe, expect, it } from 'vitest';
import {
	buildGateContext,
	blockingStory,
	promotionHoldBreakdown,
	isDependencyGateCoveredBy,
	type ContractHolds
} from './blocking-story';
import { dependencyOnlyHold, providerScopeCounts } from './dependency-hold';
import { composeHeldLeadSentence, heldVerdictForBuild } from './held';
import { reconcileNeighbourhoodHolds, type NeighbourLink } from './rollout-neighbourhood';
import type { Environment, Rollout, RolloutDependency, RolloutGate } from '../../types';

const NS = 'prod';
const GATE = 'depends-on-payments';

const depGate = {
	metadata: {
		name: GATE,
		namespace: NS,
		ownerReferences: [{ kind: 'RolloutDependency', name: 'needs-payments', controller: true }]
	}
} as unknown as RolloutGate;

const dependency = {
	metadata: { name: 'needs-payments', namespace: NS },
	spec: { providerRef: { name: 'payments-svc' }, contract: 'payments' },
	status: {
		gateName: GATE,
		providedVersion: '2.4.1',
		blockedReleases: [{ requiredVersion: '~2.9.0' }]
	}
} as unknown as RolloutDependency;

// b-43 passed the earlier stage and is refused here; b-44 has not reached
// this environment (it also waits on the promotion gate `after-staging`).
const rollout = {
	metadata: { name: 'checkout-api', namespace: NS },
	status: {
		history: [{ version: { tag: 'b-42', version: '4.42.0-42' } }],
		availableReleases: [
			{ tag: 'b-42', version: '4.42.0-42' },
			{ tag: 'b-43', version: '4.43.0-43' },
			{ tag: 'b-44', version: '4.44.0-44' }
		],
		releaseCandidates: [
			{ tag: 'b-44', version: '4.44.0-44' },
			{ tag: 'b-43', version: '4.43.0-43' }
		],
		gates: [
			{ name: GATE, passing: false, allowedVersions: ['b-42'] },
			{ name: 'after-staging', passing: false, allowedVersions: ['b-42', 'b-43'] }
		]
	}
} as unknown as Rollout;

const contract = { provider: 'payments-svc', required: '~2.9.0', has: '2.4.1', gate: GATE };
const contractHolds: ContractHolds = new Map([
	['4.43.0-43', [contract]],
	['4.44.0-44', [contract]]
]);

function ctx(withDependency: boolean) {
	return buildGateContext({
		environments: {
			items: [
				{
					metadata: { namespace: NS + '-staging', name: 'prod' },
					spec: { environment: 'staging' },
					status: {}
				},
				{
					metadata: { namespace: NS, name: 'prod' },
					spec: { environment: 'prod' },
					status: { rolloutGateRef: { name: 'after-staging' } }
				}
			]
		} as unknown as { items: Environment[] },
		rolloutDependencies: withDependency ? { items: [dependency] } : { items: [] },
		rolloutGates: { items: [depGate] }
	});
}

describe('1. the Gates lead sentence names the dependency once', () => {
	for (const joined of [true, false]) {
		it(`gate + contract read as the contract alone (dependency join ${joined ? 'present' : 'absent'})`, () => {
			const bd = promotionHoldBreakdown(rollout, ctx(joined), { contractHolds });
			const b43 = bd.held.find((h) => h.build === '4.43.0-43')!;
			expect(b43.clauses).toEqual([]);
			const { headline } = composeHeldLeadSentence([b43], []);
			expect(headline).toBe('4.43.0-43 is held by payments-svc until it ships ~2.9.0 (has 2.4.1)');
			expect(headline).not.toMatch(/ and by /);
		});
	}
	it('the build lists one classified cause, not the gate and the contract', () => {
		const bd = promotionHoldBreakdown(rollout, ctx(false), { contractHolds });
		const b43 = bd.held.find((h) => h.build === '4.43.0-43')!;
		expect(b43.classifiedGates.filter((g) => g.kind === 'dependency')).toHaveLength(1);
	});
	it('the whole-rollout story counts the dependency as one rule', () => {
		for (const joined of [true, false]) {
			const story = blockingStory(rollout, ctx(joined), { contractHolds });
			expect(story.upstream.filter((g) => g.kind === 'dependency')).toHaveLength(1);
		}
	});
	it('a dependency gate with no contract in hand still reads as the dependency, alone', () => {
		const bd = promotionHoldBreakdown(rollout, ctx(true));
		const b43 = bd.held.find((h) => h.build === '4.43.0-43')!;
		expect(b43.classifiedGates[0]).toMatchObject({ kind: 'dependency', subject: 'payments-svc' });
	});
	it('isDependencyGateCoveredBy: matches the dependency\'s own gate, never "any contract"', () => {
		const named = { kind: 'dependency', subject: 'auth' } as const;
		expect(isDependencyGateCoveredBy(named, [contract])).toBe(false);
		expect(
			isDependencyGateCoveredBy({ kind: 'check', id: GATE, subject: 'payments-svc' }, [contract])
		).toBe(false);
		// same gate: covered, joined or nameless
		expect(isDependencyGateCoveredBy({ kind: 'dependency', id: GATE }, [contract])).toBe(true);
		// a nameless dependency gate of ANOTHER dependency is not swallowed
		expect(
			isDependencyGateCoveredBy({ kind: 'dependency', id: 'depends-on-auth' }, [contract])
		).toBe(false);
		expect(isDependencyGateCoveredBy({ kind: 'dependency', id: GATE }, [])).toBe(false);
		// a joined gate falls back to its provider
		expect(
			isDependencyGateCoveredBy({ kind: 'dependency', id: 'x', subject: 'payments-svc' }, [
				{ provider: 'payments-svc' }
			])
		).toBe(true);
	});
	it('a nameless dependency gate of another dependency still counts beside an unrelated contract', () => {
		const other = {
			metadata: {
				name: 'depends-on-auth',
				namespace: NS,
				ownerReferences: [{ kind: 'RolloutDependency', name: 'needs-auth', controller: true }]
			}
		} as unknown as RolloutGate;
		const r = {
			...rollout,
			status: {
				...rollout.status,
				gates: [{ name: 'depends-on-auth', passing: false, allowedVersions: ['b-42'] }]
			}
		} as unknown as Rollout;
		const c = buildGateContext({
			rolloutGates: { items: [other] },
			rolloutDependencies: { items: [] }
		});
		const story = blockingStory(r, c, { contractHolds });
		expect(
			story.upstream
				.filter((g) => g.kind === 'dependency')
				.map((g) => g.id)
				.sort()
		).toEqual(['contract:payments-svc', 'depends-on-auth']);
	});
});

describe('2. "Holding N here" counts builds refused HERE only', () => {
	const bd = promotionHoldBreakdown(rollout, ctx(true), { contractHolds });
	const link = {
		key: 'contract:payments-svc',
		side: 'upstream',
		writer: 'contract',
		state: 'blocked',
		node: { name: 'payments-svc', env: 'prod' },
		held: ['4.44.0-44', '4.43.0-43'],
		contract: 'payments',
		requiredVersion: '~2.9.0',
		providedVersion: '2.4.1',
		cyclic: false,
		gate: GATE,
		chainPredecessor: false
	} as unknown as NeighbourLink;
	const hereHeld = (h: { build: string; gateNames: readonly string[] }) =>
		heldVerdictForBuild(bd.held.find((x) => x.build === h.build)!, 'prod').held;

	it('without the predicate every named build counts (old behaviour)', () => {
		expect(reconcileNeighbourhoodHolds([link], bd).upstream[0].held).toHaveLength(2);
	});
	it('with it, only the build refused here counts', () => {
		const r = reconcileNeighbourhoodHolds([link], bd, { heldHere: hereHeld });
		expect(r.upstream[0].held).toEqual(['4.43.0-43']);
		expect(r.holding).toBe(1);
	});
	it('a contract link whose only refused builds have not reached here stays blocked: the dependency refuses them regardless of position', () => {
		const only44 = { ...bd, held: bd.held.filter((h) => h.build === '4.44.0-44') };
		const r = reconcileNeighbourhoodHolds([link], only44, { heldHere: () => false });
		expect(r.upstream[0]).toMatchObject({ state: 'blocked', held: ['4.44.0-44'] });
		expect(r.holding).toBe(1);
	});
});

describe('3. the Overview row decision reads every edge holding the build', () => {
	const gate = { id: GATE, kind: 'dependency' as const, subject: null };
	it("is true when the dependency's own gate is the only cause", () => {
		expect(dependencyOnlyHold([gate], [contract])).toBe(true);
	});
	it('is true when a second edge holds the build too and the first is not this gate', () => {
		const auth = { provider: 'auth', gate: 'depends-on-auth' };
		expect(dependencyOnlyHold([gate], [auth, contract])).toBe(true);
	});
	it('is false when another kind of gate also refuses the build', () => {
		expect(
			dependencyOnlyHold(
				[gate, { id: 'after-staging', kind: 'promotion', subject: null }],
				[contract]
			)
		).toBe(false);
	});
	it('is false with no gate or no hold', () => {
		expect(dependencyOnlyHold([], [contract])).toBe(false);
		expect(dependencyOnlyHold([gate], [])).toBe(false);
	});
});

describe('1. the Waiting-on card counts builds refused here, not queued here', () => {
	const bd = promotionHoldBreakdown(rollout, ctx(true), { contractHolds });
	const hereHeld = bd.held.filter((h) => heldVerdictForBuild(h, 'prod').held);
	const blocks = [
		{
			providerName: 'payments-svc',
			blocked: [
				{ display: '4.43.0-43', envs: ['prod'] },
				{ display: '4.44.0-44', envs: ['prod', 'staging'] },
				{ display: '4.45.0-45', envs: ['staging'] }
			]
		}
	];
	it('here is the one build refused here; the queued one is neither here nor elsewhere', () => {
		expect(providerScopeCounts(blocks, hereHeld, 'prod').get('payments-svc')).toEqual({
			here: 1,
			elsewhere: 1
		});
	});
	it('with nothing refused here the card says none here (agrees with the header)', () => {
		expect(providerScopeCounts(blocks, [], 'prod').get('payments-svc')).toEqual({
			here: 0,
			elsewhere: 1
		});
	});
});
