/**
 * FIXTURE H - `hello-helm`, an app that ships through HelmReleases instead of a Kustomization.
 *
 *   dev      hello-helm-dev             on 0.6.0, the HelmRelease is UPGRADING (Ready=False, Progressing, helm revision 8 pending)
 *   staging  hello-helm-staging         on 0.5.0, Ready
 *   prod     hello-helm-prod-eu-west-1  on 0.4.0, Ready
 *
 * Each namespace has one HelmRelease `hello-helm` (annotated `rollout.kuberik.com/values.image.tag.from: hello-helm`) whose
 * inventory holds a Deployment and a Service. Role: a review fixture for the Resources card's HelmRelease groups; it is not part of
 * the demo story. Same topology mechanism as the release-switch apps (one namespace per site), so it reuses their builders.
 *
 * OPT-IN: dev-mock-api.ts runs `install()` only under `MOCK_FIXTURES=helm`; the demo build and the normal bundle never import it.
 * Rollout pages: /rollouts/dev/hello-helm-dev/hello-helm, /rollouts/staging/hello-helm-staging/hello-helm, /rollouts/prod/hello-helm-prod-eu-west-1/hello-helm.
 */
import { SOURCE_CLUSTER, hcAgo } from './mock-data';
import { build, environmentsOf, rolloutsOf, type Fixture, type Place } from './release-switch-fixtures';
import { setExtraFixtures, setExtraHelm } from './extra-fixtures';

type Obj = Record<string, unknown>;

const HELM = build('hello-helm', 'hh', (n) => `0.${n}.0`, 1, 6, [
	{ tier: 'dev', site: 'default', wave: 1, cluster: 'dev', at: 6, bake: 'InProgress', msg: 'checking' },
	{ tier: 'staging', site: 'default', wave: 1, cluster: 'staging', at: 5, bake: 'Succeeded' },
	{ tier: 'prod', site: 'eu-west-1', wave: 1, cluster: 'prod', at: 4, bake: 'Succeeded' }
]);

const CHART = 'hello-helm';
const CHART_VERSION = '1.4.2';
const placeOf = (ns: string): Place | undefined => HELM.places.find((p) => p.ns === ns);
const versionOf = (p: Place) => HELM.releases.find((r) => r.tag === p.tag)!.version;
/** the dev release is mid-upgrade: helm-controller has started revision 8 and the Deployment is rolling */
const upgrading = (p: Place) => p.bake === 'InProgress';
const revisionOf = (p: Place) => (p.tier === 'dev' ? 8 : p.tier === 'staging' ? 5 : 3);

function helmRelease(p: Place): Obj {
	const up = upgrading(p);
	const rev = revisionOf(p);
	const cond = (type: string, status: string, reason: string, message: string, ago: number) => ({
		type,
		status,
		reason,
		message,
		observedGeneration: 4,
		lastTransitionTime: hcAgo(ago)
	});
	return {
		apiVersion: 'helm.toolkit.fluxcd.io/v2',
		kind: 'HelmRelease',
		metadata: {
			name: HELM.app,
			namespace: p.ns,
			generation: 4,
			annotations: { 'rollout.kuberik.com/values.image.tag.from': HELM.app, [SOURCE_CLUSTER]: p.cluster }
		},
		spec: {
			interval: '5m',
			chart: { spec: { chart: CHART, version: CHART_VERSION, sourceRef: { kind: 'HelmRepository', name: 'charts' } } },
			values: { image: { tag: p.tag } }
		},
		status: {
			observedGeneration: 4,
			lastAttemptedReleaseAction: 'upgrade',
			lastAttemptedRevision: CHART_VERSION,
			history: [
				{
					chartName: CHART,
					chartVersion: CHART_VERSION,
					appVersion: versionOf(p),
					version: rev,
					status: up ? 'pending-upgrade' : 'deployed',
					name: HELM.app,
					namespace: p.ns
				}
			],
			conditions: up
				? [cond('Ready', 'False', 'Progressing', "Running 'upgrade' action with timeout of 5m0s", 1), cond('Released', 'Unknown', 'Progressing', "Running 'upgrade' action with timeout of 5m0s", 1)]
				: [cond('Ready', 'True', 'UpgradeSucceeded', `Helm upgrade succeeded for release ${p.ns}/${HELM.app}.v${rev} with chart ${CHART}@${CHART_VERSION}`, 20), cond('Released', 'True', 'UpgradeSucceeded', 'Helm upgrade succeeded', 20)],
			inventory: {
				entries: [
					{ id: `${p.ns}_${HELM.app}_apps_Deployment`, v: 'v1' },
					{ id: `${p.ns}_${HELM.app}__Service`, v: 'v1' }
				]
			}
		}
	};
}

function resources(p: Place): Obj {
	const up = upgrading(p);
	const hr = helmRelease(p);
	const dep = {
		groupVersionKind: 'apps/v1/Deployment',
		name: HELM.app,
		namespace: p.ns,
		status: up ? 'InProgress' : 'Current',
		message: up ? 'Replicas: 1/2' : 'Deployment is available. Replicas: 2',
		lastModified: hcAgo(up ? 1 : 20),
		object: { apiVersion: 'apps/v1', kind: 'Deployment', metadata: { name: HELM.app, namespace: p.ns }, spec: { replicas: 2 }, status: { replicas: 2, readyReplicas: up ? 1 : 2 } }
	};
	const svc = {
		groupVersionKind: 'v1/Service',
		name: HELM.app,
		namespace: p.ns,
		status: 'Current',
		message: 'Service is ready',
		lastModified: hcAgo(60),
		object: { apiVersion: 'v1', kind: 'Service', metadata: { name: HELM.app, namespace: p.ns } }
	};
	return {
		managedResources: [dep, svc],
		release: {
			chartName: CHART,
			chartVersion: CHART_VERSION,
			appVersion: versionOf(p),
			revision: revisionOf(p),
			status: up ? 'pending-upgrade' : 'deployed',
			lastAction: 'upgrade',
			ready: up ? 'False' : 'True',
			readyReason: up ? 'Progressing' : 'UpgradeSucceeded',
			readyMessage: up ? "Running 'upgrade' action with timeout of 5m0s" : 'Helm upgrade succeeded',
			remediated: false
		},
		helmRelease: hr
	};
}

function children(p: Place): Obj {
	const up = upgrading(p);
	const pod = (n: string, ready: boolean) => ({ name: `${HELM.app}-${n}`, phase: ready ? 'Running' : 'Pending', ready, restarts: 0, age: '1m' });
	return {
		replicaSets: up
			? [
					{ name: `${HELM.app}-7d9c8b6f5`, desiredReplicas: 2, readyReplicas: 1, replicas: 2, isCurrentRS: true, pods: [pod('7d9c8b6f5-4xk2p', true), pod('7d9c8b6f5-m8qzt', false)] },
					{ name: `${HELM.app}-5b4f9d7c6`, desiredReplicas: 1, readyReplicas: 1, replicas: 1, pods: [pod('5b4f9d7c6-9wlhn', true)] }
				]
			: [{ name: `${HELM.app}-7d9c8b6f5`, desiredReplicas: 2, readyReplicas: 2, replicas: 2, isCurrentRS: true, pods: [pod('7d9c8b6f5-4xk2p', true), pod('7d9c8b6f5-m8qzt', true)] }]
	};
}

function healthChecks(p: Place): Obj {
	const up = upgrading(p);
	return {
		healthChecks: [
			{
				apiVersion: 'kuberik.com/v1alpha1',
				kind: 'HealthCheck',
				metadata: { name: `${HELM.app}-helm`, namespace: p.ns, labels: { app: HELM.app }, annotations: { 'healthcheck.kuberik.com/helmrelease': HELM.app, 'kuberik.com/display-name': 'Helm release' } },
				spec: { class: 'helmrelease' },
				status: up
					? { status: 'Pending', message: "Running 'upgrade' action with timeout of 5m0s", lastChangeTime: hcAgo(1) }
					: { status: 'Healthy', message: `HelmRelease is ready: chart ${CHART} ${CHART_VERSION}, app ${versionOf(p)}, revision ${revisionOf(p)}`, lastChangeTime: hcAgo(20) }
			}
		]
	};
}

const owned = (f: (p: Place) => Obj) => (ns: string, name: string): Obj | undefined => {
	const p = placeOf(ns);
	return p && name === HELM.app ? f(p) : undefined;
};

export const HELM_FIXTURES: Fixture[] = [HELM];

/** `install(false)` takes the app out */
export function install(on = true): void {
	setExtraFixtures('helm', on ? { environments: () => HELM_FIXTURES.flatMap(environmentsOf), rollouts: () => HELM_FIXTURES.flatMap(rolloutsOf) } : null);
	setExtraHelm(
		on
			? {
					detail: owned((p) => ({ helmReleases: { items: [helmRelease(p)] } })),
					resources: owned(resources),
					children: owned(children),
					healthChecks: owned(healthChecks)
				}
			: null
	);
}
