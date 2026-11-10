import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/svelte';
import StatusMark from './StatusMark.svelte';
import type { NodeState } from '$lib/view-models/promotion-lanes';

const STATES: NodeState[] = ['failed', 'stuck', 'held', 'deploying', 'checking', 'behind', 'newest', 'none'];

/** Markup without Svelte's scoping hashes, so a snapshot pins structure and classes only. */
const markup = (state: NodeState, resolved = false) =>
	render(StatusMark, { state, resolved }).container.innerHTML.replace(/\s*svelte-[a-z0-9]+/g, '').replace(/<!---->/g, '');

describe('StatusMark: every existing state draws exactly as before the approval variant', () => {
	// Snapshots recorded on design/rollout 3ff95e1a BEFORE `approval` was added.
	for (const s of STATES) it(s, () => expect(markup(s)).toMatchSnapshot());
	it('failed, resolved', () => expect(markup('failed', true)).toMatchSnapshot());
});

describe('StatusMark: approval', () => {
	it('is an unfilled circle in the strongest ink with the person glyph, never the held pause or hue', () => {
		const { container } = render(StatusMark, { state: 'approval', label: 'waits for you' });
		const mark = container.querySelector('.sm-ask');
		expect(mark).toBeTruthy();
		expect(mark!.className).toContain('text-fg');
		expect(mark!.className).not.toMatch(/held|tint|bg-/);
		expect(mark!.querySelector('svg')).toBeTruthy();
		// Not the held pause (two vertical bars).
		expect(container.innerHTML).not.toContain('M9 5.5v13');
		expect(container.textContent).toContain('waits for you');
	});
});
