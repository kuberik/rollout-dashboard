import { describe, expect, test } from 'vitest';
import { OWNED_ELSEWHERE, CONFLICT_NEXT_STEP, managerName, pathParts, readyIssue, REMEDIATION_NEXT_STEP, REMEDIATION_LAST_FAILURE_NEXT_STEP, readyFacts, firstClause } from './ready-refusal';

const ready = (reason: string, message: string, status = 'False') => [
	{ type: 'DeploymentBlocked', status: 'False', reason: 'HealthChecksHealthy', message: '' },
	{ type: 'Ready', status, reason, message, lastTransitionTime: '2026-11-21T10:00:00Z' }
];

const HELM =
	'HelmRelease hello-helm-dev/hello-helm: spec.values.image.tag is also set by "gitops-demo". Remove it from the manifest in Git so kuberik owns it (set the default in the chart\'s values.yaml instead).';
const KUST =
	'Kustomization hello-dep-dev/hello-dep: spec.postBuild.substitute.IMAGE_TAG is also set by "gitops-demo". Remove the key from spec.postBuild.substitute in Git so kuberik owns it (use ${VAR:=default} in the manifests for a default).';

describe('readyIssue: which Ready=False reasons the banner speaks for', () => {
	test('a HelmRelease field conflict is "Deploy refused" naming reason, path and the other manager', () => {
		const i = readyIssue(ready('HelmReleaseFieldConflict', HELM));
		expect(i).toEqual({
			kind: 'refused',
			reason: 'HelmReleaseFieldConflict',
			title: 'Deploy refused',
			line: 'HelmRelease hello-helm spec.values.image.tag, also set by gitops-demo',
			conflict: {
				kind: 'HelmRelease',
				name: 'hello-helm',
				path: 'spec.values.image.tag',
				by: 'gitops-demo',
				manager: 'gitops-demo',
				hint: "Remove it from the manifest in Git so kuberik owns it (set the default in the chart's values.yaml instead)."
			},
			nextStep: CONFLICT_NEXT_STEP,
			detail: `HelmReleaseFieldConflict: ${HELM}`,
			since: '2026-11-21T10:00:00Z'
		});
	});

	test('a Kustomization conflict names the variable path and the other manager', () => {
		const i = readyIssue(ready('KustomizationFieldConflict', KUST))!;
		expect(i.title).toBe('Deploy refused');
		expect(i.line).toBe('Kustomization hello-dep spec.postBuild.substitute.IMAGE_TAG, also set by gitops-demo');
		expect(i.conflict).toMatchObject({ kind: 'Kustomization', name: 'hello-dep', path: 'spec.postBuild.substitute.IMAGE_TAG', by: 'gitops-demo' });
		expect(i.detail).toBe(`KustomizationFieldConflict: ${KUST}`);
	});

	test('a conflict with another rollout names that rollout', () => {
		const msg =
			'Kustomization hello-dep-dev/hello-dep: spec.postBuild.substitute.API_TAG is also set by "rollout-controller/hello-dep-dev/hello-api". Rollout hello-api wrote it before the annotation moved and still owns it.';
		expect(readyIssue(ready('KustomizationFieldConflict', msg))!.line).toBe(
			'Kustomization hello-dep spec.postBuild.substitute.API_TAG, also set by Rollout hello-api'
		);
	});

	test('an unnamed manager reads "another field manager"', () => {
		const msg = 'HelmRelease a/b: spec.values.x is also set by another field manager. Remove it.';
		expect(readyIssue(ready('HelmReleaseFieldConflict', msg))!.conflict!.by).toBe('another field manager');
		expect(managerName(undefined)).toBe('another field manager');
	});

	test('an invalid annotation is refused; the object lead moves to the disclosed detail', () => {
		const msg = 'HelmRelease hello-helm-dev/hello-helm: rollout.kuberik.com/chart-version needs spec.chart.spec.';
		const i = readyIssue(ready('HelmReleaseInvalidAnnotation', msg))!;
		expect(i.kind).toBe('refused');
		expect(i.line).toBe('HelmReleaseInvalidAnnotation: rollout.kuberik.com/chart-version needs spec.chart.spec.');
		expect(i.detail).toBe(msg);
	});

	test('only the three field-conflict reasons carry the generic next step', () => {
		for (const r of ['KustomizationFieldConflict', 'HelmReleaseFieldConflict', 'OCIRepositoryFieldConflict']) {
			expect(readyIssue(ready(r, KUST))!.nextStep).toBe(CONFLICT_NEXT_STEP);
		}
		expect(readyIssue(ready('HelmReleaseInvalidAnnotation', 'HelmRelease a/b: x needs y.'))!.nextStep).toBeNull();
		expect(readyIssue(ready('RolloutFailed', 'boom'))!.nextStep).toBeNull();
	});

	test('every printed next step is one sentence of 12 words or fewer (glanceable-UI rule)', () => {
		for (const t of [CONFLICT_NEXT_STEP, REMEDIATION_NEXT_STEP, REMEDIATION_LAST_FAILURE_NEXT_STEP]) {
			expect(t.split(/\s+/).length).toBeLessThanOrEqual(12);
		}
		const retries = readyIssue(
			ready('HelmReleaseRemediationConflict', 'HelmRelease a/b: spec.upgrade.remediation.retries is also set by "kustomize-controller". x')
		)!;
		expect(retries.nextStep).toBe(REMEDIATION_NEXT_STEP);
	});

	test('HelmReleaseRemediationConflict is "Deploy refused" with its own next step', () => {
		const msg =
			'HelmRelease shop-dev/shop: spec.upgrade.remediation.remediateLastFailure is also set by "kustomize-controller". kuberik turns off Helm\'s upgrade remediation so that only the Rollout rolls back; have "kustomize-controller" set spec.upgrade.remediation.retries: 0 and remediateLastFailure: false, or remove them, and the deploy continues (kuberik retries every minute).';
		expect(readyIssue(ready('HelmReleaseRemediationConflict', msg))).toMatchObject({
			kind: 'refused',
			title: 'Deploy refused',
			conflict: { kind: 'HelmRelease', name: 'shop', path: 'spec.upgrade.remediation.remediateLastFailure', by: 'kustomize-controller' },
			nextStep: REMEDIATION_LAST_FAILURE_NEXT_STEP,
			detail: `HelmReleaseRemediationConflict: ${msg}`
		});
	});

	test('RolloutFailed and other reasons are "Not ready" with reason and message, nothing disclosed', () => {
		const i = readyIssue(ready('RolloutFailed', 'failed to patch OCIRepository: forbidden'))!;
		expect(i).toMatchObject({ kind: 'not-ready', title: 'Not ready', line: 'RolloutFailed: failed to patch OCIRepository: forbidden', detail: null });
		expect(readyIssue(ready('GateListFailed', 'timeout'))!.line).toBe('GateListFailed: timeout');
		expect(readyIssue(ready('SomethingNew', ''))!.line).toBe('SomethingNew');
	});

	test('reasons other banners own render nothing here', () => {
		expect(readyIssue(ready('BakeTimeFailed', 'checks failed'))).toBeNull();
		expect(readyIssue(ready('BakeTimeRetrying', 'Bake time reset, retrying deployment.'))).toBeNull();
		expect(readyIssue(ready('NoReleases', 'No releases available'))).toBeNull();
		expect(readyIssue(ready('RolloutSucceeded', 'No releases available'))).toBeNull();
	});

	/**
	 * QA1-1: the suppression list is pinned to the surfaces that own each reason, one row per owner. A reason added to
	 * or dropped from OWNED_ELSEWHERE without its owner changing fails here (and the page test proves the pairs on the page).
	 */
	test('the suppression list is exactly the reasons another surface owns', () => {
		const owners: Record<string, string> = {
			BakeTimeFailed: 'FailurePanel',
			BakeTimeRetrying: 'the deploy progress (a retry in flight, not a problem)',
			ReleaseSourceRequired: 'ReleaseSourceNotice',
			NoReleases: 'the builds card "No releases yet"'
		};
		expect([...OWNED_ELSEWHERE].sort()).toEqual(Object.keys(owners).sort());
	});

	test('ReleaseSourceRequired (written on Ready AND ReleasesUpdated) is ReleaseSourceNotice\'s, never a second banner', () => {
		const msg = 'spec.releaseSourceRef is not set, so this Rollout has no releases. Create a ReleaseSource for its artifact and reference it from spec.releaseSourceRef.';
		expect(readyIssue([{ type: 'ReleasesUpdated', status: 'False', reason: 'ReleaseSourceRequired', message: msg }, ...ready('ReleaseSourceRequired', msg)])).toBeNull();
	});

	test('ReleaseCatalogueUnavailable has no other surface, so the banner states it', () => {
		const msg = 'spec.releaseSourceRef is "hello", but the release-controller CRDs (ReleaseSource, ReleaseSlice) are not installed, so no releases are read; install release-controller and this Rollout will pick it up';
		expect(readyIssue(ready('ReleaseCatalogueUnavailable', msg))).toMatchObject({ kind: 'not-ready', title: 'Not ready', line: `ReleaseCatalogueUnavailable: ${msg}`, conflict: null, detail: null });
	});

	test('NoReleaseCandidates defers to the held banner while held, and speaks when nothing holds', () => {
		expect(readyIssue(ready('NoReleaseCandidates', 'No release candidates found'), { held: true })).toBeNull();
		expect(readyIssue(ready('NoReleaseCandidates', 'No release candidates found'), { held: false })!.line).toBe(
			'NoReleaseCandidates: No release candidates found'
		);
	});

	test('Ready True, Unknown or absent is no banner', () => {
		expect(readyIssue(ready('RolloutSucceeded', 'Release deployed successfully.', 'True'))).toBeNull();
		expect(readyIssue(ready('Progressing', '', 'Unknown'))).toBeNull();
		expect(readyIssue([])).toBeNull();
		expect(readyIssue(undefined)).toBeNull();
	});
});

describe('pathParts', () => {
	test('a path splits after each dot; joined back it is the plain path (no hidden characters to copy)', () => {
		expect(pathParts('spec.values.image.tag')).toEqual(['spec.', 'values.', 'image.', 'tag']);
		expect(pathParts('spec.postBuild.substitute.ORDERS_TAG').join('')).toBe('spec.postBuild.substitute.ORDERS_TAG');
		expect(pathParts('tag')).toEqual(['tag']);
	});

	test('no line or conflict field carries a zero-width character', () => {
		const i = readyIssue(ready('HelmReleaseFieldConflict', HELM))!;
		expect(/[\u200B\u200C\u200D\u2060]/.test(i.line + i.conflict!.path + i.conflict!.by)).toBe(false);
	});
});

describe('readyFacts: the banner record beside the drawn row', () => {
	const ago = () => '14m';
	test('a conflict records the reason, the controller hint (first clause) and since when; path and writer stay drawn only', () => {
		const i = readyIssue(ready('HelmReleaseFieldConflict', HELM))!;
		expect(readyFacts(i, ago)).toEqual([
			{ label: 'Reason', value: 'HelmReleaseFieldConflict' },
			{ label: 'Controller', value: 'Remove it from the manifest in Git so kuberik owns it' },
			{ label: 'Since', value: '14m ago' }
		]);
	});
	test('another rollout as the writer also records its raw field manager', () => {
		const msg =
			'Kustomization ns/k: spec.postBuild.substitute.API_TAG is also set by "rollout-controller/ns/hello-api". Release it.';
		const facts = readyFacts(readyIssue(ready('KustomizationFieldConflict', msg))!, ago);
		expect(facts).toContainEqual({ label: 'Field manager', value: 'rollout-controller/ns/hello-api' });
	});
	test('firstClause cuts at ;, a sentence end or a parenthesis', () => {
		expect(firstClause('a b; c d.')).toBe('a b');
		expect(firstClause('one. two')).toBe('one');
		expect(firstClause('x (y)')).toBe('x');
		expect(firstClause('plain')).toBe('plain');
	});
});

