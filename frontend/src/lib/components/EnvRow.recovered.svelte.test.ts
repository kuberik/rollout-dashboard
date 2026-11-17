import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/svelte';
import EnvRow from './EnvRow.svelte';

/** The strip's marks speak failing or failed: a failed place whose checks recovered reads failed (aria label), one failing now reads failing. */
describe('EnvRow: the mark label of a failed place', () => {
	const site = (recovered: boolean) => ({ key: 'a', name: 'eu-west', wave: null, state: 'failed' as const, word: 'Failed', href: '/a', recovered });
	it('a site strip mark', () => {
		for (const [recovered, word] of [[true, 'failed'], [false, 'failing']] as const) {
			const { container, unmount } = render(EnvRow, { cells: [{ key: 'prod', label: 'prod', sites: [site(recovered)] }] });
			expect(container.querySelector('[data-wave-mark]')?.getAttribute('aria-label')).toBe(`prod: 1 ${word}`);
			unmount();
		}
	});
	it('a box mark', () => {
		for (const [recovered, word] of [[true, 'failed'], [false, 'failing']] as const) {
			const { container, unmount } = render(EnvRow, { cells: [{ key: 'prod', label: 'prod', word: 'x', mark: { state: 'failed' as const, recovered } }] });
			expect(container.querySelector('[data-wave-mark]')?.getAttribute('aria-label')).toBe(`prod: 1 ${word}`);
			unmount();
		}
	});
});
