import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/svelte';
import ReleaseSourceNotice from './ReleaseSourceNotice.svelte';
import { noticeLead } from '../releases/notice-copy';
import { RELEASE_SOURCE_REQUIRED_MESSAGE } from '../demo/mock-slices';
import type { Rollout } from '../../types';

/** rollout-controller internal/controller/rollout_slices.go `messageSourceRequired`, verbatim. */
const CONTROLLER_MESSAGE =
	'spec.releaseSourceRef is not set, so this Rollout has no releases. Create a ReleaseSource for the app ' +
	'and reference it from spec.releaseSourceRef; to migrate an existing Flux ImagePolicy, create a ReleaseSource with ' +
	'spec.oci.imagePolicyRef pointing at it';

const rollout = (spec: Record<string, unknown> = {}) =>
	({
		metadata: { name: 'recommender-svc', namespace: 'prod' },
		spec,
		status: {
			conditions: [
				{
					type: 'ReleasesUpdated',
					status: 'False',
					reason: 'ReleaseSourceRequired',
					message: CONTROLLER_MESSAGE
				}
			]
		}
	}) as unknown as Rollout;

const text = (c: HTMLElement) => (c.textContent ?? '').replace(/\s+/g, ' ');

describe('ReleaseSourceNotice', () => {
	it('the mock carries the controller message exactly', () => {
		expect(RELEASE_SOURCE_REQUIRED_MESSAGE).toBe(CONTROLLER_MESSAGE);
	});

	it('rollout page: leads with "This Rollout", the controller message sits in the footnote verbatim', () => {
		const { container } = render(ReleaseSourceNotice, { rollout: rollout() });
		const t = text(container);
		expect(t).toContain('This Rollout has no release source, so it has no releases.');
		expect(t).not.toContain("This app's rollout");
		expect(t).toContain(CONTROLLER_MESSAGE);
		expect(t.indexOf('This Rollout has no release source')).toBeLessThan(
			t.indexOf(CONTROLLER_MESSAGE)
		);
	});

	it('app page: leads with "This app\'s rollout" given the controller message as text', () => {
		const { container } = render(ReleaseSourceNotice, { app: true, text: CONTROLLER_MESSAGE });
		const t = text(container);
		expect(t).toContain("This app's rollout has no release source, so it has no releases.");
		expect(t).toContain(CONTROLLER_MESSAGE);
	});

	it('a legacy releasesImagePolicy adds its detail to the footnote, not the lead', () => {
		const { container } = render(ReleaseSourceNotice, {
			rollout: rollout({ releasesImagePolicy: { name: 'hello' } })
		});
		const t = text(container);
		expect(t).toContain(CONTROLLER_MESSAGE);
		expect(t).toContain('spec.releasesImagePolicy, which is ignored.');
		expect(t).toContain('ImagePolicy (hello)');
		expect(t.indexOf('has no release source, so it has no releases.')).toBeLessThan(
			t.indexOf('which is ignored')
		);
	});

	it('renders nothing for a Rollout that has a source', () => {
		const r = rollout({});
		(r.spec as Record<string, unknown>).releaseSourceRef = { name: 'x' };
		expect(text(render(ReleaseSourceNotice, { rollout: r }).container)).toBe('');
	});

	it('lead copy per reason and variant', () => {
		expect(noticeLead('ReleaseSourceRequired')).toBe(
			'This Rollout has no release source, so it has no releases.'
		);
		expect(noticeLead('ReleaseSourceRequired', true)).toBe(
			"This app's rollout has no release source, so it has no releases."
		);
		expect(noticeLead('ReleasesImagePolicyIgnored')).toBe(
			'This Rollout sets spec.releasesImagePolicy, which is ignored.'
		);
		expect(noticeLead('ReleasesImagePolicyIgnored', true)).toBe(
			"This app's rollout sets spec.releasesImagePolicy, which is ignored."
		);
		expect(noticeLead('NoReleases')).toBe(
			"This Rollout's release source has not published any releases yet."
		);
		expect(noticeLead('NoReleases', true)).toBe(
			"The release source of this app's rollout has not published any releases yet."
		);
	});
});
