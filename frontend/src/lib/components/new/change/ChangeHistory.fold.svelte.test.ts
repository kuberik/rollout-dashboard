import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/svelte';
import ChangeHistory from './ChangeHistory.svelte';
import type { Ev } from './detail-model';

/* QA strip r1 (9): no fixture carries more than ten events, so the fold is pinned here end to end on twelve synthetic ones (newest first, merge last) */
describe('ChangeHistory fold', () => {
	const at = (h: number) => new Date(Date.UTC(2026, 10, 12, 12 - h)).toISOString();
	const ev = (i: number, kind: Ev['kind'], words: string): Ev => ({ key: `e${i}`, kind, words, build: 'c6f19d2', place: null, places: [], tier: 'dev', at: at(i), who: null, href: '/rollouts/dev/x/y' });
	const events: Ev[] = [
		ev(0, 'moving', 'Checking'),
		...Array.from({ length: 9 }, (_, i) => ev(i + 1, 'deployed', 'Deployed to dev')),
		ev(10, 'released', 'Released'),
		ev(11, 'merged', 'Merged')
	];
	it('twelve events fold into one "Show N more" between two visible runs; the newest and the merge stay visible', () => {
		const { container, getByText } = render(ChangeHistory, { props: { events } });
		const rows = [...container.querySelectorAll('[data-ev]')];
		expect(rows.length).toBeLessThan(12);
		expect(getByText(/^Show \d+ more$/)).toBeTruthy();
		expect(rows[0].getAttribute('data-ev')).toBe('moving');
		expect(rows[rows.length - 1].getAttribute('data-ev')).toBe('merged');
		expect(rows.length + Number(getByText(/^Show \d+ more$/).textContent!.match(/\d+/)![0])).toBe(12);
	});
});
