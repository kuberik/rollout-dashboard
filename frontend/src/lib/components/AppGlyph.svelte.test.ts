import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/svelte';
import AppGlyph from './AppGlyph.svelte';
import { appIdentity } from '$lib/app-identity';
import { expectFleetAppNames, publishFleetAppNames } from './app-monogram.svelte';

describe('AppGlyph', () => {
	it('draws the monogram in the app hue, hidden from assistive tech', () => {
		const { container } = render(AppGlyph, { name: 'checkout-api', size: 24 });
		const el = container.querySelector('.app-glyph') as HTMLElement;
		expect(el.textContent).toBe('CA');
		expect(el.getAttribute('aria-hidden')).toBe('true');
		expect(el.dataset.appHue).toBe(String(appIdentity('checkout-api').hue ?? 'neutral'));
		expect(el.style.width).toBe('24px');
	});

	it('draws a letterless placeholder of the same size until the fleet names are known, then the final letters', async () => {
		expectFleetAppNames();
		const { container } = render(AppGlyph, { name: 'hello-world-app', size: 20 });
		const el = container.querySelector('.app-glyph') as HTMLElement;
		expect(el.textContent).toBe('');
		expect(el.style.width).toBe('20px');
		publishFleetAppNames(['hello-world-app', 'hello-world-manifests']);
		await Promise.resolve();
		expect(el.textContent).toBe('WA');
	});
});
