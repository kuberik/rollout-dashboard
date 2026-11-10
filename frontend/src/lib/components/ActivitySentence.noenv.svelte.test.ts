import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/svelte';
import ActivitySentence from './ActivitySentence.svelte';

describe('ActivitySentence without an environment', () => {
	it('draws no separator glyph of its own anywhere, so nothing can be orphaned', () => {
		for (const env of [null, '']) {
			const { container } = render(ActivitySentence, {
				actor: { kind: 'controller' as const, name: 'kuberik' },
				kind: 'deployed' as const,
				app: 'payments-svc',
				appHref: '/x',
				env,
				from: null,
				to: '2.4.1',
				time: '14:25'
			});
			const rest = container.querySelector('.act-sentence-rest')!;
			expect(rest.textContent).not.toContain('·');
			expect(container.querySelector('.act-env')).toBeFalsy();
		}
	});
});
