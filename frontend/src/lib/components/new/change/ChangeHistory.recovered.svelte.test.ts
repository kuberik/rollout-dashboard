import { describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/svelte';
import ChangeHistory from './ChangeHistory.svelte';
import type { Ev } from './detail-model';

/* the page asks the data layer whether a place that is still failed has every check OK again; the spec names the places that do */
const rec = vi.hoisted(() => ({ ok: new Set<string>() }));
vi.mock('../data', async (orig) => ({ ...(await orig<typeof import('../data')>()), failureRecoveredNow: (href: string) => rec.ok.has(href) }));

/** The History card's failed mark: a place's NEWEST failure whose checks recovered is the ring; failing now is the solid disc; an earlier failure of the same place is history, never the ring. */
describe('ChangeHistory: the failed mark', () => {
	const at = (m: number) => new Date(Date.UTC(2026, 10, 16, 12, 60 - m)).toISOString();
	const ev = (key: string, m: number, href: string): Ev => ({ key, kind: 'failed', words: 'Failed', build: 'c6f19d2', place: 'prod', places: [], tier: 'prod', at: at(m), who: null, href });
	const chips = (events: Ev[]) => {
		const { container } = render(ChangeHistory, { props: { events } });
		return new Map([...container.querySelectorAll('[data-ev="failed"]')].map((li, i) => [events[i].key, li.querySelector('span.rounded-full.ring-inset')!.className]));
	};
	it('recovered place: newest failure = ring, the older failure of the same place stays solid', () => {
		rec.ok = new Set(['/p']);
		const c = chips([ev('new', 5, '/p'), ev('old', 50, '/p')]);
		expect(c.get('new')).toContain('ring-[1.5px]');
		expect(c.get('new')).not.toContain('bg-danger-solid');
		expect(c.get('old')).toContain('bg-danger-solid');
	});
	it('failing now (or no evidence): the solid disc', () => {
		rec.ok = new Set();
		expect(chips([ev('only', 5, '/p')]).get('only')).toContain('bg-danger-solid');
	});
	it('the verb follows the mark: a recovered failure reads neutral, failing now and an older failure keep danger ink', () => {
		rec.ok = new Set(['/p']);
		const { container } = render(ChangeHistory, { props: { events: [ev('new', 5, '/p'), ev('old', 50, '/p')] } });
		const [nw, old] = [...container.querySelectorAll('[data-ev="failed"] [data-ev-verb]')].map((v) => v.className);
		expect(nw).toContain('text-fg-muted');
		expect(nw).not.toContain('text-danger');
		expect(old).toContain('text-danger');
	});
});
