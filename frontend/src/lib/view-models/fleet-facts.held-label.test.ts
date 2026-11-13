import { isBypassRollout } from '$lib/demo/bypass-demo';
import { describe, it, expect, afterEach } from 'vitest';
import type { Environment, Rollout, RolloutDependency } from '../../types';
import { buildRolloutCards } from '$lib/rollout-cards';
import { buildGateContext } from '$lib/view-models/blocking-story';
import { buildRolloutGraph, contractHoldsForRollout } from '$lib/view-models/dependency-graph';
import { fleetFacts, heldLabel } from './fleet-facts';
import { formatDurationMs } from '$lib/utils';
import { respond } from '../demo/respond';
import { resetDemoState } from '../demo/state';

/**
 * ⭐ shared/held-label (2026-10-11). `heldLabel` reads as a SENTENCE: one
 * rule-held app names itself, its stage and its cause; several read as a
 * count; an approval-only hold is never "held" at all (that is "waits for
 * you", elsewhere). No label here may say "place" or "the map".
 */

const NOW = new Date('2026-10-10T12:00:00Z').getTime();

const mkRollout = (name: string, namespace: string, overrides: Record<string, unknown> = {}): Rollout =>
	({
		metadata: { name, namespace },
		spec: {},
		status: { history: [] },
		...overrides
	}) as unknown as Rollout;

const mkEnv = (name: string, namespace: string, tier: string, overrides: Record<string, unknown> = {}): Environment =>
	({
		metadata: { name, namespace },
		spec: { environment: tier, name, rolloutRef: { name } },
		...overrides
	}) as unknown as Environment;

const OLD = { tag: 'tag-old', version: '1.0.0-old' };
const NEW = { tag: 'tag-new', version: '2.0.0-new' };

function heldRolloutWithGate(name: string, namespace: string, gateName: string): Rollout {
	return mkRollout(name, namespace, {
		status: {
			availableReleases: [OLD, NEW],
			releaseCandidates: [NEW],
			history: [{ version: OLD, bakeStatus: 'Succeeded', timestamp: '2026-10-10T10:00:00Z' }],
			gates: [{ name: gateName, passing: false, allowedVersions: ['tag-old'] }]
		}
	});
}

describe('heldLabel — one app held by a rule', () => {
	it('names the app, its stage and its cause, never "place" or "the map"', () => {
		const orderEnv = mkEnv('order-app', 'order-app-staging', 'staging', {
			status: { rolloutGateRef: { name: 'order-gate' } }
		});
		const orderRollout = heldRolloutWithGate('order-app', 'order-app-staging', 'order-gate');
		const gateContext = buildGateContext({ environments: { items: [orderEnv] } });
		const cards = buildRolloutCards([orderRollout], [orderEnv], new Date(NOW), gateContext);

		const f = fleetFacts(cards, [orderRollout], NOW, '24h', { gateContext });
		expect(f.held.ruleApps).toBe(1);
		expect(f.held.ruleSingle?.app).toBe('order-app');
		const label = heldLabel(f);
		expect(label).toBe(`order-app held in ${f.held.ruleSingle?.env} · waits on ${f.held.ruleSingle?.causeLabel}`);
		expect(label).not.toMatch(/place/i);
		expect(label).not.toMatch(/the map/i);
	});

	it('one app held by a dependency contract: the cause names the provider, reused from held.ts verbatim', () => {
		const dep: RolloutDependency = {
			metadata: { name: 'dep', namespace: 'dependency-app-staging' },
			spec: { providerRef: { name: 'payments-svc' }, contract: 'rest' },
			status: { gateName: 'dep-gate' }
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
		} as any;
		const dependencyEnv = mkEnv('dependency-app', 'dependency-app-staging', 'staging');
		const dependencyRollout = heldRolloutWithGate('dependency-app', 'dependency-app-staging', 'dep-gate');
		const gateContext = buildGateContext({
			environments: { items: [dependencyEnv] },
			rolloutDependencies: { items: [dep] }
		});
		const cards = buildRolloutCards([dependencyRollout], [dependencyEnv], new Date(NOW), gateContext);
		const f = fleetFacts(cards, [dependencyRollout], NOW, '24h', { gateContext });
		expect(f.held.ruleApps).toBe(1);
		const label = heldLabel(f);
		expect(label).toBe('dependency-app held in staging · waits on payments-svc');
		expect(label).not.toMatch(/place/i);
	});

	it('held across one prod region only names that region', () => {
		const env = mkEnv('edge-mesh', 'edge-mesh-prod-us-east-1', 'prod-us-east-1');
		const rollout = heldRolloutWithGate('edge-mesh', 'edge-mesh-prod-us-east-1', 'order-gate');
		const gateContext = buildGateContext({ environments: { items: [env] } });
		const cards = buildRolloutCards([rollout], [env], new Date(NOW), gateContext);
		const f = fleetFacts(cards, [rollout], NOW, '24h', { gateContext });
		expect(f.held.ruleApps).toBe(1);
		expect(f.held.ruleSingle?.env).toBe(cards[0].envDisplay || cards[0].envName);
		expect(heldLabel(f)).toMatch(/^edge-mesh held in /);
	});

	it('held across several prod regions at once names the tier, "prod", not a single region', () => {
		const envA = mkEnv('edge-mesh', 'edge-mesh-prod-us-east-1', 'prod-us-east-1');
		const envB = mkEnv('edge-mesh', 'edge-mesh-prod-us-east-2', 'prod-us-east-2');
		const rolloutA = heldRolloutWithGate('edge-mesh', 'edge-mesh-prod-us-east-1', 'order-gate');
		const rolloutB = heldRolloutWithGate('edge-mesh', 'edge-mesh-prod-us-east-2', 'order-gate');
		const gateContext = buildGateContext({ environments: { items: [envA, envB] } });
		const cards = buildRolloutCards([rolloutA, rolloutB], [envA, envB], new Date(NOW), gateContext);
		const f = fleetFacts(cards, [rolloutA, rolloutB], NOW, '24h', { gateContext });
		expect(f.held.ruleApps).toBe(1);
		expect(f.held.ruleSingle?.env).toBe('prod');
		expect(heldLabel(f)).toBe('edge-mesh held in prod · waits on a rule this dashboard cannot attribute');
	});

	/**
	 * ⭐ qa12 (squad-rollout gates-2 follow-up, 2026-10-11, tl-integrate
	 * ruling — the frontier rule's own knock-on). An app can now be held at
	 * MORE THAN ONE TIER AT ONCE — staging on its own local hold, AND a
	 * prod region on a SEPARATE, real local hold of its own (the exact
	 * live shape: `checkout-api` held in `staging`, `prod-us-east-2` AND
	 * `prod-ap-southeast-2`, verified against the real fixture in
	 * `held-predicate.test.ts`'s reference case 2). `ruleSingle.env` lists
	 * every held TIER, earliest first, each tier collapsed to its own
	 * region name when it holds only one (`staging`) or to the tier word
	 * when it holds several (`prod`, from the existing single-tier rule
	 * above) — joined "staging and prod", never every region named
	 * individually.
	 */
	it('held at staging AND across several prod regions at once names "staging and prod"', () => {
		const stagingEnv = mkEnv('edge-mesh', 'edge-mesh-staging', 'staging');
		const prodEnvA = mkEnv('edge-mesh', 'edge-mesh-prod-us-east-1', 'prod-us-east-1');
		const prodEnvB = mkEnv('edge-mesh', 'edge-mesh-prod-us-east-2', 'prod-us-east-2');
		const stagingRollout = heldRolloutWithGate('edge-mesh', 'edge-mesh-staging', 'order-gate');
		const prodRolloutA = heldRolloutWithGate('edge-mesh', 'edge-mesh-prod-us-east-1', 'order-gate');
		const prodRolloutB = heldRolloutWithGate('edge-mesh', 'edge-mesh-prod-us-east-2', 'order-gate');
		const environments = [stagingEnv, prodEnvA, prodEnvB];
		const rollouts = [stagingRollout, prodRolloutA, prodRolloutB];
		const gateContext = buildGateContext({ environments: { items: environments } });
		const cards = buildRolloutCards(rollouts, environments, new Date(NOW), gateContext);
		const f = fleetFacts(cards, rollouts, NOW, '24h', { gateContext });
		expect(f.held.ruleApps).toBe(1);
		expect(f.held.ruleSingle?.env).toBe('staging and prod');
		expect(heldLabel(f)).toBe(
			'edge-mesh held in staging and prod · waits on a rule this dashboard cannot attribute'
		);
	});
});

describe('heldLabel — several apps held by a rule', () => {
	it('reads as a count, never "N apps held · N places"', () => {
		const orderEnv = mkEnv('order-app', 'order-app-staging', 'staging', {
			status: { rolloutGateRef: { name: 'order-gate' } }
		});
		const orderRollout = heldRolloutWithGate('order-app', 'order-app-staging', 'order-gate');

		const dep: RolloutDependency = {
			metadata: { name: 'dep', namespace: 'dependency-app-staging' },
			spec: { providerRef: { name: 'payments-svc' }, contract: 'rest' },
			status: { gateName: 'dep-gate' }
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
		} as any;
		const dependencyEnv = mkEnv('dependency-app', 'dependency-app-staging', 'staging');
		const dependencyRollout = heldRolloutWithGate('dependency-app', 'dependency-app-staging', 'dep-gate');

		const rollouts = [orderRollout, dependencyRollout];
		const environments = [orderEnv, dependencyEnv];
		const gateContext = buildGateContext({
			environments: { items: environments },
			rolloutDependencies: { items: [dep] }
		});
		const cards = buildRolloutCards(rollouts, environments, new Date(NOW), gateContext);
		const f = fleetFacts(cards, rollouts, NOW, '24h', { gateContext });

		expect(f.held.ruleApps).toBe(2);
		const label = heldLabel(f);
		expect(label).toBe('2 apps held by a rule');
		expect(label).not.toMatch(/place/i);
		expect(label).not.toMatch(/the map/i);
	});
});

describe('heldLabel — approvals are never folded in', () => {
	it('an approval-only hold returns an empty label', () => {
		const approvalEnv = mkEnv('approval-app', 'approval-app-staging', 'staging');
		const approvalRollout = heldRolloutWithGate('approval-app', 'approval-app-staging', 'some-manual-approval');
		const gateContext = buildGateContext({
			environments: { items: [approvalEnv] },
			rolloutDependencies: { items: [] }
		});
		const cards = buildRolloutCards([approvalRollout], [approvalEnv], new Date(NOW), gateContext);
		const f = fleetFacts(cards, [approvalRollout], NOW, '24h', { gateContext });

		expect(f.held.apps).toBe(1); // still a real held fact...
		expect(f.held.ruleApps).toBe(0); // ...but not a RULE hold.
		expect(heldLabel(f)).toBe('');
	});

	it('a mixed approval + rule hold on the same app counts as held by a rule, naming the rule-held place', () => {
		const approvalEnv = mkEnv('mixed-app', 'mixed-app-staging', 'staging');
		const approvalRollout = heldRolloutWithGate('mixed-app', 'mixed-app-staging', 'some-manual-approval');

		const dep: RolloutDependency = {
			metadata: { name: 'dep', namespace: 'mixed-app-prod' },
			spec: { providerRef: { name: 'payments-svc' }, contract: 'rest' },
			status: { gateName: 'dep-gate' }
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
		} as any;
		const prodEnv = mkEnv('mixed-app', 'mixed-app-prod', 'prod');
		const prodRollout = heldRolloutWithGate('mixed-app', 'mixed-app-prod', 'dep-gate');

		const rollouts = [approvalRollout, prodRollout];
		const environments = [approvalEnv, prodEnv];
		const gateContext = buildGateContext({
			environments: { items: environments },
			rolloutDependencies: { items: [dep] }
		});
		const cards = buildRolloutCards(rollouts, environments, new Date(NOW), gateContext);
		const f = fleetFacts(cards, rollouts, NOW, '24h', { gateContext });

		expect(f.held.ruleApps).toBe(1);
		expect(f.held.ruleSingle?.app).toBe('mixed-app');
		// The rule-held place is prod (the dependency hold), not staging
		// (the approval) — approvals never name the stage in this sentence.
		expect(f.held.ruleSingle?.env).toBe('prod');
		expect(heldLabel(f)).toBe('mixed-app held in prod · waits on payments-svc');
	});
});

describe('Home\'s held text on the demo fleet — calm, incident, wide', () => {
	afterEach(() => resetDemoState('calm'));

	type List = {
		rollouts: { items: Rollout[] };
		environments: { items: Environment[] };
		rolloutDependencies: { items: RolloutDependency[] };
	};

	// Computed, not assumed: all three scenarios' RULE holds are checkout-api
	// on payments-svc in staging (mapped) PLUS three apps with NO Environment
	// at all, each held on its own dependency contract — fulfillment-svc,
	// payments-svc and standalone-api (⭐ shared/fleet-facts-ids, 2026-10-11:
	// "apps WITHOUT an Environment held on a dependency contract are real
	// holds and COUNT"). Four rule-held apps reads as a count, never the
	// single-app sentence. A `wide`/`incident` approval hold on
	// telemetry-indexer sits alongside it but never speaks here — approvals
	// are "waits for you", not "held by a rule". The expected label's own
	// duration is read off `f.held.ruleLongestMs` through the same
	// `formatDurationMs` `heldLabel` itself calls, never a hardcoded string.
	const EXPECTED_UNMAPPED_RULE_APPS = ['fulfillment-svc', 'payments-svc', 'standalone-api'];

	for (const scenario of ['calm', 'incident', 'wide'] as const) {
		it(`${scenario}: heldLabel counts checkout-api + the three unmapped contract-held apps as held by a rule, and no label says "place" or "the map"`, () => {
			resetDemoState(scenario);
			const list = JSON.parse(respond('GET', '/api/rollouts').body ?? '{}') as List;
			// the skip-once demo fleet (bypass-demo.ts) is held by a schedule and an approval ON PURPOSE; this is about the story fleet
			const demo = (o: { metadata?: { namespace?: string; name?: string } }) => isBypassRollout(o.metadata?.namespace ?? '', o.metadata?.name ?? '');
			list.rollouts.items = list.rollouts.items.filter((r) => !demo(r));
			list.environments.items = list.environments.items.filter((e) => !demo(e));
			const rollouts = list.rollouts.items;
			const environments = list.environments.items;
			const gateContext = buildGateContext({
				environments: list.environments,
				rolloutDependencies: list.rolloutDependencies
			});
			const graph = buildRolloutGraph({
				rollouts,
				environments,
				dependencies: list.rolloutDependencies.items,
				envOrder: [],
				gates: gateContext
			});
			const now = new Date();
			const cards = buildRolloutCards(rollouts, environments, now, gateContext, (r) =>
				contractHoldsForRollout(graph, r)
			);
			const f = fleetFacts(cards, rollouts, now.getTime(), '7d', {
				gateContext,
				contractHoldsFor: (r) => contractHoldsForRollout(graph, r)
			});

			// `held.appIds` names checkout-api (mapped) plus exactly the three
			// unmapped contract-held apps squad-fleet2's report named for
			// `calm` (verified here, not assumed, for every scenario) — plus,
			// in `incident`/`wide` only, telemetry-indexer's approval hold,
			// which `held.appIds` counts (it IS a real hold) but `ruleApps`
			// never does (approvals are "waits for you", never a rule).
			expect(f.held.appIds).toEqual(
				[...new Set(['checkout-api', ...EXPECTED_UNMAPPED_RULE_APPS, ...f.held.approvalAppIds])].sort()
			);
			expect(f.held.ruleApps).toBe(1 + EXPECTED_UNMAPPED_RULE_APPS.length);
			expect(f.held.ruleSingle).toBeNull();

			const dur = f.held.ruleLongestMs != null ? formatDurationMs(f.held.ruleLongestMs) : null;
			const EXPECTED = `${f.held.ruleApps} apps held by a rule${dur ? ` · longest ${dur}` : ''}`;

			const label = heldLabel(f);
			expect(label).toBe(EXPECTED);
			expect(label).not.toMatch(/\bplace\b/i);
			expect(label).not.toMatch(/\bplaces\b/i);
			expect(label).not.toMatch(/the map/i);
		});
	}
});

describe('fleetFacts — a pinned app is held by a person, not a rule (crash regression)', () => {
	const pinnedRollout = (name: string, namespace: string) =>
		mkRollout(name, namespace, {
			spec: { wantedVersion: OLD.tag },
			status: {
				availableReleases: [OLD, NEW],
				releaseCandidates: [NEW],
				history: [{ version: OLD, bakeStatus: 'Succeeded', timestamp: '2026-10-10T10:00:00Z' }]
			}
		});

	it('mapped: one pinned app with a held node does not throw and is not rule-held', () => {
		const env = mkEnv('pin-app', 'pin-app-staging', 'staging');
		const r = pinnedRollout('pin-app', 'pin-app-staging');
		const gateContext = buildGateContext({ environments: { items: [env] } });
		const cards = buildRolloutCards([r], [env], new Date(NOW), gateContext);
		expect(cards[0].pinnedVersion).not.toBeNull();
		expect(cards[0].held).toBe(false);
		const f = fleetFacts(cards, [r], NOW, '24h', { gateContext });
		expect(f.held.ruleApps).toBe(0);
		expect(f.held.ruleSingle).toBeNull();
	});

	it('unmapped (no Environment): one pinned app does not throw and is not rule-held', () => {
		const r = pinnedRollout('pin-app', 'pin-app-ns');
		const cards = buildRolloutCards([r], [], new Date(NOW), buildGateContext({ environments: { items: [] } }));
		const f = fleetFacts(cards, [r], NOW, '24h', {});
		expect(f.held.ruleApps).toBe(0);
		expect(f.held.ruleSingle).toBeNull();
	});
});
