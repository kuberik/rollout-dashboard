/**
 * FIXTURES: three apps whose dev Rollout the controller REFUSED to deploy (Ready=False), for the rollout page's Ready banner
 * (view-models/ready-refusal.ts). Opt-in: `MOCK_FIXTURES=deploy-refused` (dev-mock-api.ts). Built with the release-switch
 * fixture builder, so topology, history and gates are the same shape as every other fixture app.
 *
 *   billing-api  dev  HelmReleaseFieldConflict    spec.values.image.tag is also set by "gitops-demo" (Git still sets the field)
 *   orders-web   dev  KustomizationFieldConflict  spec.postBuild.substitute.ORDERS_TAG is also set by another Rollout's manager
 *   receipts-api dev  HelmReleaseRemediationConflict  spec.upgrade.remediation.retries is also set by "kustomize-controller"
 *                     (Git keeps Helm's own upgrade rollback on, which kuberik turns off)
 *
 * Each dev place runs the older build while a newer one is available: the refusal is why it never moved. The messages are the
 * controller's own (rollout-controller helmrelease_write.go `describeFieldConflict` + the two hints, and `helmReleaseConflict`),
 * byte for byte.
 */
import { build, environmentsOf, rolloutsOf, type Fixture } from './release-switch-fixtures';
import { hcAgo } from './mock-data';
import { setExtraFixtures } from './extra-fixtures';

const AT_REST = (tier: string, site: string, wave: number, cluster: string, at: number) => ({ tier, site, wave, cluster, at, bake: 'Succeeded' });

const BILLING = build('billing-api', 'bf', (n) => `3.${n}.0-${n}`, 10, 14, [
	AT_REST('dev', 'default', 1, 'dev', 12),
	AT_REST('staging', 'default', 1, 'dev', 12),
	AT_REST('prod', 'default', 1, 'prod', 11)
]);
const ORDERS = build('orders-web', 'oe', (n) => `1.${n}.0-${n}`, 20, 23, [
	AT_REST('dev', 'default', 1, 'dev', 21),
	AT_REST('staging', 'default', 1, 'dev', 21),
	AT_REST('prod', 'default', 1, 'prod', 20)
]);
const RECEIPTS = build('receipts-api', 'rc', (n) => `2.${n}.0-${n}`, 30, 33, [
	AT_REST('dev', 'default', 1, 'dev', 31),
	AT_REST('staging', 'default', 1, 'dev', 31),
	AT_REST('prod', 'default', 1, 'prod', 30)
]);

export const HELM_CONFLICT_MESSAGE =
	'HelmRelease billing-api-dev/billing-api: spec.values.image.tag is also set by "gitops-demo". Remove it from the manifest in Git so kuberik owns it (set the default in the chart\'s values.yaml instead).';
export const KUSTOMIZATION_CONFLICT_MESSAGE =
	'Kustomization orders-web-dev/orders-web: spec.postBuild.substitute.ORDERS_TAG is also set by "rollout-controller/orders-web-dev/orders-api". Rollout orders-api wrote it before the annotation moved and still owns it. Release it with a server-side apply under field manager "rollout-controller/orders-web-dev/orders-api" of a Kustomization body without the field.';
export const REMEDIATION_CONFLICT_MESSAGE =
	'HelmRelease receipts-api-dev/receipts-api: spec.upgrade.remediation.retries is also set by "kustomize-controller". kuberik turns off Helm\'s upgrade remediation so that only the Rollout rolls back; have "kustomize-controller" set spec.upgrade.remediation.retries: 0 and remediateLastFailure: false, or remove them, and the deploy continues (kuberik retries every minute).';

const REFUSALS: Record<string, { reason: string; message: string }> = {
	'billing-api-dev': { reason: 'HelmReleaseFieldConflict', message: HELM_CONFLICT_MESSAGE },
	'orders-web-dev': { reason: 'KustomizationFieldConflict', message: KUSTOMIZATION_CONFLICT_MESSAGE },
	'receipts-api-dev': { reason: 'HelmReleaseRemediationConflict', message: REMEDIATION_CONFLICT_MESSAGE }
};

export const DEPLOY_REFUSED_FIXTURES: Fixture[] = [BILLING, ORDERS, RECEIPTS];
export const DEPLOY_REFUSED_APPS = DEPLOY_REFUSED_FIXTURES.map((f) => f.app);

/** the fixture rollouts, the refused dev places carrying the controller's Ready=False condition */
export function refusedRollouts() {
	return DEPLOY_REFUSED_FIXTURES.flatMap(rolloutsOf).map((r) => {
		const refusal = REFUSALS[r.metadata.namespace];
		if (!refusal) return r;
		return { ...r, status: { ...r.status, conditions: [{ type: 'Ready', status: 'False', ...refusal, lastTransitionTime: hcAgo(14) }] } };
	});
}

/** OPT-IN, same contract as release-switch-fixtures' `install`: call before the state is built; `install(false)` takes them out. */
export function install(on = true): void {
	setExtraFixtures('deploy-refused', on ? { environments: () => DEPLOY_REFUSED_FIXTURES.flatMap(environmentsOf), rollouts: refusedRollouts } : null);
}
