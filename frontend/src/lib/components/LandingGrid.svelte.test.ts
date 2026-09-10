import { describe, test, expect } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render } from '@testing-library/svelte';
import LandingGrid from './LandingGrid.svelte';
import type { LandingServiceVM } from '../view-models/landing-grid';

/**
 * R2.5(a)/(b) — CHANGES-2026-09-10.md ROUND 2. Two regressions this file
 * guards against:
 *
 *  1. `grid-template-columns` reverting to a stretched `minmax(44px, auto)`
 *     track, which absorbed a full-width card's free space and pinned
 *     DEV/STG/PRD hundreds of pixels apart (measured live at 1440).
 *  2. `queued` (the normal "waiting its turn in the promotion order" state)
 *     drawing ANY orange — amber is reserved for genuinely `stuck` states
 *     (`gated`/`waiting-upstream`/`pinned`) and must never bleed onto the
 *     ordinary wait.
 *
 * jsdom does not lay out CSS, so this file checks the STRING the component
 * emits (the inline `style` attribute, and the rendered class list) rather
 * than a computed pixel width — the actual rendered width is verified in
 * the browser (LA's own 2×2 harness, `routes/_dev/changes`).
 */

function mkMark(family: string, familyOrder: number, state: LandingServiceVM['marks'][number]['state']) {
	return {
		family,
		familyOrder,
		count: 1,
		state,
		tone: state === 'queued' ? ('queued' as const) : ('active' as const),
		sentence: `${family}: ${state}`,
		href: '/rollouts/dev/ns/app',
		theme: null
	};
}

function mkService(appName: string, marks: ReturnType<typeof mkMark>[]): LandingServiceVM {
	return { appName, marks, verdictWord: 'active', landedCount: 0, total: marks.length };
}

describe('LandingGrid — R2.5(a) content-sized columns', () => {
	test('grid-template-columns has no `auto` and no `1fr` track for 3 families', () => {
		const services = [
			mkService('svc-a', [mkMark('DEV', 0, 'live'), mkMark('STG', 2, 'live'), mkMark('PRD', 3, 'live')])
		];
		const { container } = render(LandingGrid, { props: { services } });
		const grid = container.querySelector('.lg-grid') as HTMLElement;
		expect(grid).toBeTruthy();
		const style = grid.getAttribute('style') ?? '';
		expect(style).toContain('grid-template-columns');
		expect(style).not.toMatch(/\bauto\b/);
		expect(style).not.toMatch(/1fr/);
		expect(style).toMatch(/max-content/);
	});

	test('column count tracks the union of families across services, not a fixed 3', () => {
		const services = [
			mkService('svc-a', [mkMark('DEV', 0, 'live')]),
			mkService('svc-b', [mkMark('DEV', 0, 'live'), mkMark('STG', 2, 'live'), mkMark('PRD', 3, 'live'), mkMark('TEST', 1, 'live')])
		];
		const { container } = render(LandingGrid, { props: { services } });
		const grid = container.querySelector('.lg-grid') as HTMLElement;
		const style = grid.getAttribute('style') ?? '';
		// name column + 4 families (DEV/TEST/STG/PRD)
		expect(style).toMatch(/repeat\(4, max-content\)/);
	});
});

describe("LandingGrid/LandingMark — R2.5(b) 'waiting its turn' carries no amber", () => {
	test('a `queued` mark renders no orange anywhere in its markup', () => {
		const services = [mkService('svc-a', [mkMark('DEV', 0, 'queued')])];
		const { container } = render(LandingGrid, { props: { services } });
		expect(container.innerHTML).not.toMatch(/orange/i);
	});

	test('a `queued` mark is not classed `lm--held` (the one class that darkens word ink for a stuck state)', () => {
		const services = [mkService('svc-a', [mkMark('DEV', 0, 'queued')])];
		const { container } = render(LandingGrid, { props: { services } });
		const mark = container.querySelector('a.lm') as HTMLElement;
		expect(mark).toBeTruthy();
		expect(mark.className).not.toMatch(/lm--held/);
		expect(mark.className).not.toMatch(/lm--dashed/);
	});

	test('a genuinely `stuck` mark (`gated`) DOES carry the held class — the amber budget is not deleted, only narrowed', () => {
		const services = [mkService('svc-a', [mkMark('DEV', 0, 'gated')])];
		const { container } = render(LandingGrid, { props: { services } });
		const mark = container.querySelector('a.lm') as HTMLElement;
		expect(mark.className).toMatch(/lm--held/);
	});
});
