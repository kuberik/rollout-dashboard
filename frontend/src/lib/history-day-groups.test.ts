import { describe, expect, it } from 'vitest';
import { groupByDay } from './history-day-groups';

const o = { dayKeyOf: (s: string) => s.slice(0, 10), labelOf: (d: string) => d, totalOf: () => 1 };

describe('groupByDay', () => {
	it('groups entries of one second into one section', () => {
		const g = groupByDay(['2026-11-21T14:18:11Z', '2026-11-21T14:18:11Z'], o);
		expect(g).toHaveLength(1);
		expect(g[0].items).toHaveLength(2);
	});
	it('gives a day that comes back after another day its own distinct key', () => {
		const g = groupByDay(['2026-11-21T00:00:05Z', '2026-11-20T23:59:59Z', '2026-11-21T00:00:01Z'], o);
		expect(g.map((x) => x.key)).toEqual(['2026-11-21', '2026-11-20', '2026-11-21#2']);
		expect(new Set(g.map((x) => x.key)).size).toBe(3);
	});
});
