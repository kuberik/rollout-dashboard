/**
 * `offerableDeploy` — the two QA failures as cases (`ns-ca-staging-*.png`:
 * `/namespaces` offered a build held by a dependency contract; `app-ti-
 * 1440-light.png`: the app page offered a build to prod while its
 * immediate upstream was still checking it), plus the rest of the rule.
 *
 * The 'held' and 'deploying' cases, and the plain-sequencing 'gate' case,
 * are the REAL `checkout-api` demo fixture (calm scenario) built the same
 * way `held-predicate.test.ts` does — `respond()`/`buildRolloutCards()`,
 * never a hand-rolled rollout, so a fixture edit that changes checkout-api's
 * shape re-runs this exact assertion instead of a stale copy of it. The
 * 'upstream-running'/'upstream-failed' cases have no real fixture anywhere
 * in the demo (no app's own `waitsForEnv` peer happens to be mid-deploy or
 * failed at the same time) — those two are a minimal hand-built chain,
 * same convention `app-tasks.test.ts` uses for a case the demo cannot show.
 */
import { describe, expect, it } from 'vitest';
import { respond } from '$lib/demo/respond';
import { resetDemoState } from '$lib/demo/state';
import { buildRolloutCards } from '$lib/rollout-cards';
import type { RolloutCard } from '$lib/rollout-cards';
import { buildGateContext } from './blocking-story';
import { buildRolloutGraph, contractHoldsForRollout } from './dependency-graph';
import { offerableDeploy } from './offerable-deploy';
import type { Environment, Rollout, RolloutDependency } from '../../types';

type List = {
	rollouts: { items: Rollout[] };
	environments: { items: Environment[] };
	rolloutDependencies: { items: RolloutDependency[] };
};

function fleetCards(scenario: 'calm' | 'incident' | 'wide') {
	resetDemoState(scenario);
	const list = JSON.parse(respond('GET', '/api/rollouts').body ?? '{}') as List;
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
	return { cards, graph };
}

function cardsFor(cards: RolloutCard[], appName: string): Map<string, RolloutCard> {
	const byEnv = new Map<string, RolloutCard>();
	for (const c of cards) if (c.name === appName && c.envName) byEnv.set(c.envName, c);
	return byEnv;
}

describe('offerableDeploy — checkout-api (calm demo fixture)', () => {
	const { cards, graph } = fleetCards('calm');
	const byEnv = cardsFor(cards, 'checkout-api');

	it('held by a dependency contract (ns-ca-staging QA case) → null, reason "held"', () => {
		const staging = byEnv.get('staging')!;
		expect(staging.held).toBe(true);
		expect(staging.heldCause).toBe('dependency');
		const result = offerableDeploy(staging, { graph, peersByEnv: byEnv });
		expect(result).toEqual({ candidate: null, reason: 'held' });
	});

	it('a deploy already running in the target → null, reason "deploying"', () => {
		const east2 = byEnv.get('prod-us-east-2')!;
		expect(east2.isRunning).toBe(true);
		const result = offerableDeploy(east2, { graph, peersByEnv: byEnv });
		expect(result).toEqual({ candidate: null, reason: 'deploying' });
	});

	it('not reached yet, upstream settled and not running/failed → "gate", not a guessed running/failed state', () => {
		const euCentral = byEnv.get('prod-eu-central')!;
		expect(euCentral.waitsForEnv).toBe('staging');
		const peer = byEnv.get('staging')!;
		expect(peer.isRunning).toBe(false);
		expect(peer.statusKey).not.toBe('failed');
		const result = offerableDeploy(euCentral, { graph, peersByEnv: byEnv });
		expect(result).toEqual({ candidate: null, reason: 'gate' });
	});

	it('dev has nothing newer to offer → null, reason "none"', () => {
		const dev = byEnv.get('dev')!;
		expect(dev.waitsForEnv).toBeNull();
		expect(dev.held).toBe(false);
		const result = offerableDeploy(dev, { graph, peersByEnv: byEnv });
		expect(result).toEqual({ candidate: null, reason: 'none' });
	});

	it('an empty peersByEnv (peer unknown) reads "gate" rather than inventing a running/failed peer', () => {
		const euCentral = byEnv.get('prod-eu-central')!;
		const result = offerableDeploy(euCentral, { graph, peersByEnv: new Map() });
		expect(result).toEqual({ candidate: null, reason: 'gate' });
	});
});

// ── a minimal hand-built chain, for the two states the demo never shows ────

const NS_DEV = 'svc-app-dev';
const NS_STAGING = 'svc-app-staging';
const GATE = 'promotion-staging';

function chainEnvironments(): Environment[] {
	return [
		{
			metadata: { name: 'svc-app', namespace: NS_DEV },
			spec: { environment: 'dev', rolloutRef: { name: 'svc-app' } },
			status: { currentVersion: 'b-1' }
		},
		{
			metadata: { name: 'svc-app', namespace: NS_STAGING },
			spec: {
				environment: 'staging',
				rolloutRef: { name: 'svc-app' }
			},
			status: { currentVersion: 'b-1', rolloutGateRef: { name: GATE } }
		}
	] as unknown as Environment[];
}

/** `dev`'s own rollout — only `bakeStatus` varies between the two cases. */
function devRollout(bakeStatus: 'InProgress' | 'Failed'): Rollout {
	return {
		metadata: { name: 'svc-app', namespace: NS_DEV },
		spec: {},
		status: {
			history: [{ version: { tag: 'b-1', version: '1.0.0-1' }, bakeStatus }],
			availableReleases: [{ tag: 'b-1', version: '1.0.0-1' }],
			gates: []
		}
	} as unknown as Rollout;
}

/** `staging` — one candidate (`b-2`) waiting, refused by its own promotion
 *  gate because the tier order names `dev` as earlier in the chain
 *  (`held.ts`'s chain-sequencing branch — `waitsForEnv`, not `held`). */
function stagingRollout(): Rollout {
	return {
		metadata: { name: 'svc-app', namespace: NS_STAGING },
		spec: {},
		status: {
			history: [{ version: { tag: 'b-1', version: '1.0.0-1' }, bakeStatus: 'Succeeded' }],
			availableReleases: [
				{ tag: 'b-1', version: '1.0.0-1' },
				{ tag: 'b-2', version: '1.0.0-2' }
			],
			gates: [{ name: GATE, passing: false }]
		}
	} as unknown as Rollout;
}

function buildChainCards(devBake: 'InProgress' | 'Failed') {
	const environments = chainEnvironments();
	const rollouts = [devRollout(devBake), stagingRollout()];
	const gateContext = buildGateContext({ environments: { items: environments } });
	const graph = buildRolloutGraph({ rollouts, environments, dependencies: [], envOrder: [], gates: gateContext });
	const now = new Date();
	const cards = buildRolloutCards(rollouts, environments, now, gateContext, (r) =>
		contractHoldsForRollout(graph, r)
	);
	return { byEnv: cardsFor(cards, 'svc-app'), graph };
}

describe('offerableDeploy — upstream not settled (hand-built chain, no demo fixture shows this)', () => {
	it('upstream still checking (app-ti-1440 QA case) → null, reason "upstream-running"', () => {
		const { byEnv, graph } = buildChainCards('InProgress');
		const staging = byEnv.get('staging')!;
		expect(staging.waitsForEnv).toBe('dev');
		expect(byEnv.get('dev')!.isRunning).toBe(true);
		const result = offerableDeploy(staging, { graph, peersByEnv: byEnv });
		expect(result).toEqual({ candidate: null, reason: 'upstream-running' });
	});

	it('upstream failed → null, reason "upstream-failed"', () => {
		const { byEnv, graph } = buildChainCards('Failed');
		const staging = byEnv.get('staging')!;
		expect(staging.waitsForEnv).toBe('dev');
		expect(byEnv.get('dev')!.statusKey).toBe('failed');
		const result = offerableDeploy(staging, { graph, peersByEnv: byEnv });
		expect(result).toEqual({ candidate: null, reason: 'upstream-failed' });
	});
});

// ── a clean candidate, and the raw-tag rule ────────────────────────────────

function readyEnvironment(): Environment {
	return {
		metadata: { name: 'svc-app', namespace: 'svc-app-prod' },
		spec: { environment: 'prod', rolloutRef: { name: 'svc-app' } },
		status: { currentVersion: 'b-1' }
	} as unknown as Environment;
}

function readyRollout(): Rollout {
	return {
		metadata: { name: 'svc-app', namespace: 'svc-app-prod' },
		spec: {},
		status: {
			history: [{ version: { tag: 'b-1', version: '1.0.0-1' }, bakeStatus: 'Succeeded' }],
			availableReleases: [
				{ tag: 'b-1', version: '1.0.0-1' },
				{ tag: 'main-1785-b2-deadbeef', version: '1.0.0-2' }
			],
			gates: []
		}
	} as unknown as Rollout;
}

describe('offerableDeploy — nothing in the way', () => {
	it('settled, allowed, not held → a candidate, display is getDisplayVersion, never the raw tag', () => {
		const environments = [readyEnvironment()];
		const rollouts = [readyRollout()];
		const gateContext = buildGateContext({ environments: { items: environments } });
		const graph = buildRolloutGraph({ rollouts, environments, dependencies: [], envOrder: [], gates: gateContext });
		const now = new Date();
		const cards = buildRolloutCards(rollouts, environments, now, gateContext, (r) =>
			contractHoldsForRollout(graph, r)
		);
		const peers = cardsFor(cards, 'svc-app');
		const card = peers.get('prod')!;
		expect(card.held).toBe(false);
		expect(card.waitsForEnv).toBeNull();

		const result = offerableDeploy(card, { graph, peersByEnv: peers });
		expect(result.reason).toBeNull();
		expect(result.candidate).not.toBeNull();
		expect(result.candidate!.display).toBe('1.0.0-2');
		expect(result.candidate!.display).not.toBe('main-1785-b2-deadbeef');
		expect(result.candidate!.tag).toBe('main-1785-b2-deadbeef');
	});
});

describe('offerableDeploy: the build the nearest earlier stage runs, settled (lead, QA r6 B3)', () => {
	it('never offers prod a build dev is still deploying (telemetry-worker, calm)', () => {
		const { cards, graph } = fleetCards('calm');
		const peers = cardsFor(cards, 'telemetry-worker');
		const prod = peers.get('prod')!;
		expect(peers.get('dev')!.isRunning).toBe(true);
		expect(offerableDeploy(prod, { graph, peersByEnv: peers })).toEqual({ candidate: null, reason: 'upstream-running' });
	});
	it('offers a prod region only the build staging runs (payments-core, calm)', () => {
		const { cards, graph } = fleetCards('calm');
		const peers = cardsFor(cards, 'payments-core');
		const staging = peers.get('staging')!;
		const stagingTag = staging.rollout.status?.history?.[0]?.version?.tag;
		const r = offerableDeploy(peers.get('prod-us-east')!, { graph, peersByEnv: peers });
		expect(r.reason).toBeNull();
		expect(r.candidate?.tag).toBe(stagingTag);
		expect(r.candidate?.upstreamEnv).toBe('staging');
	});
});
