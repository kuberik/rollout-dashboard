import { describe, expect, it } from 'vitest';
import { diffPageTitle } from './diff-page-title';

describe('diffPageTitle', () => {
	it('never prefixes a build id with a literal "v" (QA/TL round 7: "Diff vb-42")', () => {
		expect(
			diffPageTitle({
				rolloutName: 'checkout-edge',
				rolloutNamespace: 'checkout-edge-prod',
				toBuild: 'b-42',
				fallbackTag: 'b-42'
			})
		).toBe('checkout-edge (checkout-edge-prod) Diff b-42');
	});

	it('prints a non-semver tag (a sha) exactly as resolved, no "v"', () => {
		expect(
			diffPageTitle({
				rolloutName: 'checkout-edge',
				rolloutNamespace: 'checkout-edge-prod',
				toBuild: 'd09e6f4',
				fallbackTag: 'd09e6f4'
			})
		).toBe('checkout-edge (checkout-edge-prod) Diff d09e6f4');
	});

	it('falls back to the raw route param before the rollout has loaded, still no "v"', () => {
		expect(
			diffPageTitle({
				rolloutName: null,
				rolloutNamespace: null,
				toBuild: null,
				fallbackTag: 'b-42'
			})
		).toBe('Diff b-42');
	});

	it('prefers the resolved display version over the raw tag once loaded', () => {
		// e.g. `version.version` is a human-readable form the entry carries
		// that differs from the route param (`tag`) used to look it up.
		expect(
			diffPageTitle({
				rolloutName: 'checkout-edge',
				rolloutNamespace: 'checkout-edge-prod',
				toBuild: '4.43.0-43',
				fallbackTag: '4.43.0-43@sha1:abc123'
			})
		).toBe('checkout-edge (checkout-edge-prod) Diff 4.43.0-43');
	});
});

import { diffSubject, diffSubjectLabel } from './diff-page-title';

const e = (tag: string) => ({ version: { tag } });

describe('diffSubject', () => {
	const history = [e('d09e6f4'), e('b7e0d41'), e('2c8b409'), e('2c8b409'), e('a1b2c3d')];

	it('a change names both builds', () => {
		const { subject, index } = diffSubject({ history, tag: 'd09e6f4', atLimit: false });
		expect(index).toBe(0);
		expect(subject).toMatchObject({ kind: 'change', from: 'b7e0d41', to: 'd09e6f4', rollback: false });
		expect(diffSubjectLabel(subject)).toBe('b7e0d41 → d09e6f4');
	});

	it('the same build twice is a redeploy, not a change', () => {
		const { subject } = diffSubject({ history, tag: '2c8b409', atLimit: false });
		expect(subject).toEqual({ kind: 'redeploy', build: '2c8b409' });
		expect(diffSubjectLabel(subject)).toBe('Redeploy of 2c8b409');
	});

	it('the oldest entry of a complete history is the first deploy', () => {
		const { subject } = diffSubject({ history, tag: 'a1b2c3d', atLimit: false });
		expect(diffSubjectLabel(subject)).toBe('First deploy of a1b2c3d');
	});

	it('the oldest entry of a truncated history is not called a first deploy', () => {
		const { subject } = diffSubject({ history, tag: 'a1b2c3d', atLimit: true });
		expect(subject.kind).toBe('oldest');
	});

	it('a build the history does not hold is missing', () => {
		const { subject, index } = diffSubject({ history, tag: 'zzz', atLimit: false });
		expect(index).toBe(-1);
		expect(subject.kind).toBe('missing');
	});

	it('carries the rollback act through', () => {
		const { subject } = diffSubject({ history, tag: 'b7e0d41', atLimit: false, actKind: 'rollback' });
		expect(subject).toMatchObject({ kind: 'change', rollback: true });
	});
});

import { deployOutcome, spanLabel } from './diff-page-title';

describe('deployOutcome', () => {
	const t = '2026-10-10T10:00:00Z';
	const plus = (m: number) => new Date(new Date(t).getTime() + m * 60_000).toISOString();
	const now = new Date(t).getTime() + 26 * 60_000;

	it('a past healthy deploy says healthy, not the live state', () => {
		const o = deployOutcome({ bakeStatus: 'Succeeded', timestamp: t, bakeEndTime: plus(1) }, { live: false, now });
		expect(o.chip).toEqual({ role: 'ready', label: 'healthy' });
		expect(o.sentence).toBe('Healthy in 1m');
	});

	it('a failed deploy says failed after its span', () => {
		const o = deployOutcome({ bakeStatus: 'Failed', timestamp: t, bakeEndTime: plus(1) }, { live: false, now });
		expect(o.chip?.label).toBe('failed');
		expect(o.sentence).toBe('Failed after 1m');
		expect(o.tone).toBe('adverse');
	});

	it('the running deploy keeps the live chip', () => {
		const o = deployOutcome({ bakeStatus: 'InProgress', timestamp: t }, { live: true, now });
		expect(o.chip).toBeUndefined();
		expect(o.sentence).toBe('Checking for 26m');
	});

	it('a past deploy with no verdict was superseded, never "checking"', () => {
		const o = deployOutcome({ bakeStatus: 'InProgress', timestamp: t }, { live: false, now });
		expect(o.chip?.label).toBe('superseded');
	});

	it('spanLabel', () => {
		expect(spanLabel(90 * 60_000)).toBe('1h 30m');
		expect(spanLabel(26 * 3_600_000)).toBe('1d 2h');
	});
});
