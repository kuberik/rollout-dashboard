import { describe, test, expect } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render } from '@testing-library/svelte';
import ChangeDot from './ChangeDot.svelte';
import type { FamilyProgressStep } from '../view-models/changes';

/**
 * ⭐ D1 FIX (QA round 4, 2026-10-11, coordinator ruling) — THE ONE DOT,
 * PINNED DIRECTLY. `ChangeLine.svelte` and `CommandPalette.svelte` both
 * render `<ChangeDot {step} />` now instead of two hand-written copies of
 * the same class-selection chain — the copies had already drifted (the
 * palette drew a PARTIAL rollback, `liveCount < builtCount`, as a plain
 * filled green dot; `ChangeLine`'s own copy had the live-ring branch the
 * palette's never did). Pinning the component's OWN output, once, is what
 * makes every caller identical BY CONSTRUCTION rather than by two tests
 * independently agreeing — see each caller's own render tests
 * (`ChangeLine.svelte.test.ts`, `CommandPalette.svelte.test.ts`) for proof
 * they render this component at all.
 */

function step(overrides: Partial<FamilyProgressStep>): FamilyProgressStep {
	return {
		family: 'PROD',
		familyOrder: 3,
		tone: 'live',
		state: null,
		builtCount: 6,
		liveCount: 5,
		sentence: '',
		approvalWait: false,
		resolved: false,
		anyResolved: false,
		...overrides
	};
}

describe('ChangeDot', () => {
	// payments-core #88's own PROD step: 5 of 6 regions live, 1 rolled back
	// (`prod-eu-central`) — the real shape the D3 fix exists for.
	test('a partial-live family (payments-core #88 shape) draws the live-ring, never a filled or dashed dot', () => {
		const { container } = render(ChangeDot, {
			props: { step: step({ tone: 'live', builtCount: 6, liveCount: 5, anyResolved: true }) }
		});
		const dot = container.querySelector('.cl-dot') as HTMLElement;
		expect(dot.className.split(/\s+/).filter((c) => !c.startsWith('svelte-'))).toEqual(['cl-dot', 'cl-dot--live-ring']);
	});

	test('a fully live family draws the solid filled dot', () => {
		const { container } = render(ChangeDot, {
			props: { step: step({ tone: 'live', builtCount: 6, liveCount: 6 }) }
		});
		const dot = container.querySelector('.cl-dot') as HTMLElement;
		expect(dot.className.split(/\s+/).filter((c) => !c.startsWith('svelte-'))).toEqual(['cl-dot', 'bg-success-solid']);
	});

	test('a fully resolved family (step.resolved) draws dashed, never the active/pulsing dot', () => {
		const { container } = render(ChangeDot, {
			props: { step: step({ tone: 'active', state: 'rolled-back', resolved: true, anyResolved: true }) }
		});
		const dot = container.querySelector('.cl-dot') as HTMLElement;
		expect(dot.className.split(/\s+/).filter((c) => !c.startsWith('svelte-'))).toEqual(['cl-dot', 'cl-dot--dashed']);
	});

	test('a genuinely in-flight (promoting) family draws the blue pulsing dot', () => {
		const { container } = render(ChangeDot, {
			props: { step: step({ tone: 'active', state: 'promoting', builtCount: 1, liveCount: 0 }) }
		});
		const dot = container.querySelector('.cl-dot') as HTMLElement;
		expect(dot.className.split(/\s+/).filter((c) => !c.startsWith('svelte-'))).toEqual(['cl-dot', 'bg-active-solid', 'animate-pulse']);
	});

	test('a held (stuck) family draws the amber dot', () => {
		const { container } = render(ChangeDot, {
			props: { step: step({ tone: 'stuck', state: 'gated', builtCount: 1, liveCount: 0 }) }
		});
		const dot = container.querySelector('.cl-dot') as HTMLElement;
		expect(dot.className.split(/\s+/).filter((c) => !c.startsWith('svelte-'))).toEqual(['cl-dot', 'bg-held-solid']);
	});
});
