import { describe, test, expect } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render } from '@testing-library/svelte';
import FleetCard from './FleetCard.svelte';
import { TONE } from '$lib/view-models/state-tone';

describe('Home fleet draws a held / paused row with the /rollouts held mark', () => {
	test.each(['Held', 'Paused'] as const)('%s: StatusMark held ring (held ink on the held tint), not a neutral glyph', (word) => {
		render(FleetCard, {
			props: { trouble: [{ key: 'a', app: 'inventory-api', failing: false, mark: 'held', word, href: '/x', places: [{ tier: 'prod', place: '' }] }], deploys: [] }
		});
		const mark = document.querySelector('[data-fleet-row="trouble"] span.rounded-full');
		expect(mark).not.toBeNull();
		for (const c of TONE.held.chip.split(' ')) expect(mark!.className).toContain(c);
		expect(document.querySelector('[data-fleet-row="trouble"] svg.text-fg-muted')).toBeNull();
	});
});
