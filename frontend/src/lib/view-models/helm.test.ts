import { describe, it, expect } from 'vitest';
import { helmView, helmWordOf, helmKey, isHelmKey, withoutExpandedHelm, hasHelm } from './helm';
import type { HelmRelease, ManagedResourceStatus } from '../../types';

const hr = (status: Record<string, unknown>, spec: Record<string, unknown> = {}, generation = 3): HelmRelease => ({
	metadata: { name: 'cart', namespace: 'shop', generation },
	spec,
	status
});
const ready = (status: string, reason = '', extra: Record<string, unknown> = {}) => ({ type: 'Ready', status, reason, message: `${reason} message`, observedGeneration: 3, ...extra });

describe('helmWordOf', () => {
	it('reads Ready=True as Ready', () => {
		expect(helmWordOf(hr({ conditions: [ready('True', 'UpgradeSucceeded')] })).word).toBe('Ready');
	});
	it('reads no Ready condition as Pending', () => {
		expect(helmWordOf(hr({ conditions: [] })).word).toBe('Pending');
	});
	it('does not trust a Ready written for an older generation', () => {
		const v = helmWordOf(hr({ conditions: [ready('True', 'UpgradeSucceeded', { observedGeneration: 2 })] }));
		expect(v.word).toBe('Pending');
		expect(v.message).toMatch(/generation 3/);
	});
	it('reads a retryable Ready=False as Pending and a terminal one as Failed', () => {
		expect(helmWordOf(hr({ conditions: [ready('False', 'Progressing')] })).word).toBe('Pending');
		const failed = helmWordOf(hr({ conditions: [ready('False', 'UpgradeFailed')] }));
		expect(failed.word).toBe('Failed');
		expect(failed.message).toBe('UpgradeFailed message');
	});
	it('reads Stalled=True as Failed even when Ready says Progressing', () => {
		const v = helmWordOf(hr({ conditions: [ready('False', 'Progressing'), { type: 'Stalled', status: 'True', message: 'retries exhausted' }] }));
		expect(v).toEqual({ word: 'Failed', message: 'retries exhausted' });
	});
	it('reads Ready Unknown as Pending', () => {
		expect(helmWordOf(hr({ conditions: [ready('Unknown', 'Progressing')] })).word).toBe('Pending');
	});
});

describe('helmView', () => {
	it('takes chart, version, app version and revision from the latest history entry', () => {
		const v = helmView(hr({ history: [{ chartName: 'cart', chartVersion: '1.2.0', appVersion: '2.0.1', version: 7 }], conditions: [ready('True')] }));
		expect(v).toMatchObject({ name: 'cart', namespace: 'shop', chart: 'cart', chartVersion: '1.2.0', appVersion: '2.0.1', revision: 7, word: 'Ready' });
	});
	it('falls back to the chart spec, then the chartRef, before anything is installed', () => {
		expect(helmView(hr({}, { chart: { spec: { chart: 'cart', version: '1.x' } } }))).toMatchObject({ chart: 'cart', chartVersion: '1.x', revision: null });
		expect(helmView(hr({ lastAttemptedRevision: '1.3.0' }, { chartRef: { kind: 'OCIRepository', name: 'cart-chart' } }))).toMatchObject({ chart: 'cart-chart', chartVersion: '1.3.0' });
	});
});

describe('managed-resources record', () => {
	it('keys a HelmRelease by namespace and name, apart from Kustomization names', () => {
		expect(helmKey('shop', 'cart')).toBe('helmrelease/shop/cart');
		expect(isHelmKey(helmKey('shop', 'cart'))).toBe(true);
		expect(isHelmKey('apps')).toBe(false);
	});
	it('drops the HelmRelease and its expanded children from a Kustomization list, keeping the rest', () => {
		const r = (gvk: string, name: string, helmRelease?: string) => ({ groupVersionKind: gvk, name, namespace: 'shop', status: 'Current', message: '', lastModified: '', ...(helmRelease ? { helmRelease } : {}) }) as ManagedResourceStatus;
		const out = withoutExpandedHelm([r('helm.toolkit.fluxcd.io/v2/HelmRelease', 'cart'), r('apps/v1/Deployment', 'cart', 'shop/cart'), r('apps/v1/Deployment', 'web'), r('v1/ConfigMap', 'cfg')]);
		expect(out.map((x) => x.name)).toEqual(['web', 'cfg']);
	});
	it('knows whether a rollout response carries any HelmRelease', () => {
		expect(hasHelm(undefined)).toBe(false);
		expect(hasHelm({ helmReleases: { items: [] } })).toBe(false);
		expect(hasHelm({ helmReleases: { items: [{}] } })).toBe(true);
	});
});
