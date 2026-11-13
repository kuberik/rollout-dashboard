/**
 * ⭐ THE DEPENDENCIES STORY, STEPPED. (2026-10-07.)
 *
 * The dependencies pages have to ENACT "nothing moves before its
 * dependencies", not just state it. The fixture's causal chain is already
 * real (see FIXTURE D in mock-data.ts):
 *
 *   ledger-core 5.1.0 ──holds──▶ payments-svc 3.0.0      (needs ledger ^6.0.0)
 *   payments-svc 2.4.1 ──holds──▶ checkout-api b-44/b-45 (need payments 3.0.0 / ^3.0.0)
 *                                 in staging, prod-eu-central, prod-us-east-1
 *                      ──holds──▶ fulfillment-svc o-13         (needs payments ^3.0.0)
 *   checkout-api staging ──promotion──▶ every prod region
 *
 * `GET|POST /api/demo/deps?step=<step>` walks it one beat at a time, each beat
 * synchronous (no timers, so a capture script drives beat → screenshot →
 * beat with no dependency on the server's wall clock), exactly like
 * `/api/demo/gate?step=`:
 *
 *   arm      — back to the held picture (same as the state a reset leaves).
 *   ledger   — ledger-core ships 6.0.0. Its contract with payments-svc is
 *              satisfied: the wire into payments-svc clears, 3.0.0 is free.
 *   payments — payments-svc ships 3.0.0 (platform-prod AND platform-staging).
 *              checkout-api's `payments` gates admit b-44/b-45 in staging and
 *              the two regions that wanted them, fulfillment-svc's admits o-13 —
 *              those wires clear. (`prod-us-east-2`/`prod-ap-southeast-2`
 *              still hold b-43, which asks for ~2.9.0: a newer provider does
 *              not satisfy an older pin, and the page keeps saying so.)
 *   staging  — checkout-api staging ships b-45. Only now does the promotion
 *              gate into the prod regions allow it.
 *   regions  — prod-eu-central and prod-us-east-1 ship b-45; fulfillment-svc
 *              ships o-13. Nothing is left holding a build anyone wants
 *              except the ~2.9.0 pin.
 *
 * Steps must run in order (each requires the previous one); repeating the
 * last step is a no-op. Every beat broadcasts `Rollout` / `RolloutDependency`
 * / `Environment` change events, so an open graph, its cards and every
 * count update live over the stream. `/api/demo/reset` returns to `arm`.
 */
import { extraEnvironments } from './extra-fixtures';
import {
	CK_APP,
	CK_ENVS,
	mkHwvEnvironments,
	type HwvScenario,
	CK_ENV_INFOS,
	CK_TIER_PLACE,
	ckAllowedFrom,
	ckUpstreamPlaces,
	ckWaveFor,
	CK_RELEASES,
	LEDGER_RELEASES,
	ORD_RELEASES,
	PAY_RELEASES,
	PLATFORM_NS,
	PLATFORM_STAGING_NS,
	ckOtherGates,
	fixtureClusterOf,
	mockDepEnvironments,
	mockDependencies
} from './mock-data';

export const DEPS_STEPS = ['arm', 'ledger', 'payments', 'staging', 'regions'] as const;
export type DepsStep = (typeof DEPS_STEPS)[number];

type Obj = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
type Change = { kind: string; namespace: string; name: string; cluster: string };

let deps: Obj[] = [];
let envs: Obj[] = [];
let at: DepsStep = 'arm';
/** `namespace/name` of every rollout a beat has changed — the detail route
 *  serves the live (scenario) rollout for exactly these. */
const touched = new Set<string>();

export function resetDepsStory(scenario: HwvScenario = 'calm'): void {
	deps = structuredClone(mockDependencies) as Obj[];
	// hello-waves is the one app whose Environments follow the scenario (mock-data.ts FIXTURE E).
	envs = structuredClone([...mockDepEnvironments, ...mkHwvEnvironments(scenario), ...extraEnvironments()]) as Obj[];
	at = 'arm';
	touched.clear();
}

export function getStoryDependencies(): Obj[] {
	return deps;
}
/** Replace hello-waves' Environments with `fresh` (waves-story.ts); the other apps' are untouched. */
export function replaceHwvEnvironments(fresh: Obj[]): void {
	const isHwv = (e: Obj) => (e.metadata?.namespace ?? '').startsWith('hello-waves-');
	envs = [...envs.filter((e) => !isHwv(e)), ...structuredClone(fresh)];
}
export function getStoryDepEnvironments(): Obj[] {
	return envs;
}
export function depsStoryStep(): DepsStep {
	return at;
}
export function depsStoryTouched(namespace: string, name: string): boolean {
	return touched.has(`${namespace}/${name}`);
}

const SATISFIED = (contract: string) => ({
	type: 'Satisfied',
	status: 'True',
	reason: 'DependencySatisfied',
	message: `No release is waiting on contract "${contract}"`
});
const UNSATISFIED = (contract: string, n: number) => ({
	type: 'Satisfied',
	status: 'False',
	reason: 'ReleasesBlocked',
	message: `${n} release(s) waiting on contract "${contract}"`
});

/** Re-evaluate one dependency against a provider that now serves `version`. */
function provide(
	dep: Obj,
	version: string,
	tag: string,
	stillBlocked: (b: { tag: string; requiredVersion?: string }) => boolean
): void {
	const s = dep.status;
	const contract = dep.spec?.contract ?? '';
	const blocked = (s.blockedReleases ?? []) as { tag: string; requiredVersion?: string }[];
	const keep = blocked.filter(stillBlocked);
	const freed = blocked.filter((b) => !keep.includes(b)).map((b) => b.tag);
	s.providedVersion = version;
	s.providedTag = tag;
	s.blockedReleases = keep;
	s.admittedVersions = [...(s.admittedVersions ?? []), ...freed];
	s.conditions = (s.conditions ?? []).map((c: Obj) =>
		c.type === 'Satisfied' ? (keep.length === 0 ? SATISFIED(contract) : UNSATISFIED(contract, keep.length)) : c
	);
}

/** Ship `tag` on a rollout: new Succeeded history head, wanted = current. */
function ship(
	r: Obj,
	tag: string,
	releases: { tag: string; version: string; revision?: string; created: string }[],
	when: Date
): void {
	const rel = releases.find((x) => x.tag === tag)!;
	const history = (r.status.history ?? []) as Obj[];
	const prevRequires = history[0]?.version?.requires;
	history.unshift({
		id: (history[0]?.id ?? 0) + 1,
		version: {
			tag: rel.tag,
			version: rel.version,
			// ⭐ ROUND 5 QA-5, ITEM 2 note (mock-data.ts) — carry `revision`
			// through a live-scenario promotion too, or a build shipped by this
			// simulation (not the static fixture history) regresses to the same
			// dead `/changes` link the static fixture just got fixed for.
			...(rel.revision ? { revision: rel.revision } : {}),
			created: rel.created,
			...(prevRequires ? { requires: prevRequires } : {})
		},
		timestamp: when.toISOString(),
		bakeStatus: 'Succeeded'
	});
	r.status.history = history;
	r.status.wantedVersion = tag;
	r.status.currentVersion = tag;
	touched.add(`${r.metadata.namespace}/${r.metadata.name}`);
}

/** CK promotion gates, recomputed from the upstream environment's LIVE history
 *  (the same rule `ckGates` in mock-data.ts applies to the static fixture). */
function recomputeCkGates(rollouts: Obj[]): void {
	const ck = (env: string) => rollouts.find((r) => r.metadata?.namespace === `${CK_APP}-${env}` && r.metadata?.name === CK_APP);
	for (const env of CK_ENVS) {
		// The upstream is whatever sites-waves' `upstreamOf` says over the Environments (a follower: its
		// leader; a wave-N leader: the wave before; a wave-1 leader: the tier before).
		const ups = ckUpstreamPlaces(envs, env);
		const r = ck(env);
		if (!ups.length || !r) continue;
		const allowed = ckAllowedFrom(r.status.currentVersion, ups, (u) =>
			((ck(u)?.status?.history ?? []) as Obj[]).filter((h) => h.bakeStatus === 'Succeeded').map((h) => h.version.tag)
		);
		const cur = CK_RELEASES.findIndex((x) => x.tag === r.status.currentVersion);
		const newer = CK_RELEASES.slice(cur + 1).map((x) => x.tag);
		r.status.gates = [
			{ name: `promotion-${env}`, kind: 'promotion', allowedVersions: allowed, passing: newer.every((t) => allowed.includes(t)) },
			// The deploy window and the approval on staging (mock-data.ts
			// `ckOtherGates`) are not promotion gates and survive the rewrite.
			...ckOtherGates(env)
		];
	}
}

/** Every checkout-api Environment's `status.wave` and wave conditions, re-read from the live rollouts. */
function refreshCkWaves(rollouts: Obj[]): void {
	const live = (env: string) => {
		const r = rollouts.find((x) => x.metadata?.namespace === `${CK_APP}-${env}` && x.metadata?.name === CK_APP);
		const h = r?.status?.history?.[0];
		return { tag: r?.status?.currentVersion ?? '', bake: h?.bakeStatus ?? 'Succeeded' };
	};
	for (const env of CK_ENVS) {
		const e = envs.find((x) => x.metadata?.namespace === `${CK_APP}-${env}`);
		if (!e) continue;
		const { wave, conditions } = ckWaveFor(env, live);
		e.status = { ...e.status, wave, conditions };
	}
}

const find = (rollouts: Obj[], ns: string, name: string) =>
	rollouts.find((r) => r.metadata?.namespace === ns && r.metadata?.name === name);
const depOf = (consumerNs: string, contract: string) =>
	deps.find((d) => d.metadata?.namespace === consumerNs && d.spec?.contract === contract);

/**
 * Run one beat against `rollouts` (state.ts's scenario dependency list, which
 * this mutates in place). Returns the change events to broadcast, or an error.
 */
export function runDepsStep(
	step: DepsStep,
	rollouts: Obj[],
	when: () => Date
): { ok: true; changes: Change[]; step: DepsStep } | { ok: false; error: string } {
	const order = DEPS_STEPS.indexOf(step);
	const cur = DEPS_STEPS.indexOf(at);
	if (step === 'arm') return { ok: false, error: 'arm is a reset: call /api/demo/reset' };
	if (order === cur) return { ok: true, changes: [], step };
	if (order !== cur + 1) {
		return { ok: false, error: `step ${step} needs ${DEPS_STEPS[order - 1]} first (at ${at})` };
	}
	const changes: Change[] = [];
	const rolloutChanged = (ns: string, name: string) =>
		changes.push({ kind: 'Rollout', namespace: ns, name, cluster: fixtureClusterOf(ns) });
	const depChanged = (d: Obj) =>
		changes.push({
			kind: 'RolloutDependency',
			namespace: d.metadata.namespace,
			name: d.metadata.name,
			cluster: d.metadata.annotations?.['rollout-dashboard.kuberik.com/source-cluster'] ?? fixtureClusterOf(d.metadata.namespace)
		});
	const ckEnvChanged = (env: string) => {
		const e = envs.find((x) => x.metadata?.namespace === `${CK_APP}-${env}`);
		const r = find(rollouts, `${CK_APP}-${env}`, CK_APP);
		if (e && r) e.status = { ...e.status, currentVersion: r.status.currentVersion };
		changes.push({ kind: 'Environment', namespace: `${CK_APP}-${env}`, name: CK_APP, cluster: fixtureClusterOf(`${CK_APP}-${env}`) });
	};

	if (step === 'ledger') {
		const ledger = find(rollouts, PLATFORM_NS, 'ledger-core');
		if (!ledger) return { ok: false, error: 'ledger-core fixture missing' };
		ship(ledger, 'led-600', LEDGER_RELEASES, when());
		rolloutChanged(PLATFORM_NS, 'ledger-core');
		const d = depOf(PLATFORM_NS, 'ledger');
		if (d) {
			provide(d, '6.0.0', 'led-600', () => false);
			depChanged(d);
		}
	}

	if (step === 'payments') {
		for (const ns of [PLATFORM_NS, PLATFORM_STAGING_NS]) {
			const p = find(rollouts, ns, 'payments-svc');
			if (!p) continue;
			ship(p, 'pay-300', PAY_RELEASES, when());
			rolloutChanged(ns, 'payments-svc');
		}
		// Every gate on the `payments` contract re-reads its provider. A build
		// that asks for 3.0.0 or ^3.0.0 is admitted now; one pinned to ~2.9.0
		// is not — a newer provider does not satisfy an older pin.
		for (const d of deps.filter((x) => x.spec?.contract === 'payments')) {
			provide(d, '3.0.0', 'pay-300', (b) => (b.requiredVersion ?? '').startsWith('~2.'));
			depChanged(d);
		}
	}

	if (step === 'staging') {
		const s = find(rollouts, `${CK_APP}-staging`, CK_APP);
		if (!s) return { ok: false, error: 'checkout-api staging fixture missing' };
		ship(s, 'b-45', CK_RELEASES, when());
		rolloutChanged(`${CK_APP}-staging`, CK_APP);
		ckEnvChanged('staging');
		recomputeCkGates(rollouts);
		// Staging's new history is what every region's promotion gate allows.
		for (const env of ['prod-eu-central', 'prod-us-east-1', 'prod-us-east-2', 'prod-ap-southeast-2', 'prod-af-south-1']) {
			rolloutChanged(`${CK_APP}-${env}`, CK_APP);
			touched.add(`${CK_APP}-${env}/${CK_APP}`);
		}
	}

	if (step === 'regions') {
		for (const env of ['prod-eu-central', 'prod-us-east-1']) {
			const r = find(rollouts, `${CK_APP}-${env}`, CK_APP);
			if (!r) continue;
			ship(r, 'b-45', CK_RELEASES, when());
			rolloutChanged(`${CK_APP}-${env}`, CK_APP);
			ckEnvChanged(env);
		}
		recomputeCkGates(rollouts);
		// Renamed from `orders-api` (TL, 2026-10-08, U-12/U-28) — that name
		// collided with the real FLEET app of the same name.
		const o = find(rollouts, 'orders-prod', 'fulfillment-svc');
		if (o) {
			ship(o, 'o-13', ORD_RELEASES, when());
			rolloutChanged('orders-prod', 'fulfillment-svc');
		}
	}

	refreshCkWaves(rollouts);
	at = step;
	return { ok: true, changes, step };
}

/**
 * The environment block a CK detail response carries, with `environmentInfos`
 * histories read from the LIVE rollouts — so the promotion chain card moves
 * with the graph instead of reciting the fixture.
 */
export function liveCkEnvironmentInfos(rollouts: Obj[]): unknown[] {
	return CK_ENV_INFOS.map((info) => {
		const r = find(rollouts, `${CK_APP}-${CK_TIER_PLACE[info.environment]}`, CK_APP);
		return r ? { ...info, history: r.status.history } : info;
	});
}
