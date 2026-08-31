/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * A FLEET WHOSE AXES ALL HAVE COMPETING VALUES.
 *
 * The subject property -- "does this sentence name what it is about?" -- is
 * not observable on a page with one app in one environment on one cluster,
 * because every sentence is trivially about the only thing there. So the
 * fixture is deliberately the smallest fleet in which every axis is
 * AMBIGUOUS UNLESS NAMED:
 *
 *   2 apps   x  3 environments  x  2 clusters
 *
 * and every rollout is in a state that produces a blocking sentence, so the
 * sentences under test actually render.
 *
 * The environment names are the real tiers (`dev`, `staging`, `prod`) because
 * `env-order.ts` ranks them and `deploy-risk.ts` classifies production from
 * them. The CLUSTERS are named `prod` and `dev` on purpose: that collision is
 * live on the hub today (`CLUSTER_NAME` from the `kuberik-cluster-info`
 * ConfigMap is set to `prod`/`dev`), it is a standing finding, and a suite
 * that renamed it away would be testing a fleet nobody runs.
 */

export const APPS = ['alpha-app', 'beta-app'] as const;
export const TIERS = ['dev', 'staging', 'prod'] as const;
export const CLUSTERS = ['rollout-a', 'rollout-b'] as const;

const SOURCE_CLUSTER = 'rollout-dashboard.kuberik.com/source-cluster';

const release = (tag: string, day: number) => ({
	tag,
	version: tag,
	created: `2026-08-${String(day).padStart(2, '0')}T00:00:00Z`
});

export const RELEASES = [release('r1aaaaa', 1), release('r2bbbbb', 2), release('r3ccccc', 3)];

export type Shape = {
	/** Which release index is running. `null` = never deployed. */
	at?: number | null;
	bakeStatus?: string;
	/** A gate holding it, by kind. */
	hold?: 'approval' | 'schedule' | 'none';
	pinned?: string | null;
	/** A `DeploymentBlocked: True` condition naming a failing check. */
	failingCheck?: string | null;
};

function rolloutFor(app: string, tier: string, cluster: string, shape: Shape) {
	const ns = `${app.replace('-app', '')}-${tier}`;
	const at = shape.at === undefined ? 0 : shape.at;
	const current = at === null ? null : RELEASES[at];
	// ⛔ THE GATE NAMES ARE `generateName` SUFFIXES, NOT DESCRIPTIONS, BECAUSE
	// THAT IS WHAT THE CLUSTER PRODUCES. `ghd-p2fld`, `schedule-gate-nwm62`.
	// A fixture that called the gate `approve-alpha-app-dev` would smuggle the
	// app name into every `rule:` handle, and the subject test would then pass
	// on pages where the only thing naming the app is an opaque identifier.
	const suffix = `${app[0]}${tier[0]}${tier.length}`;
	const gates =
		shape.hold === 'approval'
			? [{ name: `ghd-${suffix}`, passing: true, allowedVersions: [] as string[] }]
			: shape.hold === 'schedule'
				? [{ name: `schedule-gate-${suffix}`, passing: false }]
				: [];
	return {
		metadata: {
			name: app,
			namespace: ns,
			annotations: { [SOURCE_CLUSTER]: cluster },
			labels: { environment: tier }
		},
		spec: shape.pinned ? { wantedVersion: shape.pinned } : {},
		status: {
			availableReleases: RELEASES,
			releaseCandidates: at === null ? [] : RELEASES.slice(at + 1).reverse(),
			gates,
			conditions: shape.failingCheck
				? [
						{
							type: 'DeploymentBlocked',
							status: 'True',
							lastTransitionTime: '2026-08-31T01:00:00Z',
							message: `HealthCheck '${shape.failingCheck}' in namespace '${ns}' is not healthy (status: Unhealthy): p99 latency 4.2s exceeds SLO of 500ms for 5m`
						}
					]
				: [],
			history: current
				? [
						{
							id: 1,
							version: current,
							timestamp: '2026-08-31T00:00:00Z',
							bakeStatus: shape.bakeStatus ?? 'Succeeded'
						}
					]
				: []
		}
	};
}

function environmentFor(app: string, tier: string, cluster: string, after: string | null) {
	const ns = `${app.replace('-app', '')}-${tier}`;
	return {
		metadata: {
			name: `${app}-${tier}`,
			namespace: ns,
			annotations: { [SOURCE_CLUSTER]: cluster }
		},
		spec: {
			environment: tier,
			rolloutRef: { name: app },
			...(after ? { relationship: { environment: after, type: 'After' as const } } : {})
		},
		status: { rolloutGateRef: { name: `promote-${app}-${tier}` } }
	};
}

/**
 * The default fleet: every place is behind and held by a gate a PERSON has to
 * clear, which is the loudest sentence the product produces and therefore the
 * one whose subject matters most.
 */
export function fleet(
	override: (app: string, tier: string) => Shape = () => ({ hold: 'approval' })
): any {
	const rollouts: any[] = [];
	const environments: any[] = [];
	for (const [i, app] of APPS.entries()) {
		const cluster = CLUSTERS[i % CLUSTERS.length];
		for (const [t, tier] of TIERS.entries()) {
			rollouts.push(rolloutFor(app, tier, cluster, override(app, tier)));
			environments.push(environmentFor(app, tier, cluster, t === 0 ? null : TIERS[t - 1]));
		}
	}
	return {
		rollouts: { items: rollouts },
		environments: { items: environments },
		rolloutDependencies: { items: [] },
		clusters: CLUSTERS.map((name) => ({ name, url: `https://${name}` })),
		clusterErrors: []
	};
}

/** Everything an `/api/...` GET can answer with, for a stubbed `fetch`. */
export function respond(payload: any) {
	return async (input: any) => {
		const url = String(typeof input === 'string' ? input : (input?.url ?? input));
		if (url.includes('/schedules')) return json({ items: [] });
		if (url.includes('/health-checks')) return json({ items: [] });
		if (url.includes('/rollout-tests')) return json({ items: [] });
		if (url.includes('/permissions')) return json({ canDeploy: true, canPin: true });
		if (url.includes('/api/cluster')) return json({ name: CLUSTERS[0], clusters: payload.clusters });
		if (url.includes('/api/commits') || url.includes('/api/github')) return json({ connected: false });
		return json(payload);
	};
}

function json(body: unknown): Response {
	return new Response(JSON.stringify(body), {
		status: 200,
		headers: { 'Content-Type': 'application/json' }
	});
}
