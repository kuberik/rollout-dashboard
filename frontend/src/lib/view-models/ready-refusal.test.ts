import { describe, expect, test } from 'vitest';
import { managerName, readyIssue } from './ready-refusal';

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
			line: 'HelmReleaseFieldConflict on spec.values.image.tag, also set by gitops-demo',
			detail: HELM,
			since: '2026-11-21T10:00:00Z'
		});
	});

	test('a Kustomization conflict names the variable path and the other manager', () => {
		const i = readyIssue(ready('KustomizationFieldConflict', KUST))!;
		expect(i.title).toBe('Deploy refused');
		expect(i.line).toBe('KustomizationFieldConflict on spec.postBuild.substitute.IMAGE_TAG, also set by gitops-demo');
		expect(i.detail).toBe(KUST);
	});

	test('a conflict with another rollout names that rollout', () => {
		const msg =
			'Kustomization hello-dep-dev/hello-dep: spec.postBuild.substitute.API_TAG is also set by "rollout-controller/hello-dep-dev/hello-api". Rollout hello-api wrote it before the annotation moved and still owns it.';
		expect(readyIssue(ready('KustomizationFieldConflict', msg))!.line).toBe(
			'KustomizationFieldConflict on spec.postBuild.substitute.API_TAG, also set by Rollout hello-api'
		);
	});

	test('an unnamed manager reads "another field manager"', () => {
		const msg = 'HelmRelease a/b: spec.values.x is also set by another field manager. Remove it.';
		expect(readyIssue(ready('HelmReleaseFieldConflict', msg))!.line).toBe('HelmReleaseFieldConflict on spec.values.x, also set by another field manager');
		expect(managerName(undefined)).toBe('another field manager');
	});

	test('an invalid annotation is refused; the object lead moves to the disclosed detail', () => {
		const msg = 'HelmRelease hello-helm-dev/hello-helm: rollout.kuberik.com/chart-version needs spec.chart.spec.';
		const i = readyIssue(ready('HelmReleaseInvalidAnnotation', msg))!;
		expect(i.kind).toBe('refused');
		expect(i.line).toBe('HelmReleaseInvalidAnnotation: rollout.kuberik.com/chart-version needs spec.chart.spec.');
		expect(i.detail).toBe(msg);
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
