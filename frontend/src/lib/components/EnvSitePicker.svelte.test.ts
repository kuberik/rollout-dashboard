import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/svelte';
import EnvSitePicker from './EnvSitePicker.svelte';

/** A site row's mark is the strip's own: a failed site with recovered checks draws the ring. */
describe('EnvSitePicker: the row mark of a failed site', () => {
	const site = (key: string, recovered: boolean) => ({ key, name: key, wave: null, state: 'failed' as const, word: 'Failed', href: `/${key}`, recovered });
	it('recovered draws the ring, failing now the solid disc', () => {
		const { container } = render(EnvSitePicker, { props: { sites: [site('eu', true), site('us', false)], title: 'prod', sub: '2 sites', anchor: undefined, open: true, id: 'p' } });
		const kind = (key: string) => container.querySelector(`[data-site-row="${key}"] [data-wave-mark]`)?.getAttribute('data-kinds');
		expect([kind('eu'), kind('us')]).toEqual(['recovered', 'failed']);
	});
});
