import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/svelte';
import DayRow from './DayRow.svelte';

/** /envs/<env> Today: the place's newest failure whose checks recovered is the ring; any other failed row is the solid disc. */
describe('DayRow failed mark', () => {
	const row = (recovered?: boolean) => ({ key: 'k', kind: 'failed' as const, app: 'catalog-api', href: '/rollouts/x/y/z', place: '', title: null, build: 'a1b2c3d', who: 'Automatic', age: '3h', mark: null, reason: null, ...(recovered ? { recovered } : {}) });
	const chip = (recovered?: boolean) => render(DayRow, { row: row(recovered) }).container.querySelector('.dr-mk span.rounded-full')!.className;
	it('ring vs solid', () => {
		expect(chip(true)).toContain('ring-[1.5px]');
		expect(chip()).toContain('bg-danger-solid');
	});
});

/** The word and its ink follow the rule: failing now "Failing" in danger ink, a failure that is over "Failed" in neutral ink. */
describe('DayRow failed word', () => {
	const word = (extra: object) => render(DayRow, { row: { key: 'k', kind: 'failed' as const, app: 'a', href: '/x', place: '', title: null, build: 'a1b2c3d', who: 'Automatic', age: '3h', mark: null, reason: null, ...extra } }).container.querySelector('[data-word]')!;
	it('failing now: Failing, danger ink', () => {
		const w = word({});
		expect(w.textContent).toBe('Failing');
		expect(w.className).toContain('text-danger');
	});
	for (const extra of [{ recovered: true }, { superseded: true }]) it(`${JSON.stringify(extra)}: Failed, neutral ink`, () => {
		const w = word(extra);
		expect(w.textContent).toBe('Failed');
		expect(w.className).toContain('text-fg-muted');
		expect(w.className).not.toContain('text-danger');
	});
});
