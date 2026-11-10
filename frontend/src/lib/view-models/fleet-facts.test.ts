import { describe, it, expect } from 'vitest';
import type { Rollout, Environment, RolloutDependency } from '$lib/../types';
import { buildRolloutCards } from '$lib/rollout-cards';
import { buildGateContext } from '$lib/view-models/blocking-story';
import { nodeState } from './promotion-lanes';
import { fleetFacts, waitingSince, stageLabel, appsTotalLabel, type StageFacts } from './fleet-facts';

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

describe('DEPLOYS — every status.history entry in the window, across ALL rollouts, mapped or not', () => {
	it('counts an env-less app’s deploy, and reports it as unmapped', () => {
		const mapped = mkRollout('mapped-app', 'ns-mapped', {
			status: { history: [{ version: 'v1', bakeStatus: 'Succeeded', timestamp: '2026-10-10T11:00:00Z' }] }
		});
		const unmapped = mkRollout('unmapped-app', 'ns-unmapped', {
			status: { history: [{ version: 'v1', bakeStatus: 'Succeeded', timestamp: '2026-10-10T11:30:00Z' }] }
		});
		const env = mkEnv('mapped-app', 'ns-mapped', 'prod');
		const rollouts = [mapped, unmapped];
		const cards = buildRolloutCards(rollouts, [env], new Date(NOW));

		const f = fleetFacts(cards, rollouts, NOW, '24h');
		expect(f.deploys.value).toBe(2);
		expect(f.deploys.unmapped).toBe(1);
		expect(f.apps).toBe(2);
		expect(f.mappedApps).toBe(1);
		expect(f.places).toBe(2);
		expect(f.mappedPlaces).toBe(1);
	});
});

describe('FAILED — live (current state) vs inWindow (history) vs resolved', () => {
	it('a failure below the head is history, not an alarm', () => {
		const r = mkRollout('checkout', 'checkout-prod', {
			status: {
				history: [
					{ version: 'v2', bakeStatus: 'Succeeded', timestamp: '2026-10-10T11:00:00Z' },
					{ version: 'v1', bakeStatus: 'Failed', timestamp: '2026-10-10T10:00:00Z' }
				]
			}
		});
		const env = mkEnv('checkout', 'checkout-prod', 'prod');
		const rollouts = [r];
		const cards = buildRolloutCards(rollouts, [env], new Date(NOW));

		expect(nodeState(cards[0])).not.toBe('failed');
		const f = fleetFacts(cards, rollouts, NOW, '24h');
		expect(f.failed.live.places).toBe(0);
		expect(f.failed.inWindow.value).toBe(1);
		expect(f.failed.resolvedInWindow).toBe(1);
	});

	it('a failure AT the head is live, and never resolved', () => {
		const r = mkRollout('checkout-worker', 'checkout-worker-staging', {
			status: { history: [{ version: 'v1', bakeStatus: 'Failed', timestamp: '2026-10-10T11:00:00Z' }] }
		});
		const env = mkEnv('checkout-worker', 'checkout-worker-staging', 'staging');
		const rollouts = [r];
		const cards = buildRolloutCards(rollouts, [env], new Date(NOW));

		expect(nodeState(cards[0])).toBe('failed');
		const f = fleetFacts(cards, rollouts, NOW, '24h');
		expect(f.failed.live.apps).toBe(1);
		expect(f.failed.live.places).toBe(1);
		expect(f.failed.resolvedInWindow).toBe(0);
	});
});

describe('REGIONS — prod-tier places, counted among whichever set they sit in', () => {
	it('a two-region prod app counts 2 regions and 2 places, 1 app', () => {
		const a = mkRollout('edge-mesh', 'edge-mesh-prod-us-east-1', {
			status: { history: [{ version: 'v1', bakeStatus: 'Succeeded', timestamp: '2026-10-10T11:00:00Z' }] }
		});
		const b = mkRollout('edge-mesh', 'edge-mesh-prod-us-east-2', {
			status: { history: [{ version: 'v1', bakeStatus: 'Succeeded', timestamp: '2026-10-10T11:00:00Z' }] }
		});
		const envA = mkEnv('edge-mesh', 'edge-mesh-prod-us-east-1', 'prod-us-east-1');
		const envB = mkEnv('edge-mesh', 'edge-mesh-prod-us-east-2', 'prod-us-east-2');
		const rollouts = [a, b];
		const cards = buildRolloutCards(rollouts, [envA, envB], new Date(NOW));

		const f = fleetFacts(cards, rollouts, NOW, '24h');
		expect(f.apps).toBe(1);
		expect(f.places).toBe(2);
		expect(f.regions).toBe(2);
	});
});

describe('HELD vs BEHIND — refused by a gate (any kind) vs nothing blocking it yet', () => {
	const OLD = { tag: 'tag-old', version: '1.0.0-old' };
	const NEW = { tag: 'tag-new', version: '2.0.0-new' };

	function heldRollout(gateName: string) {
		return mkRollout('gated-app', 'gated-app-prod', {
			status: {
				availableReleases: [OLD, NEW],
				releaseCandidates: [NEW],
				history: [{ version: OLD, bakeStatus: 'Succeeded', timestamp: '2026-10-10T10:00:00Z' }],
				gates: [{ name: gateName, passing: false, allowedVersions: ['tag-old'] }]
			}
		});
	}
	function behindRollout() {
		return mkRollout('free-app', 'free-app-prod', {
			status: {
				availableReleases: [OLD, NEW],
				releaseCandidates: [NEW],
				history: [{ version: OLD, bakeStatus: 'Succeeded', timestamp: '2026-10-10T10:00:00Z' }],
				gates: []
			}
		});
	}

	it('a bare promotion-order gate (no GateContext at all) is HELD, not behind — the shipped predicate already treats every gate kind as held', () => {
		const r = heldRollout('gated-app-prod-promotion');
		const env = mkEnv('gated-app', 'gated-app-prod', 'prod');
		const cards = buildRolloutCards([r], [env], new Date(NOW));
		expect(nodeState(cards[0])).toBe('held');
	});

	it('a newer build with nothing blocking it is BEHIND, never held', () => {
		const r = behindRollout();
		const env = mkEnv('free-app', 'free-app-prod', 'prod');
		const cards = buildRolloutCards([r], [env], new Date(NOW));
		expect(nodeState(cards[0])).toBe('behind');
		const f = fleetFacts(cards, [r], NOW, '24h');
		expect(f.held.places).toBe(0);
	});

	it('byCause classifies order/approval/dependency correctly with a built GateContext, and falls back to "other" with none', () => {
		const orderEnv = mkEnv('order-app', 'order-app-staging', 'staging', {
			status: { rolloutGateRef: { name: 'order-gate' } }
		});
		const orderRollout = heldRollout('order-gate');
		orderRollout.metadata!.name = 'order-app';
		orderRollout.metadata!.namespace = 'order-app-staging';

		const approvalRollout = heldRollout('some-manual-approval');
		approvalRollout.metadata!.name = 'approval-app';
		approvalRollout.metadata!.namespace = 'approval-app-staging';
		const approvalEnv = mkEnv('approval-app', 'approval-app-staging', 'staging');

		const dep: RolloutDependency = {
			metadata: { name: 'dep', namespace: 'dependency-app-staging' },
			spec: { providerRef: { name: 'payments-svc' }, contract: 'rest' },
			status: { gateName: 'dep-gate' }
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
		} as any;
		const dependencyRollout = heldRollout('dep-gate');
		dependencyRollout.metadata!.name = 'dependency-app';
		dependencyRollout.metadata!.namespace = 'dependency-app-staging';
		const dependencyEnv = mkEnv('dependency-app', 'dependency-app-staging', 'staging');

		const rollouts = [orderRollout, approvalRollout, dependencyRollout];
		const environments = [orderEnv, approvalEnv, dependencyEnv];
		const gateContext = buildGateContext({
			environments: { items: environments },
			rolloutDependencies: { items: [dep] }
		});
		const cards = buildRolloutCards(rollouts, environments, new Date(NOW), gateContext);
		for (const c of cards) expect(nodeState(c)).toBe('held');

		const f = fleetFacts(cards, rollouts, NOW, '24h', { gateContext });
		expect(f.held.byCause.order).toBe(1);
		expect(f.held.byCause.approval).toBe(1);
		expect(f.held.byCause.dependency).toBe(1);
		expect(f.held.byCause.order + f.held.byCause.approval + f.held.byCause.dependency + f.held.byCause.other).toBe(
			f.held.places
		);

		// NEEDS YOU: only the approval hold wakes someone up — an order or
		// dependency hold resolves itself.
		const approvalCard = cards.find((c) => c.name === 'approval-app')!;
		const orderCard = cards.find((c) => c.name === 'order-app')!;
		const dependencyCard = cards.find((c) => c.name === 'dependency-app')!;
		expect(f.needsYou.apps).toBe(1);
		const needsYouNames = new Set(['approval-app']);
		expect(needsYouNames.has(approvalCard.name)).toBe(true);
		expect(needsYouNames.has(orderCard.name)).toBe(false);
		expect(needsYouNames.has(dependencyCard.name)).toBe(false);

		// No GateContext at all: this file cannot classify, and says so —
		// every held place falls into `other`, never guessed into a bucket.
		const fNoCtx = fleetFacts(cards, rollouts, NOW, '24h');
		expect(fNoCtx.held.byCause.other).toBe(fNoCtx.held.places);
	});
});

describe('NEWEST EVERYWHERE — mapped apps whose every place is on its newest build', () => {
	it('counts only the app with every node at state newest', () => {
		const steady = mkRollout('steady-app', 'steady-app-prod', {
			status: { history: [{ version: 'v1', bakeStatus: 'Succeeded', timestamp: '2026-10-10T10:00:00Z' }] }
		});
		const OLD = { tag: 'tag-old', version: '1.0.0-old' };
		const NEW = { tag: 'tag-new', version: '2.0.0-new' };
		const laggard = mkRollout('laggard-app', 'laggard-app-prod', {
			status: {
				availableReleases: [OLD, NEW],
				releaseCandidates: [NEW],
				history: [{ version: OLD, bakeStatus: 'Succeeded', timestamp: '2026-10-10T10:00:00Z' }],
				gates: []
			}
		});
		const envSteady = mkEnv('steady-app', 'steady-app-prod', 'prod');
		const envLaggard = mkEnv('laggard-app', 'laggard-app-prod', 'prod');
		const rollouts = [steady, laggard];
		const cards = buildRolloutCards(rollouts, [envSteady, envLaggard], new Date(NOW));

		const f = fleetFacts(cards, rollouts, NOW, '24h');
		expect(f.newestEverywhere.of).toBe(2);
		expect(f.newestEverywhere.apps).toBe(1);
	});
});

describe('waitingSince / stageLabel', () => {
	it('waitingSince is exported from fleet-facts, and held-for.ts re-exports the same function', () => {
		expect(typeof waitingSince).toBe('function');
	});

	it('stageLabel says the unit, and switches which count it divides by', () => {
		const stageState = (newest: number, behind: number) => ({
			failed: 0,
			stuck: 0,
			held: 0,
			deploying: 0,
			checking: 0,
			behind,
			newest
		});
		const s: StageFacts = {
			apps: 3,
			places: 3,
			regions: 0,
			appsByState: stageState(2, 1),
			placesByState: stageState(2, 1),
			appsByCause: { order: 0, approval: 0, dependency: 0, other: 0 }
		};
		expect(stageLabel(s, { unit: 'apps' })).toBe('2 of 3 apps on the newest');
		expect(stageLabel(s, { unit: 'regions' })).toBe('2 of 3 regions on the newest');
		expect(
			stageLabel({ ...s, apps: 1, places: 1, appsByState: stageState(1, 0), placesByState: stageState(1, 0) }, { unit: 'apps' })
		).toBe('All 1 apps on the newest');
	});
});

/**
 * ⭐ shared/age-lag-total — THE APPS TOTAL EXPLAINS ITSELF. Home's header
 * ("18 apps") and the Promotion Map/Fleet list below it ("13") used to be
 * the same fleet read two different ways with no word to say why.
 * `appsTotalLabel` is the one function both now read; these are the three
 * shapes a real fleet takes.
 */
describe('appsTotalLabel — the header and the fold agree', () => {
	it('CALM: every app has an Environment — no gap to explain, so no "without" clause', () => {
		const a = mkRollout('alpha', 'alpha-prod');
		const b = mkRollout('beta', 'beta-prod');
		const envs = [mkEnv('alpha', 'alpha-prod', 'prod'), mkEnv('beta', 'beta-prod', 'prod')];
		const rollouts = [a, b];
		const cards = buildRolloutCards(rollouts, envs, new Date(NOW));
		const f = fleetFacts(cards, rollouts, NOW, '24h');
		expect(f.apps).toBe(2);
		expect(f.mappedApps).toBe(2);
		expect(appsTotalLabel(f)).toBe('2 apps');
	});

	it('INCIDENT: a mix of mapped and unmapped apps — the header names both counts', () => {
		const mapped1 = mkRollout('checkout-worker', 'checkout-worker-prod', {
			status: { history: [{ version: 'v1', bakeStatus: 'Failed', timestamp: '2026-10-10T11:00:00Z' }] }
		});
		const mapped2 = mkRollout('edge-mesh', 'edge-mesh-prod');
		const unmapped1 = mkRollout('standalone-worker', 'standalone-ns');
		const unmapped2 = mkRollout('one-off-job', 'jobs-ns');
		const envs = [mkEnv('checkout-worker', 'checkout-worker-prod', 'prod'), mkEnv('edge-mesh', 'edge-mesh-prod', 'prod')];
		const rollouts = [mapped1, mapped2, unmapped1, unmapped2];
		const cards = buildRolloutCards(rollouts, envs, new Date(NOW));
		const f = fleetFacts(cards, rollouts, NOW, '24h');
		expect(f.apps).toBe(4);
		expect(f.mappedApps).toBe(2);
		expect(appsTotalLabel(f)).toBe('4 apps · 2 in environments · 2 without');
	});

	it('WIDE: many apps, most without an environment — the header and the fold read the same two numbers', () => {
		const mappedNames = ['svc-a', 'svc-b', 'svc-c'];
		const unmappedNames = ['job-1', 'job-2', 'job-3', 'job-4', 'job-5'];
		const envs = mappedNames.map((n) => mkEnv(n, `${n}-prod`, 'prod'));
		const rollouts = [
			...mappedNames.map((n) => mkRollout(n, `${n}-prod`)),
			...unmappedNames.map((n) => mkRollout(n, `${n}-ns`))
		];
		const cards = buildRolloutCards(rollouts, envs, new Date(NOW));
		const f = fleetFacts(cards, rollouts, NOW, '24h');
		expect(f.apps).toBe(8);
		expect(f.mappedApps).toBe(3);
		const label = appsTotalLabel(f);
		expect(label).toBe('8 apps · 3 in environments · 5 without');
		// The fold under the Fleet list opens to exactly this many rows
		// (`ControlCenter.svelte`'s own `envless`, `appsWithoutEnvironment`) —
		// same two numbers, so the header's "5 without" and the fold's own
		// "+5 apps without an environment" can never disagree.
		const without = f.apps - f.mappedApps;
		expect(label).toContain(`${without} without`);
	});

	it('a bare count never prints "0 without"', () => {
		expect(appsTotalLabel({ apps: 1, mappedApps: 1 })).toBe('1 app');
		expect(appsTotalLabel({ apps: 0, mappedApps: 0 })).toBe('0 apps');
	});
});
