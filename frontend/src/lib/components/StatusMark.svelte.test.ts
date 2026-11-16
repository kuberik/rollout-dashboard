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

describe('StatusMark: paused', () => {
	it('draws the held ring and pause glyph, never the done dot', () => {
		const html = markup('paused');
		expect(html).toContain('M9 5.5v13');
		expect(html).not.toContain('h-1.5 w-1.5');
		expect(html).toBe(markup('held'));
	});
});

describe('StatusMark: recovered (failed, every check OK again)', () => {
	const chip = (props: Record<string, unknown>) => render(StatusMark, { state: 'failed', ...props }).container.querySelector('span > span')!;
	it('the failed disc with its fill taken out: 1.5px danger ring, "!" in danger ink, no fill', () => {
		const c = chip({ recovered: true });
		expect(c.className).toContain('ring-[1.5px]');
		expect(c.className).toContain('ring-danger-solid');
		expect(c.className).toContain('text-danger');
		expect(c.className).not.toContain('bg-danger-solid');
		expect(c.className).not.toContain('ring-1 ');
		expect(c.querySelector('path')?.getAttribute('d')).toBe('M12 6v7M12 18h.01');
	});
	it('failing is still the solid disc; resolved wins over recovered', () => {
		expect(chip({}).className).toContain('bg-danger-solid');
		expect(chip({}).className).not.toContain('ring-[1.5px]');
		expect(chip({ recovered: true, resolved: true }).className).toBe(chip({ resolved: true }).className);
	});
	it('only a failed state takes it', () => {
		expect(chip({ state: 'stuck', recovered: true }).className).toBe(chip({ state: 'stuck' }).className);
	});
});
